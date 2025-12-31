from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import init_db
from .routers.auth_routes import router as auth_router
from .routers.openai_proxy import router as openai_router
from .routers.dashboard_routes import router as dashboard_router

app = FastAPI(
    title="NeuroStack OpenAI-Compatible Proxy",
    description="OpenAI-compatible API that routes to Groq's Llama Maverick model",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

@app.on_event("startup")
async def on_startup():
    print(f"DEBUG: Allowed Origins: {origins}")
    await init_db()

# CORS
# CORS
origins_raw = settings.cors_allow_origins.split(",")
origins = []
for o in origins_raw:
    o_clean = o.strip()
    if o_clean and o_clean != "*":
         origins.append(o_clean)

# If only "*" is present and we want credentials, we must be specific.
# FastAPI's CORSMiddleware with allow_credentials=True creates issues if we pass ["*"].
# We'll allow specific known dev ports + whatever is in env (excluding *).

if "http://localhost:3000" not in origins:
    origins.append("http://localhost:3000")
if "http://127.0.0.1:3000" not in origins:
    origins.append("http://127.0.0.1:3000")

# Add the explicit frontend domain user provided
# In production, users should set CORS_ALLOW_ORIGINS env var to this domain.
# But hardcoding it here as a fallback ensures it works now.
PRODUCTION_FRONTEND = "https://router-neurostack-in.onrender.com"
if PRODUCTION_FRONTEND not in origins:
    origins.append(PRODUCTION_FRONTEND)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router)
app.include_router(openai_router)
app.include_router(dashboard_router)


@app.get("/")
async def root():
    return {
        "service": "NeuroStack OpenAI Proxy",
        "status": "online",
        "endpoints": {
            "chat_completions": "/v1/chat/completions",
            "completions": "/v1/completions",
            "models": "/v1/models"
        },
        "auth": "Required - Bearer neurostack_XXXXXXXXXXXXX (13 alphanumeric chars)"
    }


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
