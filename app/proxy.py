import json
from datetime import datetime
from typing import Any, AsyncIterator, Callable, Dict, Optional

import httpx
from fastapi import HTTPException
# Removed sqlalchemy imports

from .config import settings
from .models import MonthlyUsage


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


async def stream_sse(
    resp: httpx.Response,
    on_usage: Optional[Callable[[Dict[str, Any]], Any]] = None,
) -> AsyncIterator[bytes]:
    """
    Stream Server-Sent Events from Groq to client
    If on_usage is provided, it will be called once when the final usage block is seen.
    """
    last_usage: Optional[Dict[str, Any]] = None
    usage_recorded = False

    async for line in resp.aiter_lines():
        if line.startswith("data: "):
            payload = line[len("data: ") :]
            if payload and payload != "[DONE]":
                try:
                    parsed = json.loads(payload)
                    usage = parsed.get("usage")
                    if usage:
                        last_usage = usage
                        if on_usage and not usage_recorded:
                            await on_usage(usage)
                            usage_recorded = True
                except Exception:
                    # pass through malformed lines; they are still streamed to the caller
                    pass
            elif payload == "[DONE]" and last_usage and on_usage and not usage_recorded:
                await on_usage(last_usage)
                usage_recorded = True
        yield (line + "\n").encode("utf-8")

    if on_usage and last_usage and not usage_recorded:
        await on_usage(last_usage)


async def forward_to_groq(
    client: httpx.AsyncClient,
    endpoint: str,
    body: Dict[str, Any],
    stream: bool = False,
):
    """
    Forward request to Groq OpenAI-compatible API.
    """
    # 🔒 HARD-CODED, CAN'T FAIL
    url = f"https://api.groq.com/openai/v1/{endpoint.lstrip('/')}"

    payload = build_groq_payload(body)

    print("FORWARDING TO GROQ:", url)

    if stream:
        resp = await client.stream(
            "POST",
            url,
            headers=groq_headers(),
            json=payload,
            timeout=None,
        )
        if resp.status_code >= 400:
            text = await resp.aread()
            raise HTTPException(status_code=resp.status_code, detail=text.decode())
        return resp

    resp = await client.post(
        url,
        headers=groq_headers(),
        json=payload,
        timeout=None,
    )

    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.json())

    return resp.json()


def _current_year_month() -> str:
    return datetime.utcnow().strftime("%Y-%m")


async def enforce_monthly_limit(user_id: str):
    limit = settings.monthly_token_limit
    if not limit or limit <= 0:
        return

    # Beanie aggregation sum
    total_tokens = await MonthlyUsage.find(
        MonthlyUsage.user_id == str(user_id),
        MonthlyUsage.year_month == _current_year_month(),
    ).sum(MonthlyUsage.total_tokens)
    
    # .sum() returns None if no documents match? Or 0? Usually float/int or None.
    current_tokens = total_tokens if total_tokens is not None else 0

    if current_tokens >= limit:
        raise HTTPException(
            status_code=429,
            detail="Monthly token limit exceeded",
        )


async def record_usage(
    user_id: str,
    api_key_id: str,
    model: str,
    usage: Dict[str, Any],
):
    """
    Persist prompt/completion token counts after Groq responds.
    """
    if not usage:
        return

    input_tokens = int(usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("completion_tokens") or 0)
    total_tokens = input_tokens + output_tokens
    year_month = _current_year_month()

    # Beanie logic
    # Try to find existing record
    record = await MonthlyUsage.find_one(
        MonthlyUsage.user_id == str(user_id),
        MonthlyUsage.api_key_id == str(api_key_id),
        MonthlyUsage.model == model,
        MonthlyUsage.year_month == year_month,
    )

    if not record:
        record = MonthlyUsage(
            user_id=str(user_id),
            api_key_id=str(api_key_id),
            model=model,
            year_month=year_month,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens,
            request_count=1,
        )
        await record.insert()
    else:
        record.input_tokens += input_tokens
        record.output_tokens += output_tokens
        record.total_tokens += total_tokens
        record.request_count += 1
        await record.save()
