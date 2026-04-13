"use client"

import { DashboardSidebar } from "@/components/layout/sidebar"
import styles from "./dashboard.module.css"
import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname()
    const router = useRouter()
    const [checking, setChecking] = useState(true)

    useEffect(() => {
        // Check if user is PENDING_APPROVAL — only allow /dashboard (overview)
        const profile = localStorage.getItem("user_profile")
        if (profile) {
            try {
                const data = JSON.parse(profile)
                if (data.account_status === "PENDING_APPROVAL" && pathname !== "/dashboard") {
                    router.replace("/dashboard")
                    return
                }
            } catch {}
        }
        setChecking(false)
    }, [pathname, router])

    // Also refresh profile on mount to keep it current
    useEffect(() => {
        const token = localStorage.getItem("jwt")
        if (!token) return
        const apiBase = process.env.NEXT_PUBLIC_API_URL
        fetch(`${apiBase}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data) localStorage.setItem("user_profile", JSON.stringify(data))
            })
            .catch(() => {})
    }, [])

    if (checking && pathname !== "/dashboard") return null

    return (
        <div className={styles.layout}>
            <DashboardSidebar />
            <main className={styles.mainContent}>
                <div className={styles.container}>{children}</div>
            </main>
        </div>
    )
}
