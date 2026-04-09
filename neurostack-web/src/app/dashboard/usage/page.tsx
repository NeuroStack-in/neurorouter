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
    const [currentDate, setCurrentDate] = useState(() => new Date()) // Current month

    // Filter state
    const [activePeriod, setActivePeriod] = useState("Month")
    const [selectedApiKey, setSelectedApiKey] = useState<string | null>(null)
    const [selectedModel, setSelectedModel] = useState<string | null>(null)
    const [groupBy, setGroupBy] = useState<"Day" | "Model" | "API Key">("Day")

    // Data state
    const [stats, setStats] = useState<UsageStats | null>(null)
    const [loading, setLoading] = useState(true)
    const [apiKeys, setApiKeys] = useState<ApiKey[]>([])

    // Grouped data for bar charts (Model / API Key views)
    const MODELS = ["llama-3.3-70b-versatile", "mixtral-8x7b-32768", "gemma2-9b-it"]
    const MODEL_COLORS = ["#3b82f6", "#22c55e", "#f59e0b"] // blue, green, amber
    const KEY_COLORS = ["#8b5cf6", "#06b6d4", "#f43f5e", "#22c55e", "#f59e0b"] // purple, cyan, rose, green, amber

    interface GroupedBar { label: string; input: number; output: number; total: number; color: string }
    const [groupedBars, setGroupedBars] = useState<GroupedBar[]>([])

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

    // 2. Fetch Usage Data when filters change + auto-refresh every 10s
    useEffect(() => {
        async function fetchUsage() {
            try {
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
        setLoading(true)
        fetchUsage()
        const interval = setInterval(fetchUsage, 5000)
        return () => clearInterval(interval)
    }, [activePeriod, selectedModel, selectedApiKey])

    // 3. Fetch grouped data for bar charts (Model or API Key)
    useEffect(() => {
        if (groupBy === "Day") { setGroupedBars([]); return }

        async function fetchGrouped() {
            try {
                if (groupBy === "Model") {
                    const results = await Promise.all(
                        MODELS.map(m => dashboardService.getUsage(activePeriod, m, selectedApiKey || undefined))
                    )
                    setGroupedBars(results.map((r, i) => ({
                        label: MODELS[i],
                        input: r.total_input_tokens,
                        output: r.total_output_tokens,
                        total: r.total_input_tokens + r.total_output_tokens,
                        color: MODEL_COLORS[i],
                    })))
                } else if (groupBy === "API Key") {
                    const results = await Promise.all(
                        apiKeys.filter(k => k.is_active).map(k =>
                            dashboardService.getUsage(activePeriod, selectedModel || undefined, k.id)
                        )
                    )
                    setGroupedBars(results.map((r, i) => ({
                        label: apiKeys.filter(k => k.is_active)[i]?.name || "Untitled",
                        input: r.total_input_tokens,
                        output: r.total_output_tokens,
                        total: r.total_input_tokens + r.total_output_tokens,
                        color: KEY_COLORS[i % KEY_COLORS.length],
                    })))
                }
            } catch (error) {
                console.error("Failed to fetch grouped data:", error)
            }
        }
        fetchGrouped()
        const interval = setInterval(fetchGrouped, 5000)
        return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupBy, activePeriod, selectedModel, selectedApiKey, apiKeys])

    const handlePrevMonth = () => {
        setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)))
    }

    const handleNextMonth = () => {
        setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)))
    }

    const formattedDate = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    // Tooltip state for line chart
    const [hoveredPoint, setHoveredPoint] = useState<number | null>(null)

    // X-axis: 9 days centered on today (4 days before, today, 4 days after)
    const today = new Date()
    const centerIdx = 4 // index of today in the 9-day array
    const xAxisSlots = Array.from({ length: 9 }, (_, i) => {
        const d = new Date(today)
        d.setDate(today.getDate() + (i - centerIdx))
        return {
            date: d,
            label: d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }),
            isToday: i === centerIdx,
        }
    })

    // Build chart points from real API data
    const totalTokens = (stats?.total_input_tokens || 0) + (stats?.total_output_tokens || 0)
    const inputTokens = stats?.total_input_tokens || 0
    const outputTokens = stats?.total_output_tokens || 0
    const hasData = totalTokens > 0

    // Determine which date to place the usage on:
    // - If a specific API key is selected, use its last_used_at date
    // - Otherwise use today
    const selectedKeyObj = selectedApiKey ? apiKeys.find(k => k.id === selectedApiKey) : null
    const usageDate = (() => {
        if (selectedKeyObj?.last_used_at) {
            const d = new Date(selectedKeyObj.last_used_at)
            return new Date(d.getFullYear(), d.getMonth(), d.getDate())
        }
        return new Date(today.getFullYear(), today.getMonth(), today.getDate())
    })()

    // Find which x-axis slot matches the usage date
    const usageDateStr = usageDate.toDateString()

    const chartPoints = xAxisSlots.map((slot, i) => {
        const slotDateStr = slot.date.toDateString()
        const empty = { date: slot.label, tokens: 0, isToday: slot.isToday, input: 0, output: 0 }
        if (!hasData) return empty
        if (slotDateStr === usageDateStr) {
            return { date: slot.label, tokens: totalTokens, isToday: slot.isToday, input: inputTokens, output: outputTokens }
        }
        return empty
    })

    // Dynamic Y-axis: compute nice max from data
    const rawMax = hasData ? totalTokens : 0
    const yMax = rawMax === 0 ? 2000 : (() => {
        const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax)))
        return Math.ceil(rawMax / magnitude) * magnitude
    })()
    const yTicks = [0, yMax * 0.25, yMax * 0.5, yMax * 0.75, yMax]
    const formatNumber = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n))

    // SVG chart dimensions
    const svgW = 800, svgH = 400, padL = 50, padR = 20, padT = 80, padB = 40
    const plotW = svgW - padL - padR, plotH = svgH - padT - padB

    const toX = (i: number) => padL + (i / 8) * plotW
    const toY = (v: number) => padT + plotH - (yMax === 0 ? 0 : (v / yMax) * plotH)

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
                                <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-100 rounded-lg shadow-lg z-20 py-1 animate-in fade-in zoom-in-95 duration-100">
                                    <button
                                        onClick={() => { setSelectedModel(null); setModelsOpen(false) }}
                                        className={cn("w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex justify-between items-center", !selectedModel && "bg-slate-50 font-medium")}
                                    >
                                        All Models
                                        {!selectedModel && <Check className="h-3 w-3 text-blue-500" />}
                                    </button>
                                    {["llama-3.3-70b-versatile", "mixtral-8x7b-32768", "gemma2-9b-it"].map(m => (
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

                        {/* Group By Dropdown */}
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                            <span>Group by:</span>
                            <div className="relative" ref={groupByRef}>
                                <button
                                    onClick={() => setGroupByOpen(!groupByOpen)}
                                    className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 hover:border-slate-300 text-slate-700 text-sm font-medium rounded-md transition-colors bg-white shadow-sm"
                                >
                                    {groupBy} <ChevronDown className={cn("h-3.5 w-3.5 opacity-50 transition-transform", groupByOpen && "rotate-180")} />
                                </button>
                                {groupByOpen && (
                                    <div className="absolute top-full left-0 mt-1 w-40 bg-white border border-slate-100 rounded-lg shadow-lg z-20 py-1 animate-in fade-in zoom-in-95 duration-100">
                                        {(["Model", "API Key", "Day"] as const).map(opt => (
                                            <button
                                                key={opt}
                                                onClick={() => { setGroupBy(opt); setGroupByOpen(false) }}
                                                className={cn("w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 flex justify-between items-center", groupBy === opt && "bg-slate-50 font-medium")}
                                            >
                                                {opt}
                                                {groupBy === opt && <Check className="h-3 w-3 text-blue-500" />}
                                            </button>
                                        ))}
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

                {/* Chart Section */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-slate-900">
                            {groupBy === "Day" ? "Total Tokens" : `Usage by ${groupBy}`}
                            {selectedModel && <span className="ml-2 text-xs font-normal text-blue-500">({selectedModel})</span>}
                            {selectedApiKey && <span className="ml-2 text-xs font-normal text-emerald-500">(Key: {getApiKeyLabel()})</span>}
                        </h3>
                    </div>

                    {/* === DAY VIEW: Multi-line chart (Input/Output/Total) === */}
                    {groupBy === "Day" && (
                        <>
                            <div className="relative" style={{ height: 420 }}>
                                {!hasData ? (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="flex flex-col items-center justify-center p-6 bg-slate-50/50 rounded-full border border-slate-100/50 backdrop-blur-[2px]">
                                            <span className="text-slate-400 font-medium mb-1">No data available</span>
                                            <span className="text-xs text-slate-400">Usage will appear here when you make API requests</span>
                                        </div>
                                    </div>
                                ) : (
                                    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-full" onMouseLeave={() => setHoveredPoint(null)}>
                                        {yTicks.map((tick, i) => (
                                            <g key={`grid-${i}`}>
                                                <line x1={padL} y1={toY(tick)} x2={svgW - padR} y2={toY(tick)} stroke="#cbd5e1" strokeWidth={0.5} strokeDasharray="4 3" />
                                                <text x={padL - 8} y={toY(tick) + 4} textAnchor="end" fill="#475569" fontSize={12} fontFamily="monospace" fontWeight={500}>{formatNumber(tick)}</text>
                                            </g>
                                        ))}
                                        {/* Baseline */}
                                        <line x1={padL} y1={toY(0)} x2={svgW - padR} y2={toY(0)} stroke="#94a3b8" strokeWidth={1} />
                                        {/* Input line (dark blue) */}
                                        <polyline points={chartPoints.map((p, i) => `${toX(i)},${toY(p.input)}`).join(" ")} fill="none" stroke="#1e3a5f" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                                        {/* Output line (orange) */}
                                        <polyline points={chartPoints.map((p, i) => `${toX(i)},${toY(p.output)}`).join(" ")} fill="none" stroke="#f97316" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                                        {/* Total line (emerald) */}
                                        <polyline points={chartPoints.map((p, i) => `${toX(i)},${toY(p.tokens)}`).join(" ")} fill="none" stroke="#10b981" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                                        {chartPoints.map((point, i) => (
                                            <g key={`pts-${i}`} onMouseEnter={() => setHoveredPoint(i)} style={{ cursor: "pointer" }}>
                                                <rect x={toX(i) - 20} y={padT} width={40} height={plotH} fill="transparent" />
                                                <circle cx={toX(i)} cy={toY(point.input)} r={hoveredPoint === i ? 5 : 3} fill="#1e3a5f" stroke="white" strokeWidth={1.5} />
                                                <circle cx={toX(i)} cy={toY(point.output)} r={hoveredPoint === i ? 5 : 3} fill="#f97316" stroke="white" strokeWidth={1.5} />
                                                <circle cx={toX(i)} cy={toY(point.tokens)} r={hoveredPoint === i ? 5 : 3} fill="#10b981" stroke="white" strokeWidth={1.5} />
                                                {hoveredPoint === i && <line x1={toX(i)} y1={padT} x2={toX(i)} y2={padT + plotH} stroke="#64748b" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />}
                                            </g>
                                        ))}
                                        {hoveredPoint !== null && chartPoints[hoveredPoint] && (() => {
                                            const p = chartPoints[hoveredPoint]; const tx = toX(hoveredPoint)
                                            const tooltipW = 185, tooltipH = 80
                                            const tooltipX = Math.min(Math.max(tx - tooltipW / 2, padL), svgW - padR - tooltipW)
                                            return (<g>
                                                <rect x={tooltipX} y={padT} width={tooltipW} height={tooltipH} rx={8} fill="#1e293b" opacity={0.95} />
                                                <text x={tooltipX + 12} y={padT + 18} fill="#94a3b8" fontSize={10} fontWeight={500}>{p.date}</text>
                                                <circle cx={tooltipX + 16} cy={padT + 32} r={4} fill="#1e3a5f" />
                                                <text x={tooltipX + 26} y={padT + 36} fill="#93c5fd" fontSize={11}>Input: {p.input.toLocaleString()}</text>
                                                <circle cx={tooltipX + 16} cy={padT + 48} r={4} fill="#f97316" />
                                                <text x={tooltipX + 26} y={padT + 52} fill="#fdba74" fontSize={11}>Output: {p.output.toLocaleString()}</text>
                                                <circle cx={tooltipX + 16} cy={padT + 64} r={4} fill="#10b981" />
                                                <text x={tooltipX + 26} y={padT + 68} fill="#6ee7b7" fontSize={11}>Total: {p.tokens.toLocaleString()}</text>
                                            </g>)
                                        })()}
                                        {chartPoints.map((point, i) => (
                                            <text key={`xl-${i}`} x={toX(i)} y={svgH - 6} textAnchor="middle" fill={point.isToday ? "#1e40af" : "#475569"} fontSize={point.isToday ? 13 : 12} fontFamily="monospace" fontWeight={point.isToday ? 700 : 500}>{point.date}</text>
                                        ))}
                                        {/* Legend inside chart (top-right) */}
                                        <g transform={`translate(${svgW - padR - 180}, ${padT + 5})`}>
                                            <rect x={0} y={0} width={170} height={58} rx={6} fill="white" stroke="#e2e8f0" strokeWidth={1} />
                                            <circle cx={14} cy={16} r={5} fill="#1e3a5f" /><text x={26} y={20} fill="#334155" fontSize={11} fontWeight={500}>Input Tokens</text>
                                            <circle cx={14} cy={32} r={5} fill="#f97316" /><text x={26} y={36} fill="#334155" fontSize={11} fontWeight={500}>Output Tokens</text>
                                            <circle cx={14} cy={48} r={5} fill="#10b981" /><text x={26} y={52} fill="#334155" fontSize={11} fontWeight={500}>Total Tokens</text>
                                        </g>
                                    </svg>
                                )}
                            </div>
                        </>
                    )}

                    {/* === MODEL / API KEY VIEW: Bar chart === */}
                    {(groupBy === "Model" || groupBy === "API Key") && (() => {
                        const allBars = groupedBars
                        const barMax = allBars.length > 0 ? Math.max(...allBars.map(b => b.total), 1) : 1
                        const barYMax = (() => { const mag = Math.pow(10, Math.floor(Math.log10(barMax || 1))); return Math.ceil(barMax / mag) * mag || 2000 })()
                        const barYTicks = [0, barYMax * 0.25, barYMax * 0.5, barYMax * 0.75, barYMax]
                        const barSvgW = 800, barSvgH = 420, bPadL = 55, bPadR = 20, bPadT = 30, bPadB = 50
                        const bPlotW = barSvgW - bPadL - bPadR, bPlotH = barSvgH - bPadT - bPadB
                        const barToY = (v: number) => bPadT + bPlotH - (barYMax === 0 ? 0 : (v / barYMax) * bPlotH)
                        const barCount = allBars.length || 1
                        const barGroupW = bPlotW / barCount
                        const barW = Math.min(barGroupW * 0.55, 90)
                        const subBarW = barW / 2 // only 2 bars: input + output

                        return (
                            <div className="relative" style={{ height: 440 }}>
                                {allBars.length === 0 ? (
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="flex flex-col items-center justify-center p-6 bg-slate-50/50 rounded-full border border-slate-100/50 backdrop-blur-[2px]">
                                            <span className="text-slate-400 font-medium mb-1">Loading...</span>
                                        </div>
                                    </div>
                                ) : (
                                    <svg viewBox={`0 0 ${barSvgW} ${barSvgH}`} className="w-full h-full" onMouseLeave={() => setHoveredPoint(null)}>
                                        {/* Grid lines */}
                                        {barYTicks.map((tick, i) => (
                                            <g key={`bg-${i}`}>
                                                <line x1={bPadL} y1={barToY(tick)} x2={barSvgW - bPadR} y2={barToY(tick)} stroke="#cbd5e1" strokeWidth={0.5} strokeDasharray="4 3" />
                                                <text x={bPadL - 8} y={barToY(tick) + 4} textAnchor="end" fill="#475569" fontSize={12} fontFamily="monospace" fontWeight={500}>{formatNumber(tick)}</text>
                                            </g>
                                        ))}
                                        {/* Baseline */}
                                        <line x1={bPadL} y1={barToY(0)} x2={barSvgW - bPadR} y2={barToY(0)} stroke="#94a3b8" strokeWidth={1} />

                                        {/* Bars: 2 sub-bars per group (Input=dark blue, Output=orange) */}
                                        {allBars.map((bar, i) => {
                                            const cx = bPadL + (i + 0.5) * barGroupW
                                            const groupX = cx - barW / 2
                                            return (
                                                <g key={`bar-${i}`} onMouseEnter={() => setHoveredPoint(i)} onMouseLeave={() => setHoveredPoint(null)} style={{ cursor: "pointer" }}>
                                                    {/* Hover highlight */}
                                                    {hoveredPoint === i && (
                                                        <rect x={cx - barGroupW / 2} y={bPadT} width={barGroupW} height={bPlotH} fill="#3b82f6" opacity={0.04} rx={4} />
                                                    )}
                                                    {/* Input bar (dark blue) */}
                                                    <rect x={groupX} y={barToY(bar.input)} width={subBarW - 2} height={Math.max(barToY(0) - barToY(bar.input), 0)} fill="#1e3a5f" rx={3} opacity={hoveredPoint === i ? 1 : 0.9} />
                                                    {/* Output bar (orange) */}
                                                    <rect x={groupX + subBarW + 2} y={barToY(bar.output)} width={subBarW - 2} height={Math.max(barToY(0) - barToY(bar.output), 0)} fill="#f97316" rx={3} opacity={hoveredPoint === i ? 1 : 0.9} />
                                                </g>
                                            )
                                        })}

                                        {/* X-axis labels */}
                                        {allBars.map((bar, i) => {
                                            const cx = bPadL + (i + 0.5) * barGroupW
                                            const label = bar.label.length > 18 ? bar.label.slice(0, 16) + "..." : bar.label
                                            return (
                                                <text key={`bl-${i}`} x={cx} y={barSvgH - 12} textAnchor="middle" fill="#334155" fontSize={12} fontWeight={600}>{label}</text>
                                            )
                                        })}

                                        {/* Hover tooltip */}
                                        {hoveredPoint !== null && allBars[hoveredPoint] && (() => {
                                            const bar = allBars[hoveredPoint]
                                            const cx = bPadL + (hoveredPoint + 0.5) * barGroupW
                                            const tooltipW = 200, tooltipH = 68
                                            const tooltipX = Math.min(Math.max(cx - tooltipW / 2, bPadL), barSvgW - bPadR - tooltipW)
                                            return (
                                                <g>
                                                    <rect x={tooltipX} y={bPadT - 5} width={tooltipW} height={tooltipH} rx={8} fill="#1e293b" opacity={0.95} />
                                                    <text x={tooltipX + 12} y={bPadT + 13} fill="white" fontSize={12} fontWeight={600}>{bar.label}</text>
                                                    <circle cx={tooltipX + 16} cy={bPadT + 28} r={5} fill="#1e3a5f" />
                                                    <text x={tooltipX + 28} y={bPadT + 32} fill="#93c5fd" fontSize={11} fontWeight={500}>Input: {bar.input.toLocaleString()}</text>
                                                    <circle cx={tooltipX + 16} cy={bPadT + 46} r={5} fill="#f97316" />
                                                    <text x={tooltipX + 28} y={bPadT + 50} fill="#fdba74" fontSize={11} fontWeight={500}>Output: {bar.output.toLocaleString()}</text>
                                                </g>
                                            )
                                        })()}

                                        {/* Legend inside chart (top-right) */}
                                        <g transform={`translate(${barSvgW - bPadR - 160}, ${bPadT + 5})`}>
                                            <rect x={0} y={0} width={150} height={42} rx={6} fill="white" stroke="#e2e8f0" strokeWidth={1} />
                                            <circle cx={14} cy={16} r={5} fill="#1e3a5f" /><text x={26} y={20} fill="#334155" fontSize={11} fontWeight={500}>Input Tokens</text>
                                            <circle cx={14} cy={32} r={5} fill="#f97316" /><text x={26} y={36} fill="#334155" fontSize={11} fontWeight={500}>Output Tokens</text>
                                        </g>
                                    </svg>
                                )}
                            </div>
                        )
                    })()}
                </div >

            </div >
        </div >
    )
}
