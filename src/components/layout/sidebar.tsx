"use client"

import { cn } from "@/lib/utils"
import { BarChart3, Key, LayoutDashboard, LogOut, Settings, CreditCard } from "lucide-react"
import { api } from "@/lib/api"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import styles from "@/app/dashboard/dashboard.module.css"

const sidebarItems = [
    {
        title: "Overview",
        href: "/dashboard",
        icon: LayoutDashboard,
        alwaysAccessible: true,
    },
    {
        title: "API Keys",
        href: "/dashboard/api-keys",
        icon: Key,
    },
    {
        title: "Usage",
        href: "/dashboard/usage",
        icon: BarChart3,
    },
    {
        title: "Billing",
        href: "/dashboard/billing",
        icon: CreditCard,
    },
    {
        title: "Settings",
        href: "/dashboard/settings",
        icon: Settings,
    },
]

export function DashboardSidebar() {
    const pathname = usePathname()
    const router = useRouter()
    const [isPending, setIsPending] = useState(false)

    useEffect(() => {
        const profile = localStorage.getItem("user_profile")
        if (profile) {
            try {
                const data = JSON.parse(profile)
                setIsPending(data.account_status === "PENDING_APPROVAL")
            } catch {}
        }
    }, [])

    const handleLogout = async () => {
        try {
            await api.post("/auth/logout", {})
        } catch (error) {
            console.error("Logout failed", error)
        } finally {
            localStorage.removeItem("jwt")
            localStorage.removeItem("refresh_token")
            localStorage.removeItem("user_profile")
            router.push("/auth")
        }
    }

    return (
        <div className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
                <Link href="/dashboard" className={styles.sidebarTitle}>
                    <img src="/logo.png" alt="NeuroRouter" className="h-8 w-auto" />
                </Link>
            </div>

            <nav className={styles.sidebarNav}>
                {sidebarItems.map((item) => {
                    const isActive = pathname === item.href
                    const isLocked = isPending && !item.alwaysAccessible
                    return (
                        <Link
                            key={item.href}
                            href={isLocked ? "/dashboard" : item.href}
                            className={cn(
                                styles.navItem,
                                isActive && styles.navItemActive,
                                isLocked && "opacity-40 pointer-events-none"
                            )}
                            aria-disabled={isLocked}
                            title={isLocked ? "Available after admin approval" : ""}
                        >
                            <item.icon className="h-4 w-4" />
                            {item.title}
                        </Link>
                    )
                })}
            </nav>

            <div className={styles.sidebarFooter}>
                <button
                    onClick={handleLogout}
                    className={styles.logoutButton}
                >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                </button>
            </div>
        </div>
    )
}
