"""
Billing Job Logic — Day 6 Implementation
==========================================
Port of app/jobs/monthly_billing.py from MongoDB/Beanie → DynamoDB/boto3.

WHAT THIS DOES:
    Generates monthly invoices for all active users by:
    1. Scanning the users table for ACTIVE and GRACE users
    2. For each user, checking if an invoice already exists for the target month
    3. If PENDING invoice exists → finalize it (recalculate costs, update dates)
    4. If no invoice exists → aggregate usage from usage_monthly, calculate costs, create invoice
    5. Write audit log entries for every invoice processed

COST CALCULATION (ported from app/billing_utils.py → calculate_variable_cost):
    - Deduct 1M free tokens from both input and output
    - Apply per-million rates from the plan_catalog table
    - Variable cost = input_cost + output_cost (in USD)
    - Fixed fee = from plan_catalog (in INR)
    - Total = "₹{fixed_fee} + ${variable_cost}"

KEY DIFFERENCES FROM OLD CODE:
    OLD (MongoDB):  BillingCycle.find_one(), MonthlyUsage.find(), user.save()
    NEW (DynamoDB):  table.get_item(), table.query(), table.put_item()
"""

import os
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional

import boto3
from boto3.dynamodb.conditions import Key, Attr

# AWS clients — created once per cold start
dynamodb = boto3.resource("dynamodb")

# Table names from environment variables (set by CDK)
USERS_TABLE = os.environ.get("USERS_TABLE", "neurorouter-users-dev")
INVOICES_TABLE = os.environ.get("INVOICES_TABLE", "neurorouter-invoices-dev")
USAGE_MONTHLY_TABLE = os.environ.get("USAGE_MONTHLY_TABLE", "neurorouter-usage-monthly-dev")
PLAN_CATALOG_TABLE = os.environ.get("PLAN_CATALOG_TABLE", "neurorouter-plan-catalog-dev")
AUDIT_LOG_TABLE = os.environ.get("AUDIT_LOG_TABLE", "neurorouter-admin-audit-log-dev")


def calculate_variable_cost(
    input_tokens: int,
    output_tokens: int,
    rate_input_per_1m: Decimal,
    rate_output_per_1m: Decimal,
    free_input: int = 1_000_000,
    free_output: int = 1_000_000,
) -> Decimal:
    """
    Calculate variable cost in USD based on token usage.

    PORTED FROM: app/billing_utils.py → calculate_variable_cost() (lines 14-26)

    LOGIC:
    1. Subtract free tier tokens (1M input + 1M output by default)
    2. Anything above free tier is "chargeable"
    3. Multiply chargeable tokens by per-million rate
    4. Return total variable cost in USD

    Args:
        input_tokens:       Total input tokens used this month
        output_tokens:      Total output tokens used this month
        rate_input_per_1m:  USD per 1M input tokens (from plan_catalog)
        rate_output_per_1m: USD per 1M output tokens (from plan_catalog)
        free_input:         Free tier input tokens (default 1M)
        free_output:        Free tier output tokens (default 1M)

    Returns:
        Variable cost in USD as Decimal
    """
    chargeable_input = max(0, input_tokens - free_input)
    chargeable_output = max(0, output_tokens - free_output)

    input_cost = (Decimal(chargeable_input) / Decimal("1000000")) * rate_input_per_1m
    output_cost = (Decimal(chargeable_output) / Decimal("1000000")) * rate_output_per_1m
    return input_cost + output_cost


def _get_plan_rates(plan_id: str) -> dict:
    """
    Fetch pricing rates from the plan_catalog DynamoDB table.

    Returns dict with: fixedFeeInr, rateInputUsdPer1M, rateOutputUsdPer1M,
                       inputTokensFree, outputTokensFree
    """
    table = dynamodb.Table(PLAN_CATALOG_TABLE)
    resp = table.get_item(Key={"planId": plan_id})
    plan = resp.get("Item")

    if not plan:
        # Default to developer plan rates if plan not found
        return {
            "fixedFeeInr": Decimal("1599"),
            "rateInputUsdPer1M": Decimal("2"),
            "rateOutputUsdPer1M": Decimal("8"),
            "inputTokensFree": 1_000_000,
            "outputTokensFree": 1_000_000,
        }

    return {
        "fixedFeeInr": Decimal(str(plan.get("fixedFeeInr", 1599))),
        "rateInputUsdPer1M": Decimal(str(plan.get("rateInputUsdPer1M", 2))),
        "rateOutputUsdPer1M": Decimal(str(plan.get("rateOutputUsdPer1M", 8))),
        "inputTokensFree": int(plan.get("inputTokensFree", 1_000_000)),
        "outputTokensFree": int(plan.get("outputTokensFree", 1_000_000)),
    }


