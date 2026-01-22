from datetime import datetime
from decimal import Decimal
from typing import Tuple, Optional

from fastapi import HTTPException, status

from .models import User, BillingCycle, AccountStatus, BillingStatus

# Fixed rates
FIXED_FEE_INR = Decimal("1599.00")
RATE_INPUT_USD_PER_1M = Decimal("2.00")
RATE_OUTPUT_USD_PER_1M = Decimal("8.00")

def calculate_variable_cost(input_tokens: int, output_tokens: int) -> Decimal:
    """
    Calculate variable cost in USD based on token usage.
    Deducts 1M free tokens for both input and output before charging.
    """
    # Deduct 1M Free Tier
    chargeable_input = max(0, input_tokens - 1_000_000)
    chargeable_output = max(0, output_tokens - 1_000_000)

    input_cost = (Decimal(chargeable_input) / Decimal("1000000")) * RATE_INPUT_USD_PER_1M
    output_cost = (Decimal(chargeable_output) / Decimal("1000000")) * RATE_OUTPUT_USD_PER_1M
    return input_cost + output_cost


async def refresh_user_billing_status(user: User) -> AccountStatus:
    """
    Evaluates unpaid invoices against due dates and updates User & BillingCycle states.
    
    Rules:
    - If any invoice is OVERDUE -> User = BLOCKED
    - If any invoice is PENDING but past Grace Period -> Invoice = OVERDUE, User = BLOCKED
    - If any invoice is PENDING but past Due Date -> User = GRACE
    - If no unpaid invoices/issues -> User = ACTIVE (unless manually blocked)
    """
    if user.account_status == AccountStatus.BLOCKED and user.auth_provider == "local": 
        # Optional: Allow Manual Unblock to persist even if invoice is overdue?
        # NO. Strict enforcement.
        # But if manually blocked for other reasons, we keep it BLOCKED.
        pass

    now = datetime.utcnow()
    
    # 1. Fetch all unpaid invoices (PENDING or OVERDUE)
    unpaid_invoices = await BillingCycle.find(
        BillingCycle.user_id == str(user.id),
        BillingCycle.status != BillingStatus.PAID,
        BillingCycle.status != BillingStatus.VOID
    ).to_list()
    
    should_be_blocked = False
    should_be_grace = False
    
    for inv in unpaid_invoices:
        # Check transition PENDING -> OVERDUE
        if inv.status == BillingStatus.PENDING and now > inv.grace_period_end:
            inv.status = BillingStatus.OVERDUE
            await inv.save()
            should_be_blocked = True
            
        elif inv.status == BillingStatus.OVERDUE:
            should_be_blocked = True
            
        elif inv.status == BillingStatus.PENDING and now > inv.due_date:
            should_be_grace = True
            
    # Determine new status
    new_status = user.account_status
    
    # Priority: BLOCKED > GRACE > ACTIVE
    # However, we must respect Manual BLOCKED status if we implement a separate flag.
    # For now, we assume AccountStatus is solely driven by billing + optional admin override.
    # To support Admin Override, we might need a flag 'is_manually_blocked'.
    # For this strict billing task, we enforce billing rules.
    
    if should_be_blocked:
        new_status = AccountStatus.BLOCKED
    elif should_be_grace:
        # Only downgrade to GRACE if currently ACTIVE (don't unblock a Blocked user automatically strictly? 
        # Actually if they paid the blocking invoice, they should go to Active/Grace depending on other invoices)
        # But here we are iterating ALL unpaid. So if 'should_be_blocked' is False, then no overdue invoices exist.
        new_status = AccountStatus.GRACE
    else:
        # No issues.
        # Auto-restore to ACTIVE if was previously billed-blocked?
        # Only if we know it was billing blocked.
        # Let's assume yes: If you pay, you get access.
        if user.account_status in [AccountStatus.GRACE, AccountStatus.BLOCKED]:
           new_status = AccountStatus.ACTIVE
           
    # Apply Update
    if new_status != user.account_status:
        # If Admin manually blocked it, we might be overriding it here if we don't have a separate field.
        # We'll assume for this feature that billing is the primary driver.
        user.account_status = new_status
        await user.save()
        
    return new_status

