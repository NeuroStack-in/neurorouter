"""
Quick test to check if proxy is responding
"""
import requests
import os

BASE_URL = "https://gaurikapare-neurorouter-backend.hf.space"

print("Testing proxy server...")

API_KEY = os.getenv("NEUROSTACK_API_KEY")
if not API_KEY:
    print("Set NEUROSTACK_API_KEY env var to a valid key generated via /api-keys.")
    raise SystemExit(1)

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

try:
    # Test 1: Health check
    print("\n1. Testing health endpoint...")
    response = requests.get(f"{BASE_URL}/healthz", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")

    # Test 2: Root endpoint
    print("\n2. Testing root endpoint...")
    response = requests.get(f"{BASE_URL}/", timeout=10)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")

    # Test 3: Chat endpoint
    print("\n3. Testing chat endpoint...")
    payload = {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": "Say hi"}],
        "max_tokens": 10
    }

    response = requests.post(
        f"{BASE_URL}/v1/chat/completions",
        headers=headers,
        json=payload,
        timeout=20
    )

    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")

    print("\n✅ Proxy is working!")

except requests.exceptions.ConnectionError:
    print("\n❌ ERROR: Cannot connect to server!")
except requests.exceptions.Timeout:
    print("\n❌ ERROR: Request timed out!")
except Exception as e:
    print(f"\n❌ ERROR: {e}")