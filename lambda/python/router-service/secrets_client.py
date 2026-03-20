"""
Secrets Manager Helper Module
==============================
Retrieves secret values from AWS Secrets Manager with in-memory caching.

WHY NOT JUST USE ENVIRONMENT VARIABLES?
- Env vars are visible to anyone with Lambda console access
- Secrets Manager encrypts values at rest with AWS KMS
- Secrets can be rotated without redeploying the Lambda
- Access is logged in AWS CloudTrail (audit trail)

HOW IT WORKS:
1. First call: Fetches the secret from AWS Secrets Manager API (~50ms)
2. Subsequent calls: Returns the cached value instantly (0ms)
3. Cache lives for the lifetime of the Lambda instance (warm start)
4. When Lambda cold-starts, the cache is empty and fetches again

WHAT'S STORED IN SECRETS MANAGER:
- The Groq API key (gsk_xxx) — used by GroqAdapter to authenticate with Groq Cloud
- Future: OpenAI API key, Anthropic API key, etc.
"""

import json
from typing import Optional

import boto3


# In-memory cache for secrets.
# Dict[secret_name -> secret_value]
# Persists across Lambda warm starts (same as dynamo_client.py caching pattern)
_cache: dict = {}

# Boto3 Secrets Manager client — also cached for warm starts
_sm_client = None


def _get_client():
    """
    Get or create the Secrets Manager client.
    Same caching pattern as dynamo_client.py — avoid re-creating boto3 clients.
    """
    global _sm_client
    if _sm_client is None:
        _sm_client = boto3.client("secretsmanager")
    return _sm_client


def get_secret(secret_name: str) -> str:
    """
    Retrieve a secret value from AWS Secrets Manager.

    Caches the result in memory — subsequent calls within the same
    Lambda instance return immediately without an API call.

    Args:
        secret_name: The name or ARN of the secret in AWS Secrets Manager.
                     Example: "neurorouter/prod/groq-api-key"

    Returns:
        The secret string value.

    Raises:
        Exception: If the secret doesn't exist or access is denied.

    Example:
        # In your Lambda handler:
        groq_key = get_secret("neurorouter/prod/groq-api-key")
        adapter = GroqAdapter(api_key=groq_key)

    HOW THE SECRET IS STORED IN AWS:
    - You create a secret in the AWS console or CLI:
        aws secretsmanager create-secret \\
            --name "neurorouter/prod/groq-api-key" \\
            --secret-string "gsk_PnZ9gDHY8VHQjRKGqkkfWGdyb3FY069..."
    - The Lambda needs IAM permission to read it (Dev 1 handles this in CDK)
    """
    # Return from cache if we've already fetched this secret
    if secret_name in _cache:
        return _cache[secret_name]

    # Fetch from AWS Secrets Manager
    client = _get_client()
    response = client.get_secret_value(SecretId=secret_name)

    # Secrets Manager returns the value in "SecretString" (for text secrets)
    # or "SecretBinary" (for binary secrets). We use text (the API key is a string).
    secret_value = response["SecretString"]

    # Some secrets are stored as JSON objects like {"api_key": "gsk_xxx"}.
    # If it's valid JSON, we still return the raw string — the caller can parse it.
    # This keeps the helper simple and generic.

    # Cache it for future calls
    _cache[secret_name] = secret_value

    return secret_value


def get_secret_json(secret_name: str) -> dict:
    """
    Retrieve a secret and parse it as JSON.

    Useful when a secret stores multiple values, e.g.:
    {
        "groq_api_key": "gsk_xxx",
        "openai_api_key": "sk-xxx"
    }

    Args:
        secret_name: The name or ARN of the secret

    Returns:
        Parsed JSON as a Python dict
    """
    raw = get_secret(secret_name)
    return json.loads(raw)


def clear_cache():
    """
    Clear the in-memory secret cache.

    You typically DON'T need this — Lambda warm starts naturally
    get fresh secrets on cold start. But it's useful for testing
    or if you need to force a re-fetch after secret rotation.
    """
    global _cache
    _cache = {}
