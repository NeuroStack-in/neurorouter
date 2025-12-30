"use client"

import styles from "@/app/home.module.css"
import { Cloud, Cpu, Globe, Zap, Layers, Server, Shield } from "lucide-react";

export function TrustedBy() {
    return (
        <section className={styles.trustedSection}>
            <div className={styles.container}>
                <p className={styles.trustedTitle}>
                    TRUSTED BY INNOVATIVE TEAMS
                </p>
                <div className={styles.scroller}>
                    <div className={styles.scrollerInner}>
                        {/* Valid Lucide icons only */}
                        <div className={styles.logoItem}><Cloud className="h-6 w-6" /> Vertex</div>
                        <div className={styles.logoItem}><Cpu className="h-6 w-6" /> Anthropic</div>
                        <div className={styles.logoItem}><Globe className="h-6 w-6" /> OpenAI</div>
                        <div className={styles.logoItem}><Zap className="h-6 w-6" /> Mistral</div>
                        <div className={styles.logoItem}><Layers className="h-6 w-6" /> Cohere</div>
                        <div className={styles.logoItem}><Server className="h-6 w-6" /> Azure</div>
                        <div className={styles.logoItem}><Shield className="h-6 w-6" /> AWS Bedrock</div>

                        {/* Duplicate for infinite scroll */}
                        <div className={styles.logoItem}><Cloud className="h-6 w-6" /> Vertex</div>
                        <div className={styles.logoItem}><Cpu className="h-6 w-6" /> Anthropic</div>
                        <div className={styles.logoItem}><Globe className="h-6 w-6" /> OpenAI</div>
                        <div className={styles.logoItem}><Zap className="h-6 w-6" /> Mistral</div>
                        <div className={styles.logoItem}><Layers className="h-6 w-6" /> Cohere</div>
                        <div className={styles.logoItem}><Server className="h-6 w-6" /> Azure</div>
                        <div className={styles.logoItem}><Shield className="h-6 w-6" /> AWS Bedrock</div>
                    </div>
                </div>
            </div>
        </section>
    )
}
