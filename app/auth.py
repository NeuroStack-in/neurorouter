import hashlib
import re
import secrets
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from .config import settings
from .models import ApiKey, User

# -------------------------------------------------------------------
# Password hashing
# -------------------------------------------------------------------

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _prehash_password(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    return pwd_context.hash(_prehash_password(password))


def verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(_prehash_password(password), hashed)


# -------------------------------------------------------------------
# JWT auth
# -------------------------------------------------------------------

jwt_bearer = HTTPBearer(auto_error=False)


def create_access_token(subject: str, expires_minutes: Optional[int] = None) -> str:
    # subject should be str (ObjectId)
    expire_minutes = expires_minutes or settings.jwt_expire_minutes
    expire = datetime.utcnow() + timedelta(minutes=expire_minutes)
    payload = {"sub": str(subject), "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(jwt_bearer),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    token = credentials.credentials
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    # Beanie find by ID
    # user_id is string from JWT, Beanie expects PydanticObjectId usually but can parse str
    from bson import ObjectId
    try:
        oid = ObjectId(user_id)
        user = await User.get(oid)
    except Exception:
        user = None

    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    return user


async def authenticate_user(email: str, password: str) -> Optional[User]:
    # Beanie find
    user = await User.find_one(User.email == email.lower())
    if not user or not user.is_active:
        return None
    if not user.password_hash: # Social login user might not have hash
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


# -------------------------------------------------------------------
# API key handling
# -------------------------------------------------------------------

API_KEY_PATTERN = r"^neurostack_[a-zA-Z0-9]{13}$"


class AuthenticatedAPIKey:
    def __init__(self, token: str, api_key: ApiKey, user: User):
        self.token = token
        self.api_key = api_key
        self.user = user


def validate_api_key_format(api_key: str) -> bool:
    return bool(re.match(API_KEY_PATTERN, api_key))


def hash_api_key(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def generate_api_key():
    suffix = "".join(
        secrets.choice("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        for _ in range(13)
    )
    raw_key = f"neurostack_{suffix}"
    key_hash = hash_api_key(raw_key)
    key_prefix = raw_key[:15]
    return raw_key, key_prefix, key_hash


async def verify_api_key(
    authorization: Optional[str] = Header(default=None),
) -> AuthenticatedAPIKey:
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    parts = authorization.split(" ", 1)
    if len(parts) != 2:
        raise HTTPException(
            status_code=401,
            detail="Invalid Authorization header format. Use: Bearer neurostack_XXXXXXXXXXXXX",
        )

    scheme, token = parts
    if scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authentication scheme. Use Bearer")

    if not validate_api_key_format(token):
        raise HTTPException(
            status_code=401,
            detail="Invalid API key format. Expected: neurostack_ followed by 13 alphanumeric characters",
        )

    token_hash = hash_api_key(token)

    # Beanie Query
    api_key = await ApiKey.find_one(
        ApiKey.key_hash == token_hash,
        ApiKey.is_active == True
    )

    if not api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")

    # Get User
    from bson import ObjectId
    user = await User.get(ObjectId(api_key.user_id))
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid API key owner")

    # Update last used timestamp
    api_key.last_used_at = datetime.utcnow()
    await api_key.save()

    return AuthenticatedAPIKey(token=token, api_key=api_key, user=user)
