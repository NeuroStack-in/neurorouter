"use client"

import { Activity, Clock, CreditCard, Key, TrendingUp, Zap, CheckCircle, AlertTriangle, XCircle } from "lucide-react"
import styles from "./dashboard.module.css"
import { cn } from "@/lib/utils"
import { useEffect, useState } from "react"
import { dashboardService, DashboardOverview } from "@/services/dashboard"

const ICON_MAP: Record<string, any> = {
    usage: TrendingUp,
    key: Key,
    billing: CreditCard,
    system: Activity,
    default: Activity
}

export default function DashboardPage() {
    const [data, setData] = useState<DashboardOverview | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function fetchDashboard() {
            try {
                const result = await dashboardService.getOverview()
                setData(result)
            } catch (error) {
                console.error("Failed to fetch dashboard data:", error)
            } finally {
                setLoading(false)
            }
        }
        fetchDashboard()
        const interval = setInterval(fetchDashboard, 5000)
        return () => clearInterval(interval)
    }, [])

    if (loading) {
        return ( // Simple skeleton
            <div className={styles.container}>
                <div className={styles.pageHeader}>
                    <div className="h-8 w-48 bg-slate-200 rounded animate-pulse mb-2"></div>
                    <div className="h-4 w-96 bg-slate-100 rounded animate-pulse"></div>
                </div>
                <div className={styles.statsGrid}>
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-40 bg-slate-50 rounded-xl animate-pulse"></div>
                    ))}
                </div>
            </div>
        )
    }

    if (data?.account_status === "PENDING_APPROVAL") {
        return (
            <div className={styles.container}>
                <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-lg mx-auto">
                    <div className="p-4 bg-yellow-50 rounded-full mb-6">
                        <Clock className="h-12 w-12 text-yellow-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 mb-2">Account Pending Approval</h2>
                    <p className="text-slate-600 mb-6">
                        Your account is currently under review. You will receive access to the dashboard and API keys once an admin approves your request.
                    </p>
                </div>
            </div>
        )
    }

    if (data?.account_status === "BLOCKED") {
        return (
            <div className={styles.container}>
                <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-lg mx-auto">
                    <div className="p-4 bg-red-50 rounded-full mb-6">
                        <XCircle className="h-12 w-12 text-red-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-red-800 mb-2">Account Suspended</h2>
                    <p className="text-slate-600 mb-4">
                        Your account has been suspended due to non-payment. All API keys have been disabled and API access is blocked.
                    </p>
                    <p className="text-slate-500 text-sm mb-6">
                        Please clear your outstanding invoices to restore access.
                    </p>
                    <a href="/dashboard/billing"
                        className="px-6 py-3 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 transition-colors">
                        View Billing & Pay Now
                    </a>
                </div>
            </div>
        )
    }

    return (
        <div className={styles.container}>
            <div className={styles.pageHeader}>
                <h2 className={styles.pageTitle}>Overview</h2>
                <p className={styles.pageDescription}>
                    Welcome, {data?.user_name || "User"}. Here's what's happening with your API.
                </p>
            </div>

            <div className={styles.statsGrid}>
                {/* Stats Card 1: Total Tokens */}
                <div className={cn(styles.card, "p-6 flex flex-col justify-between h-full relative overflow-hidden group")}>
                    <div className="flex items-start justify-between relative z-10">
                        <div>
                            <p className="text-sm font-medium text-slate-500 mb-1">Total Tokens</p>
                            <h3 className="text-3xl font-bold text-slate-900 tracking-tight">
                                {(data?.total_tokens || 0).toLocaleString()}
                            </h3>
                        </div>
                        <div className="p-2 bg-blue-50 rounded-lg group-hover:bg-blue-100 transition-colors">
                            <Zap className="h-5 w-5 text-blue-600" />
                        </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-sm relative z-10">
                        <span className="text-slate-400">All time usage</span>
                    </div>
                    {/* Background decoration */}
                    <div className="absolute right-0 bottom-0 w-24 h-24 bg-gradient-to-br from-blue-500/10 to-transparent rounded-tl-full -mr-4 -mb-4 transition-transform group-hover:scale-110 duration-500"></div>
                </div>

                {/* Stats Card 2: Total Requests */}
                <div className={cn(styles.card, "p-6 flex flex-col justify-between h-full relative overflow-hidden group")}>
                    <div className="flex items-start justify-between relative z-10">
                        <div>
                            <p className="text-sm font-medium text-slate-500 mb-1">Total Requests</p>
                            <h3 className="text-3xl font-bold text-slate-900 tracking-tight">
                                {(data?.total_requests || 0).toLocaleString()}
                            </h3>
                        </div>
                        <div className="p-2 bg-purple-50 rounded-lg group-hover:bg-purple-100 transition-colors">
                            <Activity className="h-5 w-5 text-purple-600" />
                        </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-sm relative z-10">
                        <span className="text-slate-400">All time requests</span>
                    </div>
                    <div className="absolute right-0 bottom-0 w-24 h-24 bg-gradient-to-br from-purple-500/10 to-transparent rounded-tl-full -mr-4 -mb-4 transition-transform group-hover:scale-110 duration-500"></div>
                </div>

                {/* Stats Card 3: Active Keys */}
                <div className={cn(styles.card, "p-6 flex flex-col justify-between h-full relative overflow-hidden group")}>
                    <div className="flex items-start justify-between relative z-10">
                        <div>
                            <p className="text-sm font-medium text-slate-500 mb-1">Active Keys</p>
                            <h3 className="text-3xl font-bold text-slate-900 tracking-tight">
                                {data?.active_keys || 0}
                            </h3>
                        </div>
                        <div className="p-2 bg-green-50 rounded-lg group-hover:bg-green-100 transition-colors">
                            <Key className="h-5 w-5 text-green-600" />
                        </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-sm relative z-10">
                        <span className="text-green-600 font-medium">Active now</span>
                    </div>
                    <div className="absolute right-0 bottom-0 w-24 h-24 bg-gradient-to-br from-green-500/10 to-transparent rounded-tl-full -mr-4 -mb-4 transition-transform group-hover:scale-110 duration-500"></div>
                </div>
            </div>

            {/* Token Usage Warning Banner */}
            {(() => {
                const FREE_TIER = 1_000_000
                const inputUsed = data?.total_input_tokens || 0
                const outputUsed = data?.total_output_tokens || 0
                const inputPct = (inputUsed / FREE_TIER) * 100
                const outputPct = (outputUsed / FREE_TIER) * 100
                const maxPct = Math.max(inputPct, outputPct)
                const inputExceeded = inputUsed >= FREE_TIER
                const outputExceeded = outputUsed >= FREE_TIER
                const anyExceeded = inputExceeded || outputExceeded
                const isWarning = maxPct >= 80 && !anyExceeded

                if (!isWarning && !anyExceeded) return null

                return (
                    <div className={cn(
                        "rounded-xl border p-4 flex items-start gap-4",
                        anyExceeded
                            ? "border-red-200 bg-red-50"
                            : "border-amber-200 bg-amber-50"
                    )}>
                        <div className={cn(
                            "p-2 rounded-lg shrink-0",
                            anyExceeded ? "bg-red-100" : "bg-amber-100"
                        )}>
                            {anyExceeded
                                ? <XCircle className="h-5 w-5 text-red-600" />
                                : <AlertTriangle className="h-5 w-5 text-amber-600" />
                            }
                        </div>
                        <div className="flex-1">
                            <h4 className={cn(
                                "text-sm font-semibold",
                                anyExceeded ? "text-red-800" : "text-amber-800"
                            )}>
                                {anyExceeded ? "Free Tier Limit Exceeded" : "Approaching Free Tier Limit"}
                            </h4>
                            <div className="mt-2 space-y-2">
                                <div>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className={inputExceeded ? "text-red-700 font-semibold" : "text-slate-600"}>
                                            Input Tokens: {inputUsed.toLocaleString()} / {FREE_TIER.toLocaleString()}
                                        </span>
                                        <span className={inputExceeded ? "text-red-700 font-semibold" : "text-slate-500"}>
                                            {Math.min(inputPct, 100).toFixed(1)}%
                                        </span>
                                    </div>
                                    <div className="w-full bg-slate-200 rounded-full h-2">
                                        <div className={cn(
                                            "h-2 rounded-full transition-all",
                                            inputExceeded ? "bg-red-500" : inputPct >= 80 ? "bg-amber-500" : "bg-blue-500"
                                        )} style={{ width: `${Math.min(inputPct, 100)}%` }} />
                                    </div>
                                </div>
                                <div>
                                    <div className="flex justify-between text-xs mb-1">
                                        <span className={outputExceeded ? "text-red-700 font-semibold" : "text-slate-600"}>
                                            Output Tokens: {outputUsed.toLocaleString()} / {FREE_TIER.toLocaleString()}
                                        </span>
                                        <span className={outputExceeded ? "text-red-700 font-semibold" : "text-slate-500"}>
                                            {Math.min(outputPct, 100).toFixed(1)}%
                                        </span>
                                    </div>
                                    <div className="w-full bg-slate-200 rounded-full h-2">
                                        <div className={cn(
                                            "h-2 rounded-full transition-all",
                                            outputExceeded ? "bg-red-500" : outputPct >= 80 ? "bg-amber-500" : "bg-blue-500"
                                        )} style={{ width: `${Math.min(outputPct, 100)}%` }} />
                                    </div>
                                </div>
                            </div>
                            {anyExceeded && (
                                <p className="text-xs text-red-700 mt-2">
                                    Overage charges apply: $2/1M input tokens, $8/1M output tokens.
                                    <a href="/dashboard/billing" className="font-medium underline ml-1">View billing</a>
                                </p>
                            )}
                            {isWarning && (
                                <p className="text-xs text-amber-700 mt-2">
                                    You're approaching your free tier limit. Overage rates: $2/1M input, $8/1M output.
                                    <a href="/pricing" className="font-medium underline ml-1">Upgrade plan</a>
                                </p>
                            )}
                        </div>
                    </div>
                )
            })()}

            {/* Grace Period Banner */}
            {data?.graceBanner?.show && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-4">
                    <div className="p-2 bg-amber-100 rounded-lg shrink-0">
                        <AlertTriangle className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                        <h4 className="text-sm font-semibold text-amber-800">Grace Period Active</h4>
                        <p className="text-sm text-amber-700 mt-1">
                            {data.graceBanner.billingMessage}
                            {data.graceBanner.daysRemaining > 0 && (
                                <span className="font-semibold"> ({data.graceBanner.daysRemaining} days remaining)</span>
                            )}
                        </p>
                        <a href="/dashboard/billing" className="text-sm font-medium text-amber-800 hover:text-amber-900 underline mt-2 inline-block">
                            View billing details
                        </a>
                    </div>
                </div>
            )}

            {/* Recent Activity Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className={cn(styles.card, "lg:col-span-2 p-6")}>
                    <div className="flex items-center justify-between mb-6">
                        <h3 className="text-lg font-semibold text-slate-900">Recent Activity</h3>
                        {/* <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">View all</button> */}
                    </div>
                    <div className="space-y-6">
                        {!data?.recent_activity?.length ? (
                            <p className="text-slate-500 text-sm">No recent activity found.</p>
                        ) : (
                            data?.recent_activity?.map((activity) => {
                                const Icon = ICON_MAP[activity.icon_type] || ICON_MAP.default
                                return (
                                    <div key={activity.id} className="flex items-start gap-4 group">
                                        <div className={cn("p-2 rounded-lg mt-0.5 transition-colors", activity.bg)}>
                                            <Icon className={cn("h-4 w-4", activity.color)} />
                                        </div>
                                        <div className="flex-1 min-w-0 pb-6 border-b border-slate-50 last:border-0 last:pb-0">
                                            <p className="text-sm font-medium text-slate-900">{activity.message}</p>
                                            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                                                <Clock className="h-3 w-3" /> {activity.time}
                                            </p>
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>

                <div className={cn(styles.card, "p-6 bg-gradient-to-br from-slate-900 to-slate-800 text-white border-none")}>
                    <h3 className="text-lg font-semibold mb-2">Your Plan</h3>
                    <p className="text-slate-300 text-sm mb-6">Manage your subscription and explore available plans.</p>

                    <a href="/pricing" className="block w-full py-2.5 bg-white text-slate-900 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-lg shadow-white/10 text-center">
                        View Plans
                    </a>

                    <div className="mt-8 pt-8 border-t border-white/10">
                        <div className="flex items-center justify-between text-sm mb-2">
                            <span className="text-slate-300">Current Plan</span>
                            <span className="font-semibold text-white capitalize">{data?.plan_id || "Developer"} Plan</span>
                        </div>

                        <div className="w-full bg-white/10 rounded-full h-1.5 mt-2">
                            <div className={cn(
                                "h-1.5 rounded-full transition-all",
                                ((data?.total_tokens || 0) / 1_000_000) * 100 >= 80 ? "bg-amber-400" : "bg-blue-400"
                            )} style={{ width: `${Math.min(((data?.total_tokens || 0) / 1_000_000) * 100, 100)}%` }} />
                        </div>
                        <p className="text-xs text-slate-400 mt-2 text-right">
                            {((data?.total_tokens || 0) / 1_000_000 * 100).toFixed(1)}% of free tier used
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
