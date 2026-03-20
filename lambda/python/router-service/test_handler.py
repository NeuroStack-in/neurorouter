"""
Local Test Script for router-service Handler
=============================================
Tests the Lambda handler WITHOUT deploying to AWS.

HOW THIS WORKS:
- We construct FAKE API Gateway events (same format as real ones)
- We call lambda_handler() directly (same function AWS calls)
- We check the response matches what we expect

WHY TEST LOCALLY?
- Deploying to AWS takes 30+ seconds
- Local tests run in 1 second
- You can test edge cases (bad input, missing fields) easily
- You can debug with print() statements and see output immediately

HOW TO RUN:
    cd lambda/python/router-service
    GROQ_API_KEY=gsk_your_key_here python test_handler.py

NOTE: For tests that call Groq, you need a real API key.
      For route dispatcher tests, no key needed.
"""

import json
import os
import sys

# Add current directory to Python path so imports work
# WHY: When Lambda runs, all files are in the same directory.
# Locally, Python might not know to look in the current folder.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from handler import lambda_handler


def _make_event(method: str, path: str, body: dict = None, authorizer: dict = None) -> dict:
    """
    Build a fake API Gateway event.

    This mimics exactly what API Gateway sends to Lambda.
    We use this instead of hitting real AWS endpoints.
    """
    return {
        "httpMethod": method,
        "path": path,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body) if body else None,
        "requestContext": {
            "authorizer": authorizer or {
                "userId": "test-user-001",
                "apiKeyId": "test-key-001",
                "planId": "free",
                "accountStatus": "ACTIVE",
            }
        },
    }


def test_route_dispatcher_404():
    """
    Test: Unknown routes return 404.
    No Groq key needed — this tests routing only.
    """
    print("\n🧪 TEST: Unknown route returns 404...")

    event = _make_event("GET", "/v1/unknown-endpoint")
    response = lambda_handler(event, None)

    assert response["statusCode"] == 404, f"Expected 404, got {response['statusCode']}"

    body = json.loads(response["body"])
    assert body["error"]["type"] == "not_found"

    print("   ✅ PASSED — 404 returned for unknown route")


def test_route_dispatcher_options():
    """
    Test: OPTIONS requests return 204 (CORS preflight).
    """
    print("\n🧪 TEST: OPTIONS returns 204 (CORS preflight)...")

    event = _make_event("OPTIONS", "/v1/chat/completions")
    response = lambda_handler(event, None)

    assert response["statusCode"] == 204, f"Expected 204, got {response['statusCode']}"
    assert "Access-Control-Allow-Origin" in response["headers"]

    print("   ✅ PASSED — CORS preflight handled correctly")


def test_list_models():
    """
    Test: GET /v1/models returns our model catalog.
    No Groq key needed — returns hardcoded catalog.
    """
    print("\n🧪 TEST: GET /v1/models returns model catalog...")

    event = _make_event("GET", "/v1/models")
    response = lambda_handler(event, None)

    assert response["statusCode"] == 200, f"Expected 200, got {response['statusCode']}"

    body = json.loads(response["body"])
    assert body["object"] == "list"
    assert len(body["data"]) > 0

    model_ids = [m["id"] for m in body["data"]]
    assert "llama-3.3-70b-versatile" in model_ids

    print(f"   ✅ PASSED — {len(body['data'])} models returned")
    for m in body["data"]:
        print(f"      - {m['id']} (owned by {m['owned_by']})")


def test_streaming_returns_error():
    """
    Test: stream=true returns clear error (not implemented yet).
    """
    print("\n🧪 TEST: stream=true returns 400 error...")

    event = _make_event("POST", "/v1/chat/completions", body={
        "model": "gpt-4",
        "messages": [{"role": "user", "content": "Hi"}],
        "stream": True,
    })
    response = lambda_handler(event, None)

    assert response["statusCode"] == 400, f"Expected 400, got {response['statusCode']}"

    body = json.loads(response["body"])
    assert "streaming" in body["error"]["message"].lower()

    print("   ✅ PASSED — Streaming correctly rejected with clear message")


