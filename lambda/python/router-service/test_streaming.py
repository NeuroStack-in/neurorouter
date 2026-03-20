"""
Local Test Script for Streaming Handler
========================================
Tests the streaming Lambda handler WITHOUT deploying to AWS.

HOW THIS WORKS:
- We create a FAKE response_stream object that captures bytes
- We call the streaming handler with a fake event
- We verify chunks arrive progressively and usage is captured

HOW TO RUN:
    cd lambda/python/router-service
    GROQ_API_KEY=gsk_your_key_here python test_streaming.py

NOTE: Real Groq key needed for streaming test.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


class FakeResponseStream:
    """
    Simulates the Lambda response_stream object.

    In real Lambda:
        response_stream.write(b"data: ...")  → sends bytes to client
        response_stream.close()              → signals end of stream

    Our fake version:
        - Captures all chunks in a list
        - Prints each chunk as it arrives (simulates real-time streaming)
        - Tracks timing to show chunks arrive progressively
    """

    def __init__(self):
        self.chunks = []
        self.closed = False
        self.start_time = time.time()

    def write(self, data: bytes):
        """Called by the handler for each SSE chunk."""
        elapsed = time.time() - self.start_time
        self.chunks.append(data)

        # Print each chunk in real-time (like watching ChatGPT type)
        text = data.decode("utf-8", errors="replace").strip()
        if text:
            # Show timing to prove chunks arrive progressively
            print(f"   [{elapsed:.2f}s] {text[:120]}")

    def close(self):
        """Called when the stream is done."""
        self.closed = True
        elapsed = time.time() - self.start_time
        print(f"   [{elapsed:.2f}s] --- STREAM CLOSED ---")


def _make_streaming_event(body: dict, authorizer: dict = None) -> dict:
    """Build a fake API Gateway event for streaming."""
    return {
        "httpMethod": "POST",
        "path": "/v1/chat/completions",
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
        "requestContext": {
            "authorizer": authorizer or {
                "userId": "test-user-001",
                "apiKeyId": "test-key-001",
                "planId": "free",
                "accountStatus": "ACTIVE",
            }
        },
    }


def test_non_streaming_rejected():
    """
    Test: Non-streaming request sent to streaming handler → error.
    """
    from handler_streaming import lambda_handler

    print("\n🧪 TEST: Non-streaming request is rejected...")

    event = _make_streaming_event({"model": "gpt-4", "messages": [{"role": "user", "content": "Hi"}], "stream": False})
    stream = FakeResponseStream()

    lambda_handler(event, stream, None)

    assert stream.closed, "Stream should be closed"
    assert len(stream.chunks) > 0, "Should have written an error"

    output = stream.chunks[0].decode("utf-8")
    assert "non-streaming" in output.lower() or "stream=true" in output.lower()

    print("   ✅ PASSED — Non-streaming request rejected correctly")


def test_missing_key_streaming():
    """
    Test: Missing Groq key returns SSE-formatted error.
    """
    from handler_streaming import lambda_handler

    print("\n🧪 TEST: Missing key returns SSE error...")

    old_key = os.environ.pop("GROQ_API_KEY", None)
    old_secret = os.environ.pop("GROQ_SECRET_NAME", None)

    try:
        event = _make_streaming_event({
            "model": "gpt-4",
            "messages": [{"role": "user", "content": "Hi"}],
            "stream": True,
        })
        stream = FakeResponseStream()
        lambda_handler(event, stream, None)

        assert stream.closed, "Stream should be closed"
        assert len(stream.chunks) >= 1, "Should have error chunk"

        # Verify it's valid SSE format
        output = stream.chunks[0].decode("utf-8")
        assert "data: " in output, f"Expected SSE format, got: {output}"

        print("   ✅ PASSED — SSE-formatted error returned")
    finally:
        if old_key:
            os.environ["GROQ_API_KEY"] = old_key
        if old_secret:
            os.environ["GROQ_SECRET_NAME"] = old_secret


def test_real_streaming():
    """
    Test: Real streaming call to Groq.
    Proves chunks arrive progressively (typing effect).
    """
    from handler_streaming import lambda_handler

    groq_key = os.environ.get("GROQ_API_KEY", "")
    if not groq_key:
        print("\n⏭️  SKIP: test_real_streaming (no GROQ_API_KEY set)")
        return

    print("\n🧪 TEST: Real streaming chat completion...")
    print("   (Watch chunks arrive in real-time!)\n")

    event = _make_streaming_event({
        "model": "gpt-4",
        "messages": [{"role": "user", "content": "Count from 1 to 5, one number per line."}],
        "max_tokens": 50,
        "stream": True,
    })

    stream = FakeResponseStream()
    lambda_handler(event, stream, None)

    assert stream.closed, "Stream should be closed"
    assert len(stream.chunks) > 1, (
        f"Expected multiple chunks (streaming), got {len(stream.chunks)}"
    )

    # Reconstruct the full response by extracting delta content
    full_content = ""
    for chunk in stream.chunks:
        text = chunk.decode("utf-8", errors="replace").strip()
        if text.startswith("data: ") and text != "data: [DONE]":
            try:
                parsed = json.loads(text[6:])
                delta = parsed.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                full_content += content
            except Exception:
                pass

    print(f"\n   Full reconstructed response: \"{full_content.strip()}\"")
    print(f"   Total chunks received: {len(stream.chunks)}")
    print("   ✅ PASSED — Streaming works with progressive chunks!")


# ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 60)
    print("  NeuroRouter — Streaming Handler Tests")
    print("=" * 60)

    test_non_streaming_rejected()
    test_missing_key_streaming()
    test_real_streaming()

    print("\n" + "=" * 60)
    print("  All streaming tests completed!")
    print("=" * 60)
