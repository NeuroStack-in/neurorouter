"""
Monthly Invoice Job — Lambda Handler (Day 6 Implementation)
=============================================================
Triggered by EventBridge on the 1st of every month at 01:00 UTC.
Generates invoices for all active users for the previous month.

HOW IT WORKS:
    1. EventBridge fires this Lambda on schedule (cron: 0 1 1 * ? *)
    2. Handler determines the target month (previous month, or from event override)
    3. Calls billing_job.generate_invoices() which:
       - Scans all ACTIVE/GRACE users
       - Aggregates their usage from usage_monthly table
       - Calculates costs from plan_catalog rates
       - Creates/finalizes invoices in the invoices table
       - Writes audit log entries
    4. Returns the count of generated, skipped, and errored invoices

EVENT FORMATS:
    EventBridge (automatic): {"source": "aws.events", "detail-type": "Scheduled Event", ...}
    Manual override:         {"yearMonth": "2026-02"}
"""

import json
from datetime import datetime, timedelta

from billing_job import generate_invoices


def lambda_handler(event, context):
    """
    AWS Lambda entry point — triggered by EventBridge schedule.

    The event can be:
    1. EventBridge scheduled event (no yearMonth) → defaults to previous month
    2. Manual invocation with {"yearMonth": "2026-02"} → uses specified month
    """
    # ── Determine target month ──
    year_month = event.get("yearMonth")

    if not year_month:
        # Default to previous month (same logic as old code)
        today = datetime.utcnow()
        first_of_month = datetime(today.year, today.month, 1)
        prev_month = first_of_month - timedelta(days=1)
        year_month = prev_month.strftime("%Y-%m")

    print(f"Monthly Invoice Job started for: {year_month}")

    # ── Run the billing job ──
    try:
        result = generate_invoices(year_month)
    except Exception as e:
        print(f"FATAL ERROR in billing job: {str(e)}")
        return {
            "statusCode": 500,
            "body": json.dumps({
                "error": f"Billing job failed: {str(e)}",
                "yearMonth": year_month,
            }),
        }

    # ── Return results ──
    return {
        "statusCode": 200,
        "body": json.dumps({
            "yearMonth": year_month,
            "generated": result["generated"],
            "skipped": result["skipped"],
            "errors": result["errors"],
        }),
    }
