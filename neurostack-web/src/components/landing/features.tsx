"use client"

import { motion } from "framer-motion"
import { Shield, Zap, Globe, ArrowRight, Lock, Server } from "lucide-react"
import styles from "@/app/home.module.css"

const features = [
    {
        title: "Universal Compatibility",
        description: "Drop-in replacement for OpenAI SDKs. Switch models instantly without changing business logic or learning new APIs.",
        icon: Globe,
        color: "rgba(59, 130, 246, 0.5)", // Blue
        visual: (
            <div className="relative flex items-center justify-center">
                <div className="absolute h-24 w-24 rounded-full border border-blue-500/30" />
                <div className="absolute h-32 w-32 rounded-full border border-blue-500/20" />
                <Globe className="h-16 w-16 text-blue-400" />
                <div className="absolute -right-12 -top-12 h-6 w-6 rounded-full bg-blue-500/20 blur-sm" />
                <div className="absolute -bottom-8 -left-10 h-4 w-4 rounded-full bg-blue-400/20 blur-sm" />
            </div>
        )
    },
    {
        title: "Enterprise-Grade Security",
        description: "Issue granular API keys with scoped permissions. Enforce strict rate limits and track usage per tenant in real-time.",
        icon: Shield,
        color: "rgba(139, 92, 246, 0.5)", // Violet
        visual: (
            <div className="relative flex items-center justify-center">
                <Shield className="relative z-10 h-16 w-16 text-violet-400" />
                <Lock className="absolute -right-6 -top-4 h-8 w-8 text-violet-300/50" />
                <div className="absolute inset-0 rounded-lg border border-violet-500/20 bg-violet-500/5 rotate-3 scale-110" />
                <div className="absolute inset-0 rounded-lg border border-violet-500/20 bg-violet-500/5 -rotate-3 scale-110" />
            </div>
        )
    },
    {
        title: "Groq LPU™ Performance",
        description: "Experience blazing fast inference speeds with Llama 3 70B on Groq's dedicated LPU hardware. Zero latency compromises.",
        icon: Zap,
        color: "rgba(249, 115, 22, 0.5)", // Orange
        visual: (
            <div className="relative flex items-center justify-center">
                <Zap className="relative z-10 h-16 w-16 text-orange-400" />
                <Server className="absolute -bottom-4 -right-6 h-8 w-8 text-orange-300/50" />
                <div className="absolute h-20 w-1 bg-gradient-to-b from-transparent via-orange-500/50 to-transparent -rotate-45" />
                <div className="absolute h-20 w-1 bg-gradient-to-b from-transparent via-orange-500/50 to-transparent rotate-45" />
            </div>
        )
    },
]

export function Features() {
    return (
        <section className={styles.section}>
            <div className={styles.container}>
                <div className="mb-16 text-center">
                    <h2 className={styles.heroTitle} style={{ fontSize: "2.5rem" }}>
                        Built for AI scale
                    </h2>
                    <p className={styles.heroDescription}>
                        Everything you need to build production-ready AI applications.
                    </p>
                </div>

                <div className={styles.featuresGrid}>
                    {features.map((feature, index) => (
                        <motion.div
                            key={feature.title}
                            initial={{ opacity: 0, y: 20 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.1 }}
                            viewport={{ once: true }}
                            className={styles.featureCard}
                            style={{ "--glow-color": feature.color } as React.CSSProperties}
                        >
                            <div className={styles.featureVisual}>
                                <div className={styles.featureGlow} />
                                {feature.visual}
                            </div>

                            <div className={styles.featureContent}>
                                <h3 className={styles.featureTitle}>{feature.title}</h3>
                                <p className={styles.featureDescription}>{feature.description}</p>

                            </div>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    )
}