async def check_billing_access(user: User):
    """
    Strict enforcement of billing status.
    Refreshes status first to ensure real-time enforcement.
    """
    # 1. Refresh Status based on time
    # This ensures "Logic must run on API request" rule.
    current_status = await refresh_user_billing_status(user)
    
    # 2. Blocked User -> 403 Forbidden
    if current_status == AccountStatus.BLOCKED:
        # Check WHY (fetch invoice)
        overdue = await BillingCycle.find_one(
            BillingCycle.user_id == str(user.id),
            BillingCycle.status == BillingStatus.OVERDUE
        )
        msg = "Account is blocked."
        code = status.HTTP_403_FORBIDDEN
        
        if overdue:
            msg = f"Billing suspension. Invoice {overdue.invoice_number} is overdue."
            code = status.HTTP_402_PAYMENT_REQUIRED
            
        raise HTTPException(status_code=code, detail=msg)
    
    # 3. Pending Approval Check
    if current_status == AccountStatus.PENDING_APPROVAL:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Account pending approval."
        )
    
    # 3. Grace Period Warning?
    # We allow access.
    return True

from io import BytesIO
try:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors
    from reportlab.lib.units import inch
except ImportError:
    pass # handle smoothly if not installed yet during dev

def generate_invoice_pdf(invoice: BillingCycle, user: User) -> BytesIO:
    """
    Generates a PDF invoice for the given BillingCycle and User.
    Returns a BytesIO buffer containing the PDF.
    """
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4
    
    # --- Header ---
    c.setFont("Helvetica-Bold", 24)
    c.drawString(1 * inch, height - 1 * inch, "NeuroStack Invoice")
    
    c.setFont("Helvetica", 10)
    c.drawRightString(width - 1 * inch, height - 1 * inch, f"Invoice #: {invoice.invoice_number}")
    c.drawRightString(width - 1 * inch, height - 1.2 * inch, f"Date: {invoice.created_at.strftime('%Y-%m-%d')}")
    c.drawRightString(width - 1 * inch, height - 1.4 * inch, f"Due Date: {invoice.due_date.strftime('%Y-%m-%d')}")
    
    status_color = colors.red if invoice.status == BillingStatus.OVERDUE else colors.green if invoice.status == BillingStatus.PAID else colors.orange
    c.setFillColor(status_color)
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(width - 1 * inch, height - 1.7 * inch, f"Status: {invoice.status}")
    c.setFillColor(colors.black)
    
    # --- Bill To ---
    c.setFont("Helvetica-Bold", 12)
    c.drawString(1 * inch, height - 2.5 * inch, "Bill To:")
    c.setFont("Helvetica", 12)
    c.drawString(1 * inch, height - 2.7 * inch, f"{user.full_name or 'NeuroStack User'}")
    c.drawString(1 * inch, height - 2.9 * inch, f"{user.email}")
    
    # --- Line Items ---
    y = height - 4 * inch
    c.line(1 * inch, y + 0.2 * inch, width - 1 * inch, y + 0.2 * inch)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(1 * inch, y, "Description")
    c.drawRightString(width - 1 * inch, y, "Amount")
    c.line(1 * inch, y - 0.1 * inch, width - 1 * inch, y - 0.1 * inch)
    
    y -= 0.5 * inch
    c.setFont("Helvetica", 12)
    
    # Item 1: Fixed Fee
    c.drawString(1 * inch, y, "Infrastructure Access Fee (Monthly)")
    c.drawRightString(width - 1 * inch, y, f"INR {invoice.snapshot_data.fixed_fee_inr:.2f}")
    
    y -= 0.3 * inch
    
    # Item 2: Variable Usage
    c.drawString(1 * inch, y, "NeuroRouter LLM Usage (Variable)")
    c.drawRightString(width - 1 * inch, y, f"USD {invoice.calculated_costs.variable_cost_usd:.2f}")
    
    # Details for variable
    y -= 0.2 * inch
    c.setFont("Helvetica", 10)
    c.setFillColor(colors.grey)
    c.drawString(1.2 * inch, y, f"Input Tokens: {invoice.snapshot_data.total_input_tokens:,}")
    c.drawString(1.2 * inch, y - 0.2 * inch, f"Output Tokens: {invoice.snapshot_data.total_output_tokens:,}")
    c.setFillColor(colors.black)
    
    # --- Total ---
    y -= 1 * inch
    c.line(1 * inch, y + 0.2 * inch, width - 1 * inch, y + 0.2 * inch)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(1 * inch, y, "Total Due:")
    c.drawRightString(width - 1 * inch, y, f"{invoice.calculated_costs.total_due_display}")
    
    # --- Footer ---
    c.setFont("Helvetica", 9)
    c.setFillColor(colors.grey)
    c.drawCentredString(width / 2, 0.5 * inch, "Thank you for building with NeuroStack.")
    
    c.save()
    buffer.seek(0)
    return buffer
