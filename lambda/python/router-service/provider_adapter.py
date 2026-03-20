"""
Provider Adapter Interface (Abstract Base Class)
=================================================
Every AI provider (Groq, OpenAI, Anthropic, etc.) must implement this interface.

WHY THIS EXISTS:
- The Lambda handler doesn't care WHICH AI provider it's talking to
- It just calls adapter.chat_completions() or adapter.list_models()
- To add a new provider, you create a new adapter class — zero changes to handler code
- This is the "Strategy Pattern" / "Provider Adapter Pattern"

HOW IT WORKS:
- ABC = Abstract Base Class (from Python's abc module)
- @abstractmethod = "you MUST implement this method in any subclass"
- If a subclass forgets to implement a method, Python raises TypeError at instantiation
"""

from abc import ABC, abstractmethod
from typing import Any, AsyncIterator, Dict, Optional, Tuple


class ProviderAdapter(ABC):
    """
    Abstract base class that every AI provider adapter must implement.

    Each method corresponds to an OpenAI-compatible API endpoint
    that NeuroRouter exposes to clients.
    """

    @abstractmethod
    async def chat_completions(
        self,
        payload: Dict[str, Any],
        stream: bool = False,
    ) -> Any:
        """
        Handle a chat completions request.

        Args:
            payload: The request body from the client (messages, model, temperature, etc.)
            stream: If True, return an async iterator of SSE chunks.
                    If False, return the complete JSON response as a dict.

        Returns:
            - If stream=False: Dict with the complete response
              Example: {"id": "chatcmpl-xxx", "choices": [...], "usage": {...}}

            - If stream=True: AsyncIterator[bytes] yielding SSE-formatted chunks
              Example: b'data: {"id":"chatcmpl-xxx","choices":[...]}\n\n'

        Raises:
            ProviderError: If the upstream provider returns an error
        """
        ...

    @abstractmethod
    async def list_models(self) -> Dict[str, Any]:
        """
        Return the list of available models from this provider.

        Returns:
            Dict in OpenAI format: {"object": "list", "data": [{"id": "model-name", ...}]}

        Raises:
            ProviderError: If the upstream provider returns an error
        """
        ...

    @abstractmethod
    def extract_usage(self, response: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Extract token usage information from a provider's response.

        WHY: Different providers format usage data differently.
        This method normalizes it so the Lambda handler can always record usage
        the same way regardless of provider.

        Args:
            response: The complete (non-streaming) response from the provider

        Returns:
            Dict with at least: {"prompt_tokens": int, "completion_tokens": int, "total_tokens": int}
            Returns None if no usage data is available.
        """
        ...


class ProviderError(Exception):
    """
    Raised when an AI provider returns an error.

    Attributes:
        status_code: HTTP status code from the provider (e.g., 429 for rate limit)
        detail: Error details (string or dict)
    """

    def __init__(self, status_code: int, detail: Any):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Provider error {status_code}: {detail}")
