"""
OpenAI Provider Adapter — STUB
================================
Placeholder for future OpenAI direct integration.

THIS DOES NOT WORK YET. All methods raise NotImplementedError.
It exists to show the extensibility point — when we want to add
OpenAI as a provider, we implement these methods and the Lambda
handler works with zero changes.

FUTURE IMPLEMENTATION WOULD:
- Use OpenAI's API at https://api.openai.com/v1
- Support models like gpt-4, gpt-4o, gpt-3.5-turbo
- Handle OpenAI-specific rate limits and error formats
"""

from typing import Any, Dict, Optional

from provider_adapter import ProviderAdapter


class OpenAIAdapter(ProviderAdapter):
    """
    Stub adapter for OpenAI's API.
    Not yet implemented — raises NotImplementedError for all methods.
    """

    def __init__(self, api_key: str):
        self._api_key = api_key

    async def chat_completions(
        self,
        payload: Dict[str, Any],
        stream: bool = False,
    ) -> Any:
        raise NotImplementedError(
            "OpenAI adapter is not yet implemented. "
            "Currently only Groq is supported."
        )

    async def list_models(self) -> Dict[str, Any]:
        raise NotImplementedError(
            "OpenAI adapter is not yet implemented."
        )

    def extract_usage(self, response: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        raise NotImplementedError(
            "OpenAI adapter is not yet implemented."
        )
