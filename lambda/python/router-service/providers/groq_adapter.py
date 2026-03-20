"""
Groq Provider Adapter
=====================
Concrete implementation of ProviderAdapter that talks to Groq Cloud's
OpenAI-compatible API (https://api.groq.com/openai/v1).

PORTED FROM: app/proxy.py in the original FastAPI codebase.

HOW GROQ WORKS:
- Groq provides an OpenAI-compatible API (same request/response format as OpenAI)
- We send requests to https://api.groq.com/openai/v1/chat/completions
- We FORCE the model to "llama-3.3-70b-versatile" regardless of what the client requests
  (this is the core "routing" in NeuroRouter — the client thinks they're using GPT-4,
   but we secretly route to Llama on Groq which is faster and cheaper)

KEY DIFFERENCE FROM OLD CODE:
- Old: Read API key from environment variable (settings.groq_api_key)
- New: Read API key from AWS Secrets Manager via secrets_client.py
       This is more secure — secrets aren't in env vars or config files
"""

import json
from typing import Any, AsyncIterator, Dict, Optional

import httpx

from provider_adapter import ProviderAdapter, ProviderError


# Groq's OpenAI-compatible API base URL (hardcoded — same as original proxy.py line 78)
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

# The model we force all requests to use
DEFAULT_MODEL = "llama-3.3-70b-versatile"


