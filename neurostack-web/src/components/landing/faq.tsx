"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import styles from "@/app/home.module.css"
import { cn } from "@/lib/utils"
import { Plus, Minus } from "lucide-react"

const faqs = [
    {
        question: "How does NeuroStack handle API keys?",
        answer: "NeuroStack encrypts all API keys using AES-256 encryption. We never store your keys in plain text and they are only decrypted at runtime within our secure enclave."
    },
    {
        question: "Can I use custom models?",
        answer: "Yes! NeuroStack supports custom endpoints. You can route traffic to your own self-hosted models or fine-tuned versions on supported providers similarly to standard models."
    },
    {
        question: "What is the cost of using NeuroStack?",
        answer: "NeuroStack acts as a router. You pay the standard provider rates (e.g., to OpenAI or Anthropic) directly. We charge a small platform fee based on volume for routing, logging, and analytics transparency. Check our pricing page for details."
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
            <div className="container px-4 md:px-6 max-w-3xl">
                <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-bold tracking-tighter mb-4 text-slate-900">
                        Frequently Asked Questions
                    </h2>
                </div>

                <div className="flex flex-col gap-4">
                    {faqs.map((faq, index) => (
                        <motion.div
                            key={index}
                            initial={{ opacity: 0, y: 10 }}
                            whileInView={{ opacity: 1, y: 0 }}
                            viewport={{ once: true }}
                            transition={{ delay: index * 0.1 }}
                            className={cn(styles.superCard, "overflow-hidden border border-slate-200 bg-white")}
                        >
                            <button
                                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                                className="w-full flex items-center justify-between p-6 text-left hover:bg-slate-50 transition-colors"
                                aria-expanded={openIndex === index}
                            >
                                <span className="text-lg font-medium text-slate-800">{faq.question}</span>
                                <span className="text-slate-400">
                                    {openIndex === index ? <Minus className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
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
