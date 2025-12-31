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
                        The Universal API for <br />
                        <span className={styles.gradientText}>
                            <TypewriterEffect words={["Intelligent Model Routing", "Cost Optimization", "Low Latency AI"]} />
                        </span>
                    </motion.h1>

                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.2 }}
                        className={styles.heroDescription}
                    >
                        Access 100+ LLMs through a single, unified API. Optimize for cost, latency, or performance in real-time with our smart routing engine.
                    </motion.p>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                        className="flex flex-col sm:flex-row items-center justify-center gap-4"
                    >
                        <Link href="/auth?tab=register">
                            <Button size="lg" className="h-12 px-8 text-base bg-blue-600 hover:bg-blue-700 text-white shadow-lg shadow-blue-500/20">
                                Start Building Free
                            </Button>
                        </Link>

                    </motion.div>


                </div>
            </div>
        </section>
    )
}
