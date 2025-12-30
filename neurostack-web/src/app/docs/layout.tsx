import { DocsSidebar } from "@/components/layout/docs-sidebar"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import styles from "./docs.module.css"

export default function DocsLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <div className={styles.container}>
            <Navbar />
            <div className={styles.contentWrapper}>
                <DocsSidebar />
                <main className={styles.main}>
                    {children}
                    <Footer />
                </main>
            </div>
        </div>
    )
}
