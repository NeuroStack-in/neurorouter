from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Query

from .. import schemas
from ..auth import get_current_user
from ..models import ApiKey, MonthlyUsage, User

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/overview", response_model=schemas.DashboardOverview)
async def get_dashboard_overview(
    current_user: User = Depends(get_current_user),
):
    # 1. Calculate usage stats (All time for now, or we could filter by current month)
    # Let's do all time summation for the "Total" cards
    usage_docs = await MonthlyUsage.find(
        MonthlyUsage.user_id == str(current_user.id)
    ).to_list()

    total_tokens = sum(d.total_tokens for d in usage_docs)
    total_requests = sum(d.request_count for d in usage_docs)

    # 2. Active Keys
    active_keys_count = await ApiKey.find(
        ApiKey.user_id == str(current_user.id),
        ApiKey.is_active == True,
    ).count()

    # 3. Recent Activity
    # We'll synthesize this from ApiKeys for now.
    # In a real app, we'd have a separate ActivityLog collection.
    
    activity_items: List[schemas.ActivityItem] = []
    
    # Get recent keys
    recent_keys = await ApiKey.find(
        ApiKey.user_id == str(current_user.id)
    ).sort("-created_at").limit(5).to_list()

    for i, key in enumerate(recent_keys):
        # Activity for creation
        time_diff = datetime.utcnow() - key.created_at
        time_str = _format_time_diff(time_diff)
        
        activity_items.append(
            schemas.ActivityItem(
                id=i, # temporary ID
                type="key",
                message=f"New API Key created: {key.name or 'Untitled'}",
                time=f"{time_str} ago",
                icon_type="key",
                bg="bg-green-50",
                color="text-green-500"
            )
        )

    # Sort by "time" is hard because it's a string, ensuring we just take the top few.
    # Since we only look at keys, they are already sorted by created_at.
    
    return schemas.DashboardOverview(
        user_name=current_user.full_name or current_user.email.split("@")[0],
        total_tokens=total_tokens,
        total_requests=total_requests,
        active_keys=active_keys_count,
        recent_activity=activity_items[:5]
    )

@router.get("/usage", response_model=schemas.UsageStats)
async def get_usage_stats(
    period: str = Query("Month", description="Day, Week, or Month"),
    model: Optional[str] = Query(None, description="Filter by model"),
    api_key_id: Optional[str] = Query(None, description="Filter by API Key ID"),
    current_date: Optional[datetime] = None, # Not fully used yet, assuming 'now'
    current_user: User = Depends(get_current_user),
):
    # 1. Fetch relevant MonthlyUsage docs
    
    query = {
        "user_id": str(current_user.id)
    }
    
    if model:
        query["model"] = model
    
    if api_key_id:
        query["api_key_id"] = api_key_id
        
    usage_docs = await MonthlyUsage.find(query).sort("year_month").to_list()

    total_input = sum(d.input_tokens for d in usage_docs)
    total_output = sum(d.output_tokens for d in usage_docs)
    total_requests = sum(d.request_count for d in usage_docs)
    
    # 2. Build Chart Data
    # Aggregate by month (since that's the granularity we have)
    chart_data = {} # "YYYY-MM" -> total_tokens
    
    for doc in usage_docs:
        ym = doc.year_month
        chart_data[ym] = chart_data.get(ym, 0) + doc.total_tokens
        
    # Convert to list
    chart_points = [
        schemas.UsageChartPoint(date=k, tokens=v) 
        for k, v in sorted(chart_data.items())
    ]
    
    return schemas.UsageStats(
        total_input_tokens=total_input,
        total_output_tokens=total_output,
        total_requests=total_requests,
        total_web_searches=0, # Placeholder
        chart_data=chart_points
    )


def _format_time_diff(diff):
    seconds = diff.total_seconds()
    if seconds < 60:
        return "now"
    elif seconds < 3600:
        return f"{int(seconds // 60)} mins"
    elif seconds < 86400:
        return f"{int(seconds // 3600)} hours"
    else:
        return f"{int(seconds // 86400)} days"
