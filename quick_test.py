"""
Quick test to check if proxy is responding
"""
import requests

print("Testing proxy server...")

try:
    # Test 1: Health check
    print("\n1. Testing health endpoint...")
    response = requests.get("http://localhost:7860/healthz", timeout=5)
    print(f"   Status: {response.status_code}")
    print(f"   Response: {response.json()}")
    
    # Test 2: Root endpoint
    print("\n2. Testing root endpoint...")
    response = requests.get("http://localhost:7860/", timeout=5)
    print(f"   Status: {response.status_code}")
    print(f"   Response: {response.json()}")
    
    # Test 3: Simple API call
    print("\n3. Testing chat endpoint...")
    headers = {
        "Authorization": "Bearer neurostack_a1b2c3d4e5f6g",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "gpt-4o-mini",
        "messages": [{"role": "user", "content": "Say hi"}],
        "max_tokens": 10
    }
    response = requests.post(
        "http://localhost:7860/v1/chat/completions",
        headers=headers,
        json=payload,
        timeout=30
    )
    print(f"   Status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"   Response: {data['choices'][0]['message']['content']}")
    else:
        print(f"   Error: {response.text}")
    
    print("\n✅ Proxy is working!")
    
except requests.exceptions.ConnectionError:
    print("\n❌ ERROR: Cannot connect to server!")
    print("   Make sure the server is running:")
    print("   conda activate mcc-project")
    print("   python run.py")
except requests.exceptions.Timeout:
    print("\n❌ ERROR: Request timed out!")
    print("   The server might be slow or hanging.")
except Exception as e:
    print(f"\n❌ ERROR: {e}")
