from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers.openai_proxy import router as openai_router

app = FastAPI(
    title="NeuroStack OpenAI-Compatible Proxy",
    description="OpenAI-compatible API that routes to Groq's Llama Maverick model",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_allow_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(openai_router)


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
