"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import styles from "@/app/home.module.css"
import { cn } from "@/lib/utils"
import { Plus, Minus } from "lucide-react"

const faqs = [
    {
        question: "How does NeuroRouter handle API keys?",
        answer: "NeuroRouter encrypts all API keys using AES-256 encryption. We never store your keys in plain text and they are only decrypted at runtime within our secure enclave."
    },
    {
        question: "Can I use custom models?",
        answer: "Yes! NeuroRouter supports custom endpoints. You can route traffic to your own self-hosted models or fine-tuned versions on supported providers similarly to standard models."
    },
    {
        question: "What is the cost of using NeuroRouter?",
        answer: "NeuroRouter acts as a router. You pay the standard provider rates (e.g., to OpenAI or Anthropic) directly. We charge a small platform fee based on volume for routing, logging, and analytics transparency. Check our pricing page for details."
    },
    {
        question: "Is there a latency overhead?",
        answer: "Our intelligent router adds less than 15ms of overhead to requests, which is negligible for most LLM workloads. In many cases, our dynamic model selection actually reduces total response time."
    }
]

export function FAQ() {
    const [openIndex, setOpenIndex] = useState<number | null>(0)

    return (
        <section className="py-24 relative bg-white">
            <div className="container px-4 md:px-6 max-w-7xl mx-auto">
                <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tighter mb-4 text-slate-900">
                        Frequently Asked Questions
                    </h2>
                    <p className="text-slate-600 max-w-2xl mx-auto">
                        Everything you need to know about NeuroRouter's self-hosted infrastructure.
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                    {faqs.map((faq, index) => (
                        <motion.div
                            key={index}
                            initial={{ opacity: 0, y: 10 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: index * 0.1 }}
                            className={cn(styles.superCard, "overflow-hidden border border-slate-200 bg-white h-fit")}
                        >
                            <button
                                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                                className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-50 transition-colors"
                                aria-expanded={openIndex === index}
                            >
                                <span className="text-lg font-medium text-slate-800 pr-4">{faq.question}</span>
                                <span className={cn("text-slate-400 transition-transform duration-300", openIndex === index && "rotate-180")}>
                                    {openIndex === index ? <Minus className="h-5 w-5 text-orange-500" /> : <Plus className="h-5 w-5" />}
                                </span>
                            </button>

                            <AnimatePresence>
                                {openIndex === index && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.3, ease: "easeInOut" }}
                                    >
                                        <div className="px-6 pb-6 pt-0 text-slate-600 leading-relaxed border-t border-slate-100">
                                            <div className="pt-4">{faq.answer}</div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    ))}
                </div>
            </div>
        </section>
    )
}
