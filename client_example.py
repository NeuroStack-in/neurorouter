"""
Example client usage for NeuroStack OpenAI Proxy
"""
from openai import OpenAI

# Initialize the OpenAI client pointing to your proxy
client = OpenAI(
    base_url="http://localhost:7860/v1",  # Your proxy URL
    api_key="neurostack_a1b2c3d4e5f6g"     # Your custom API key
)

# Example 1: Simple chat completion
print("=== Example 1: Simple Chat ===")
response = client.chat.completions.create(
    model="gpt-4o-mini",  # Model name doesn't matter, will use Llama Maverick
    messages=[
        {"role": "user", "content": "Hello! Who are you?"}
    ],
    max_tokens=100
)
print(response.choices[0].message.content)
print()

# Example 2: Streaming response
print("=== Example 2: Streaming Chat ===")
stream = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "user", "content": "Count from 1 to 10"}
    ],
    stream=True,
    max_tokens=100
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print("\n")

# Example 3: With system message
print("=== Example 3: With System Message ===")
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": "You are a helpful assistant that speaks like a pirate."},
        {"role": "user", "content": "Tell me about the weather today"}
    ],
    max_tokens=100
)
print(response.choices[0].message.content)
