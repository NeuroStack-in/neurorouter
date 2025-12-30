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
 # DATABASE_URL=sqlite:///./neuro_router.db
 # JWT_SECRET_KEY=your_long_random_string
 # MONTHLY_TOKEN_LIMIT=0   # set >0 to enforce monthly cap per user
 ```

4. **Initialize the database (first run)**
```bash
python -m app.database
```

5. **Run the server**
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
| `/auth/register` | POST | Register a new user (email/password) |
| `/auth/login` | POST | Login and receive JWT |
| `/api-keys` | POST | Create a new API key (JWT protected) |
| `/api-keys` | GET | List your API keys (JWT protected, no raw key) |
| `/api-keys/{id}` | DELETE | Revoke an API key (JWT protected) |
| `/auth/google` | POST | Login/Register with Google ID token |
| `/healthz` | GET | Health check |
| `/` | GET | Service info |

## 🔐 Authentication

- Register with email/password: `POST /auth/register`
- Login to get JWT: `POST /auth/login` → `{"access_token": "...", "token_type": "bearer"}`
- Create API keys with your JWT: `POST /api-keys` (raw key returned once)
- Clients call `/v1/*` endpoints using `Authorization: Bearer neurostack_XXXXXXXXXXXXX`
- JWT is only for managing your account/API keys; it is **not** used for `/v1` proxy calls

## 💻 Usage Examples

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:7860/v1",
    api_key="YOUR_GENERATED_API_KEY"
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
  -H "Authorization: Bearer YOUR_GENERATED_API_KEY" \
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
  apiKey: 'YOUR_GENERATED_API_KEY'
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

Set `NEUROSTACK_API_KEY` to a valid key generated via `/api-keys` before running the scripts below.

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

# Model to use (Llama Maverick)
DEFAULT_MODEL=llama-3.3-70b-versatile

# CORS settings
CORS_ALLOW_ORIGINS=*

# Database configuration
DATABASE_URL=sqlite:///./neuro_router.db

# JWT and API key management
JWT_SECRET_KEY=change_me
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440

# Monthly token limit per user (0 disables limit)
MONTHLY_TOKEN_LIMIT=0

# Google OAuth
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
```

## 🔄 How It Works

1. **Client sends request** → with any OpenAI model name
2. **Proxy authenticates** → validates neurostack API key against the database
3. **Usage guard** → enforces per-user monthly token limit (if configured)
4. **Model conversion** → changes to `llama-3.3-70b-versatile`
5. **Forward to Groq** → sends request to Groq Cloud
6. **Return response + record usage** → sends back in OpenAI format and records tokens per user/key/model/month

## Token Accounting

- Usage is recorded per `user_id` + `api_key_id` + `model` + `YYYY-MM`
- Tokens come from Groq responses: `usage.prompt_tokens` (input) and `usage.completion_tokens` (output)
- Streaming requests capture the final usage block before `[DONE]`
- Monthly limit (`MONTHLY_TOKEN_LIMIT`) is enforced per user; if reached, the proxy returns HTTP 429 without forwarding
- Initialize tables with `python -m app.database` (creates `users`, `api_keys`, `monthly_usage`)

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
   - `DATABASE_URL`
   - `JWT_SECRET_KEY`
   - `JWT_ALGORITHM`
   - `JWT_EXPIRE_MINUTES`
   - `DEFAULT_MODEL`
   - `MONTHLY_TOKEN_LIMIT`

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

Use the API:
1. `POST /auth/register` (if you don't have an account)
2. `POST /auth/login` to get JWT
3. `POST /api-keys` with the JWT to generate a new key (raw key shown once)

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
    api_key="YOUR_GENERATED_API_KEY"
)
```

It's that simple! 🚀
