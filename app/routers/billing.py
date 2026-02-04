from datetime import datetime
from datetime import timedelta
from typing import List, Optional
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..models import (
    User, 
    BillingCycle, 
    BillingStatus, 
    AccountStatus,
    SnapshotData, 
    CalculatedCosts,
    AdminAuditLog,
    PaymentDetails,
    ApiKey
)
from ..auth import get_current_user, get_current_admin
from ..billing_utils import calculate_variable_cost, FIXED_FEE_INR, check_billing_access, generate_invoice_pdf

router = APIRouter(prefix="/billing", tags=["Billing"])

# --- Schemas ---

class CurrentUsageResponse(BaseModel):
    user_id: str
    year_month: str
    input_tokens: int
    output_tokens: int
    estimated_variable_usd: float
    fixed_fee_inr: float
    total_display: str

class SnapshotDataResponse(BaseModel):
    total_input_tokens: int
    total_output_tokens: int
    rate_input_usd_per_1m: float
    rate_output_usd_per_1m: float
    fixed_fee_inr: float

class CalculatedCostsResponse(BaseModel):
    variable_cost_usd: float
    fixed_cost_inr: float
    total_due_display: str

class BillingCycleResponse(BaseModel):
    id: str
    invoice_number: str
    year_month: str
    status: BillingStatus
    due_date: datetime
    grace_period_end: datetime
    snapshot_data: SnapshotDataResponse
    calculated_costs: CalculatedCostsResponse
    created_at: datetime



class InvoiceUpdateModel(BaseModel):
    status: Optional[BillingStatus] = None
    due_date: Optional[datetime] = None
    grace_period_end: Optional[datetime] = None

