"""
DynamoDB Helper Module
======================
Provides a clean interface to get DynamoDB table resources.

WHY THIS EXISTS:
- In AWS Lambda, table names are different per environment:
  - Dev:  "neurorouter-dev-usage_events"
  - Prod: "neurorouter-prod-usage_events"
- Dev 1 sets these as Lambda environment variables during CDK deployment
- This module reads those env vars so the SAME code works everywhere

HOW AWS LAMBDA ENV VARS WORK:
- When Dev 1 deploys the Lambda via CDK, they set env vars like:
    TABLE_USAGE_EVENTS=neurorouter-prod-usage_events
    TABLE_USAGE_MONTHLY=neurorouter-prod-usage_monthly
    TABLE_INVOICES=neurorouter-prod-invoices
- This module reads those at runtime using os.environ

WHY CACHE THE RESOURCE?
- boto3.resource('dynamodb') creates a connection to AWS
- Creating it once and reusing it is much faster (100ms+ savings per request)
- Lambda keeps the module in memory between invocations ("warm start"),
  so the cached resource persists across requests
"""

import os
from typing import Optional

import boto3


# Cache the boto3 DynamoDB resource at module level.
# This is a Lambda best practice: resources created outside the handler
# function persist across invocations (warm starts), avoiding re-initialization.
_dynamodb_resource = None


def _get_resource():
    """
    Get or create the DynamoDB resource.
    Cached at module level for Lambda warm-start reuse.

    WHY module-level caching?
    - Lambda "freezes" the execution environment between invocations
    - Next time the Lambda is called (warm start), this variable still exists
    - This saves ~100-200ms of boto3 initialization on every request
    """
    global _dynamodb_resource
    if _dynamodb_resource is None:
        _dynamodb_resource = boto3.resource("dynamodb")
    return _dynamodb_resource


def get_table(env_var_name: str):
    """
    Get a DynamoDB Table resource by its environment variable name.

    Args:
        env_var_name: The name of the Lambda environment variable that
                      holds the actual DynamoDB table name.
                      Example: "TABLE_USAGE_EVENTS"

    Returns:
        boto3 DynamoDB Table resource — you can call .put_item(), .query(), etc.

    Raises:
        EnvironmentError: If the environment variable is not set

    Example:
        # In your Lambda handler:
        usage_table = get_table("TABLE_USAGE_EVENTS")
        usage_table.put_item(Item={"user_id": "abc", "tokens": 100})

        # The actual table name (e.g., "neurorouter-prod-usage_events")
        # comes from the Lambda's environment variables, set by Dev 1's CDK code.
    """
    table_name = os.environ.get(env_var_name)
    if not table_name:
        raise EnvironmentError(
            f"Environment variable '{env_var_name}' is not set. "
            f"This should be configured in the Lambda's environment by CDK deployment."
        )
    return _get_resource().Table(table_name)


# ──────────────────────────────────────────────────────────────────
# Convenience constants for table environment variable names.
# Use these instead of raw strings to avoid typos:
#   get_table(TABLE_USAGE_EVENTS)  instead of  get_table("TABLE_USAGE_EVENTS")
# ──────────────────────────────────────────────────────────────────

TABLE_USAGE_EVENTS = "TABLE_USAGE_EVENTS"
TABLE_USAGE_MONTHLY = "TABLE_USAGE_MONTHLY"
TABLE_INVOICES = "TABLE_INVOICES"
TABLE_USERS = "TABLE_USERS"
TABLE_PLAN_CATALOG = "TABLE_PLAN_CATALOG"
TABLE_ADMIN_AUDIT_LOG = "TABLE_ADMIN_AUDIT_LOG"
