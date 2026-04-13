"use client"

import styles from "@/app/home.module.css"

export function TrustedBy() {
    return (
        <section className={styles.trustedSection}>
            <div className={styles.container}>
                <p className={styles.trustedTitle}>
                    TRUSTED BY INNOVATIVE TEAMS
                </p>

                <div className={styles.scroller}>
                    <div className={styles.scrollerInner}>
                        {/* Company names only */}
                        <div className={styles.logoItem}>Agreeupon.ai</div>
                        <div className={styles.logoItem}>Jobcart.ca</div>
                        <div className={styles.logoItem}>Infiniqon Technologies</div>
                        <div className={styles.logoItem}>Zrae Global</div>
                        <div className={styles.logoItem}>StoryBook.ai</div>
                        <div className={styles.logoItem}>R-Logics Solutions Limited</div>
                        <div className={styles.logoItem}>AppBeez</div>

                        {/* Duplicate for infinite scroll */}
                        <div className={styles.logoItem}>Agreeupon.ai</div>
                        <div className={styles.logoItem}>Jobcart.ca</div>
                        <div className={styles.logoItem}>Infiniqon Technologies</div>
                        <div className={styles.logoItem}>Zrae Global</div>
                        <div className={styles.logoItem}>StoryBook.ai</div>
                        <div className={styles.logoItem}>R-Logics Solutions Limited</div>
                        <div className={styles.logoItem}>AppBeez</div>
                    </div>
                </div>
            </div>
        </section>
    )
}
