"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { motion } from "framer-motion"
import Link from "next/link"
import styles from "@/app/home.module.css"

function TypewriterEffect({ words }: { words: string[] }) {
    const [currentWordIndex, setCurrentWordIndex] = useState(0)
    const [currentText, setCurrentText] = useState("")
    const [isDeleting, setIsDeleting] = useState(false)

    useEffect(() => {
        const word = words[currentWordIndex]
        const typeSpeed = isDeleting ? 50 : 150

        const timer = setTimeout(() => {
            if (!isDeleting && currentText === word) {
                setTimeout(() => setIsDeleting(true), 2000)
            } else if (isDeleting && currentText === "") {
                setIsDeleting(false)
                setCurrentWordIndex((prev) => (prev + 1) % words.length)
            } else {
                setCurrentText(word.substring(0, currentText.length + (isDeleting ? -1 : 1)))
            }
        }, typeSpeed)

        return () => clearTimeout(timer)
    }, [currentText, isDeleting, currentWordIndex, words])

    return (
        <span>
            {currentText}
            <span className="ml-1 animate-pulse border-r-2 border-current h-full inline-block align-middle">&nbsp;</span>
        </span>
    )
}

export function Hero() {
    return (
        <section className={styles.heroSection}>
            <div className={styles.heroBackground} />

            <div className={styles.container}>
                <div className={styles.heroContent}>
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                    >
                        <span className={styles.badge}>
                            New: Multi-Model Routing 1.0 &rarr;
                        </span>
                    </motion.div>

                    <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.1 }}
                        className={styles.heroTitle}
                    >
                        Self-Hosted LLM Routing Engine <br />
                        <span className={styles.gradientText}>
                            <TypewriterEffect words={["Built for Ultra-Low-Latency Inference", "Built for Private Infrastructure", "Built for Enterprise Scale"]} />
                        </span>
                    </motion.h1>

                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.2 }}
                        className={styles.heroDescription}
                    >
                        NeuroRouter runs self-hosted LLMs inside NeuroRouter infrastructure. Use it as a drop-in replacement for OpenAI APIs — no code changes required.
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                        className="flex flex-col sm:flex-row items-center justify-center gap-4"
                    >
                        <Link href="/auth?tab=register">
                            <Button size="lg" className="h-12 px-8 text-base bg-[#f47c28] hover:bg-[#e06b1b] text-white shadow-lg shadow-orange-500/20">
                                Start Building Free
                            </Button>
                        </Link>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.5 }}
                        className="mt-8 text-sm text-slate-500/80 max-w-md mx-auto text-center"
                    >
                        Inference is performed entirely within NeuroRouter infrastructure. <br />
                        No third-party LLM clouds are used.
                    </motion.div>


                </div>
            </div>
        </section>
    )
}
