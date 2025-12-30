from typing import Any, Dict

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from ..auth import AuthenticatedAPIKey, verify_api_key
from ..config import settings
from ..proxy import (
    enforce_monthly_limit,
    forward_to_groq,
    record_usage,
    stream_sse,
)

router = APIRouter(prefix="/v1", tags=["OpenAI-compatible"])


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    auth_context: AuthenticatedAPIKey = Depends(verify_api_key),
):
    """
    OpenAI-compatible chat completions endpoint
    Routes to Groq's Llama Maverick model
    """
    body: Dict[str, Any] = await request.json()
    stream = bool(body.get("stream", False))

    await enforce_monthly_limit(str(auth_context.user.id))
    async with httpx.AsyncClient(timeout=None) as client:
        if stream:
            # Streaming response
            upstream = await forward_to_groq(
                client, "chat/completions", body, stream=True
            )

            async def on_usage(usage_block: Dict[str, Any]):
                await record_usage(
                    user_id=str(auth_context.user.id),
                    api_key_id=str(auth_context.api_key.id),
                    model=settings.default_model,
                    usage=usage_block,
                )

            return StreamingResponse(
                stream_sse(upstream, on_usage=on_usage),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            )
        else:
            # Non-streaming response
            data = await forward_to_groq(
                client, "chat/completions", body, stream=False
            )
            usage_block = data.get("usage")
            if usage_block:
                await record_usage(
                    user_id=str(auth_context.user.id),
                    api_key_id=str(auth_context.api_key.id),
                    model=settings.default_model,
                    usage=usage_block,
                )
            return JSONResponse(status_code=200, content=data)


@router.post("/completions")
async def completions(
    request: Request,
    auth_context: AuthenticatedAPIKey = Depends(verify_api_key),
):
    """
    OpenAI-compatible completions endpoint
    Internally routed to Groq chat/completions
    """
    body: Dict[str, Any] = await request.json()
    stream = bool(body.get("stream", False))

    await enforce_monthly_limit(str(auth_context.user.id))

    async with httpx.AsyncClient(timeout=None) as client:
        if stream:
            upstream = await forward_to_groq(
                client, "chat/completions", body, stream=True
            )

            async def on_usage(usage_block: Dict[str, Any]):
                await record_usage(
                    user_id=str(auth_context.user.id),
                    api_key_id=str(auth_context.api_key.id),
                    model=settings.default_model,
                    usage=usage_block,
                )

            return StreamingResponse(
                stream_sse(upstream, on_usage=on_usage),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            )
        else:
            data = await forward_to_groq(
                client, "chat/completions", body, stream=False
            )

            usage_block = data.get("usage")
            if usage_block:
                await record_usage(
                    user_id=str(auth_context.user.id),
                    api_key_id=str(auth_context.api_key.id),
                    model=settings.default_model,
                    usage=usage_block,
                )

            return JSONResponse(status_code=200, content=data)


@router.get("/models")
async def list_models(
    auth_context: AuthenticatedAPIKey = Depends(verify_api_key),
):
    """
    OpenAI-compatible models endpoint
    """
    url = "https://api.groq.com/openai/v1/models"

    async with httpx.AsyncClient(timeout=None) as client:
        resp = await client.get(
            url,
            headers={
                "Authorization": f"Bearer {settings.groq_api_key}",
                "Content-Type": "application/json",
            },
        )

    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.json())

    return JSONResponse(status_code=200, content=resp.json())

