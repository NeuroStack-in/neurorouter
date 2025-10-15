"""
Test script for NeuroStack OpenAI Proxy
"""
import requests
import json

# Configuration
BASE_URL = "http://localhost:7860"
API_KEY = "neurostack_a1b2c3d4e5f6g"  # Replace with your actual API key

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}


def test_health():
    """Test health endpoint"""
    print("\n=== Testing Health Endpoint ===")
    response = requests.get(f"{BASE_URL}/healthz")
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")


def test_root():
    """Test root endpoint"""
    print("\n=== Testing Root Endpoint ===")
    response = requests.get(f"{BASE_URL}/")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")


def test_chat_completion():
    """Test chat completions endpoint"""
    print("\n=== Testing Chat Completions (Non-streaming) ===")
    
    payload = {
        "model": "gpt-4o-mini",  # Will be mapped to Llama Maverick
        "messages": [
            {"role": "user", "content": "Say hello in one sentence!"}
        ],
        "max_tokens": 50
    }
    
    response = requests.post(
        f"{BASE_URL}/v1/chat/completions",
        headers=headers,
        json=payload
    )
    
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"Model: {data.get('model')}")
        print(f"Response: {data['choices'][0]['message']['content']}")
    else:
        print(f"Error: {response.text}")


def test_chat_completion_streaming():
    """Test chat completions with streaming"""
    print("\n=== Testing Chat Completions (Streaming) ===")
    
    payload = {
        "model": "gpt-4o-mini",
        "messages": [
            {"role": "user", "content": "Count from 1 to 5"}
        ],
        "stream": True,
        "max_tokens": 50
    }
    
    response = requests.post(
        f"{BASE_URL}/v1/chat/completions",
        headers=headers,
        json=payload,
        stream=True
    )
    
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        print("Streaming response:")
        for line in response.iter_lines():
            if line:
                line_str = line.decode('utf-8')
                if line_str.startswith('data: ') and line_str != 'data: [DONE]':
                    try:
                        data = json.loads(line_str[6:])
                        if data['choices'][0]['delta'].get('content'):
                            print(data['choices'][0]['delta']['content'], end='', flush=True)
                    except:
                        pass
        print()
    else:
        print(f"Error: {response.text}")


def test_invalid_key():
    """Test with invalid API key"""
    print("\n=== Testing Invalid API Key ===")
    
    invalid_headers = {
        "Authorization": "Bearer neurostack_invalid123",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": "Hello"}]
    }
    
    response = requests.post(
        f"{BASE_URL}/v1/chat/completions",
        headers=invalid_headers,
        json=payload
    )
    
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")


if __name__ == "__main__":
    print("=" * 50)
    print("NeuroStack OpenAI Proxy - Test Suite")
    print("=" * 50)
    
    try:
        test_health()
        test_root()
        test_chat_completion()
        test_chat_completion_streaming()
        test_invalid_key()
        
        print("\n" + "=" * 50)
        print("All tests completed!")
        print("=" * 50)
    except Exception as e:
        print(f"\nError during testing: {e}")
