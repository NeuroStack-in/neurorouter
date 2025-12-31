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
    await init_db()

# CORS
origins_raw = [o.strip() for o in settings.cors_allow_origins.split(",") if o.strip()]
origins = []
# Filter out wildcard '*' if it exists, as it cannot be used with allow_credentials=True
for origin in origins_raw:
    if origin != "*":
        origins.append(origin)

# Add frontend origins explicitly
if "http://localhost:3000" not in origins:
    origins.append("http://localhost:3000")
if "http://127.0.0.1:3000" not in origins:
    origins.append("http://127.0.0.1:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://router-neurostack-in.onrender.com",
    ],
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
