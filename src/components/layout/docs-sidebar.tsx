"use client"

import { cn } from "@/lib/utils"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import styles from "@/app/docs/docs.module.css"

const docsItems = [
    { title: "Introduction", href: "/docs", id: "introduction" },
    { title: "Authentication", href: "/docs#authentication", id: "authentication" },
    { title: "API Keys", href: "/docs#api-keys", id: "api-keys" },
    { title: "Chat Completions", href: "/docs#chat-completions", id: "chat-completions" },
    { title: "Models", href: "/docs#models", id: "models" },
]

export function DocsSidebar() {
    const pathname = usePathname()
    const [activeId, setActiveId] = useState("introduction")

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        setActiveId(entry.target.id)
                    }
                })
            },
            { rootMargin: "-100px 0% -80% 0%" }
        )

        docsItems.forEach((item) => {
            const element = document.getElementById(item.id)
            if (element) observer.observe(element)
        })

        return () => observer.disconnect()
    }, [])

    return (
        <div className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
                <span>Documentation</span>
            </div>
            <nav className={styles.sidebarNav}>
                {docsItems.map((item) => (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                            styles.navItem,
                            activeId === item.id && styles.navItemActive
                        )}
                        onClick={() => setActiveId(item.id)}
                    >
                        {item.title}
                    </Link>
                ))}
            </nav>
        </div>
    )
}
