import re
from typing import Optional
from fastapi import HTTPException, Header

from .config import settings


def validate_api_key_format(api_key: str) -> bool:
    """
    Validate API key format: neurostack_ followed by exactly 13 alphanumeric characters
    Example: neurostack_a1b2c3d4e5f6g
    """
    pattern = r'^neurostack_[a-zA-Z0-9]{13}$'
    return bool(re.match(pattern, api_key))


def verify_api_key(authorization: Optional[str] = Header(default=None)) -> str:
    """
    Verify the API key from Authorization header.
    Expects: Authorization: Bearer neurostack_XXXXXXXXXXXXX
    """
    if not authorization:
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization header"
        )

    parts = authorization.split(" ", 1)
    if len(parts) != 2:
        raise HTTPException(
            status_code=401,
            detail="Invalid Authorization header format. Use: Bearer neurostack_XXXXXXXXXXXXX"
        )

    scheme, token = parts[0], parts[1]
    if scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication scheme. Use Bearer"
        )

    # Validate format
    if not validate_api_key_format(token):
        raise HTTPException(
            status_code=401,
            detail="Invalid API key format. Expected: neurostack_ followed by 13 alphanumeric characters"
        )

    # Check if key is in valid keys list
    valid_keys = settings.get_valid_keys()
    if token not in valid_keys:
        raise HTTPException(
            status_code=401,
            detail="Invalid API key"
        )

    return token
