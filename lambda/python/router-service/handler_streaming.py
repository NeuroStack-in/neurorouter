"""
Router Service — Streaming Lambda Handler (Day 3)
===================================================
Separate entry point for streaming AI responses.

WHY A SEPARATE FILE FROM handler.py?
- Lambda Response Streaming uses a DIFFERENT function signature
- Regular handler: def handler(event, context) → returns dict
- Streaming handler: def handler(event, response_stream, context) → writes to stream
- API Gateway integration points to a different handler for streaming routes
- Dev 1 configures InvokeMode: RESPONSE_STREAM in CDK for this Lambda

HOW LAMBDA RESPONSE STREAMING WORKS:

    Regular Lambda:
        def handler(event, context):
            return {"statusCode": 200, "body": "..."}  ← ONE response at the end

    Streaming Lambda:
        def handler(event, response_stream, context):
            response_stream.write(b"chunk 1...")   ← Write progressively
            response_stream.write(b"chunk 2...")
            response_stream.write(b"chunk 3...")
            response_stream.close()                ← Signal "done"

HOW SSE (Server-Sent Events) WORKS:

    The client receives lines like this, one at a time:
        data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"Hello"}}]}
        data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":" to"}}]}
        data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":" you"}}]}
        data: [DONE]

    - Each "data:" line is a chunk containing a small piece of the response
    - "delta" = the incremental addition (not the full text so far)
    - Client reconstructs the full message by concatenating all deltas
    - "data: [DONE]" signals the stream is finished
    - Token usage appears in the LAST chunk before [DONE]

PORTED FROM:
    - app/proxy.py → stream_sse() (lines 32-64)
    - app/routers/openai_proxy.py → chat_completions() streaming path (lines 43-64)
"""

import asyncio
import json
import os
from typing import Any, Dict, Optional

from providers.groq_adapter import GroqAdapter
from provider_adapter import ProviderError
from secrets_client import get_secret
from usage import record_usage


# ──────────────────────────────────────────────────────────────────
# CONSTANTS (same as handler.py)
# ──────────────────────────────────────────────────────────────────

GROQ_SECRET_NAME_ENV = "GROQ_SECRET_NAME"
DEFAULT_MODEL = "llama-3.3-70b-versatile"


def _get_groq_api_key(user_id: str = None) -> str:
    """
    Get Groq API key, with per-user key support.

    PORTED FROM: app/routers/openai_proxy.py line 37:
        user_key = auth_context.user.groq_cloud_api_key or settings.groq_api_key

    NEW BEHAVIOR:
    1. Try per-user secret: "neurorouter/prod/user-groq-key/{userId}"
    2. Fall back to default: "neurorouter/prod/groq-api-key"
    3. Fall back to env var: GROQ_API_KEY (local testing)

    WHY per-user keys?
    - Some users bring their own Groq API key
    - Their key is stored in Secrets Manager under a user-specific name
    - If they don't have one, we use the platform's default key
    """
    # Try per-user key first
    if user_id:
        user_secret_name = os.environ.get("USER_GROQ_SECRET_PREFIX", "")
        if user_secret_name:
            try:
                return get_secret(f"{user_secret_name}/{user_id}")
            except Exception:
                pass  # No per-user key — fall through to default

    # Default platform key from Secrets Manager
    secret_name = os.environ.get(GROQ_SECRET_NAME_ENV)
    if secret_name:
        return get_secret(secret_name)

    # Fallback for local testing
    fallback = os.environ.get("GROQ_API_KEY", "")
    if fallback:
        return fallback

    raise EnvironmentError(
        "No Groq API key available. "
        "Set GROQ_SECRET_NAME or GROQ_API_KEY environment variable."
    )


def _write_error_response(response_stream, status_code: int, message: str):
    """
    Write an error as a valid SSE stream, then close.

    WHY not just close the stream?
    - The client is expecting SSE format
    - If we just close, the client gets a broken pipe with no explanation
    - By writing an error in SSE format, the client can display it to the user
    """
    error_data = json.dumps({
        "error": {
            "message": message,
            "type": "upstream_error",
            "code": status_code,
        }
    })
    response_stream.write(f"data: {error_data}\n\n".encode("utf-8"))
    response_stream.write(b"data: [DONE]\n\n")
    response_stream.close()


