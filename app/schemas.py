from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, EmailStr, Field


# -------------------------
# Users
# -------------------------

class UserCreate(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    password: str = Field(min_length=6)


class UserOut(BaseModel):
    id: str
    email: EmailStr
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# -------------------------
# Auth / JWT
# -------------------------

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


# -------------------------
# API Keys
# -------------------------

class APIKeyCreate(BaseModel):
    name: Optional[str] = None


# Used for GET /api-keys
class APIKeyListResponse(BaseModel):
    id: str
    name: Optional[str] = None
    key_prefix: str
    is_active: bool
    created_at: datetime
    last_used_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Used ONLY for POST /api-keys
class APIKeyCreateResponse(BaseModel):
    id: str
    api_key: str               # ✅ correct name
    key_prefix: str
    name: Optional[str] = None
    created_at: datetime


class GoogleAuthRequest(BaseModel):
    token: str


# -------------------------
# Dashboard
# -------------------------

class ActivityItem(BaseModel):
    id: int
    type: str
    message: str
    time: str
    icon_type: str  # "usage", "key", "billing", "system" to map to icons
    bg: str
    color: str

class DashboardOverview(BaseModel):
    user_name: Optional[str] = None
    total_tokens: int
    total_requests: int
    active_keys: int
    account_status: str
    recent_activity: List[ActivityItem]


# -------------------------
# Usage Stats
# -------------------------

class UsageChartPoint(BaseModel):
    date: str
    tokens: int

class UsageStats(BaseModel):
    total_input_tokens: int
    total_output_tokens: int
    total_requests: int
    total_web_searches: int = 0
    chart_data: List[UsageChartPoint]
