"""
Router Service — Lambda Handler (Day 2: Non-Streaming Implementation)
======================================================================
Main entry point for the NeuroRouter inference Lambda.

WHAT CHANGED FROM DAY 1 PLACEHOLDER:
- Day 1: Returned "I'm alive" for all requests
- Day 2: Real route dispatcher + non-streaming chat completions + usage recording

HOW THE REQUEST FLOWS (complete picture):

    Client sends POST /v1/chat/completions
        ↓
    API Gateway receives it
        ↓
    Dev 1's Go Authorizer validates the API key
    and injects userId/apiKeyId/planId/accountStatus
        ↓
    THIS Lambda is invoked with the enriched event
        ↓
    lambda_handler() — Route Dispatcher
        ↓ reads path → "/v1/chat/completions"
    _handle_chat_completions()
        ↓ gets Groq API key from Secrets Manager
    GroqAdapter.chat_completions(payload)
        ↓ forwards to Groq Cloud
    Groq responds with AI completion + usage tokens
        ↓
    usage.record_usage() — writes to DynamoDB
        ↓
    Response returned to client

WHAT'S IN THE 'event' (reminder):
{
    "httpMethod": "POST",
    "path": "/v1/chat/completions",
    "body": '{"model":"gpt-4","messages":[{"role":"user","content":"Hi"}]}',
    "requestContext": {
        "authorizer": {
            "userId": "abc123",
            "apiKeyId": "key456",
            "planId": "free",
            "accountStatus": "ACTIVE"
        }
    }
}
"""

import asyncio
import json
import os
from typing import Any, Dict, Tuple

from providers.groq_adapter import GroqAdapter
from provider_adapter import ProviderError
from secrets_client import get_secret
from usage import record_usage
from model_catalog import to_openai_format


# ──────────────────────────────────────────────────────────────────
# CONSTANTS
# ──────────────────────────────────────────────────────────────────

# Environment variable names for Secrets Manager secret names.
# Dev 1 sets these in the Lambda configuration via CDK.
# Example: GROQ_SECRET_NAME = "neurorouter/prod/groq-api-key"
GROQ_SECRET_NAME_ENV = "GROQ_SECRET_NAME"

# Default model — same as the old settings.default_model
DEFAULT_MODEL = "llama-3.3-70b-versatile"

# Standard CORS headers — included in every response so browsers
# can call this API. Without these, browser JavaScript gets blocked
# by the browser's Same-Origin Policy.
CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
}


# ──────────────────────────────────────────────────────────────────
# HELPER FUNCTIONS
# ──────────────────────────────────────────────────────────────────


def _build_response(status_code: int, body: Any) -> Dict[str, Any]:
    """
    Build a standard API Gateway response.

    WHY this helper?
    - Every response needs the same structure (statusCode, headers, body)
    - API Gateway requires body to be a STRING, not a dict
    - json.dumps() converts dict → string
    - CORS headers are included in every response

    Args:
        status_code: HTTP status (200, 400, 502, etc.)
        body: Response body (dict that gets JSON-serialized)

    Returns:
        API Gateway response dict
    """
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body) if isinstance(body, dict) else body,
    }


def _parse_event(event: Dict) -> Tuple[str, str, Dict, Dict]:
    """
    Extract the key pieces from an API Gateway event.

    Returns:
        (http_method, path, body_dict, authorizer_context)

    WHY parse body separately?
    - API Gateway sends body as a STRING (JSON-encoded)
    - We need to json.loads() it to get a Python dict
    - If body is None (e.g., GET request), we return empty dict
    """
    http_method = event.get("httpMethod", "").upper()
    path = event.get("path", "")

    # Parse the JSON body (API Gateway sends it as a string)
    raw_body = event.get("body")
    if raw_body:
        try:
            body = json.loads(raw_body)
        except json.JSONDecodeError:
            body = {}
    else:
        body = {}

    # Authorizer context — injected by Dev 1's Go authorizer
    authorizer = event.get("requestContext", {}).get("authorizer", {})

    return http_method, path, body, authorizer


