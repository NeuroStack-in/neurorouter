"""
Monthly Invoice Job — Lambda Handler (Placeholder)
====================================================
This Lambda runs once a month via EventBridge (AWS cron).
It creates invoices for all active users by reading usage data
from DynamoDB and calculating costs based on plan_catalog rates.
Will be implemented on a later day.
"""


def lambda_handler(event, context):
    """AWS Lambda entry point — triggered by EventBridge schedule."""
    return {
        "statusCode": 501,
        "body": '{"message": "monthly-invoice-job not yet implemented"}',
    }
