"use client"

import { useState, useEffect } from "react"
import { User, Users, CreditCard, Save, Mail, Shield, Plus, X, Clock, Check, Trash2, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import { api } from "@/lib/api"

interface UserProfile {
    userId: string
    email: string
    full_name: string
    account_status: string
    plan_id: string
}

interface TeamMemberData {
    email: string
    name: string
    role: string
    status: string
}

interface BillingData {
    current_month?: {
        input_tokens: number
        output_tokens: number
        total_display: string
    }
    account_status: string
}

export default function SettingsPage() {
    const [activeTab, setActiveTab] = useState("general")
    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [displayName, setDisplayName] = useState("")
    const [team, setTeam] = useState<TeamMemberData[]>([])
    const [billing, setBilling] = useState<BillingData | null>(null)
    const [saving, setSaving] = useState(false)
    const [saved, setSaved] = useState(false)

    // Invite state
    const [showInvite, setShowInvite] = useState(false)
    const [inviteEmail, setInviteEmail] = useState("")
    const [inviteRole, setInviteRole] = useState("Editor")
    const [inviting, setInviting] = useState(false)
    const [inviteResult, setInviteResult] = useState<{ link?: string } | null>(null)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        api.get("/auth/me").then((data: any) => {
            setProfile(data)
            setDisplayName(data.full_name || "")
        }).catch(() => {})

        api.get("/auth/team").then((data: any) => {
            setTeam(data || [])
        }).catch(() => {})

        api.get("/billing/me").then((data: any) => {
            setBilling(data)
        }).catch(() => {})
    }, [])

    const handleSaveProfile = async () => {
        setSaving(true)
        try {
            const token = localStorage.getItem("jwt")
            await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/me`, {
                method: "PUT",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ full_name: displayName }),
            })
            setSaved(true)
            setTimeout(() => setSaved(false), 2000)
            // Update cached profile
            if (profile) {
                const updated = { ...profile, full_name: displayName }
                setProfile(updated)
                localStorage.setItem("user_profile", JSON.stringify(updated))
            }
        } catch {}
        setSaving(false)
    }

    const handleInvite = async () => {
        if (!inviteEmail.trim()) return
        setInviting(true)
        setInviteResult(null)
        setCopied(false)
        try {
            const result: any = await api.post("/auth/team/invite", { email: inviteEmail.trim(), role: inviteRole })
            setInviteResult({ link: result.acceptLink })
            const updated: any = await api.get("/auth/team")
            setTeam(updated || [])
            setInviteEmail("")
        } catch (err: any) {
            alert(err?.message || "Failed to send invite")
        }
        setInviting(false)
    }

    const handleRemoveMember = async (email: string) => {
        if (!confirm(`Remove ${email} from your team?`)) return
        try {
            await api.delete(`/auth/team/${encodeURIComponent(email)}`)
            setTeam(prev => prev.filter(m => m.email !== email))
        } catch {}
    }

    const getInitials = (name: string, email: string) => {
        const src = name || email
        return src.split(/[\s@]/).filter(Boolean).map(w => w[0]).join("").toUpperCase().slice(0, 2)
    }

    const FREE_TIER = 1_000_000

    return (
        <div className="w-full max-w-[1000px] mx-auto px-6 pb-12 flex flex-col gap-8">
            <div className="flex flex-col gap-2">
                <h2 className="text-3xl font-bold tracking-tight text-slate-900">Settings</h2>
                <p className="text-slate-500">Manage your account settings and preferences.</p>
            </div>

            <div className="flex flex-col md:flex-row gap-8">
                {/* Sidebar */}
                <div className="w-full md:w-64 flex-shrink-0">
                    <nav className="flex md:flex-col gap-1">
                        {[
                            { id: "general", label: "General", icon: User },
                            { id: "team", label: "Team", icon: Users },
                            { id: "billing", label: "Billing", icon: CreditCard },
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left",
                                    activeTab === tab.id ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                )}
                            >
                                <tab.icon className="h-4 w-4" />
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">

                    {/* ========== GENERAL TAB ========== */}
                    {activeTab === "general" && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                <div className="p-6 border-b border-slate-100">
                                    <h3 className="text-lg font-semibold text-slate-900">Profile</h3>
                                    <p className="text-sm text-slate-500">Update your personal information.</p>
                                </div>
                                <div className="p-6 space-y-4">
                                    <div className="flex items-center gap-4">
                                        <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center text-2xl font-bold text-blue-600">
                                            {getInitials(profile?.full_name || "", profile?.email || "")}
                                        </div>
                                    </div>
                                    <div className="grid gap-2">
                                        <label className="text-sm font-medium text-slate-700">Display Name</label>
                                        <input
                                            type="text"
                                            value={displayName}
                                            onChange={e => setDisplayName(e.target.value)}
                                            placeholder="Enter your name"
                                            className="px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 w-full max-w-md"
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <label className="text-sm font-medium text-slate-700">Email Address</label>
                                        <div className="relative max-w-md">
                                            <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                                            <input
                                                type="email"
                                                value={profile?.email || ""}
                                                disabled
                                                className="pl-9 px-3 py-2 border border-slate-200 rounded-md text-sm bg-slate-50 text-slate-500 w-full"
                                            />
                                        </div>
                                    </div>
                                    <div className="grid gap-2">
                                        <label className="text-sm font-medium text-slate-700">Account Status</label>
                                        <span className={cn(
                                            "px-2.5 py-1 rounded-full text-xs font-semibold w-fit",
                                            profile?.account_status === "ACTIVE" ? "bg-green-100 text-green-700" :
                                            profile?.account_status === "BLOCKED" ? "bg-red-100 text-red-700" :
                                            "bg-yellow-100 text-yellow-700"
                                        )}>
                                            {profile?.account_status || "Loading..."}
                                        </span>
                                    </div>
                                </div>
                                <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end items-center gap-3">
                                    {saved && <span className="text-sm text-green-600 flex items-center gap-1"><Check className="h-4 w-4" /> Saved</span>}
                                    <button
                                        onClick={handleSaveProfile}
                                        disabled={saving}
                                        className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-md transition-colors shadow-sm disabled:opacity-50"
                                    >
                                        <Save className="h-4 w-4" />
                                        {saving ? "Saving..." : "Save Changes"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ========== TEAM TAB ========== */}
                    {activeTab === "team" && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                                    <div>
                                        <h3 className="text-lg font-semibold text-slate-900">Team Members</h3>
                                        <p className="text-sm text-slate-500">Manage who has access to your workspace.</p>
                                    </div>
                                    <button
                                        onClick={() => { setShowInvite(true); setInviteResult(null) }}
                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors shadow-sm flex items-center gap-1"
                                    >
                                        <Plus className="h-4 w-4" />
                                        Invite Member
                                    </button>
                                </div>

                                {/* Invite Panel */}
                                {showInvite && (
                                    <div className="p-4 bg-blue-50 border-b border-blue-100">
                                        <div className="flex items-center justify-between mb-3">
                                            <h4 className="text-sm font-semibold text-blue-800">Send Invitation</h4>
                                            <button onClick={() => setShowInvite(false)} className="text-blue-400 hover:text-blue-600">
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
                                        <div className="flex gap-2">
                                            <input
                                                type="email"
                                                placeholder="Enter email address"
                                                value={inviteEmail}
                                                onChange={e => setInviteEmail(e.target.value)}
                                                onKeyDown={e => e.key === "Enter" && handleInvite()}
                                                className="flex-1 px-3 py-2 border border-blue-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                                autoFocus
                                            />
                                            <select
                                                value={inviteRole}
                                                onChange={e => setInviteRole(e.target.value)}
                                                className="px-3 py-2 border border-blue-200 rounded-md text-sm bg-white"
                                            >
                                                <option>Editor</option>
                                                <option>Viewer</option>
                                            </select>
                                            <button
                                                onClick={handleInvite}
                                                disabled={inviting || !inviteEmail.trim()}
                                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md disabled:opacity-50"
                                            >
                                                {inviting ? "Sending..." : "Send"}
                                            </button>
                                        </div>

                                        {inviteResult?.link && (
                                            <div className="mt-3 p-3 bg-white rounded-md border border-blue-100 text-sm">
                                                <p className="text-green-700 flex items-center gap-1 mb-2">
                                                    <Check className="h-4 w-4" /> Invitation created! Share this link with the invitee:
                                                </p>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        value={inviteResult.link}
                                                        readOnly
                                                        className="flex-1 px-2 py-1.5 bg-slate-50 border rounded text-xs font-mono truncate"
                                                        onClick={e => (e.target as HTMLInputElement).select()}
                                                    />
                                                    <button
                                                        onClick={() => { navigator.clipboard.writeText(inviteResult.link!); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                                                        className={cn(
                                                            "px-3 py-1.5 rounded text-xs flex items-center gap-1 shrink-0 font-medium transition-colors",
                                                            copied ? "bg-green-100 text-green-700" : "bg-blue-100 hover:bg-blue-200 text-blue-700"
                                                        )}
                                                    >
                                                        {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy Link</>}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Members List */}
                                <div className="divide-y divide-slate-100">
                                    {team.map((member) => (
                                        <div key={member.email} className="p-4 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className={cn(
                                                    "h-10 w-10 rounded-full flex items-center justify-center font-bold text-sm",
                                                    member.role === "Owner" ? "bg-blue-100 text-blue-600" : "bg-purple-100 text-purple-600"
                                                )}>
                                                    {getInitials(member.name, member.email)}
                                                </div>
                                                <div>
                                                    <div className="text-sm font-medium text-slate-900">
                                                        {member.name || member.email.split("@")[0]}
                                                        {member.status === "PENDING" && (
                                                            <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-600 font-normal">
                                                                <Clock className="h-3 w-3" /> Pending
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-slate-500">{member.email}</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {member.role === "Owner" ? (
                                                    <div className="flex items-center gap-1 px-2 py-1 bg-slate-100 rounded text-xs font-semibold text-slate-600">
                                                        <Shield className="h-3 w-3" /> Owner
                                                    </div>
                                                ) : (
                                                    <>
                                                        <span className="text-xs text-slate-500 font-medium">{member.role}</span>
                                                        <button
                                                            onClick={() => handleRemoveMember(member.email)}
                                                            className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                                            title="Remove member"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {team.length === 0 && (
                                        <div className="p-8 text-center text-sm text-slate-400">Loading team...</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ========== BILLING TAB ========== */}
                    {activeTab === "billing" && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-xl shadow-lg p-6 text-white relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-32 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                                <div className="relative z-10">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="text-sm font-medium text-slate-300 uppercase tracking-wider mb-1">Current Plan</div>
                                            <h3 className="text-3xl font-bold capitalize">{profile?.plan_id || "Developer"} Plan</h3>
                                            <p className="text-slate-300 mt-2 max-w-md">
                                                1M free input + 1M free output tokens/month. Overage: $2/1M input, $8/1M output. Access to all models.
                                            </p>
                                        </div>
                                        <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-lg border border-white/10">
                                            <div className="text-2xl font-bold">₹1,599</div>
                                            <div className="text-xs text-slate-300">/month</div>
                                        </div>
                                    </div>
                                    <div className="mt-8 flex gap-3">
                                        <a href="/dashboard/billing" className="px-4 py-2 bg-white text-slate-900 text-sm font-semibold rounded-md hover:bg-slate-100 transition-colors">
                                            View Invoices
                                        </a>
                                        <a href="/pricing" className="px-4 py-2 bg-transparent border border-white/20 text-white text-sm font-medium rounded-md hover:bg-white/10 transition-colors">
                                            Upgrade Plan
                                        </a>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-6">
                                <h4 className="font-semibold text-slate-900 mb-4">Current Month Usage</h4>
                                <div className="space-y-4">
                                    <div>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-slate-600">Input Tokens</span>
                                            <span className="text-slate-900 font-medium">
                                                {(billing?.current_month?.input_tokens || 0).toLocaleString()} / {FREE_TIER.toLocaleString()}
                                            </span>
                                        </div>
                                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                            <div className={cn(
                                                "h-full rounded-full transition-all",
                                                (billing?.current_month?.input_tokens || 0) / FREE_TIER >= 0.8 ? "bg-amber-500" : "bg-blue-500"
                                            )} style={{ width: `${Math.min(((billing?.current_month?.input_tokens || 0) / FREE_TIER) * 100, 100)}%` }} />
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex justify-between text-sm mb-1">
                                            <span className="text-slate-600">Output Tokens</span>
                                            <span className="text-slate-900 font-medium">
                                                {(billing?.current_month?.output_tokens || 0).toLocaleString()} / {FREE_TIER.toLocaleString()}
                                            </span>
                                        </div>
                                        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                                            <div className={cn(
                                                "h-full rounded-full transition-all",
                                                (billing?.current_month?.output_tokens || 0) / FREE_TIER >= 0.8 ? "bg-amber-500" : "bg-blue-500"
                                            )} style={{ width: `${Math.min(((billing?.current_month?.output_tokens || 0) / FREE_TIER) * 100, 100)}%` }} />
                                        </div>
                                    </div>
                                    <div className="pt-2 border-t">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-slate-600">Estimated Total</span>
                                            <span className="text-slate-900 font-semibold">{billing?.current_month?.total_display || "₹1,599.00 + $0.00"}</span>
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
