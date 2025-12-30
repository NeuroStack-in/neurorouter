from datetime import datetime
from typing import Optional
import uuid

from beanie import Document, Indexed
from pydantic import Field

def generate_uuid() -> str:
    return str(uuid.uuid4())

class User(Document):
    # Using string UUIDs for IDs to maintain compatibility if helpful, 
    # but Beanie default is ObjectId. Let's strictly define fields.
    # Actually, Beanie models have an 'id' field automatically. 
    # To keep strict compatibility with previous string IDs, we could use a custom id,
    # but let's assume standard ObjectId is fine for new setup. 
    # Users will be re-registered anyway.
    
    email: Indexed(str, unique=True)
    full_name: Optional[str] = None
    password_hash: Optional[str] = None
    google_id: Optional[Indexed(str, unique=True)] = None
    auth_provider: str = "local"
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "users"


class ApiKey(Document):
    user_id: Indexed(str)  # Storing User ID as string (ObjectId str representation)
    key_hash: Indexed(str, unique=True)
    key_prefix: Indexed(str)
    name: Optional[str] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_used_at: Optional[datetime] = None

    class Settings:
        name = "api_keys"


class MonthlyUsage(Document):
    user_id: Indexed(str)
    api_key_id: Indexed(str)
    model: str
    year_month: str
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    request_count: int = 0

    class Settings:
        name = "monthly_usage"
