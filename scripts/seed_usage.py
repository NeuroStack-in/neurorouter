import asyncio
import os
import random
from datetime import datetime, timedelta
import uuid

# Set env var for API base BEFORE importing app
os.environ["MONGODB_URL"] = "mongodb://localhost:27017"
os.environ["DB_NAME"] = "neuro_router"

from app.database import init_db
from app.models import User, ApiKey, MonthlyUsage
from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie

async def seed_data():
    # 1. Connect to DB
    client = AsyncIOMotorClient(os.environ["MONGODB_URL"])
    await init_beanie(database=client[os.environ["DB_NAME"]], document_models=[User, ApiKey, MonthlyUsage])

    # 2. Get first user
    user = await User.find_one({})
    if not user:
        print("No user found. Please register first.")
        return

    print(f"Seeding data for user: {user.email}")

    # 3. Create dummy API key if none
    key = await ApiKey.find_one({"user_id": str(user.id)})
    if not key:
        key = ApiKey(
            user_id=str(user.id),
            key_hash="dummy_hash",
            key_prefix="sk-dummy",
            name="Seed Key"
        )
        await key.insert()
        print("Created dummy API key")

    # 4. Generate Monthly Usage for last 6 months
    models = ["llama-3-70b", "mixtral-8x7b", "gemma-7b"]
    
    current_date = datetime.utcnow()
    
    # Clear existing usage for clean slate
    await MonthlyUsage.find({"user_id": str(user.id)}).delete()

    for i in range(6):
        d = current_date - timedelta(days=30 * (5-i))
        ym = d.strftime("%Y-%m")
        
        for model in models:
            input_tok = random.randint(1000, 50000)
            output_tok = random.randint(1000, 50000)
            req_count = random.randint(50, 500)
            
            usage = MonthlyUsage(
                user_id=str(user.id),
                api_key_id=str(key.id),
                model=model,
                year_month=ym,
                input_tokens=input_tok,
                output_tokens=output_tok,
                total_tokens=input_tok + output_tok,
                request_count=req_count
            )
            await usage.insert()
            print(f"Created usage for {ym} - {model}")

    print("Seeding complete!")

if __name__ == "__main__":
    asyncio.run(seed_data())
