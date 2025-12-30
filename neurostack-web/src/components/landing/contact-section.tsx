import { Button } from "@/components/ui/button"
import Link from "next/link"
import styles from "@/app/home.module.css"

export function ContactSection() {
    return (
        <section className={styles.contactSection}>
            <div className={styles.contactContent}>
                <div className={styles.container}>
                    <h2 className={styles.heroTitle} style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>
                        Ready to scale your AI stack?
                    </h2>
                    <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground">
                        Join thousands of developers building the future with NeuroStack.
                        Get started for free today.
                    </p>
                    <div className="flex items-center justify-center gap-4">
                        <Link href="/auth">
                            <Button size="lg" variant="glow" className="h-12 px-8">
                                Get Started Now
                            </Button>
                        </Link>
                        <Link href="/contact">
                            <Button size="lg" variant="outline" className="h-12 px-8 bg-transparent border-white/20 hover:bg-white/10">
                                Contact Sales
                            </Button>
                        </Link>
                    </div>
                </div>
            </div>

            {/* Background Glow */}
            <div className={styles.contactGlow} />
        </section>
    )
}
