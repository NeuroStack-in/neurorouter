import { DashboardSidebar } from "@/components/layout/sidebar"
import styles from "./dashboard.module.css"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className={styles.layout}>
            <DashboardSidebar />
            <main className={styles.mainContent}>
                <div className={styles.container}>{children}</div>
            </main>
        </div>
    )
}