class GroqAdapter(ProviderAdapter):
    """
    Adapter for Groq Cloud's OpenAI-compatible API.

    Usage:
        adapter = GroqAdapter(api_key="gsk_xxx")
        response = await adapter.chat_completions(payload, stream=False)
    """

    def __init__(self, api_key: str):
        """
        Args:
            api_key: Groq API key (starts with 'gsk_').
                     In production, this comes from AWS Secrets Manager.
                     The Lambda handler fetches it and passes it here.
        """
        self._api_key = api_key

    def _build_headers(self) -> Dict[str, str]:
        """
        Build HTTP headers for Groq API requests.

        PORTED FROM: app/proxy.py → groq_headers() (lines 13-19)

        WHY Bearer token?
        - This is the standard "Authorization" header format for APIs
        - "Bearer" means "I'm carrying this token as proof of who I am"
        - Groq validates this key on their end before processing the request
        """
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def _build_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Transform the client's request payload for Groq.

        PORTED FROM: app/proxy.py → build_groq_payload() (lines 22-29)

        KEY BEHAVIOR: We OVERRIDE the model to llama-3.3-70b-versatile.
        The client might send model="gpt-4" or model="gpt-3.5-turbo",
        but Groq only understands its own model names. This is the core
        "routing" logic — transparent model swapping.
        """
        groq_payload = dict(payload)  # Make a copy so we don't modify the original
        groq_payload["model"] = DEFAULT_MODEL
        return groq_payload

    async def chat_completions(
        self,
        payload: Dict[str, Any],
        stream: bool = False,
    ) -> Any:
        """
        Send a chat completion request to Groq.

        PORTED FROM: app/proxy.py → forward_to_groq() (lines 67-107)

        Two modes:
        1. stream=False: Send request, wait for full response, return JSON dict
        2. stream=True:  Send request, return async iterator of SSE bytes
                         (Server-Sent Events — the "typing" effect in ChatGPT)

        Args:
            payload: Client's request body (messages, temperature, max_tokens, etc.)
            stream: Whether to stream the response

        Returns:
            Dict (non-streaming) or AsyncIterator[bytes] (streaming)
        """
        url = f"{GROQ_BASE_URL}/chat/completions"
        groq_payload = self._build_payload(payload)

        if stream:
            # --- STREAMING MODE ---
            # WHY no "async with httpx.AsyncClient()" here?
            # Because the client must stay alive while we're streaming.
            # If we use "async with", it closes when we return the iterator,
            # killing the connection before chunks are consumed.
            # Instead, we create the client and let the caller consume the stream.
            # The client is stored on self so it can be cleaned up later.
            self._http_client = httpx.AsyncClient(timeout=None)

            # httpx.stream() is an async context manager:
            # "async with client.stream(...) as resp:" opens the streaming connection
            self._stream_context = self._http_client.stream(
                "POST",
                url,
                headers=self._build_headers(),
                json=groq_payload,
                timeout=None,
            )
            # Enter the context manager to get the actual response
            resp = await self._stream_context.__aenter__()

            # Check for errors before streaming
            if resp.status_code >= 400:
                error_body = await resp.aread()
                await self._stream_context.__aexit__(None, None, None)
                await self._http_client.aclose()
                raise ProviderError(
                    status_code=resp.status_code,
                    detail=error_body.decode(),
                )

            # Return the SSE stream iterator (wraps the raw response)
            return self._stream_sse_managed(resp)

        else:
            # --- NON-STREAMING MODE ---
            # Safe to use "async with" — we consume the full response here
            async with httpx.AsyncClient(timeout=None) as client:
                resp = await client.post(
                    url,
                    headers=self._build_headers(),
                    json=groq_payload,
                    timeout=None,
                )

                # If Groq returns an error (4xx or 5xx), raise it
                if resp.status_code >= 400:
                    try:
                        error_detail = resp.json()
                    except Exception:
                        error_detail = {"error": {"message": resp.text}}
                    raise ProviderError(
                        status_code=resp.status_code,
                        detail=error_detail,
                    )

                # Return the full JSON response
                return resp.json()

    async def list_models(self) -> Dict[str, Any]:
        """
        Fetch available models from Groq.

        PORTED FROM: app/routers/openai_proxy.py → list_models() (lines 142-166)

        This calls Groq's /models endpoint and returns the list in OpenAI format.
        """
        url = f"{GROQ_BASE_URL}/models"

        async with httpx.AsyncClient(timeout=None) as client:
            resp = await client.get(
                url,
                headers=self._build_headers(),
            )

        if resp.status_code >= 400:
            raise ProviderError(
                status_code=resp.status_code,
                detail=resp.json(),
            )

        return resp.json()

    def extract_usage(self, response: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Extract token usage from Groq's response.

        Groq follows OpenAI format, so usage is at response["usage"]:
        {
            "prompt_tokens": 15,
            "completion_tokens": 42,
            "total_tokens": 57
        }

        This is used by the Lambda handler to record usage in DynamoDB for billing.
        """
        return response.get("usage")

    async def _stream_sse_managed(
        self,
        resp: httpx.Response,
    ) -> AsyncIterator[bytes]:
        """
        Stream SSE from Groq, then clean up the HTTP connection.

        PORTED FROM: app/proxy.py → stream_sse() (lines 32-64)

        HOW SSE WORKS:
        - Server sends lines like: data: {"choices":[{"delta":{"content":"Hello"}}]}
        - Each line is a "chunk" — a small piece of the response
        - The client receives these one by one, creating the "typing" effect
        - The last line is: data: [DONE] — signals end of stream
        - Usage data (token counts) appears in the final chunk before [DONE]

        WHY "_managed"?
        - This version cleans up the HTTP client and stream context after iteration
        - Without cleanup, the connection stays open (resource leak)
        - The "try/finally" ensures cleanup happens even if the caller stops early
        """
        last_usage: Optional[Dict[str, Any]] = None

        try:
            async for line in resp.aiter_lines():
                # Parse SSE lines to extract usage data for billing
                if line.startswith("data: "):
                    data_str = line[len("data: "):]
                    if data_str and data_str != "[DONE]":
                        try:
                            parsed = json.loads(data_str)
                            usage = parsed.get("usage")
                            if usage:
                                last_usage = usage
                        except Exception:
                            pass  # Malformed lines are still forwarded to the client

                # Yield the line as-is to the client (preserving the SSE format)
                yield (line + "\n").encode("utf-8")
        finally:
            # Clean up the HTTP connection after streaming is done
            # This runs whether iteration completed normally or was interrupted
            try:
                await self._stream_context.__aexit__(None, None, None)
            except Exception:
                pass
            try:
                await self._http_client.aclose()
            except Exception:
                pass

        # Store last_usage so the handler can access it after streaming
        self._last_stream_usage = last_usage

    @property
    def last_stream_usage(self) -> Optional[Dict[str, Any]]:
        """
        After a streaming request completes, this holds the usage data
        from the final chunk. The Lambda handler reads this to record
        token usage in DynamoDB.
        """
        return getattr(self, "_last_stream_usage", None)