def test_chat_completions_no_key():
    """
    Test: Missing Groq key returns error (not a crash).
    """
    print("\n🧪 TEST: Missing Groq key returns clean error...")

    # Make sure no key is set
    old_key = os.environ.pop("GROQ_API_KEY", None)
    old_secret = os.environ.pop("GROQ_SECRET_NAME", None)

    try:
        event = _make_event("POST", "/v1/chat/completions", body={
            "model": "gpt-4",
            "messages": [{"role": "user", "content": "Hi"}],
        })
        response = lambda_handler(event, None)

        # Should return 502 (upstream error) not crash
        assert response["statusCode"] == 502, f"Expected 502, got {response['statusCode']}"
        print("   ✅ PASSED — Clean error returned when Groq key is missing")
    finally:
        # Restore env vars
        if old_key:
            os.environ["GROQ_API_KEY"] = old_key
        if old_secret:
            os.environ["GROQ_SECRET_NAME"] = old_secret


def test_chat_completions_real():
    """
    Test: Real chat completion call to Groq (needs GROQ_API_KEY).
    Skip if no key available.
    """
    groq_key = os.environ.get("GROQ_API_KEY", "")
    if not groq_key:
        print("\n⏭️  SKIP: test_chat_completions_real (no GROQ_API_KEY set)")
        return

    print("\n🧪 TEST: Real non-streaming chat completion...")

    event = _make_event("POST", "/v1/chat/completions", body={
        "model": "gpt-4",
        "messages": [{"role": "user", "content": "Say hello in exactly 3 words."}],
        "max_tokens": 20,
    })
    response = lambda_handler(event, None)

    assert response["statusCode"] == 200, (
        f"Expected 200, got {response['statusCode']}: {response['body']}"
    )

    body = json.loads(response["body"])

    # Verify OpenAI-compatible response format
    assert "choices" in body, f"Missing 'choices' in response: {body}"
    assert len(body["choices"]) > 0
    assert "message" in body["choices"][0]

    content = body["choices"][0]["message"]["content"]
    print(f"   AI responded: \"{content}\"")

    # Verify usage data exists (needed for billing)
    assert "usage" in body, f"Missing 'usage' in response: {body}"
    usage = body["usage"]
    print(f"   Tokens — prompt: {usage['prompt_tokens']}, "
          f"completion: {usage['completion_tokens']}, "
          f"total: {usage['total_tokens']}")

    print("   ✅ PASSED — Real Groq completion works!")


def test_completions_alias():
    """
    Test: /v1/completions routes to the same handler as /v1/chat/completions.
    """
    groq_key = os.environ.get("GROQ_API_KEY", "")
    if not groq_key:
        print("\n⏭️  SKIP: test_completions_alias (no GROQ_API_KEY set)")
        return

    print("\n🧪 TEST: /v1/completions works as alias...")

    event = _make_event("POST", "/v1/completions", body={
        "model": "gpt-4",
        "messages": [{"role": "user", "content": "Say hi"}],
        "max_tokens": 10,
    })
    response = lambda_handler(event, None)

    assert response["statusCode"] == 200, (
        f"Expected 200, got {response['statusCode']}: {response['body']}"
    )
    print("   ✅ PASSED — /v1/completions alias works!")


# ──────────────────────────────────────────────────────────────────
# RUN ALL TESTS
# ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  NeuroRouter — router-service Local Tests")
    print("=" * 60)

    # Tests that DON'T need a Groq key (always run)
    test_route_dispatcher_404()
    test_route_dispatcher_options()
    test_list_models()
    test_streaming_returns_error()
    test_chat_completions_no_key()

    # Tests that NEED a Groq key (skip if not available)
    test_chat_completions_real()
    test_completions_alias()

    print("\n" + "=" * 60)
    print("  All tests completed!")
    print("=" * 60)
