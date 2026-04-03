"use client"

import { useState, useEffect } from "react"
import styles from "../dashboard.module.css"
import { ChevronDown, ChevronLeft, ChevronRight, Download, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/hooks/use-click-outside"
import { dashboardService, UsageStats } from "@/services/dashboard"
import { apiKeyService, ApiKey } from "@/services/api-keys"

export default function UsagePage() {
    // UI state
    const [workspaceOpen, setWorkspaceOpen] = useState(false)
    const [periodOpen, setPeriodOpen] = useState(false)
    const [apiKeysOpen, setApiKeysOpen] = useState(false)
    const [modelsOpen, setModelsOpen] = useState(false)
    const [groupByOpen, setGroupByOpen] = useState(false)
    const [currentDate, setCurrentDate] = useState(new Date(2025, 11, 1)) // Dec 2025

    // Filter state
    const [activePeriod, setActivePeriod] = useState("Month")
    const [selectedApiKey, setSelectedApiKey] = useState<string | null>(null)
    const [selectedModel, setSelectedModel] = useState<string | null>(null)

    // Data state
    const [stats, setStats] = useState<UsageStats | null>(null)
    const [loading, setLoading] = useState(true)
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([])

    // Refs
    const workspaceRef = useClickOutside<HTMLDivElement>(() => setWorkspaceOpen(false))
    const periodRef = useClickOutside<HTMLDivElement>(() => setPeriodOpen(false))
    const apiKeysRef = useClickOutside<HTMLDivElement>(() => setApiKeysOpen(false))
    const modelsRef = useClickOutside<HTMLDivElement>(() => setModelsOpen(false))
    const groupByRef = useClickOutside<HTMLDivElement>(() => setGroupByOpen(false))

    // 1. Fetch API Keys on mount
    useEffect(() => {
        apiKeyService.list().then(setApiKeys).catch(console.error)
    }, [])

    // 2. Fetch Usage Data when filters change
    useEffect(() => {
        async function fetchUsage() {
            setLoading(true)
            try {
                // Pass filters to service
                const data = await dashboardService.getUsage(
                    activePeriod,
                    selectedModel || undefined,
                    selectedApiKey || undefined
                )
                setStats(data)
            } catch (error) {
                console.error("Failed to fetch usage:", error)
            } finally {
                setLoading(false)
            }
        }
        fetchUsage()
    }, [activePeriod, selectedModel, selectedApiKey])

    const handlePrevMonth = () => {
        setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)))
    }

    const handleNextMonth = () => {
        setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)))
    }

    const formattedDate = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    const chartLabels = stats?.chart_data.length
        ? stats.chart_data.map(d => d.date)
        : Array.from({ length: 7 }, (_, i) => {
            const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1 + (i * 5))
            return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
        })

    const getApiKeyLabel = () => {
        if (!selectedApiKey) return "All API keys"
        const key = apiKeys.find(k => k.id === selectedApiKey)
        return key ? key.name || "Untitled Key" : "Unknown Key"
    }

    return (
        <div className="w-full max-w-[1400px] mx-auto px-6 pb-12 flex flex-col gap-8">
            <div className={styles.pageHeader}>
                <h2 className={styles.pageTitle}>Usage</h2>
                <div className="flex flex-col sm:flex-row gap-4 mt-4">
                    {/* Workspace Selector Removed */}

                    {/* Time Range Selector Removed */}

                    {/* Month Navigation */}
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 shadow-sm">
                            <button
                                onClick={handlePrevMonth}
                                className="p-1 hover:bg-slate-50 rounded-md transition-colors text-slate-500 hover:text-slate-900"
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </button>
                            <div className="flex items-center gap-1 px-3 py-0.5 min-w-[120px] justify-center">
                                <span className="text-sm font-medium text-slate-700">{formattedDate}</span>
                            </div>
                            <button
                                onClick={handleNextMonth}
                                className="p-1 hover:bg-slate-50 rounded-md transition-colors text-slate-500 hover:text-slate-900"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="mt-8">
                {/* Secondary Filters Row */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
                    <div className="flex flex-wrap items-center gap-3">
                        {/* API Keys Dropdown */}
                        <div className="relative" ref={apiKeysRef}>
                            <button
                                onClick={() => setApiKeysOpen(!apiKeysOpen)}
                                className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 hover:border-slate-300 text-slate-600 text-sm font-medium rounded-md transition-colors bg-white shadow-sm"
                            >
                                {getApiKeyLabel()} <ChevronDown className={cn("h-3.5 w-3.5 opacity-50 transition-transform", apiKeysOpen && "rotate-180")} />
                            </button>
                            {apiKeysOpen && (
                                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-100 rounded-lg shadow-lg z-20 py-1 animate-in fade-in zoom-in-95 duration-100 max-h-60 overflow-y-auto">
                                    <button
                                        onClick={() => { setSelectedApiKey(null); setApiKeysOpen(false) }}
                                        className={cn("w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex justify-between items-center", !selectedApiKey && "bg-slate-50 font-medium")}
                                    >
                                        All API keys
                                        {!selectedApiKey && <Check className="h-3 w-3 text-blue-500" />}
                                    </button>
                                    {apiKeys.map(key => (
                                        <button
                                            key={key.id}
                                            onClick={() => { setSelectedApiKey(key.id); setApiKeysOpen(false) }}
                                            className={cn(
                                                "w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex justify-between items-center truncate",
                                                selectedApiKey === key.id && "bg-slate-50 font-medium"
                                            )}
                                        >
                                            <span className="truncate">{key.name || "Untitled"}</span>
                                            {selectedApiKey === key.id && <Check className="h-3 w-3 text-blue-500 flex-shrink-0" />}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Models Dropdown */}
                        <div className="relative" ref={modelsRef}>
                            <button
                                onClick={() => setModelsOpen(!modelsOpen)}
                                className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 hover:border-slate-300 text-slate-600 text-sm font-medium rounded-md transition-colors bg-white shadow-sm"
                            >
                                {selectedModel || "All Models"} <ChevronDown className={cn("h-3.5 w-3.5 opacity-50 transition-transform", modelsOpen && "rotate-180")} />
                            </button>
                            {modelsOpen && (
                                <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-slate-100 rounded-lg shadow-lg z-20 py-1 animate-in fade-in zoom-in-95 duration-100">
                                    <button
                                        onClick={() => { setSelectedModel(null); setModelsOpen(false) }}
                                        className={cn("w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex justify-between items-center", !selectedModel && "bg-slate-50 font-medium")}
                                    >
                                        All Models
                                        {!selectedModel && <Check className="h-3 w-3 text-blue-500" />}
                                    </button>
                                    {["llama-3-70b", "mixtral-8x7b", "gemma-7b"].map(m => (
                                        <button
                                            key={m}
                                            onClick={() => { setSelectedModel(m); setModelsOpen(false) }}
                                            className={cn(
                                                "w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex justify-between items-center",
                                                selectedModel === m && "bg-slate-50 font-medium"
                                            )}
                                        >
                                            {m}
                                            {selectedModel === m && <Check className="h-3 w-3 text-blue-500" />}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="hidden sm:block h-6 w-px bg-slate-200 mx-1"></div>

                        {/* Group By Dropdown (Still mock for now) */}
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                            <span>Group by:</span>
                            <div className="relative" ref={groupByRef}>
                                <button
                                    onClick={() => setGroupByOpen(!groupByOpen)}
                                    className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 hover:border-slate-300 text-slate-700 text-sm font-medium rounded-md transition-colors bg-white shadow-sm"
                                >
                                    Model <ChevronDown className={cn("h-3.5 w-3.5 opacity-50 transition-transform", groupByOpen && "rotate-180")} />
                                </button>
                                {groupByOpen && (
                                    <div className="absolute top-full left-0 mt-1 w-40 bg-white border border-slate-100 rounded-lg shadow-lg z-20 py-1 animate-in fade-in zoom-in-95 duration-100">
                                        <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 bg-slate-50 font-medium">Model</button>
                                        <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">API Key</button>
                                        <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Day</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => {
                            if (!stats) return;
                            const csv = [
                                "metric,value",
                                `total_input_tokens,${stats.total_input_tokens}`,
                                `total_output_tokens,${stats.total_output_tokens}`,
                                `total_requests,${stats.total_requests}`,
                                ...(stats.chart_data || []).map(p => `usage_${p.date},${p.tokens}`),
                            ].join("\n");
                            const blob = new Blob([csv], { type: "text/csv" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `neurorouter-usage-${new Date().toISOString().slice(0, 10)}.csv`;
                            a.click();
                            URL.revokeObjectURL(url);
                        }}
                        className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-md transition-colors shadow-sm bg-white"
                    >
                        <Download className="h-4 w-4 text-slate-500" />
                        Export
                    </button>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div className="bg-white rounded-lg p-5 border border-slate-200 shadow-sm hover:shadow-md transition-all">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Total Tokens In</div>
                        <div className="text-3xl font-bold text-slate-900 tracking-tight">
                            {(stats?.total_input_tokens || 0).toLocaleString()}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">Prompt tokens</div>
                    </div>
                    <div className="bg-white rounded-lg p-5 border border-slate-200 shadow-sm hover:shadow-md transition-all">
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Total Tokens Out</div>
                        <div className="text-3xl font-bold text-slate-900 tracking-tight">
                            {(stats?.total_output_tokens || 0).toLocaleString()}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">Completion tokens</div>
                    </div>
                    <div className="bg-white rounded-lg p-5 border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
                        <div>
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Total Web Searches</div>
                            <div className="text-3xl font-bold text-slate-900 tracking-tight">
                                {(stats?.total_web_searches || 0).toLocaleString()}
                            </div>
                        </div>
                        <div className="text-right text-xs text-slate-400 mt-1">No data</div>
                    </div>
                </div>

                {/* Main Chart Section */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-slate-900">Token usage over time</h3>
                    </div>

                    <div className="h-[400px] border-t border-slate-100 relative mt-4">
                        {/* Dashed Grid Lines */}
                        <div className="absolute inset-x-0 top-0 h-px bg-slate-100"></div>
                        <div className="absolute inset-x-0 top-1/4 h-px border-t border-dashed border-slate-100"></div>
                        <div className="absolute inset-x-0 top-2/4 h-px border-t border-dashed border-slate-100"></div>
                        <div className="absolute inset-x-0 top-3/4 h-px border-t border-dashed border-slate-100"></div>
                        <div className="absolute inset-x-0 bottom-0 h-px bg-slate-100"></div>

                        {/* Y-Axis Labels (Static for now, should be dynamic based on max value) */}
                        <div className="absolute top-4 left-0 text-xs text-slate-400 font-mono">2k</div>
                        <div className="absolute top-1/4 left-0 text-xs text-slate-400 font-mono mt-4">1.5k</div>
                        <div className="absolute top-2/4 left-0 text-xs text-slate-400 font-mono mt-4">1k</div>
                        <div className="absolute top-3/4 left-0 text-xs text-slate-400 font-mono mt-4">500</div>
                        <div className="absolute bottom-2 left-0 text-xs text-slate-400 font-mono">0</div>

                        {/* Chart Line */}
                        <div className="absolute inset-0 left-8 right-0 top-0 bottom-6 flex items-end justify-around px-4">
                            {stats?.chart_data.length === 0 ? (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="flex flex-col items-center justify-center p-6 bg-slate-50/50 rounded-full border border-slate-100/50 backdrop-blur-[2px]">
                                        <span className="text-slate-400 font-medium mb-1">No data available</span>
                                        <span className="text-xs text-slate-400">Usage will appear here</span>
                                    </div>
                                </div>
                            ) : (
                                stats?.chart_data.map((point, i) => (
                                    <div key={i} className="flex flex-col items-center group">
                                        <div
                                            className="w-12 bg-blue-500 rounded-t-sm hover:bg-blue-600 transition-all relative"
                                            style={{ height: `${Math.min((point.tokens / 2000) * 100, 100)}%` }} // Scaled to 2k for now
                                        >
                                            <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                                                {point.tokens} tokens
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* X-Axis Labels */}
                        <div className="absolute bottom-[-24px] left-8 right-0 flex justify-between text-xs text-slate-400 px-4 font-mono select-none">
                            {chartLabels.map((label, i) => (
                                <span key={i}>{label}</span>
                            ))}
                        </div>
                    </div>
                </div >

            </div >
        </div >
    )
}
