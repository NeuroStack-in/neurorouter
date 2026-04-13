"use client"

import { motion } from "framer-motion"
import Link from "next/link"
import { ArrowRight } from "lucide-react"

export function CTASection() {
    return (
        <section className="py-32 relative overflow-hidden bg-slate-50">
            {/* Background Pattern */}
            <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.03]" />
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-indigo-50/30 to-cyan-50" />

            <div className="container px-4 md:px-6 relative z-10 text-center">
                <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    className="max-w-3xl mx-auto"
                >
                    <h2 className="text-4xl md:text-6xl font-bold tracking-tighter mb-6 text-slate-900">
                        Ready to scale your AI?
                    </h2>
                    <p className="text-xl text-slate-600 mb-10 max-w-2xl mx-auto">
                        Start routing effectively today. No credit card required, 14-day free trial on Pro plans.
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Link
                            href="/auth?tab=register"
                            className="px-8 py-4 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-all flex items-center gap-2 text-lg transform hover:scale-105 shadow-xl shadow-blue-500/20"
                        >
                            Get Started Free <ArrowRight className="h-5 w-5" />
                        </Link>
                        <Link
                            href="/contact"
                            className="px-8 py-4 bg-white border border-slate-200 text-slate-700 font-medium rounded-lg hover:bg-slate-50 transition-all text-lg"
                        >
                            Contact Sales
                        </Link>
                    </div>
                </motion.div>
            </div>
        </section>
    )
}
