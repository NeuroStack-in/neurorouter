"""
Usage Recording Module
======================
Records AI inference usage in DynamoDB for billing and analytics.

PORTED FROM: app/proxy.py → record_usage() (lines 139-247)

OLD (MongoDB/Beanie):
    - MonthlyUsage.find_one(...).upsert(Inc({...}))
    - BillingCycle.find_one(...).inc({...})
    - Complex upsert logic with race condition handling

NEW (DynamoDB/boto3):
    - usage_events table: put_item() — one raw record per request
    - usage_monthly table: update_item() with ADD — atomic increment

WHY TWO TABLES?

1. usage_events (raw log)
   - One row per request
   - Used for detailed audit trail and debugging
   - Example: "User abc used gpt-4 at 3:42 PM, 50 prompt tokens, 20 completion tokens"

2. usage_monthly (aggregates)
   - One row per user/month/model/key combination
   - Used by dashboard to show "this month you've used 15,000 tokens"
   - Atomically incremented — no race conditions even with concurrent requests
   - Uses DynamoDB's ADD operation (like SQL: SET tokens = tokens + 50)

SORT KEY FORMAT (defined by Dev 1):
   "YYYY-MM#MODEL#{modelName}#KEY#{apiKeyId}"
   Example: "2026-03#MODEL#llama-3.3-70b-versatile#KEY#key456"

   WHY this format?
   - DynamoDB can only query by partition key + sort key
   - Packing month/model/key into the sort key lets us query:
     * All usage for a user in March: sort_key begins_with "2026-03"
     * All usage for a specific model: sort_key contains "MODEL#llama"
     * This is called a "composite sort key" — standard DynamoDB pattern
"""

import uuid
from datetime import datetime
from typing import Any, Dict

from dynamo_client import get_table, TABLE_USAGE_EVENTS, TABLE_USAGE_MONTHLY


def _current_year_month() -> str:
    """
    Get current year-month string.

    PORTED FROM: app/proxy.py → _current_year_month() (line 110)

    Returns "2026-03" format. Used for:
    - Grouping usage by month
    - Building the composite sort key
    """
    return datetime.utcnow().strftime("%Y-%m")


def _build_sort_key(year_month: str, model: str, api_key_id: str) -> str:
    """
    Build the composite sort key for usage_monthly table.

    FORMAT: "YYYY-MM#MODEL#{modelName}#KEY#{apiKeyId}"
    DEFINED BY: Dev 1 on Day 1 (DynamoDB table schema)

    Example:
        _build_sort_key("2026-03", "llama-3.3-70b-versatile", "key456")
        → "2026-03#MODEL#llama-3.3-70b-versatile#KEY#key456"

    WHY this specific format?
    - The "#" separator is a common DynamoDB convention
    - "MODEL#" and "KEY#" prefixes make the key self-describing
    - You can query with begins_with("2026-03") to get all models/keys for that month
    """
    return f"{year_month}#MODEL#{model}#KEY#{api_key_id}"


def write_usage_event(
    user_id: str,
    api_key_id: str,
    model: str,
    usage: Dict[str, Any],
) -> None:
    """
    Write a single raw usage event to the usage_events DynamoDB table.

    This creates ONE record per completed inference request.
    It's the detailed audit log — every single API call is recorded.

    Args:
        user_id:    The authenticated user's ID (from authorizer context)
        api_key_id: Which API key was used (from authorizer context)
        model:      The model requested by the client (e.g., "gpt-4")
        usage:      Token usage from Groq's response:
                    {"prompt_tokens": 15, "completion_tokens": 42, "total_tokens": 57}

    DynamoDB Item Structure:
    {
        "user_id": "abc123",           ← Partition key
        "event_id": "evt_uuid",        ← Sort key (unique per event)
        "api_key_id": "key456",
        "model": "gpt-4",
        "prompt_tokens": 15,
        "completion_tokens": 42,
        "total_tokens": 57,
        "timestamp": "2026-03-20T15:42:00Z",
        "year_month": "2026-03"
    }

    WHY uuid for event_id?
    - DynamoDB needs a unique sort key per item
    - UUID guarantees uniqueness even with thousands of concurrent requests
    - We prefix with "evt_" to make it clear this is an event ID
    """
    if not usage:
        return

    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    total_tokens = prompt_tokens + completion_tokens
    now = datetime.utcnow()

    table = get_table(TABLE_USAGE_EVENTS)
    table.put_item(
        Item={
            "user_id": user_id,
            "event_id": f"evt_{uuid.uuid4().hex}",
            "api_key_id": api_key_id,
            "model": model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "timestamp": now.isoformat() + "Z",
            "year_month": _current_year_month(),
        }
    )