def _scan_all_users(table) -> list:
    """
    Scan the users table for ACTIVE and GRACE users with pagination.

    WHY PAGINATION?
    DynamoDB scan returns max 1MB of data per call. If you have more users
    than fit in 1MB, you get a LastEvaluatedKey telling you to call again.
    Without handling this, you'd miss users and they wouldn't get invoiced.
    """
    items = []
    scan_kwargs = {
        "FilterExpression": Attr("account_status").is_in(["ACTIVE", "GRACE"]),
    }

    while True:
        response = table.scan(**scan_kwargs)
        items.extend(response.get("Items", []))

        # If LastEvaluatedKey exists, there are more pages
        if "LastEvaluatedKey" in response:
            scan_kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]
        else:
            break

    return items


def _aggregate_usage(user_id: str, year_month: str) -> dict:
    """
    Aggregate token usage from usage_monthly table for a user in a specific month.

    Queries all sort keys starting with the target month, then sums up
    all input/output tokens across all models and API keys.

    Returns: {"total_input_tokens": int, "total_output_tokens": int}
    """
    table = dynamodb.Table(USAGE_MONTHLY_TABLE)
    total_input = 0
    total_output = 0

    response = table.query(
        KeyConditionExpression=Key("userId").eq(user_id) & Key("sk").begins_with(year_month)
    )

    for item in response.get("Items", []):
        total_input += int(item.get("input_tokens", 0))
        total_output += int(item.get("output_tokens", 0))

    # Handle pagination
    while "LastEvaluatedKey" in response:
        response = table.query(
            KeyConditionExpression=Key("userId").eq(user_id) & Key("sk").begins_with(year_month),
            ExclusiveStartKey=response["LastEvaluatedKey"],
        )
        for item in response.get("Items", []):
            total_input += int(item.get("input_tokens", 0))
            total_output += int(item.get("output_tokens", 0))

    return {"total_input_tokens": total_input, "total_output_tokens": total_output}


def _write_audit_log(user_id: str, invoice_number: str, action: str, details: dict):
    """Write an entry to the admin_audit_log table."""
    table = dynamodb.Table(AUDIT_LOG_TABLE)
    now = datetime.utcnow().isoformat() + "Z"
    table.put_item(Item={
        "id": f"audit_{uuid.uuid4().hex}",
        "timestamp": now,
        "admin_user_id": "SYSTEM_JOB",
        "target_user_id": user_id,
        "action": action,
        "resource_collection": "invoices",
        "resource_id": invoice_number,
        "new_value": details,
    })


