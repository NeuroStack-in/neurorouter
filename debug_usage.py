
import asyncio
from app.database import init_db
from app.models import MonthlyUsage, User

async def main():
    await init_db()
    
    print("--- USERS ---")
    async for user in User.find_all():
        print(f"ID: {user.id} | Email: {user.email}")

    print("\n--- MONTHLY USAGE ---")
    usages = await MonthlyUsage.find_all().to_list()
    if not usages:
        print("No usage records found.")
    else:
        for u in usages:
            print(f"User: {u.user_id} | Month: {u.year_month} | In: {u.input_tokens} | Out: {u.output_tokens}")

if __name__ == "__main__":
    asyncio.run(main())
