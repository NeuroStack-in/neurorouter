from datetime import datetime
from typing import Optional, List, Any
from enum import Enum
from decimal import Decimal

from beanie import Document, Indexed
from pydantic import Field, BaseModel

class AccountStatus(str, Enum):
    ACTIVE = "ACTIVE"
    GRACE = "GRACE"
    BLOCKED = "BLOCKED"
    PENDING_APPROVAL = "PENDING_APPROVAL"

class BillingStatus(str, Enum):
    PENDING = "PENDING"
    PAID = "PAID"
    OVERDUE = "OVERDUE"
    VOID = "VOID"

class BillingConfig(BaseModel):
    currency: str = "INR"
    tax_id: Optional[str] = None

class User(Document):
    email: Indexed(str, unique=True)
    full_name: Optional[str] = None
    password_hash: Optional[str] = None
    google_id: Optional[Indexed(str, unique=True)] = None
    auth_provider: str = "local"
    is_active: bool = True
    
    # Billing & Access Control
    account_status: AccountStatus = AccountStatus.PENDING_APPROVAL
    billing_config: BillingConfig = Field(default_factory=BillingConfig)
    
    # Internal Groq Key (Hidden from User)
    groq_cloud_api_key: Optional[str] = None
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "users"

class ApiKey(Document):
    user_id: Indexed(str)
    key_hash: Indexed(str, unique=True)
    key_prefix: Indexed(str)
    name: Optional[str] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_used_at: Optional[datetime] = None

    class Settings:
        name = "api_keys"



class SnapshotData(BaseModel):
    total_input_tokens: int
    total_output_tokens: int
    rate_input_usd_per_1m: float = 2.00
    rate_output_usd_per_1m: float = 8.00
    fixed_fee_inr: float = 1599.00

class CalculatedCosts(BaseModel):
    variable_cost_usd: float
    fixed_cost_inr: float
    total_due_display: str

class PaymentDetails(BaseModel):
    paid_at: Optional[datetime] = None
    payment_reference: Optional[str] = None
    marked_by_user_id: Optional[str] = None

class BillingCycle(Document):
    """
    Immutable Invoice Record.
    Generated at end of month.
    """
    user_id: Indexed(str)
    invoice_number: Indexed(str, unique=True)
    year_month: str
    
    start_date: datetime
    end_date: datetime
    
    status: BillingStatus = BillingStatus.PENDING
    due_date: datetime
    grace_period_end: datetime
    
    snapshot_data: SnapshotData
    calculated_costs: CalculatedCosts
    payment_details: PaymentDetails = Field(default_factory=PaymentDetails)
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "billing_cycles"
        indexes = [
            [("user_id", 1), ("year_month", -1)]
        ]

class MonthlyUsage(Document):
    user_id: Indexed(str)
    year_month: Indexed(str)
    model: Optional[str] = None
    api_key_id: Optional[str] = None
    
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    request_count: int = 0
    
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "monthly_usage"
        indexes = [
            [("user_id", 1), ("year_month", -1), ("model", 1), ("api_key_id", 1)]
        ]

class AdminAuditLog(Document):
    admin_user_id: Indexed(str)
    target_user_id: Indexed(str)
    action: str
    resource_collection: str
    resource_id: str
    previous_value: Optional[Any] = None
    new_value: Optional[Any] = None
    reason: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "admin_audit_logs"
