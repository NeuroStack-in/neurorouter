"use client"

import { useState } from "react"
import { User, Users, CreditCard, Save, Mail, Shield } from "lucide-react"
import { cn } from "@/lib/utils"

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState("general")

    return (
        <div className="w-full max-w-[1000px] mx-auto px-6 pb-12 flex flex-col gap-8">
            <div className="flex flex-col gap-2">
                <h2 className="text-3xl font-bold tracking-tight text-slate-900">Settings</h2>
                <p className="text-slate-500">Manage your account settings and preferences.</p>
            </div>

            <div className="flex flex-col md:flex-row gap-8">
                {/* Sidebar Navigation */}
                <div className="w-full md:w-64 flex-shrink-0">
                    <nav className="flex md:flex-col gap-1">
                        <button
                            onClick={() => setActiveTab("general")}
                            className={cn(
                                "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left",
                                activeTab === "general" 
                                    ? "bg-slate-100 text-slate-900" 
                                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            )}
                        >
                            <User className="h-4 w-4" />
                            General
                        </button>
                        <button
                            onClick={() => setActiveTab("team")}
                            className={cn(
                                "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left",
                                activeTab === "team" 
                                    ? "bg-slate-100 text-slate-900" 
                                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            )}
                        >
                            <Users className="h-4 w-4" />
                            Team
                        </button>
                        <button
                            onClick={() => setActiveTab("billing")}
                            className={cn(
                                "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left",
                                activeTab === "billing" 
                                    ? "bg-slate-100 text-slate-900" 
                                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            )}
                        >
                            <CreditCard className="h-4 w-4" />
                            Billing
                        </button>
                    </nav>
                </div>

                {/* Content Area */}
                <div className="flex-1 min-w-0">
                    {/* General Tab */}
                    {activeTab === "general" && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                <div className="p-6 border-b border-slate-100">
                                    <h3 className="text-lg font-semibold text-slate-900">Profile</h3>
                                    <p className="text-sm text-slate-500">Update your personal information.</p>
                                </div>
                                <div className="p-6 space-y-4">
                                    <div className="flex items-center gap-4">
                                        <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center text-2xl font-bold text-slate-400">
                                            PN
                                        </div>
                                        <button className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-md text-sm font-medium text-slate-700 transition-colors">
                                            Change Avatar
                                        </button>
                                    </div>
                                    <div className="grid gap-2">
                                        <label className="text-sm font-medium text-slate-700">Display Name</label>
                                        <input 
                                            type="text" 
                                            defaultValue="Peyala Ananda Naidu"
                                            className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all w-full max-w-md"
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <label className="text-sm font-medium text-slate-700">Email Address</label>
                                        <div className="relative max-w-md">
                                            <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                            <input 
                                                type="email" 
                                                defaultValue="peyala@neurorouter.com"
                                                className="pl-9 px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all w-full"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
                                    <button className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-md transition-colors shadow-sm">
                                        <Save className="h-4 w-4" />
                                        Save Changes
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Team Tab */}
                    {activeTab === "team" && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                                    <div>
                                        <h3 className="text-lg font-semibold text-slate-900">Team Members</h3>
                                        <p className="text-sm text-slate-500">Manage who has access to your workspace.</p>
                                    </div>
                                    <button className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors shadow-sm">
                                        Invite Member
                                    </button>
                                </div>
                                <div className="divide-y divide-slate-100">
                                    <div className="p-4 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
                                                PN
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium text-slate-900">Peyala Ananda Naidu</div>
                                                <div className="text-xs text-slate-500">peyala@neurorouter.com</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 px-2 py-1 bg-slate-100 rounded text-xs font-semibold text-slate-600">
                                            <Shield className="h-3 w-3" />
                                            Owner
                                        </div>
                                    </div>
                                    <div className="p-4 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="h-10 w-10 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-bold text-sm">
                                                JD
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium text-slate-900">Jane Doe</div>
                                                <div className="text-xs text-slate-500">jane@neurorouter.com</div>
                                            </div>
                                        </div>
                                        <select className="text-sm border-none bg-transparent text-slate-600 font-medium focus:ring-0 cursor-pointer">
                                            <option>Editor</option>
                                            <option>Viewer</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Billing Tab */}
                    {activeTab === "billing" && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                             <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-xl shadow-lg p-6 text-white relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-32 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                                <div className="relative z-10">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="text-sm font-medium text-slate-300 uppercase tracking-wider mb-1">Current Plan</div>
                                            <h3 className="text-3xl font-bold">Pro Plan</h3>
                                            <p className="text-slate-300 mt-2 max-w-md">You are currently on the Pro plan with access to all advanced models and increased API limits.</p>
                                        </div>
                                        <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-lg border border-white/10">
                                            <div className="text-2xl font-bold">$29</div>
                                            <div className="text-xs text-slate-300">/month</div>
                                        </div>
                                    </div>
                                    <div className="mt-8 flex gap-3">
                                        <button className="px-4 py-2 bg-white text-slate-900 text-sm font-semibold rounded-md hover:bg-slate-100 transition-colors">
                                            Manage Subscription
                                        </button>
                                        <button className="px-4 py-2 bg-transparent border border-white/20 text-white text-sm font-medium rounded-md hover:bg-white/10 transition-colors">
                                            View Invoices
                                        </button>
                                    </div>
                                </div>
                             </div>

                             <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-6">
                                <h4 className="font-semibold text-slate-900 mb-4">Usage Limits</h4>
                                <div className="space-y-4">
                                    <div>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-slate-600">Tokens (Monthly)</span>
                                            <span className="text-slate-900 font-medium">1.2M / 2M</span>
                                        </div>
                                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-blue-500 w-[60%] rounded-full"></div>
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-slate-600">Team Members</span>
                                            <span className="text-slate-900 font-medium">2 / 5</span>
                                        </div>
                                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                            <div className="h-full bg-green-500 w-[40%] rounded-full"></div>
                                        </div>
                                    </div>
                                </div>
                             </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
