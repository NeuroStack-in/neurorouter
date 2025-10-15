from typing import AsyncIterator, Dict, Any
import httpx
from fastapi import HTTPException

from .config import settings


def groq_headers() -> Dict[str, str]:
    """Headers for Groq API requests"""
    return {
        "Authorization": f"Bearer {settings.groq_api_key}",
        "Content-Type": "application/json",
    }


def build_groq_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build the payload for Groq, using Llama Maverick model
    """
    groq_payload = dict(payload)
    # Force the model to Llama Maverick (llama-3.3-70b-versatile)
    groq_payload["model"] = settings.default_model
    return groq_payload


async def stream_sse(resp: httpx.Response) -> AsyncIterator[bytes]:
    """
    Stream Server-Sent Events from Groq to client
    """
    async for line in resp.aiter_lines():
        yield (line + "\n").encode("utf-8")


async def forward_to_groq(
    client: httpx.AsyncClient,
    endpoint: str,
    body: Dict[str, Any],
    stream: bool = False
):
    """
    Forward request to Groq Cloud
    """
    url = f"{settings.groq_base_url.rstrip('/')}/{endpoint.lstrip('/')}"
    groq_payload = build_groq_payload(body)

    if stream:
        # Streaming response
        resp = await client.stream(
            "POST",
            url,
            headers=groq_headers(),
            json=groq_payload,
            timeout=None
        )
        if resp.status_code >= 400:
            text = await resp.aread()
            raise HTTPException(
                status_code=resp.status_code,
                detail=text.decode()
            )
        return resp
    else:
        # Non-streaming response
        resp = await client.post(
            url,
            headers=groq_headers(),
            json=groq_payload,
            timeout=None
        )
        if resp.status_code >= 400:
            try:
                err = resp.json()
            except Exception:
                err = {"error": {"message": resp.text}}
            raise HTTPException(
                status_code=resp.status_code,
                detail=err
            )
        return resp.json()