async def _handle_streaming(event: Dict, response_stream) -> None:
    """
    Handle streaming chat completions.

    This is the core streaming logic:
    1. Parse the request
    2. Get Groq API key (with per-user support)
    3. Call GroqAdapter in streaming mode
    4. Forward each SSE chunk to the client via response_stream
    5. Capture usage from the final chunk
    6. Record usage in DynamoDB after stream completes
    """

    # Parse event (same as handler.py)
    raw_body = event.get("body", "")
    try:
        body = json.loads(raw_body) if raw_body else {}
    except json.JSONDecodeError:
        body = {}

    authorizer = event.get("requestContext", {}).get("authorizer", {})
    user_id = authorizer.get("userId", "")
    api_key_id = authorizer.get("apiKeyId", "")
    requested_model = body.get("model", DEFAULT_MODEL)

    # Force stream=true (that's why we're in the streaming handler)
    body["stream"] = True

    # Get Groq API key (with per-user key support)
    try:
        groq_key = _get_groq_api_key(user_id=user_id)
    except Exception as e:
        _write_error_response(response_stream, 502, str(e))
        return

    # Create adapter and call Groq in streaming mode
    adapter = GroqAdapter(api_key=groq_key)

    try:
        # This returns an async iterator of SSE bytes
        # from GroqAdapter._stream_sse()
        stream_iterator = await adapter.chat_completions(body, stream=True)
    except ProviderError as e:
        _write_error_response(response_stream, e.status_code, str(e.detail))
        return
    except Exception as e:
        _write_error_response(response_stream, 502, f"Failed to connect to Groq: {e}")
        return

    # Forward each SSE chunk from Groq to the client
    # This is where the "typing effect" happens — each chunk arrives in real-time
    last_usage: Optional[Dict[str, Any]] = None

    try:
        async for chunk in stream_iterator:
            # Write the chunk to the response stream (client receives it immediately)
            response_stream.write(chunk)

            # Parse SSE lines to capture usage data from the final chunk
            # Usage appears in the last content chunk before [DONE]
            line = chunk.decode("utf-8", errors="replace").strip()
            if line.startswith("data: "):
                data_str = line[len("data: "):]
                if data_str and data_str != "[DONE]":
                    try:
                        parsed = json.loads(data_str)
                        usage = parsed.get("usage")
                        if usage:
                            last_usage = usage
                    except Exception:
                        pass

    except Exception as e:
        # If the stream breaks mid-way, send an error and close
        _write_error_response(response_stream, 502, f"Stream interrupted: {e}")
        return

    # Close the response stream — signals to the client that we're done
    response_stream.close()

    # Record usage in DynamoDB AFTER the stream completes
    # WHY after? Because token usage only appears in the final chunk.
    # We couldn't record it until the stream was done.
    usage_to_record = last_usage or adapter.last_stream_usage
    if usage_to_record:
        try:
            record_usage(
                user_id=user_id,
                api_key_id=api_key_id,
                model=requested_model,
                usage=usage_to_record,
            )
        except Exception as e:
            print(f"WARNING: Failed to record streaming usage: {e}")


def lambda_handler(event, response_stream, context):
    """
    Streaming Lambda entry point.

    DIFFERENT FROM handler.py:
    - Takes 3 args: (event, response_stream, context) instead of (event, context)
    - response_stream is where we write bytes progressively
    - Must be configured with InvokeMode: RESPONSE_STREAM in CDK

    WHY asyncio.run()?
    - GroqAdapter uses async HTTP (httpx)
    - Lambda handlers are sync by default
    - asyncio.run() runs the async streaming logic inside sync context
    """
    # Check if the request is actually a streaming request
    raw_body = event.get("body", "")
    try:
        body = json.loads(raw_body) if raw_body else {}
    except json.JSONDecodeError:
        body = {}

    if not body.get("stream", False):
        # Non-streaming request reached the streaming handler
        # This shouldn't happen if API Gateway is configured correctly,
        # but handle it gracefully
        error = json.dumps({
            "error": {
                "message": "Non-streaming request sent to streaming endpoint. "
                           "Set stream=true or use the non-streaming endpoint.",
                "type": "invalid_request_error",
            }
        })
        response_stream.write(error.encode("utf-8"))
        response_stream.close()
        return

    asyncio.run(_handle_streaming(event, response_stream))