def generate_invoices(year_month: str) -> dict:
    """
    Main billing job — generates/finalizes invoices for all active users.

    PORTED FROM: app/jobs/monthly_billing.py → generate_invoices_for_month()

    Args:
        year_month: Target month in "YYYY-MM" format (e.g., "2026-03")

    Returns:
        {"generated": int, "skipped": int, "errors": int}
    """
    print(f"Starting invoice generation for {year_month}...")

    # ── Calculate dates (same logic as old code) ──
    cycle_date = datetime.strptime(year_month, "%Y-%m")

    # Due date = 5th of the month AFTER the billing cycle
    if cycle_date.month == 12:
        next_month = datetime(cycle_date.year + 1, 1, 5)
    else:
        next_month = datetime(cycle_date.year, cycle_date.month + 1, 5)

    due_date = next_month
    grace_period_end = due_date + timedelta(days=5)

    print(f"Billing cycle: {year_month}, due: {due_date.date()}, grace end: {grace_period_end.date()}")

    # ── Scan active users (with pagination) ──
    users_table = dynamodb.Table(USERS_TABLE)
    users = _scan_all_users(users_table)
    print(f"Found {len(users)} active/grace users")

    invoices_table = dynamodb.Table(INVOICES_TABLE)
    generated = 0
    skipped = 0
    errors = 0

    for user in users:
        user_id = user.get("id", "")
        user_email = user.get("email", "unknown")
        plan_id = user.get("plan_id", "developer")

        try:
            # ── Check for existing invoice ──
            # Query the invoices table GSI by userId + yearMonth
            existing = invoices_table.query(
                IndexName="userId-yearMonth-index",
                KeyConditionExpression=Key("user_id").eq(user_id) & Key("year_month").eq(year_month),
            )
            existing_items = existing.get("Items", [])

            # Get plan rates from plan_catalog
            rates = _get_plan_rates(plan_id)

            if existing_items:
                invoice = existing_items[0]

                # Skip if already PAID or VOID
                if invoice.get("status") in ("PAID", "VOID"):
                    print(f"Skipping {user_email}: invoice already {invoice.get('status')}")
                    skipped += 1
                    continue

                # Finalize existing PENDING invoice
                print(f"Finalizing existing invoice for {user_email}")
                input_tk = int(invoice.get("snapshot_data", {}).get("total_input_tokens", 0))
                output_tk = int(invoice.get("snapshot_data", {}).get("total_output_tokens", 0))

                variable_usd = calculate_variable_cost(
                    input_tk, output_tk,
                    rates["rateInputUsdPer1M"], rates["rateOutputUsdPer1M"],
                    rates["inputTokensFree"], rates["outputTokensFree"],
                )

                # Update the invoice
                invoices_table.update_item(
                    Key={"id": invoice["id"]},
                    UpdateExpression=(
                        "SET calculated_costs = :costs, "
                        "due_date = :due, grace_period_end = :grace, "
                        "updated_at = :now"
                    ),
                    ExpressionAttributeValues={
                        ":costs": {
                            "variable_cost_usd": str(variable_usd),
                            "fixed_cost_inr": str(rates["fixedFeeInr"]),
                            "total_due_display": f"₹{rates['fixedFeeInr']} + ${variable_usd:.2f}",
                        },
                        ":due": due_date.isoformat(),
                        ":grace": grace_period_end.isoformat(),
                        ":now": datetime.utcnow().isoformat() + "Z",
                    },
                )

                invoice_number = invoice.get("invoice_number", "")
                generated += 1

            else:
                # ── Create NEW invoice ──
                print(f"Creating new invoice for {user_email}")

                # Aggregate usage from usage_monthly
                usage = _aggregate_usage(user_id, year_month)
                input_tk = usage["total_input_tokens"]
                output_tk = usage["total_output_tokens"]

                variable_usd = calculate_variable_cost(
                    input_tk, output_tk,
                    rates["rateInputUsdPer1M"], rates["rateOutputUsdPer1M"],
                    rates["inputTokensFree"], rates["outputTokensFree"],
                )

                invoice_id = f"inv_{uuid.uuid4().hex}"
                invoice_number = f"INV-{year_month}-{user_id[:8].upper()}"
                now = datetime.utcnow().isoformat() + "Z"

                invoices_table.put_item(Item={
                    "id": invoice_id,
                    "user_id": user_id,
                    "invoice_number": invoice_number,
                    "year_month": year_month,
                    "start_date": cycle_date.isoformat(),
                    "end_date": (cycle_date + timedelta(days=28)).isoformat(),
                    "status": "PENDING",
                    "due_date": due_date.isoformat(),
                    "grace_period_end": grace_period_end.isoformat(),
                    "plan_id": plan_id,
                    "plan_name": plan_id.capitalize(),
                    "snapshot_data": {
                        "total_input_tokens": input_tk,
                        "total_output_tokens": output_tk,
                        "rate_input_usd_per_1m": str(rates["rateInputUsdPer1M"]),
                        "rate_output_usd_per_1m": str(rates["rateOutputUsdPer1M"]),
                        "fixed_fee_inr": str(rates["fixedFeeInr"]),
                    },
                    "calculated_costs": {
                        "variable_cost_usd": str(variable_usd),
                        "fixed_cost_inr": str(rates["fixedFeeInr"]),
                        "total_due_display": f"₹{rates['fixedFeeInr']} + ${variable_usd:.2f}",
                    },
                    "created_at": now,
                    "updated_at": now,
                })

                generated += 1

            # ── Audit log ──
            _write_audit_log(
                user_id=user_id,
                invoice_number=invoice_number,
                action="BATCH_INVOICE_GENERATION",
                details={
                    "invoice_number": invoice_number,
                    "input_tokens": input_tk,
                    "output_tokens": output_tk,
                    "variable_cost_usd": str(variable_usd),
                    "fixed_fee_inr": str(rates["fixedFeeInr"]),
                },
            )

            print(f"Generated {invoice_number} for {user_email}")

        except Exception as e:
            print(f"ERROR processing {user_email}: {str(e)}")
            errors += 1

    result = {"generated": generated, "skipped": skipped, "errors": errors}
    print(f"Invoice generation complete: {result}")
    return result
