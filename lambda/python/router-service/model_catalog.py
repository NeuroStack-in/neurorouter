"""
Model Catalog
=============
Structured list of all AI models supported by NeuroRouter.

This is consumed by the /v1/models endpoint (Day 5 handler).
Currently hardcoded — can be migrated to DynamoDB's plan_catalog
table later if dynamic model management is needed.

EACH MODEL ENTRY HAS:
- id:           The model identifier clients use in requests (e.g., "llama-3.3-70b-versatile")
- display_name: Human-readable name shown in docs/UI
- provider:     Which AI provider hosts this model ("groq", "openai", etc.)
- tags:         Categories for filtering (e.g., ["chat", "fast", "large"])

HOW THIS CONNECTS TO THE ADAPTER PATTERN:
- Client requests model "llama-3.3-70b-versatile"
- Lambda handler looks up the model in this catalog → provider = "groq"
- Lambda handler picks the GroqAdapter → sends request to Groq Cloud
- In the future: client requests "gpt-4" → provider = "openai" → OpenAIAdapter
"""

from typing import Any, Dict, List


# ──────────────────────────────────────────────────────────────────
# Model definitions
# ──────────────────────────────────────────────────────────────────

MODELS: List[Dict[str, Any]] = [
    {
        "id": "llama-3.3-70b-versatile",
        "display_name": "LLaMA 3.3 70B Versatile (Maverick)",
        "provider": "groq",
        "tags": ["chat", "large", "versatile", "default"],
    },
    {
        "id": "llama-3.1-8b-instant",
        "display_name": "LLaMA 3.1 8B Instant",
        "provider": "groq",
        "tags": ["chat", "small", "fast"],
    },
    {
        "id": "llama-3.1-70b-versatile",
        "display_name": "LLaMA 3.1 70B Versatile",
        "provider": "groq",
        "tags": ["chat", "large", "versatile"],
    },
    {
        "id": "mixtral-8x7b-32768",
        "display_name": "Mixtral 8x7B",
        "provider": "groq",
        "tags": ["chat", "large", "moe"],
    },
    {
        "id": "gemma2-9b-it",
        "display_name": "Gemma 2 9B IT",
        "provider": "groq",
        "tags": ["chat", "small", "instruction-tuned"],
    },
]

# ──────────────────────────────────────────────────────────────────
# Helper functions
# ──────────────────────────────────────────────────────────────────


def get_all_models() -> List[Dict[str, Any]]:
    """Return the full model catalog."""
    return MODELS


def get_model_by_id(model_id: str) -> Dict[str, Any] | None:
    """
    Look up a model by its ID.

    Args:
        model_id: e.g., "llama-3.3-70b-versatile"

    Returns:
        The model dict, or None if not found.
    """
    for model in MODELS:
        if model["id"] == model_id:
            return model
    return None


def get_models_by_provider(provider: str) -> List[Dict[str, Any]]:
    """
    Get all models for a specific provider.

    Args:
        provider: e.g., "groq" or "openai"

    Returns:
        List of model dicts for that provider.
    """
    return [m for m in MODELS if m["provider"] == provider]


def get_provider_for_model(model_id: str) -> str | None:
    """
    Given a model ID, return which provider serves it.

    This is the key function for routing:
        model_id = "llama-3.3-70b-versatile" → returns "groq"
        model_id = "gpt-4" → returns "openai" (future)
        model_id = "unknown" → returns None

    The Lambda handler uses this to select the correct adapter.
    """
    model = get_model_by_id(model_id)
    return model["provider"] if model else None


def to_openai_format() -> Dict[str, Any]:
    """
    Convert the catalog to OpenAI's /v1/models response format.

    This is what gets returned when a client calls GET /v1/models.
    OpenAI format:
    {
        "object": "list",
        "data": [
            {"id": "llama-3.3-70b-versatile", "object": "model", "owned_by": "groq", ...},
            ...
        ]
    }
    """
    return {
        "object": "list",
        "data": [
            {
                "id": model["id"],
                "object": "model",
                "created": 1700000000,  # Placeholder timestamp
                "owned_by": model["provider"],
            }
            for model in MODELS
        ],
    }
