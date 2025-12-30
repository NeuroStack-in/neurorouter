from fastapi import APIRouter, Depends, HTTPException, status
# Removed sqlalchemy Session

from .. import schemas
from ..auth import (
    authenticate_user,
    create_access_token,
    generate_api_key,
    get_current_user,
    hash_password,
)
# Removed get_db dependency
from ..models import ApiKey, User
from ..google_auth import verify_google_token

router = APIRouter(tags=["Auth"])


# -------------------------
# Auth
# -------------------------

@router.post("/auth/register", response_model=schemas.UserOut)
async def register_user(payload: schemas.UserCreate):
    # Beanie find
    existing = await User.find_one(User.email == payload.email.lower())
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is already registered",
        )

    user = User(
        email=payload.email.lower(),
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
    )
    await user.insert()
    return schemas.UserOut(
        id=str(user.id),
        email=user.email,
        is_active=user.is_active,
        created_at=user.created_at
    )


@router.post("/auth/login", response_model=schemas.TokenResponse)
async def login(payload: schemas.UserCreate):
    user = await authenticate_user(payload.email, payload.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    token = create_access_token(subject=str(user.id))

    return schemas.TokenResponse(
        access_token=token,
        expires_in=60 * 60,  # 1 hour
    )


@router.post("/auth/google", response_model=schemas.TokenResponse)
async def login_google(payload: schemas.GoogleAuthRequest):
    try:
        email, sub = verify_google_token(payload.token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google token",
        )

    user = await User.find_one(User.email == email)
    if user:
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User inactive",
            )
        # Update user
        if not user.google_id:
            user.google_id = sub
        if not user.auth_provider:
            user.auth_provider = "google"
        await user.save()
    else:
        user = User(
            email=email,
            google_id=sub,
            auth_provider="google",
            password_hash=None,
        )
        await user.insert()

    token = create_access_token(subject=str(user.id))
    return schemas.TokenResponse(
        access_token=token,
        expires_in=60 * 60,
    )


@router.post("/auth/logout")
async def logout():
    return {"message": "Logged out successfully"}



# -------------------------
# API Keys
# -------------------------

@router.post(
    "/api-keys",
    response_model=schemas.APIKeyCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_api_key(
    payload: schemas.APIKeyCreate,
    current_user: User = Depends(get_current_user),
):
    raw_key, key_prefix, key_hash = generate_api_key()

    api_key = ApiKey(
        user_id=str(current_user.id),
        key_hash=key_hash,
        key_prefix=key_prefix,
        name=payload.name,
    )
    await api_key.insert()

    # ⚠️ raw key returned ONLY ONCE
    return schemas.APIKeyCreateResponse(
        id=str(api_key.id), # Cast to string just in case, though Pydantic should handle
        api_key=raw_key,
        key_prefix=api_key.key_prefix,
        name=api_key.name,
        created_at=api_key.created_at,
    )


@router.get(
    "/api-keys",
    response_model=list[schemas.APIKeyListResponse],
)
async def list_api_keys(
    current_user: User = Depends(get_current_user),
):
    api_keys = await ApiKey.find(
        ApiKey.user_id == str(current_user.id)
    ).sort("-created_at").to_list()
    
    # Manual serialization to handle ObjectId -> str
    return [
        schemas.APIKeyListResponse(
            id=str(k.id),
            name=k.name,
            key_prefix=k.key_prefix,
            is_active=k.is_active,
            created_at=k.created_at,
            last_used_at=k.last_used_at
        ) for k in api_keys
    ]


@router.delete("/api-keys/{api_key_id}")
async def revoke_api_key(
    api_key_id: str,
    current_user: User = Depends(get_current_user),
):
    # Beanie can't easily query by ID AND another field in one find_one call efficiently without index, 
    # but regular find works fine.
    
    # We can use find_one with multiple criteria
    from bson import ObjectId
    try:
        oid = ObjectId(api_key_id)
        api_key = await ApiKey.find_one(
            ApiKey.id == oid,
            ApiKey.user_id == str(current_user.id)
        )
    except Exception:
        api_key = None

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found",
        )

    api_key.is_active = False
    await api_key.save()

    return {"detail": "API key revoked successfully"}
