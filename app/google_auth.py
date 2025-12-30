from typing import Tuple

from google.auth.transport import requests
from google.oauth2 import id_token

from .config import settings


def verify_google_token(token: str) -> Tuple[str, str]:
    """
    Verify Google ID token and return (email, sub).
    Raises ValueError if invalid.
    """
    if not settings.google_client_id:
        raise ValueError("GOOGLE_CLIENT_ID not configured")

    info = id_token.verify_oauth2_token(token, requests.Request(), settings.google_client_id)
    email = info.get("email")
    sub = info.get("sub")
    if not email or not sub:
        raise ValueError("Invalid Google token: missing email or sub")
    return email.lower(), sub
