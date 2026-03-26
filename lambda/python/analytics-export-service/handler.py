"""
Analytics Export Service — Lambda Handler (Day 5 Implementation)
================================================================
Generates CSV usage exports and uploads them to S3.

HOW IT WORKS:
    1. Dev 1's dashboard-service invokes this Lambda asynchronously
       when a user clicks "Export Usage" in the dashboard.
    2. Handler receives { "userId": "...", "exportId": "...", "yearMonth": "..." }
    3. Calls exporter.py to generate the CSV from DynamoDB usage data.
    4. Uploads the CSV to S3 at exports/{exportId}.csv
    5. Returns { "s3Key": "exports/xxx.csv", "bucket": "...", "status": "DONE" }

ENVIRONMENT VARIABLES (set in Lambda console or CDK):
    USAGE_MONTHLY_TABLE — DynamoDB table name for usage_monthly (default: neurorouter-usage-monthly-dev)
    EXPORT_BUCKET       — S3 bucket for CSV exports (default: neurorouter-invoice-pdfs-dev)
"""

import json
import os

import boto3
from botocore.exceptions import ClientError

from exporter import generate_csv

# AWS clients — created once per cold start
s3_client = boto3.client("s3")
EXPORT_BUCKET = os.environ.get("EXPORT_BUCKET", "neurorouter-invoice-pdfs-dev")


def lambda_handler(event, context):
    """
    AWS Lambda entry point.

    Expected event payload (from Dev 1's dashboard-service):
    {
        "userId": "user123",
        "exportId": "exp_abc",         ← unique ID for this export
        "yearMonth": "2026-03"         ← optional, exports all months if omitted
    }

    Returns:
    {
        "statusCode": 200,
        "body": {
            "s3Key": "exports/exp_abc.csv",
            "bucket": "neurorouter-invoice-pdfs-dev",
            "status": "DONE"
        }
    }
    """
    # ── 1. Validate input ──
    user_id = event.get("userId")
    export_id = event.get("exportId")
    year_month = event.get("yearMonth")  # Optional

    if not user_id or not export_id:
        return _error(400, "Both 'userId' and 'exportId' are required.")

    # ── 2. Generate CSV from DynamoDB ──
    try:
        csv_bytes = generate_csv(user_id, year_month)
    except Exception as e:
        return _error(500, f"CSV generation failed: {str(e)}")

    # ── 3. Upload to S3 ──
    s3_key = f"exports/{export_id}.csv"
    try:
        s3_client.put_object(
            Bucket=EXPORT_BUCKET,
            Key=s3_key,
            Body=csv_bytes,
            ContentType="text/csv",
        )
    except ClientError as e:
        return _error(500, f"S3 upload error: {e.response['Error']['Message']}")

    # ── 4. Return success ──
    print(f"Export complete: userId={user_id}, s3Key={s3_key}, bytes={len(csv_bytes)}")
    return {
        "statusCode": 200,
        "body": json.dumps({
            "s3Key": s3_key,
            "bucket": EXPORT_BUCKET,
            "status": "DONE",
        }),
    }


def _error(code: int, message: str) -> dict:
    """Standard error response."""
    print(f"ERROR [{code}]: {message}")
    return {
        "statusCode": code,
        "body": json.dumps({"error": message}),
    }
