"""
Test script for NeuroStack API on Hugging Face
"""
from openai import OpenAI
import sys
import os

# NeuroStack API Configuration
NEUROSTACK_BASE_URL = os.getenv("NEUROSTACK_BASE_URL", "https://kiranparthiban-neuro-router.hf.space/v1")
NEUROSTACK_API_KEY = os.getenv("NEUROSTACK_API_KEY")  # Set to a valid key from /api-keys

if not NEUROSTACK_API_KEY:
    raise RuntimeError("Set NEUROSTACK_API_KEY env var to a valid key generated via /api-keys")

def test_chat_completion():
    """Test basic chat completion"""
    print("Testing NeuroStack Chat Completion...")
    
    client = OpenAI(
        base_url=NEUROSTACK_BASE_URL,
        api_key=NEUROSTACK_API_KEY
    )
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": "Say 'Hello from NeuroStack API!'"}
            ]
        )
        print("✅ Success!")
        print(f"Response: {response.choices[0].message.content}\n")
        return True
    except Exception as e:
        print(f"❌ Failed: {e}\n")
        return False

def test_streaming():
    """Test streaming responses"""
    print("Testing NeuroStack Streaming...")
    
    client = OpenAI(
        base_url=NEUROSTACK_BASE_URL,
        api_key=NEUROSTACK_API_KEY
    )
    
    try:
        stream = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "user", "content": "Count from 1 to 5"}
            ],
            stream=True
        )
        
        print("✅ Streaming response: ", end="")
        for chunk in stream:
            if chunk.choices[0].delta.content:
                print(chunk.choices[0].delta.content, end="", flush=True)
        print("\n")
        return True
    except Exception as e:
        print(f"❌ Failed: {e}\n")
        return False

def test_models_endpoint():
    """Test models listing"""
    print("Testing NeuroStack Models Endpoint...")
    
    client = OpenAI(
        base_url=NEUROSTACK_BASE_URL,
        api_key=NEUROSTACK_API_KEY
    )
    
    try:
        models = client.models.list()
        print("✅ Available models:")
        for model in models.data[:5]:  # Show first 5
            print(f"  - {model.id}")
        print()
        return True
    except Exception as e:
        print(f"❌ Failed: {e}\n")
        return False

def test_invalid_key():
    """Test with invalid API key"""
    print("Testing Invalid API Key (should fail)...")
    
    client = OpenAI(
        base_url=NEUROSTACK_BASE_URL,
        api_key="invalid_key"
    )
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "Hello"}]
        )
        print("❌ Should have failed but didn't!\n")
        return False
    except Exception as e:
        print(f"✅ Correctly rejected: {str(e)[:50]}...\n")
        return True

if __name__ == "__main__":
    print("=" * 60)
    print("NeuroStack API Test Suite")
    print("=" * 60)
    print(f"Endpoint: {NEUROSTACK_BASE_URL}")
    print("=" * 60)
    print()
    
    results = []
    
    # Run tests
    results.append(("Chat Completion", test_chat_completion()))
    results.append(("Streaming", test_streaming()))
    results.append(("Models List", test_models_endpoint()))
    results.append(("Invalid Key", test_invalid_key()))
    
    # Summary
    print("=" * 60)
    print("Test Results Summary")
    print("=" * 60)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {name}")
    
    print("=" * 60)
    print(f"Passed: {passed}/{total}")
    print("=" * 60)
    
    sys.exit(0 if passed == total else 1)
