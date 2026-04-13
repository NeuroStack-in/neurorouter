"use client"

import { useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Download, Info } from "lucide-react"
import { cn } from "@/lib/utils"
import { useClickOutside } from "@/hooks/use-click-outside"

export default function CostPage() {
    const [groupByOpen, setGroupByOpen] = useState(false)
    const [apiKeysOpen, setApiKeysOpen] = useState(false)
    const [modelsOpen, setModelsOpen] = useState(false)
    const [currentDate, setCurrentDate] = useState(new Date(2025, 11, 1)) // Dec 2025

    const groupByRef = useClickOutside<HTMLDivElement>(() => setGroupByOpen(false))
    const apiKeysRef = useClickOutside<HTMLDivElement>(() => setApiKeysOpen(false))
    const modelsRef = useClickOutside<HTMLDivElement>(() => setModelsOpen(false))

    const handlePrevMonth = () => {
        setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)))
    }

    const handleNextMonth = () => {
        setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)))
    }

    const formattedDate = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    const monthDayLabels = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1 + (i * 5))
        return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
    })

    return (
        <div className="w-full max-w-[1400px] mx-auto px-6 pb-12 flex flex-col gap-8">
            <div className="flex flex-col gap-2">
                <h2 className="text-3xl font-bold tracking-tight text-slate-900">Cost</h2>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                    {/* Group By */}
                    <div className="flex items-center gap-2 text-sm text-slate-500 mr-2">
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
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="hidden sm:block h-6 w-px bg-slate-200 mx-1"></div>

                    {/* API Keys */}
                    <div className="relative" ref={apiKeysRef}>
                        <button
                            onClick={() => setApiKeysOpen(!apiKeysOpen)}
                            className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 hover:border-slate-300 text-slate-600 text-sm font-medium rounded-md transition-colors bg-white shadow-sm"
                        >
                            All API keys <ChevronDown className={cn("h-3.5 w-3.5 opacity-50 transition-transform", apiKeysOpen && "rotate-180")} />
                        </button>
                        {apiKeysOpen && (
                            <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-slate-100 rounded-lg shadow-lg z-20 py-1 animate-in fade-in zoom-in-95 duration-100">
                                <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 bg-slate-50 font-medium">All API keys</button>
                                <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Production App</button>
                                <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Development Key</button>
                            </div>
                        )}
                    </div>

                    {/* Models */}
                    <div className="relative" ref={modelsRef}>
                        <button
                            onClick={() => setModelsOpen(!modelsOpen)}
                            className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 hover:border-slate-300 text-slate-600 text-sm font-medium rounded-md transition-colors bg-white shadow-sm"
                        >
                            All Models <ChevronDown className={cn("h-3.5 w-3.5 opacity-50 transition-transform", modelsOpen && "rotate-180")} />
                        </button>
                        {modelsOpen && (
                            <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-slate-100 rounded-lg shadow-lg z-20 py-1 animate-in fade-in zoom-in-95 duration-100">
                                <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 bg-slate-50 font-medium">All Models</button>
                                <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Llama 3 70B</button>
                                <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Mixtral 8x7B</button>
                                <button className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Gemma 7B</button>
                            </div>
                        )}
                    </div>

                    {/* Date Navigation */}
                    <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-0.5 shadow-sm ml-2">
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
                <button className="flex items-center gap-2 px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-md transition-colors shadow-sm bg-white">
                    <Download className="h-4 w-4 text-slate-500" />
                    Export
                </button>
            </div>

            {/* Info Banner */}
            <div className="flex items-center gap-2 px-4 py-3 bg-blue-50/50 border border-blue-100 rounded-lg text-sm text-blue-700">
                <Info className="h-4 w-4 text-blue-500" />
                <span>Showing API usage only. Select 'All workspaces' to include workbench usage.</span>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-lg p-5 border border-slate-200 shadow-sm hover:shadow-md transition-all">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Total Token Cost</div>
                    <div className="text-3xl font-bold text-slate-900 tracking-tight">$0.00</div>
                    <div className="text-xs text-slate-400 mt-1">USD</div>
                </div>
                <div className="bg-white rounded-lg p-5 border border-slate-200 shadow-sm hover:shadow-md transition-all">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Total Web Search Cost</div>
                    <div className="text-3xl font-bold text-slate-900 tracking-tight">$0.00</div>
                    <div className="text-xs text-slate-400 mt-1">USD</div>
                </div>
                <div className="bg-white rounded-lg p-5 border border-slate-200 shadow-sm hover:shadow-md transition-all">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Total Code Execution Cost</div>
                    <div className="text-3xl font-bold text-slate-900 tracking-tight">$0.00</div>
                    <div className="text-xs text-slate-400 mt-1">USD</div>
                </div>
            </div>

            {/* Main Chart Section */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-slate-900">Daily token cost</h3>
                </div>

                <div className="h-[400px] border-t border-slate-100 relative mt-4">
                    {/* Dashed Grid Lines */}
                    <div className="absolute inset-x-0 top-0 h-px bg-slate-100"></div>
                    <div className="absolute inset-x-0 top-1/4 h-px border-t border-dashed border-slate-100"></div>
                    <div className="absolute inset-x-0 top-2/4 h-px border-t border-dashed border-slate-100"></div>
                    <div className="absolute inset-x-0 top-3/4 h-px border-t border-dashed border-slate-100"></div>
                    <div className="absolute inset-x-0 bottom-0 h-px bg-slate-100"></div>

                    {/* Y-Axis Labels */}
                    <div className="absolute top-4 left-0 text-xs text-slate-400 font-mono">$0.04</div>
                    <div className="absolute top-1/4 left-0 text-xs text-slate-400 font-mono mt-4">$0.03</div>
                    <div className="absolute top-2/4 left-0 text-xs text-slate-400 font-mono mt-4">$0.02</div>
                    <div className="absolute top-3/4 left-0 text-xs text-slate-400 font-mono mt-4">$0.01</div>
                    <div className="absolute bottom-2 left-0 text-xs text-slate-400 font-mono">$0.00</div>

                    {/* Chart Line (SVG Placeholder) - Showing "No Data" visually but structure ready */}
                    <div className="absolute inset-0 left-10 right-0 top-0 bottom-6 flex items-center justify-center">
                        <div className="flex flex-col items-center justify-center p-6 bg-slate-50/50 rounded-full border border-slate-100/50 backdrop-blur-[2px]">
                            <span className="text-slate-400 font-medium mb-1">No data available</span>
                            <span className="text-xs text-slate-400">Cost usage will appear here</span>
                        </div>
                    </div>

                    {/* X-Axis Labels */}
                    <div className="absolute bottom-[-24px] left-10 right-0 flex justify-between text-xs text-slate-400 px-4 font-mono select-none">
                        {monthDayLabels.map((date, i) => (
                            <span key={i}>{date}</span>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
