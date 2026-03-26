"""
CSV Exporter Module — Day 5 Implementation
============================================
Generates CSV exports of user usage data from DynamoDB.

HOW IT WORKS:
    1. Takes a userId and optional yearMonth filter
    2. Queries usage_monthly DynamoDB table for matching records
    3. Parses the composite sort key to extract month, model, and apiKeyId
    4. Writes results to a CSV with standard columns
    5. Returns a bytes buffer containing the CSV

SORT KEY FORMAT (defined by Dev 1):
    "YYYY-MM#MODEL#{modelName}#KEY#{apiKeyId}"
    Example: "2026-03#MODEL#llama-3.3-70b-versatile#KEY#key456"

    We parse this to extract:
    - yearMonth = "2026-03"
    - model = "llama-3.3-70b-versatile"
    - apiKeyId = "key456"

CSV COLUMNS:
    yearMonth, model, apiKeyId, inputTokens, outputTokens,
    totalTokens, requestCount, updatedAt
"""

import csv
import io
import os
from typing import Optional

import boto3
from boto3.dynamodb.conditions import Key

# AWS clients — created once per cold start
dynamodb = boto3.resource("dynamodb")
USAGE_MONTHLY_TABLE = os.environ.get("USAGE_MONTHLY_TABLE", "neurorouter-usage-monthly-dev")


def _parse_sort_key(sk: str) -> dict:
    """
    Parse the composite sort key into its components.

    Input:  "2026-03#MODEL#llama-3.3-70b-versatile#KEY#key456"
    Output: {"yearMonth": "2026-03", "model": "llama-3.3-70b-versatile", "apiKeyId": "key456"}

    WHY parse instead of storing separate columns?
    DynamoDB only allows querying by partition key + sort key.
    The composite key lets us do prefix queries like begins_with("2026-03")
    to get all usage for a specific month. The trade-off is we need to
    parse the key when reading data.
    """
    parts = sk.split("#")
    result = {"yearMonth": "", "model": "", "apiKeyId": ""}

    if len(parts) >= 1:
        result["yearMonth"] = parts[0]
    if len(parts) >= 3 and parts[1] == "MODEL":
        result["model"] = parts[2]
    if len(parts) >= 5 and parts[3] == "KEY":
        result["apiKeyId"] = parts[4]

    return result


def generate_csv(user_id: str, year_month: Optional[str] = None) -> bytes:
    """
    Generate a CSV export of usage data for a user.

    Parameters
    ----------
    user_id : str
        The user whose usage data to export.
    year_month : str, optional
        Filter to a specific month (e.g., "2026-03").
        If None, exports ALL months.

    Returns
    -------
    bytes
        CSV file content as bytes, ready to upload to S3.

    DynamoDB QUERY STRATEGY:
    - Partition key = userId (always required)
    - If yearMonth is provided: sort key begins_with("2026-03")
      This gets all models/keys for that month efficiently.
    - If no yearMonth: query ALL sort keys for the user.
    """
    table = dynamodb.Table(USAGE_MONTHLY_TABLE)

    # Build query parameters
    if year_month:
        # Query with sort key prefix filter
        # begins_with("2026-03") matches all sort keys starting with that month
        response = table.query(
            KeyConditionExpression=Key("userId").eq(user_id) & Key("sk").begins_with(year_month)
        )
    else:
        # Query all records for this user (no sort key filter)
        response = table.query(
            KeyConditionExpression=Key("userId").eq(user_id)
        )

    items = response.get("Items", [])

    # Handle DynamoDB pagination — if there are more results, keep fetching
    while "LastEvaluatedKey" in response:
        if year_month:
            response = table.query(
                KeyConditionExpression=Key("userId").eq(user_id) & Key("sk").begins_with(year_month),
                ExclusiveStartKey=response["LastEvaluatedKey"],
            )
        else:
            response = table.query(
                KeyConditionExpression=Key("userId").eq(user_id),
                ExclusiveStartKey=response["LastEvaluatedKey"],
            )
        items.extend(response.get("Items", []))

    # Write CSV to in-memory buffer
    output = io.StringIO()
    writer = csv.writer(output)

    # Header row
    writer.writerow([
        "yearMonth", "model", "apiKeyId", "inputTokens",
        "outputTokens", "totalTokens", "requestCount", "updatedAt",
    ])

    # Data rows — parse the composite sort key for each record
    for item in items:
        sk_parts = _parse_sort_key(item.get("sk", ""))
        writer.writerow([
            sk_parts["yearMonth"],
            sk_parts["model"],
            sk_parts["apiKeyId"],
            int(item.get("input_tokens", 0)),
            int(item.get("output_tokens", 0)),
            int(item.get("total_tokens", 0)),
            int(item.get("request_count", 0)),
            item.get("updated_at", ""),
        ])

    # Convert string buffer to bytes (S3 needs bytes)
    return output.getvalue().encode("utf-8")