def _get_groq_api_key() -> str:
    """
    Get the Groq API key from AWS Secrets Manager.

    WHY not from environment variable?
    - Env vars are visible in the Lambda console to anyone with access
    - Secrets Manager encrypts the key and logs every access
    - The secret is cached after first fetch (see secrets_client.py)

    FLOW:
    1. Read GROQ_SECRET_NAME env var → "neurorouter/prod/groq-api-key"
    2. Fetch that secret from Secrets Manager → "gsk_xxx..."
    3. Return the API key string

    FALLBACK: If GROQ_SECRET_NAME isn't set (local testing),
    try GROQ_API_KEY env var directly.
    """
    secret_name = os.environ.get(GROQ_SECRET_NAME_ENV)
    if secret_name:
        return get_secret(secret_name)

    # Fallback for local testing — read from env var directly
    fallback = os.environ.get("GROQ_API_KEY", "")
    if fallback:
        return fallback

    raise EnvironmentError(
        f"Neither {GROQ_SECRET_NAME_ENV} nor GROQ_API_KEY environment variable is set. "
        f"Cannot authenticate with Groq Cloud."
    )


# ──────────────────────────────────────────────────────────────────
# ROUTE HANDLERS
# ──────────────────────────────────────────────────────────────────


async def _handle_chat_completions(
    body: Dict[str, Any],
    authorizer: Dict[str, str],
) -> Dict[str, Any]:
    """
    Handle POST /v1/chat/completions (non-streaming).

    PORTED FROM: app/routers/openai_proxy.py → chat_completions() (lines 20-78)

    OLD FLOW (FastAPI):
        1. verify_api_key() via Depends()         → Go authorizer does this now
        2. check_billing_access(user)              → Go authorizer blocks BLOCKED users
        3. enforce_monthly_limit(user_id)           → TODO: Day 4
        4. user_key = user.groq_key or settings.groq_key → Secrets Manager now
        5. forward_to_groq(client, "chat/completions", body)
        6. record_usage(user_id, api_key_id, model, usage)
        7. return JSONResponse(data)

    NEW FLOW (Lambda):
        1. Auth already done by Go authorizer (userId in event context)
        2. accountStatus checked (BLOCKED users never reach us)
        3. Get Groq API key from Secrets Manager
        4. GroqAdapter.chat_completions(payload)
        5. record_usage() → DynamoDB
        6. Return response dict

    Args:
        body: The parsed request body from the client
        authorizer: Context from Dev 1's Go authorizer
                    {"userId": "abc", "apiKeyId": "key456", "planId": "free", ...}

    Returns:
        API Gateway response dict (statusCode + headers + body)
    """

    # Check if client wants streaming
    stream = bool(body.get("stream", False))
    if stream:
        # Streaming is Day 3 — return clear error so developer knows
        return _build_response(400, {
            "error": {
                "message": "Streaming is not yet supported on this endpoint. "
                           "Use the streaming Lambda or set stream=false.",
                "type": "invalid_request_error",
            }
        })

    # Extract authorizer context
    user_id = authorizer.get("userId", "")
    api_key_id = authorizer.get("apiKeyId", "")
    plan_id = authorizer.get("planId", "")

    # Capture the model the client requested (for usage tracking)
    # Even though GroqAdapter overrides it to llama-3.3-70b, we track
    # what the CLIENT asked for so we know demand per model
    requested_model = body.get("model", DEFAULT_MODEL)

    # Get Groq API key and call the provider
    try:
        # Get Groq API key from Secrets Manager
        groq_key = _get_groq_api_key()

        # Create the adapter and forward the request
        adapter = GroqAdapter(api_key=groq_key)

        # Call Groq Cloud (non-streaming)
        # This is the equivalent of forward_to_groq() from app/proxy.py
        response_data = await adapter.chat_completions(body, stream=False)

    except ProviderError as e:
        # Groq returned an error (4xx or 5xx)
        # Pass through the SAME status code and error body to our caller
        # WHY: The client should see the real error (rate limit, invalid request, etc.)
        return _build_response(e.status_code, e.detail)

    except Exception as e:
        # Network error, missing API key, or unexpected failure
        # Return 502 Bad Gateway — standard HTTP code for "upstream server failed"
        return _build_response(502, {
            "error": {
                "message": f"Failed to connect to AI provider: {str(e)}",
                "type": "upstream_error",
            }
        })

    # Extract usage block for billing
    # Groq's response includes: {"usage": {"prompt_tokens": 15, "completion_tokens": 42}}
    usage_block = adapter.extract_usage(response_data)

    # Record usage in DynamoDB (both raw event + monthly aggregate)
    if usage_block:
        try:
            record_usage(
                user_id=user_id,
                api_key_id=api_key_id,
                model=requested_model,
                usage=usage_block,
            )
        except Exception as e:
            # Usage recording failure should NOT break the response
            # The client already got their AI response — we just log the error
            print(f"WARNING: Failed to record usage: {e}")

    # Return the response in the same format Groq sent it
    # This is OpenAI-compatible format — the client can't tell
    # they're talking to Groq through our proxy
    return _build_response(200, response_data)


