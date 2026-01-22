import json
from datetime import datetime
from typing import Any, AsyncIterator, Callable, Dict, Optional

import httpx
from fastapi import HTTPException
# Removed sqlalchemy imports

from .config import settings
from .config import settings


def groq_headers(api_key: Optional[str] = None) -> Dict[str, str]:
    """Headers for Groq API requests"""
    token = api_key or settings.groq_api_key
    return {
        "Authorization": f"Bearer {token}",
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
    api_key: Optional[str] = None,
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
            headers=groq_headers(api_key),
            json=payload,
            timeout=None,
        )
        if resp.status_code >= 400:
            text = await resp.aread()
            raise HTTPException(status_code=resp.status_code, detail=text.decode())
        return resp

    resp = await client.post(
        url,
        headers=groq_headers(api_key),
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



from .models import BillingCycle, SnapshotData, CalculatedCosts, BillingStatus, MonthlyUsage
from beanie.operators import Inc, Set

async def record_usage(
    user_id: str,
    api_key_id: str,
    model: str,
    usage: Dict[str, Any],
):
    """
    Persist prompt/completion token counts directly to the current BillingCycle.
    Live usage tracking = Pending Invoice.
    Also updates granular MonthlyUsage for dashboard analytics.
    """
    print(f"DEBUG: record_usage called for {user_id} with usage: {usage}")
    if not usage:
        return

    input_tokens = int(usage.get("prompt_tokens") or 0)
    output_tokens = int(usage.get("completion_tokens") or 0)
    total_tokens_calc = input_tokens + output_tokens
    year_month = _current_year_month()

    # 1. Update Aggregate BillingCycle (The Invoice)
    result = await BillingCycle.find_one(
        BillingCycle.user_id == str(user_id),
        BillingCycle.year_month == year_month
    ).inc({
        "snapshot_data.total_input_tokens": input_tokens,
        "snapshot_data.total_output_tokens": output_tokens
    })
    
    if result.modified_count == 0:
        # Document doesn't exist, create it.
        from .billing_utils import FIXED_FEE_INR 
        
        invoice_num = f"INV-{year_month}-{user_id[:8].upper()}"
        now = datetime.utcnow()
        
        existing = await BillingCycle.find_one(
             BillingCycle.user_id == str(user_id),
             BillingCycle.year_month == year_month
        )
        
        if not existing:
            new_cycle = BillingCycle(
                user_id=str(user_id),
                invoice_number=invoice_num,
                year_month=year_month,
                start_date=now,
                end_date=now,
                status=BillingStatus.PENDING,
                due_date=now, 
                grace_period_end=now, 
                snapshot_data=SnapshotData(
                    total_input_tokens=input_tokens, 
                    total_output_tokens=output_tokens
                ),
                calculated_costs=CalculatedCosts(
                     variable_cost_usd=0.0,
                     fixed_cost_inr=float(FIXED_FEE_INR),
                     total_due_display="Pending"
                )
            )
            try:
                await new_cycle.insert()
            except Exception as e:
                print(f"Inverse creation race: {e}")
                # Retry Inc
                await BillingCycle.find_one(
                    BillingCycle.user_id == str(user_id),
                    BillingCycle.year_month == year_month
                ).inc({
                    "snapshot_data.total_input_tokens": input_tokens,
                    "snapshot_data.total_output_tokens": output_tokens
                })
        else:
             await existing.inc({
                "snapshot_data.total_input_tokens": input_tokens,
                "snapshot_data.total_output_tokens": output_tokens
            })

    # 2. Update Granular MonthlyUsage (For Dashboard)
    # Upsert logic: find by user, month, model, api_key
    # We use Beanie's update with upsert=True semantics via find_one().upsert()
    
    await MonthlyUsage.find_one(
        MonthlyUsage.user_id == str(user_id),
        MonthlyUsage.year_month == year_month,
        MonthlyUsage.model == model,
        MonthlyUsage.api_key_id == str(api_key_id)
    ).upsert(
        Set({
            MonthlyUsage.updated_at: datetime.utcnow()
        }),
        Inc({
            MonthlyUsage.input_tokens: input_tokens,
            MonthlyUsage.output_tokens: output_tokens,
            MonthlyUsage.total_tokens: total_tokens_calc,
            MonthlyUsage.request_count: 1
        }),
        on_insert=MonthlyUsage(
            user_id=str(user_id),
            year_month=year_month,
            model=model,
            api_key_id=str(api_key_id),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            total_tokens=total_tokens_calc,
            request_count=1
        )
    )

