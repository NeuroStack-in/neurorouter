"""
Usage Repair Function — Day 8 Implementation
==============================================
Re-aggregates usage_monthly from raw usage_events for a given month.

WHEN TO USE:
    Only run manually when monthly aggregates are suspected to have drifted
    from the raw event data (e.g., due to Lambda retries that incremented
    usage_monthly but failed before recording the event, or vice versa).

HOW IT WORKS:
    1. Scans usage_events for all events in the target month
    2. Groups them by userId + model + apiKeyId
    3. Sums input_tokens, output_tokens, total_tokens, request_count
    4. Writes the correct totals to usage_monthly using put_item (full replace)

WHY put_item INSTEAD OF update_item?
    This is a FULL RECOMPUTE. We want to replace whatever is there with the
    correct value from the raw events. update_item with ADD would increment
    on top of possibly wrong values.

EDGE CASE DOCUMENTED:
    If a Lambda retries AFTER recording usage_events but BEFORE updating
    usage_monthly, the monthly aggregate could miss that increment. This
    repair function fixes that by recomputing from the raw events.
"""

import os
from collections import defaultdict
from datetime import datetime

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
USAGE_EVENTS_TABLE = os.environ.get("TABLE_USAGE_EVENTS", "neurorouter-usage-events-dev")
USAGE_MONTHLY_TABLE = os.environ.get("TABLE_USAGE_MONTHLY", "neurorouter-usage-monthly-dev")


def repair_month(year_month: str) -> dict:
    """
    Recompute usage_monthly from usage_events for a given month.

    Args:
        year_month: Target month in "YYYY-MM" format (e.g., "2026-03")

    Returns:
        {"users_repaired": int, "records_written": int}
    """
    events_table = dynamodb.Table(USAGE_EVENTS_TABLE)
    monthly_table = dynamodb.Table(USAGE_MONTHLY_TABLE)

    print(f"Starting usage repair for {year_month}...")

    # ── Step 1: Scan all events for the target month ──
    # We scan the entire table and filter by year_month
    # This is expensive but repair is a rare manual operation
    all_events = []
    scan_kwargs = {
        "FilterExpression": Key("year_month").eq(year_month),
    }

    while True:
        response = events_table.scan(**scan_kwargs)
        all_events.extend(response.get("Items", []))
        if "LastEvaluatedKey" in response:
            scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
        else:
            break

    print(f"Found {len(all_events)} events for {year_month}")

    # ── Step 2: Aggregate by userId + model + apiKeyId ──
    # Key: (userId, model, apiKeyId) → {input_tokens, output_tokens, ...}
    aggregates = defaultdict(lambda: {
        "input_tokens": 0,
        "output_tokens": 0,
        "total_tokens": 0,
        "request_count": 0,
    })

    for event in all_events:
        user_id = event.get("userId", "")
        model = event.get("model", "unknown")
        api_key_id = event.get("api_key_id", "unknown")
        key = (user_id, model, api_key_id)

        aggregates[key]["input_tokens"] += int(event.get("prompt_tokens", 0))
        aggregates[key]["output_tokens"] += int(event.get("completion_tokens", 0))
        aggregates[key]["total_tokens"] += int(event.get("total_tokens", 0))
        aggregates[key]["request_count"] += 1

    # ── Step 3: Write correct totals to usage_monthly ──
    records_written = 0
    users_seen = set()

    for (user_id, model, api_key_id), totals in aggregates.items():
        sort_key = f"{year_month}#MODEL#{model}#KEY#{api_key_id}"

        # put_item = full replace (not increment)
        monthly_table.put_item(Item={
            "userId": user_id,
            "sk": sort_key,
            "input_tokens": totals["input_tokens"],
            "output_tokens": totals["output_tokens"],
            "total_tokens": totals["total_tokens"],
            "request_count": totals["request_count"],
            "year_month": year_month,
            "model": model,
            "api_key_id": api_key_id,
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "repaired": True,  # Flag so we know this was a repair
        })
        records_written += 1
        users_seen.add(user_id)

    result = {
        "users_repaired": len(users_seen),
        "records_written": records_written,
        "events_processed": len(all_events),
    }
    print(f"Repair complete: {result}")
    return result