async def _handle_completions(
    body: Dict[str, Any],
    authorizer: Dict[str, str],
) -> Dict[str, Any]:
    """
    Handle POST /v1/completions (non-streaming).

    PORTED FROM: app/routers/openai_proxy.py → completions() (lines 81-139)

    This is an ALIAS for chat completions.
    The old code routes /v1/completions through chat/completions internally
    (see line 106: forward_to_groq(client, "chat/completions", ...))

    WHY an alias?
    - OpenAI has two endpoints: /completions (old) and /chat/completions (new)
    - Most clients use /chat/completions now
    - But some old tools still call /completions
    - We support both by routing /completions → chat/completions
    """
    return await _handle_chat_completions(body, authorizer)


async def _handle_list_models(
    authorizer: Dict[str, str],
) -> Dict[str, Any]:
    """
    Handle GET /v1/models.

    PORTED FROM: app/routers/openai_proxy.py → list_models() (lines 142-166)

    Returns the model catalog in OpenAI-compatible format.
    For now, returns our hardcoded catalog from model_catalog.py.
    """
    models = to_openai_format()
    return _build_response(200, models)


async def _handle_options() -> Dict[str, Any]:
    """
    Handle OPTIONS requests (CORS preflight).

    WHY?
    - Before making a POST request, browsers send an OPTIONS request
      to ask "am I allowed to call this API?"
    - We respond with CORS headers saying "yes, from any origin"
    - Without this, browser-based clients (like the Next.js frontend) get blocked
    """
    return {
        "statusCode": 204,  # 204 = "No Content" (standard for OPTIONS)
        "headers": CORS_HEADERS,
        "body": "",
    }


# ──────────────────────────────────────────────────────────────────
# ROUTE DISPATCHER (main entry point)
# ──────────────────────────────────────────────────────────────────


def lambda_handler(event, context):
    """
    AWS Lambda entry point — Route Dispatcher.

    This is the function AWS calls when a request arrives.
    It reads the HTTP method and path, then calls the right handler.

    ROUTE TABLE:
        POST /v1/chat/completions  → _handle_chat_completions()
        POST /v1/completions       → _handle_completions()
        GET  /v1/models            → _handle_list_models()
        OPTIONS *                  → _handle_options() (CORS preflight)

    WHY asyncio.run()?
    - GroqAdapter uses httpx which is async (await client.post(...))
    - Lambda's handler function is synchronous (def, not async def)
    - asyncio.run() bridges the gap — it runs the async code inside sync context
    - Alternative: Lambda supports async handlers natively in Python 3.12+
      but asyncio.run() works on all Python versions
    """
    http_method, path, body, authorizer = _parse_event(event)

    # CORS preflight
    if http_method == "OPTIONS":
        return asyncio.run(_handle_options())

    # Route to the correct handler based on path
    # We use .rstrip("/") to handle both "/v1/models" and "/v1/models/"
    clean_path = path.rstrip("/")

    if http_method == "POST" and clean_path == "/v1/chat/completions":
        return asyncio.run(_handle_chat_completions(body, authorizer))

    elif http_method == "POST" and clean_path == "/v1/completions":
        return asyncio.run(_handle_completions(body, authorizer))

    elif http_method == "GET" and clean_path == "/v1/models":
        return asyncio.run(_handle_list_models(authorizer))

    else:
        # Unknown route — return 404
        return _build_response(404, {
            "error": {
                "message": f"Unknown route: {http_method} {path}",
                "type": "not_found",
                "available_routes": [
                    "POST /v1/chat/completions",
                    "POST /v1/completions",
                    "GET /v1/models",
                ],
            }
        })
