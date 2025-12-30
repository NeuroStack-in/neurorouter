"use client"

import { motion } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowRight, Lock, Server, Zap, Cpu, Network } from "lucide-react"
import styles from "@/app/home.module.css"
import { cn } from "@/lib/utils"

export function HowItWorks() {
    return (
        <section className={styles.howItWorksSection} style={{ backgroundColor: "#fafbfc" }}>
            <div className={styles.container}>
                <div className="text-center mb-16">
                    <motion.h2
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-3xl md:text-5xl font-bold tracking-tighter mb-4 text-slate-900"
                    >
                        How it Works
                    </motion.h2>
                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.1 }}
                        className="text-slate-600 text-lg max-w-2xl mx-auto"
                    >
                        Seamlessly sit between your application and LLM providers.
                    </motion.p>
                </div>

                <div className={styles.diagramContainer}>
                    {/* Step 1: Client */}
                    <StepCard
                        icon={<Server className="h-8 w-8 text-blue-600" />}
                        title="Your Application"
                        description="Send standard OpenAI-compatible requests."
                        delay={0}
                        color="blue"
                    />

                    {/* Arrow 1 */}
                    <ConnectionArrow delay={0.2} />

                    {/* Step 2: NeuroStack */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        whileInView={{ opacity: 1, scale: 1 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.3 }}
                        className="relative z-10 w-full md:w-1/3"
                    >
                        <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-violet-600 rounded-2xl blur opacity-20 animate-pulse" />
                        <Card className="relative border-0 shadow-xl bg-white h-full transform hover:-translate-y-1 transition-transform duration-300">
                            <CardContent className="flex flex-col items-center p-8 text-center h-full justify-center">
                                <div className="mb-6 rounded-full bg-violet-50 p-4 border border-violet-100 shadow-sm">
                                    <Network className="h-10 w-10 text-violet-600" />
                                </div>
                                <h3 className="mb-3 text-xl font-bold text-slate-900">NeuroStack Engine</h3>
                                <ul className="text-sm text-slate-500 space-y-2 text-left w-full px-4">
                                    <li className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                                        Unified Auth & Metering
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                                        Intelligent Routing
                                    </li>
                                    <li className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                                        Caching & logging
                                    </li>
                                </ul>
                            </CardContent>
                        </Card>
                    </motion.div>

                    {/* Arrow 2 */}
                    <ConnectionArrow delay={0.5} />

                    {/* Step 3: Provider */}
                    <StepCard
                        icon={<Cpu className="h-8 w-8 text-orange-600" />}
                        title="Model Provider"
                        description="Groq, OpenAI, Anthropic, or custom models."
                        delay={0.6}
                        color="orange"
                    />
                </div>
            </div>
        </section>
    )
}

function StepCard({ icon, title, description, delay, color }: { icon: React.ReactNode, title: string, description: string, delay: number, color: string }) {
    const colorStyles = {
        blue: "bg-blue-50 border-blue-100",
        orange: "bg-orange-50 border-orange-100",
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay }}
            className="relative z-10 w-full md:w-1/3"
        >
            <Card className="border border-slate-200 shadow-sm bg-white hover:shadow-md transition-all h-full">
                <CardContent className="flex flex-col items-center p-8 text-center h-full justify-center">
                    <div className={cn("mb-6 rounded-full p-4 border shadow-sm", colorStyles[color as keyof typeof colorStyles])}>
                        {icon}
                    </div>
                    <h3 className="mb-3 text-xl font-bold text-slate-900">{title}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed">
                        {description}
                    </p>
                </CardContent>
            </Card>
        </motion.div>
    )
}

function ConnectionArrow({ delay }: { delay: number }) {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay }}
            className="hidden md:flex items-center justify-center text-slate-300"
        >
            <ArrowRight className="h-8 w-8" />
        </motion.div>
    )
}