@router.put("/admin/invoices/{invoice_id}")
async def update_invoice(
    invoice_id: str, 
    update_data: InvoiceUpdateModel,
    admin: User = Depends(get_current_admin)
):
    """
    Admin: Edit invoice details (Status, Due Date, Grace Period).
    """
    invoice = await BillingCycle.get(invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
        
    changes = {}
    
    if update_data.status:
        changes["status"] = {"old": invoice.status, "new": update_data.status}
        invoice.status = update_data.status
        
        # If marking PAID manually, add fake payment details if missing
        if update_data.status == BillingStatus.PAID and not invoice.payment_details.paid_at:
             invoice.payment_details = PaymentDetails(
                paid_at=datetime.utcnow(),
                marked_by_user_id=str(admin.id),
                payment_reference="MANUAL_ADMIN_UPDATE"
            )
        # If UN-marking PAID, clear details?
        if update_data.status != BillingStatus.PAID:
            invoice.payment_details = PaymentDetails() # Reset
            
    if update_data.due_date:
        changes["due_date"] = {"old": invoice.due_date, "new": update_data.due_date}
        invoice.due_date = update_data.due_date
        
    if update_data.grace_period_end:
        changes["grace_period_end"] = {"old": invoice.grace_period_end, "new": update_data.grace_period_end}
        invoice.grace_period_end = update_data.grace_period_end
        
    await invoice.save()
    
    # Audit Log
    if changes:
        await AdminAuditLog(
            admin_user_id=str(admin.id),
            target_user_id=invoice.user_id,
            action="UPDATE_INVOICE",
            resource_collection="billing_cycles",
            resource_id=str(invoice.id),
            new_value=str(changes) # Simple string dump for generic updates
        ).insert()
    
    return {"status": "success", "changes": changes}

class BillingDashboardResponse(BaseModel):
    current_month: CurrentUsageResponse
    past_invoices: List[BillingCycleResponse]
    account_status: AccountStatus

class AdminUserBillingSummary(BaseModel):
    user_id: str
    email: str
    full_name: Optional[str]
    account_status: AccountStatus
    current_month_usage: Optional[CurrentUsageResponse]
    last_invoice_status: Optional[BillingStatus]

# --- User Endpoints ---
from ..billing_utils import check_billing_access

@router.get("/me", response_model=BillingDashboardResponse)
async def get_my_billing(user: User = Depends(get_current_user)):
    """
    Get current user's billing dashboard data.
    """
    await check_billing_access(user)
    current_month = datetime.utcnow().strftime("%Y-%m")
    
    # Fetch live usage
    # Fetch live usage (which is now the PENDING BillingCycle)
    current_cycle = await BillingCycle.find_one(
        BillingCycle.user_id == str(user.id),
        BillingCycle.year_month == current_month
    )
    
    input_tk = current_cycle.snapshot_data.total_input_tokens if current_cycle else 0
    output_tk = current_cycle.snapshot_data.total_output_tokens if current_cycle else 0
    variable_cost = calculate_variable_cost(input_tk, output_tk)
    
    current_resp = CurrentUsageResponse(
        user_id=str(user.id),
        year_month=current_month,
        input_tokens=input_tk,
        output_tokens=output_tk,
        estimated_variable_usd=float(variable_cost),
        fixed_fee_inr=float(FIXED_FEE_INR),
        total_display=f"₹{FIXED_FEE_INR} + ${variable_cost:.2f}"
    )
    
    # Fetch past invoices
    invoices_db = await BillingCycle.find(
        BillingCycle.user_id == str(user.id)
    ).sort(-BillingCycle.created_at).to_list()

    invoices_resp = []
    for inv in invoices_db:
        # Map nested objects manually to ensure clean Pydantic models
        snap = SnapshotDataResponse(
            total_input_tokens=inv.snapshot_data.total_input_tokens,
            total_output_tokens=inv.snapshot_data.total_output_tokens,
            rate_input_usd_per_1m=inv.snapshot_data.rate_input_usd_per_1m,
            rate_output_usd_per_1m=inv.snapshot_data.rate_output_usd_per_1m,
            fixed_fee_inr=inv.snapshot_data.fixed_fee_inr
        )
        
        costs = CalculatedCostsResponse(
            variable_cost_usd=inv.calculated_costs.variable_cost_usd,
            fixed_cost_inr=inv.calculated_costs.fixed_cost_inr,
            total_due_display=inv.calculated_costs.total_due_display
        )
        
        invoices_resp.append(BillingCycleResponse(
            id=str(inv.id),
            invoice_number=inv.invoice_number,
            year_month=inv.year_month,
            status=inv.status,
            due_date=inv.due_date,
            grace_period_end=inv.grace_period_end,
            snapshot_data=snap,
            calculated_costs=costs,
            created_at=inv.created_at
        ))
    
    return BillingDashboardResponse(
        current_month=current_resp,
        past_invoices=invoices_resp,
        account_status=user.account_status
    )

# --- Admin Endpoints ---

@router.get("/admin/users", response_model=List[AdminUserBillingSummary])
async def list_users_billing(admin: User = Depends(get_current_admin)):
    """
    Admin: List all users with billing status.
    """
    users = await User.find_all().to_list()
    summary_list = []
    current_month = datetime.utcnow().strftime("%Y-%m")
    
    for u in users:
        # Get Usage (from PENDING BillingCycle)
        usage_cycle = await BillingCycle.find_one(
            BillingCycle.user_id == str(u.id),
            BillingCycle.year_month == current_month
        )
        
        input_tk = usage_cycle.snapshot_data.total_input_tokens if usage_cycle else 0
        output_tk = usage_cycle.snapshot_data.total_output_tokens if usage_cycle else 0
        variable_cost = calculate_variable_cost(input_tk, output_tk)
        
        curr_resp = CurrentUsageResponse(
            user_id=str(u.id),
            year_month=current_month,
            input_tokens=input_tk,
            output_tokens=output_tk,
            estimated_variable_usd=float(variable_cost),
            fixed_fee_inr=float(FIXED_FEE_INR),
            total_display=f"₹{FIXED_FEE_INR} + ${variable_cost:.2f}"
        )
        
        # Get Last Invoice
        last_inv = await BillingCycle.find(
            BillingCycle.user_id == str(u.id)
        ).sort(-BillingCycle.created_at).first_or_none()
        
        summary_list.append(AdminUserBillingSummary(
            user_id=str(u.id),
            email=u.email,
            full_name=u.full_name,
            account_status=u.account_status,
            current_month_usage=curr_resp,
            last_invoice_status=last_inv.status if last_inv else None
        ))
        
    return summary_list

@router.post("/admin/users/{user_id}/invoice")
async def generate_invoice_manually(
    user_id: str, 
    year_month: str, # passed in body or query? using query for simplicity or we can check body
    admin: User = Depends(get_current_admin)
):
    """
    Admin: Generate an immutable invoice for a specific month.
    SNAPSHOTS usage data and rates.
    """
    target_user = await User.get(user_id)
    if not target_user:
        raise HTTPException(404, "User not found")
        
    # Check if invoice already exists
    existing = await BillingCycle.find_one(
        BillingCycle.user_id == user_id,
        BillingCycle.year_month == year_month
    )
    if existing:
        # If it's PENDING, maybe we are "finalizing" it?
        # But this endpoint says "generate_invoice".
        if existing.status == BillingStatus.PENDING:
             # Just return the existing one, maybe recalculate?
             return existing
        raise HTTPException(400, "Invoice already finalized for this month")
        
    # If no usage record/cycle exists, create one with 0 usage
    input_tk = 0
    output_tk = 0
    
    variable_usd = calculate_variable_cost(input_tk, output_tk)
    
    snapshot = SnapshotData(
        total_input_tokens=input_tk,
        total_output_tokens=output_tk,
    )
    
    costs = CalculatedCosts(
        variable_cost_usd=float(variable_usd),
        fixed_cost_inr=float(FIXED_FEE_INR),
        total_due_display=f"₹{FIXED_FEE_INR} + ${variable_usd:.2f}"
    )
    
    # Create Invoice
    invoice = BillingCycle(
        user_id=user_id,
        invoice_number=f"INV-{year_month}-{user_id[:8].upper()}",
        year_month=year_month,
        start_date=datetime.utcnow(), # Placeholder, ideally strictly calculation start
        end_date=datetime.utcnow(),   # Placeholder
        status=BillingStatus.PENDING,
        due_date=datetime.utcnow() + timedelta(days=7),
grace_period_end=datetime.utcnow() + timedelta(days=10),
        snapshot_data=snapshot,
        calculated_costs=costs
    )
    await invoice.insert()
    
    # Audit Log
    await AdminAuditLog(
        admin_user_id=str(admin.id),
        target_user_id=user_id,
        action="GENERATE_INVOICE",
        resource_collection="billing_cycles",
        resource_id=str(invoice.id),
        new_value={"invoice_number": invoice.invoice_number, "total": costs.total_due_display}
    ).insert()
    
    return invoice

@router.post("/admin/invoices/{invoice_id}/pay")
async def mark_invoice_paid(invoice_id: str, admin: User = Depends(get_current_admin)):
    """
    Admin: Mark an invoice as PAID.
    """
    invoice = await BillingCycle.get(invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
        
    previous_status = invoice.status
    invoice.status = BillingStatus.PAID
    invoice.payment_details = PaymentDetails(
        paid_at=datetime.utcnow(),
        marked_by_user_id=str(admin.id),
        payment_reference="MANUAL_ADMIN_MARK"
    )
    await invoice.save()
    
    # Restore Access Logic
    # 1. Update User Status -> ACTIVE (if blocked/grace)
    user = await User.get(invoice.user_id)
    if user:
        user.account_status = AccountStatus.ACTIVE
        await user.save()

    # 2. Re-enable API Keys
    # Find all keys for this user and set is_active = True
    # (Assuming we want to re-enable everything. If some were manually disabled for security, this might be aggressive, 
    # but per requirements: "System must immediately restore access")
    keys = await ApiKey.find(ApiKey.user_id == invoice.user_id).to_list()
    for key in keys:
        if not key.is_active:
             key.is_active = True
             await key.save()

    # Audit Log
    await AdminAuditLog(
        admin_user_id=str(admin.id),
        target_user_id=invoice.user_id,
        action="MARK_INVOICE_PAID",
        resource_collection="billing_cycles",
        resource_id=str(invoice.id),
        previous_value=previous_status,
        new_value=BillingStatus.PAID,
        reason="Manual Payment - Access Restored"
    ).insert()
    
    return {
        "status": "success", 
        "invoice_status": "PAID",
        "account_status": "ACTIVE",
        "keys_restored": len(keys)
    }

class UserStatusUpdate(BaseModel):
    status: AccountStatus
    reason: str

@router.post("/admin/users/{user_id}/status")
async def change_user_status(
    user_id: str, 
    update_data: UserStatusUpdate,
    admin: User = Depends(get_current_admin)
):
    """
    Admin: Force change user account status (e.g. BLOCK, ACTIVATE).
    """
    target_user = await User.get(user_id)
    if not target_user:
        raise HTTPException(404, "User not found")
        
    old_status = target_user.account_status
    target_user.account_status = update_data.status
    await target_user.save()
    
    # Audit Log
    await AdminAuditLog(
        admin_user_id=str(admin.id),
        target_user_id=user_id,
        action="CHANGE_ACCOUNT_STATUS",
        resource_collection="users",
        resource_id=user_id,
        previous_value=old_status,
        new_value=update_data.status,
        reason=update_data.reason
    ).insert()
    
    return {"status": "success", "new_status": update_data.status}

class UserApproval(BaseModel):
    groq_api_key: str

@router.post("/admin/users/{user_id}/approve")
async def approve_user(
    user_id: str,
    approval_data: UserApproval,
    admin: User = Depends(get_current_admin)
):
    """
    Admin: Approve a pending user and assign their specific Groq Cloud API Key.
    Validates key before saving.
    """
    import httpx
    
    target_user = await User.get(user_id)
    if not target_user:
        raise HTTPException(404, "User not found")
        
    # Validate Key
    # We'll make a lightweight call to Groq Models endpoint
    # Using the key provided.
    
    try:
        async with httpx.AsyncClient() as client:
           res = await client.get(
               "https://api.groq.com/openai/v1/models",
               headers={"Authorization": f"Bearer {approval_data.groq_api_key}"}
           )
           if res.status_code != 200:
               raise HTTPException(400, "Invalid Groq API Key. Validation failed.")
    except httpx.RequestError:
        raise HTTPException(502, "Failed to connect to Groq for validation")
        
    # Validation Success
    target_user.groq_cloud_api_key = approval_data.groq_api_key
    target_user.account_status = AccountStatus.ACTIVE
    await target_user.save()
    
    # Audit Log
    await AdminAuditLog(
        admin_user_id=str(admin.id),
        target_user_id=user_id,
        action="APPROVE_USER",
        resource_collection="users",
        resource_id=user_id,
        previous_value="PENDING_APPROVAL",
        new_value="ACTIVE",
        reason="Admin Approval with Validated Key"
    ).insert()
    
    return {"status": "success", "user_status": "ACTIVE", "message": "User approved and key assigned."}

@router.get("/admin/users/{user_id}/billing", response_model=BillingDashboardResponse)
async def get_user_billing_admin(
    user_id: str,
    admin: User = Depends(get_current_admin)
):
    """
    Admin: Get ANY user's full billing dashboard data.
    """
    target_user = await User.get(user_id)
    if not target_user:
        raise HTTPException(404, "User not found")

    current_month = datetime.utcnow().strftime("%Y-%m")
    
    # Fetch live usage (which is now the PENDING BillingCycle)
    current_cycle = await BillingCycle.find_one(
        BillingCycle.user_id == str(target_user.id),
        BillingCycle.year_month == current_month
    )
    
    input_tk = current_cycle.snapshot_data.total_input_tokens if current_cycle else 0
    output_tk = current_cycle.snapshot_data.total_output_tokens if current_cycle else 0
    variable_cost = calculate_variable_cost(input_tk, output_tk)
    
    current_resp = CurrentUsageResponse(
        user_id=str(target_user.id),
        year_month=current_month,
        input_tokens=input_tk,
        output_tokens=output_tk,
        estimated_variable_usd=float(variable_cost),
        fixed_fee_inr=float(FIXED_FEE_INR),
        total_display=f"₹{FIXED_FEE_INR} + ${variable_cost:.2f}"
    )
    
    # Fetch past invoices
    invoices_db = await BillingCycle.find(
        BillingCycle.user_id == str(target_user.id)
    ).sort(-BillingCycle.created_at).to_list()

    invoices_resp = []
    for inv in invoices_db:
        snap = SnapshotDataResponse(
            total_input_tokens=inv.snapshot_data.total_input_tokens,
            total_output_tokens=inv.snapshot_data.total_output_tokens,
            rate_input_usd_per_1m=inv.snapshot_data.rate_input_usd_per_1m,
            rate_output_usd_per_1m=inv.snapshot_data.rate_output_usd_per_1m,
            fixed_fee_inr=inv.snapshot_data.fixed_fee_inr
        )
        
        costs = CalculatedCostsResponse(
            variable_cost_usd=inv.calculated_costs.variable_cost_usd,
            fixed_cost_inr=inv.calculated_costs.fixed_cost_inr,
            total_due_display=inv.calculated_costs.total_due_display
        )
        
        invoices_resp.append(BillingCycleResponse(
            id=str(inv.id),
            invoice_number=inv.invoice_number,
            year_month=inv.year_month,
            status=inv.status,
            due_date=inv.due_date,
            grace_period_end=inv.grace_period_end,
            snapshot_data=snap,
            calculated_costs=costs,
            created_at=inv.created_at
        ))
    
    return BillingDashboardResponse(
        current_month=current_resp,
        past_invoices=invoices_resp,
        account_status=target_user.account_status
    )

@router.get("/admin/invoices/{invoice_id}/pdf")
async def download_invoice_pdf(
    invoice_id: str,
    admin: User = Depends(get_current_admin)
):
    """
    Admin: Generate and download PDF for an invoice.
    """
    invoice = await BillingCycle.get(invoice_id)
    if not invoice:
        raise HTTPException(404, "Invoice not found")
        
    user = await User.get(invoice.user_id)
    if not user:
         # Should not happen usually, but handle it
         raise HTTPException(404, "User associated with invoice not found")
         
    pdf_buffer = generate_invoice_pdf(invoice, user)
    
    filename = f"{invoice.invoice_number}.pdf"
    
    return StreamingResponse(
        pdf_buffer, 
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
