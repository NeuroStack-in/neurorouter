from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import init_db
from .routers.auth_routes import router as auth_router
from .routers.openai_proxy import router as openai_router
from .routers.dashboard_routes import router as dashboard_router
from .routers.billing import router as billing_router

# -------------------- APP --------------------

app = FastAPI(
    title="NeuroStack OpenAI-Compatible Proxy",
    description="OpenAI-compatible API that routes to Groq's Llama Maverick model",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# -------------------- CORS --------------------

origins = []

# From ENV (comma-separated)
if settings.cors_allow_origins:
    for o in settings.cors_allow_origins.split(","):
        o = o.strip()
        if o and o != "*":
            origins.append(o)

# Local dev
origins.extend([
    "https://neurostack-web.vercel.app"
])

# Production frontend (Render)
PRODUCTION_FRONTEND = "https://neurostack-web.vercel.app"
if PRODUCTION_FRONTEND not in origins:
    origins.append(PRODUCTION_FRONTEND)

print("✅ CORS ALLOWED ORIGINS:", origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------- STARTUP --------------------

@app.on_event("startup")
async def on_startup():
    await init_db()

# -------------------- ROUTERS --------------------

app.include_router(auth_router)
app.include_router(openai_router)
app.include_router(dashboard_router)
app.include_router(billing_router)

# -------------------- HEALTH --------------------

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
        "auth": "Required - Bearer neurostack_XXXXXXXXXXXXX"
    }

@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