def update_usage_monthly(
    user_id: str,
    api_key_id: str,
    model: str,
    usage: Dict[str, Any],
) -> None:
    """
    Atomically increment token counts in the usage_monthly DynamoDB table.

    PORTED FROM: app/proxy.py → record_usage() lines 218-247
    (the MonthlyUsage.find_one().upsert() block)

    OLD (MongoDB):
        await MonthlyUsage.find_one(...).upsert(
            Inc({input_tokens: 50, output_tokens: 20, request_count: 1}),
            on_insert=MonthlyUsage(...)
        )

    NEW (DynamoDB):
        table.update_item(
            Key=...,
            UpdateExpression="ADD input_tokens :inp, ...",
        )

    WHY "ADD" instead of "SET"?
    - SET = "replace the value" (SET tokens = 50)  → WRONG for counters
    - ADD = "increment the value" (ADD tokens 50)  → CORRECT for counters
    - ADD is ATOMIC — even if 10 requests hit simultaneously,
      each one correctly increments the counter without losing data
    - ADD also creates the attribute if it doesn't exist (starts from 0)
    - This replaces MongoDB's Inc() operator

    WHY no need for upsert logic?
    - DynamoDB's update_item() with ADD automatically creates the item
      if it doesn't exist. This is built-in behavior — no "on_insert" needed.
    - This is MUCH simpler than the MongoDB version which had a complex
      find-then-upsert-with-race-condition-handling pattern.

    Args:
        user_id:    Partition key
        api_key_id: Part of the composite sort key
        model:      Part of the composite sort key
        usage:      Token counts from Groq's response
    """
    if not usage:
        return

    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    total_tokens = prompt_tokens + completion_tokens
    year_month = _current_year_month()

    # Build the composite sort key: "2026-03#MODEL#llama-3.3#KEY#key456"
    sort_key = _build_sort_key(year_month, model, api_key_id)

    table = get_table(TABLE_USAGE_MONTHLY)
    table.update_item(
        Key={
            "user_id": user_id,
            "sk": sort_key,
        },
        # UpdateExpression uses DynamoDB's expression language:
        # ADD = atomically increment numeric values
        # SET = set non-counter fields (like updated_at timestamp)
        UpdateExpression=(
            "ADD input_tokens :inp, "
            "    output_tokens :out, "
            "    total_tokens :tot, "
            "    request_count :one "
            "SET updated_at = :now, "
            "    #yr_mo = :ym, "
            "    #mdl = :mdl, "
            "    api_key_id = :kid"
        ),
        # ExpressionAttributeValues = the actual values for the placeholders above
        # :inp, :out, etc. are placeholders — DynamoDB requires the ":" prefix
        ExpressionAttributeValues={
            ":inp": prompt_tokens,
            ":out": completion_tokens,
            ":tot": total_tokens,
            ":one": 1,                              # Increment request count by 1
            ":now": datetime.utcnow().isoformat() + "Z",
            ":ym": year_month,
            ":mdl": model,
            ":kid": api_key_id,
        },
        # ExpressionAttributeNames = aliases for reserved words
        # "model" and "year_month" are reserved words in DynamoDB
        # so we use #mdl and #yr_mo as aliases
        ExpressionAttributeNames={
            "#yr_mo": "year_month",
            "#mdl": "model",
        },
    )


def record_usage(
    user_id: str,
    api_key_id: str,
    model: str,
    usage: Dict[str, Any],
) -> None:
    """
    Main entry point — records usage in BOTH tables.

    Called by the Lambda handler after every completed inference request.
    This is the equivalent of app/proxy.py → record_usage()

    FLOW:
    1. Write raw event to usage_events (audit log)
    2. Increment counters in usage_monthly (dashboard analytics)
    """
    if not usage:
        return

    # 1. Raw event log
    write_usage_event(user_id, api_key_id, model, usage)

    # 2. Monthly aggregate
    update_usage_monthly(user_id, api_key_id, model, usage)
