import asyncio
import sys
import os
from datetime import datetime, timedelta
from decimal import Decimal

# Add project root to path to allow imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.database import init_db
from app.models import User, BillingCycle, BillingStatus, AccountStatus, SnapshotData, CalculatedCosts, AdminAuditLog
from app.billing_utils import calculate_variable_cost, FIXED_FEE_INR

async def generate_invoices_for_month(year_month: str):
    """
    Batch generation of invoices for a specific month (YYYY-MM).
    Should typically be run on the 1st of the NEXT month.
    """
    print(f"🚀 Starting Invoice Generation for {year_month}...")
    await init_db()

    # 1. Calculation Constants
    # Due Date: 5th of the CURRENT month (assuming we run this on the 1st of new month for PREVIOUS month)
    # If year_month is "2023-12", we are likely in "2024-01".
    # Payment Due: 5th day from *now* (run date) or 5th of *next* month?
    # Requirement: "due date (e.g., 5th of month)"
    # Let's set it to 5th of the month following the billing cycle.
    
    cycle_date = datetime.strptime(year_month, "%Y-%m")
    # Next month calculation
    if cycle_date.month == 12:
        next_month_year = cycle_date.year + 1
        next_month_month = 1
    else:
        next_month_year = cycle_date.year
        next_month_month = cycle_date.month + 1
        
    due_date = datetime(next_month_year, next_month_month, 5)
    grace_period_end = due_date + timedelta(days=5)

    print(f"📅 Billing Cycle: {year_month}")
    print(f"📅 Due Date: {due_date.date()}")
    print(f"📅 Grace End: {grace_period_end.date()}")

    # 2. Iterate Active Users
    users = await User.find(
        User.account_status != AccountStatus.BLOCKED,
        User.account_status != AccountStatus.PENDING_APPROVAL
    ).to_list()
    
    print(f"👥 Found {len(users)} active users.")

    generated_count = 0
    skipped_count = 0

    for user in users:
        user_id = str(user.id)
        
        # 3. Check for Existing Invoice (Usage Record)
        # In the new system, a BillingCycle might already exist with Live Usage.
        invoice = await BillingCycle.find_one(
            BillingCycle.user_id == user_id,
            BillingCycle.year_month == year_month
        )
        
        if invoice:
            if invoice.status != BillingStatus.PENDING:
                print(f"⏩ Skipping {user.email}: Invoice already processed ({invoice.status})")
                skipped_count += 1
                continue
                
            # Finalize the existing Pending Invoice
            print(f"🔄 Finalizing existing usage for {user.email}")
            
            # Recalculate costs to be sure
            input_tk = invoice.snapshot_data.total_input_tokens
            output_tk = invoice.snapshot_data.total_output_tokens
            variable_usd = calculate_variable_cost(input_tk, output_tk)
            
            invoice.calculated_costs = CalculatedCosts(
                variable_cost_usd=float(variable_usd),
                fixed_cost_inr=float(FIXED_FEE_INR),
                total_due_display=f"₹{FIXED_FEE_INR} + ${variable_usd:.2f}"
            )
            # Update Dates
            invoice.invoice_number = f"INV-{year_month}-{user_id[:8].upper()}" # Ensure format
            invoice.start_date = cycle_date
            invoice.end_date = cycle_date + timedelta(days=28)
            invoice.due_date = due_date
            invoice.grace_period_end = grace_period_end
            
            await invoice.save()
            generated_count += 1
            
        else:
            # No usage record exists, create new invoice with 0 usage
            print(f"🆕 Creating 0-usage invoice for {user.email}")
            input_tk = 0
            output_tk = 0
            variable_usd = calculate_variable_cost(input_tk, output_tk)
            
            costs = CalculatedCosts(
                variable_cost_usd=float(variable_usd),
                fixed_cost_inr=float(FIXED_FEE_INR),
                total_due_display=f"₹{FIXED_FEE_INR} + ${variable_usd:.2f}"
            )
            
            snapshot = SnapshotData(
                total_input_tokens=input_tk,
                total_output_tokens=output_tk
            )
            
            invoice = BillingCycle(
                user_id=user_id,
                invoice_number=f"INV-{year_month}-{user_id[:8].upper()}",
                year_month=year_month,
                start_date=cycle_date,
                end_date=cycle_date + timedelta(days=28),
                status=BillingStatus.PENDING,
                due_date=due_date,
                grace_period_end=grace_period_end,
                snapshot_data=snapshot,
                calculated_costs=costs
            )
            await invoice.insert()
            generated_count += 1
        
        # 8. Audit Log (System Action)
        await AdminAuditLog(
            admin_user_id="SYSTEM_JOB",
            target_user_id=user_id,
            action="BATCH_INVOICE_GENERATION",
            resource_collection="billing_cycles",
            resource_id=str(invoice.id),
            new_value={"invoice": invoice_num, "amount": costs.total_due_display}
        ).insert()
        
        print(f"✅ Generated {invoice_num} for {user.email}")

    print(f"🏁 Done. Generated: {generated_count}, Skipped: {skipped_count}")

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--month", type=str, help="YYYY-MM to generate bills for (default: previous month)")
    args = parser.parse_args()

    target_month = args.month
    if not target_month:
        # Default to previous month
        today = datetime.utcnow()
        first_of_month = datetime(today.year, today.month, 1)
        prev_month = first_of_month - timedelta(days=1)
        target_month = prev_month.strftime("%Y-%m")

    asyncio.run(generate_invoices_for_month(target_month))
