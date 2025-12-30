from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    # Groq API key (required to talk to Groq Cloud)
    groq_api_key: str = Field(..., env="GROQ_API_KEY")

    # Groq's OpenAI-compatible base URL
    groq_base_url: str = Field(
        "https://api.groq.com/openai/v1", env="GROQ_BASE_URL"
    )

    # Default model (Llama Maverick)
    default_model: str = Field("llama-3.3-70b-versatile", env="DEFAULT_MODEL")

    # Database URL
    mongodb_url: str = Field("mongodb://localhost:27017", env="MONGODB_URL")
    database_name: str = Field("neuro_router", env="DATABASE_NAME")

    # JWT auth
    jwt_secret_key: str = Field(..., env="JWT_SECRET_KEY")
    jwt_algorithm: str = Field("HS256", env="JWT_ALGORITHM")
    jwt_expire_minutes: int = Field(60 * 24, env="JWT_EXPIRE_MINUTES")

    # Monthly token limit (0 disables limit)
    monthly_token_limit: int = Field(0, env="MONTHLY_TOKEN_LIMIT")

    # Google OAuth
    google_client_id: str = Field(None, env="GOOGLE_CLIENT_ID")

    # CORS
    cors_allow_origins: str = Field("*", env="CORS_ALLOW_ORIGINS")

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


settings = Settings()
