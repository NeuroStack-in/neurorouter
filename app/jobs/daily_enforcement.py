import asyncio
import sys
import os

# Add project root to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.database import init_db
from app.models import User
from app.billing_utils import refresh_user_billing_status

async def run_daily_enforcement():
    """
    Iterates all users and updates their billing status based on due dates.
    This ensures that even inactive users get marked OVERDUE/BLOCKED correctly.
    """
    print("🛡️ Starting Daily Billing Enforcement...")
    await init_db()
    
    users = await User.find_all().to_list()
    print(f"Checking {len(users)} users...")
    
    updates = 0
    for user in users:
        old_status = user.account_status
        new_status = await refresh_user_billing_status(user)
        
        if old_status != new_status:
            print(f"🔄 User {user.email}: {old_status} -> {new_status}")
            updates += 1
            
    print(f"✅ Enforcement Complete. {updates} status updates.")

if __name__ == "__main__":
    asyncio.run(run_daily_enforcement())
