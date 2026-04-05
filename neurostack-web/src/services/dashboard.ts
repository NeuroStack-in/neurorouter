import { api } from '@/lib/api'

export interface ActivityItem {
    id: number
    type: string
    message: string
    time: string
    icon_type: string
    bg: string
    color: string
}

export interface GraceBanner {
    show: boolean
    daysRemaining: number
    billingMessage: string
}

export interface DashboardOverview {
    user_name?: string
    total_tokens: number
    total_input_tokens: number
    total_output_tokens: number
    total_requests: number
    active_keys: number
    account_status: string
    recent_activity: ActivityItem[]
    graceBanner: GraceBanner
}

export const dashboardService = {
    getOverview: () => api.get('/dashboard/overview') as Promise<DashboardOverview>,
    getUsage: (period = "Month", model?: string, apiKeyId?: string) => {
        const params = new URLSearchParams({ period });
        if (model) params.append("model", model);
        if (apiKeyId) params.append("api_key_id", apiKeyId);
        return api.get(`/dashboard/usage?${params.toString()}`) as Promise<UsageStats>
    },
}

export interface UsageChartPoint {
    date: string
    tokens: number
}

export interface UsageStats {
    total_input_tokens: number
    total_output_tokens: number
    total_requests: number
    total_web_searches: number
    chart_data: UsageChartPoint[]
}
