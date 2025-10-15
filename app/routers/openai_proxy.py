from typing import Any, Dict
from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
import httpx

from ..auth import verify_api_key
from ..proxy import forward_to_groq, stream_sse
from ..config import settings

router = APIRouter(prefix="/v1", tags=["OpenAI-compatible"])


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    api_key: str = Depends(verify_api_key),
):
    """
    OpenAI-compatible chat completions endpoint
    Routes to Groq's Llama Maverick model
    """
    body: Dict[str, Any] = await request.json()
    stream = bool(body.get("stream", False))

    async with httpx.AsyncClient(timeout=None) as client:
        if stream:
            # Streaming response
            upstream = await forward_to_groq(
                client, "chat/completions", body, stream=True
            )
            return StreamingResponse(
                stream_sse(upstream),
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
            return JSONResponse(status_code=200, content=data)


@router.post("/completions")
async def completions(
    request: Request,
    api_key: str = Depends(verify_api_key),
):
    """
    OpenAI-compatible completions endpoint
    Routes to Groq's Llama Maverick model
    """
    body: Dict[str, Any] = await request.json()
    stream = bool(body.get("stream", False))

    async with httpx.AsyncClient(timeout=None) as client:
        if stream:
            upstream = await forward_to_groq(
                client, "completions", body, stream=True
            )
            return StreamingResponse(
                stream_sse(upstream),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                },
            )
        else:
            data = await forward_to_groq(
                client, "completions", body, stream=False
            )
            return JSONResponse(status_code=200, content=data)


@router.get("/models")
async def list_models(api_key: str = Depends(verify_api_key)):
    """
    List available models (returns Groq's models)
    """
    groq_models_url = f"{settings.groq_base_url.rstrip('/')}/models"
    async with httpx.AsyncClient(timeout=None) as client:
        resp = await client.get(
            groq_models_url,
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
        )
        try:
            data = resp.json()
        except Exception:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)

    return JSONResponse(status_code=resp.status_code, content=data)
