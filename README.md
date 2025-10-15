# NeuroStack OpenAI Proxy

A FastAPI-based proxy server that provides OpenAI-compatible API endpoints while routing all requests to Groq's Llama Maverick (llama-3.3-70b-versatile) model under the hood.

## 🎯 What This Does

- **Accepts**: OpenAI-compatible API requests (any model name: gpt-4, gpt-4o-mini, etc.)
- **Processes**: Custom API key authentication (neurostack_XXXXXXXXXXXXX format)
- **Routes**: All requests to Groq's Llama Maverick model
- **Returns**: Responses in OpenAI-compatible format

Your clients use familiar OpenAI SDK and endpoints, but you control the backend model and costs!

## 🔑 API Key Format

- Format: `neurostack_` followed by exactly 13 alphanumeric characters
- Example: `neurostack_a1b2c3d4e5f6g`

## 🚀 Quick Start

### Prerequisites
```bash
# Conda environment (or Python 3.11+)
conda create -n mcc-project python=3.11
conda activate mcc-project
```

### Installation

1. **Clone/Copy the project**
```bash
cd D:\Clients\neuro_router
```

2. **Install dependencies**
```bash
pip install -r requirements.txt
```

3. **Configure environment**
```bash
# Copy .env.example to .env
copy .env.example .env

# Edit .env and add your keys:
# GROQ_API_KEY=gsk_your_groq_api_key_here
# VALID_API_KEYS=neurostack_a1b2c3d4e5f6g,neurostack_h7i8j9k0l1m2n
```

4. **Run the server**
```bash
python run.py
```

Server runs on: `http://localhost:7860`

## 📡 API Endpoints

### Base URL
```
http://localhost:7860/v1
```

### Available Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Chat completions (OpenAI compatible) |
| `/v1/completions` | POST | Text completions (OpenAI compatible) |
| `/v1/models` | GET | List available models |
| `/healthz` | GET | Health check |
| `/` | GET | Service info |

## 🔐 Authentication

All requests require Bearer token authentication:

```bash
Authorization: Bearer neurostack_XXXXXXXXXXXXX
```

## 💻 Usage Examples

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:7860/v1",
    api_key="neurostack_a1b2c3d4e5f6g"
)

# Simple chat
response = client.chat.completions.create(
    model="gpt-4o-mini",  # Any model name works!
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Count to 5"}],
    stream=True
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### cURL

```bash
curl -X POST http://localhost:7860/v1/chat/completions \
  -H "Authorization: Bearer neurostack_a1b2c3d4e5f6g" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hi"}],
    "max_tokens": 50
  }'
```

### JavaScript/TypeScript

```javascript
const OpenAI = require('openai');

const client = new OpenAI({
  baseURL: 'http://localhost:7860/v1',
  apiKey: 'neurostack_a1b2c3d4e5f6g'
});

async function main() {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'Hello!' }]
  });
  console.log(response.choices[0].message.content);
}

main();
```

## 🧪 Testing

### Quick Test
```bash
conda activate mcc-project
python quick_test.py
```

### Full Test Suite
```bash
python test_proxy.py
```

### Client Examples
```bash
python client_example.py
```

## 🏗️ Project Structure

```
neuro_router/
├── app/
│   ├── __init__.py
│   ├── config.py           # Configuration & settings
│   ├── auth.py             # API key validation
│   ├── proxy.py            # Groq forwarding logic
│   ├── main.py             # FastAPI application
│   └── routers/
│       ├── __init__.py
│       └── openai_proxy.py # OpenAI-compatible endpoints
├── requirements.txt        # Python dependencies
├── .env                    # Environment variables (DO NOT COMMIT)
├── .env.example            # Environment template
├── run.py                  # Server startup script
├── test_proxy.py           # Test suite
├── client_example.py       # Usage examples
├── quick_test.py           # Quick verification
└── README.md               # This file
```

## ⚙️ Configuration

Environment variables (`.env` file):

```env
# Required: Your Groq API key
GROQ_API_KEY=gsk_your_groq_api_key_here

# Groq base URL (OpenAI-compatible endpoint)
GROQ_BASE_URL=https://api.groq.com/openai/v1

# Your custom API keys (comma-separated)
VALID_API_KEYS=neurostack_a1b2c3d4e5f6g,neurostack_h7i8j9k0l1m2n

# Model to use (Llama Maverick)
DEFAULT_MODEL=llama-3.3-70b-versatile

# CORS settings
CORS_ALLOW_ORIGINS=*
```

## 🔄 How It Works

1. **Client sends request** → with any OpenAI model name
2. **Proxy authenticates** → validates neurostack API key
3. **Model conversion** → changes to `llama-3.3-70b-versatile`
4. **Forward to Groq** → sends request to Groq Cloud
5. **Return response** → sends back in OpenAI format

The client never knows they're using Groq - it's completely transparent!

## 🌐 Deployment

### Hugging Face Spaces

1. Create new Space (Docker SDK)
2. Add files to Space repo
3. Create `Dockerfile`:

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY run.py .

EXPOSE 7860

CMD ["python", "run.py"]
```

4. Add secrets in Space settings:
   - `GROQ_API_KEY`
   - `VALID_API_KEYS`
   - `DEFAULT_MODEL`

5. Push and deploy!

### Production Considerations

- Use environment variables for all secrets
- Enable HTTPS/TLS in production
- Implement rate limiting
- Add request logging
- Set up monitoring
- Lock down CORS (`CORS_ALLOW_ORIGINS`)

## 🛠️ Development

### Run in Development Mode
```bash
conda activate mcc-project
python run.py
```

Server auto-reloads on code changes.

### Adding New API Keys

Edit `.env`:
```env
VALID_API_KEYS=neurostack_key1,neurostack_key2,neurostack_key3
```

Restart server to apply changes.

## 📊 Monitoring

- Check Groq dashboard: https://console.groq.com
- Server logs show all requests
- Health endpoint: `http://localhost:7860/healthz`

## ❓ Troubleshooting

### Server won't start
- Check `.env` file exists with valid `GROQ_API_KEY`
- Ensure port 7860 is not in use
- Verify conda environment is activated

### No response from API
- Ensure server is running in separate terminal
- Check API key format is correct
- Verify Groq API key is valid

### Groq dashboard shows 0 calls
- Dashboard may have delay (2-3 minutes)
- Check date filter in dashboard
- Verify correct Groq project selected

## 📝 License

Private/Proprietary

## 🤝 Support

For issues or questions:
1. Check `HOW_TO_RUN.txt` for detailed instructions
2. Verify `.env` configuration
3. Test with `quick_test.py`

---

## 🎯 For Your Clients

Share this with your clients:

**Endpoint**: `http://your-server:7860/v1`  
**API Key**: `neurostack_XXXXXXXXXXXXX`  
**Usage**: Exactly like OpenAI API

```python
from openai import OpenAI
client = OpenAI(
    base_url="http://your-server:7860/v1",
    api_key="neurostack_a1b2c3d4e5f6g"
)
```

It's that simple! 🚀
