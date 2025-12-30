from motor.motor_asyncio import AsyncIOMotorClient
from beanie import init_beanie

from .config import settings
# Models will be imported here inside init_db to avoid circular imports if needed, 
# or we can import them if they don't depend on this file for anything other than types (which they shouldn't with Beanie)

async def init_db():
    # Create Motor client
    client = AsyncIOMotorClient(settings.mongodb_url)
    
    # Initialize Beanie with the User and ApiKey models
    # We need to import them inside here to ensure they are fully defined before init
    from .models import User, ApiKey, MonthlyUsage
    
    await init_beanie(
        database=client[settings.database_name],
        document_models=[
            User,
            ApiKey,
            MonthlyUsage
        ],
    )
