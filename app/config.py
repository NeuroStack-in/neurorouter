from pydantic_settings import BaseSettings
from pydantic import Field
from typing import List


class Settings(BaseSettings):
    # Groq API key (required to talk to Groq Cloud)
    groq_api_key: str = Field(..., env="GROQ_API_KEY")

    # Groq's OpenAI-compatible base URL
    groq_base_url: str = Field(
        "https://api.groq.com/openai/v1", env="GROQ_BASE_URL"
    )

    # Valid API keys for your clients (comma-separated)
    valid_api_keys: str = Field(..., env="VALID_API_KEYS")

    # Default model (Llama Maverick)
    default_model: str = Field("llama-3.3-70b-versatile", env="DEFAULT_MODEL")

    # CORS
    cors_allow_origins: str = Field("*", env="CORS_ALLOW_ORIGINS")

    class Config:
        env_file = ".env"
        case_sensitive = False

    def get_valid_keys(self) -> List[str]:
        """Parse valid API keys from comma-separated string"""
        return [key.strip() for key in self.valid_api_keys.split(",") if key.strip()]


settings = Settings()
