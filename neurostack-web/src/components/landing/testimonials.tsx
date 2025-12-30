"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import styles from "@/app/home.module.css"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight, Quote } from "lucide-react"

const testimonials = [
    {
        quote: "NeuroStack has completely transformed how we build AI applications. The unified API is a game changer.",
        author: "Sarah Chen",
        role: "CTO at TechFlow",
        avatar: "SC"
    },
    {
        quote: "The best developer experience I've had in years. Integration was seamless and the performance is unmatched.",
        author: "Michael Ross",
        role: "Senior Engineer",
        avatar: "MR"
    },
    {
        quote: "Finally, a routing solution that actually balances cost and latency effectively without complex configuration.",
        author: "Elena Rodriguez",
        role: "AI Researcher",
        avatar: "ER"
    },
    {
        quote: "We reduced our inference costs by 40% in the first month just by switching to NeuroStack's intelligent routing.",
        author: "David Kim",
        role: "VP of Engineering at DataScale",
        avatar: "DK"
    },
    {
        quote: "The ability to switch between models instantly without code changes is exactly what we needed for our enterprise clients.",
        author: "Amanda Low",
        role: "Product Lead at InnovateCorp",
        avatar: "AL"
    }
]

export function Testimonials() {
    const [currentIndex, setCurrentIndex] = useState(0)
    const [direction, setDirection] = useState(0)

    const slideVariants = {
        enter: (direction: number) => ({
            x: direction > 0 ? 50 : -50,
            opacity: 0,
            scale: 0.95
        }),
        center: {
            zIndex: 1,
            x: 0,
            opacity: 1,
            scale: 1
        },
        exit: (direction: number) => ({
            zIndex: 0,
            x: direction < 0 ? 50 : -50,
            opacity: 0,
            scale: 0.95
        })
    }

    const swipe = (newDirection: number) => {
        setDirection(newDirection)
        setCurrentIndex((prevIndex) => {
            let nextIndex = prevIndex + newDirection
            if (nextIndex < 0) nextIndex = testimonials.length - 1
            if (nextIndex >= testimonials.length) nextIndex = 0
            return nextIndex
        })
    }

    return (
        <section className="py-24 relative overflow-hidden bg-slate-50">
            <div className="container px-4 md:px-6 relative z-10">
                <div className="text-center mb-16">
                    <motion.h2
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-3xl md:text-5xl font-bold tracking-tighter mb-4 text-slate-900"
                    >
                        Trusted by Builders
                    </motion.h2>
                    <motion.p
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: 0.1 }}
                        className="text-slate-600 text-lg max-w-2xl mx-auto"
                    >
                        Join thousands of developers building the future of AI with NeuroStack.
                    </motion.p>
                </div>

                <div className="relative max-w-5xl mx-auto min-h-[420px] flex items-center justify-center">
                    <AnimatePresence initial={false} mode="wait" custom={direction}>
                        <motion.div
                            key={currentIndex}
                            custom={direction}
                            variants={slideVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{
                                x: { type: "spring", stiffness: 300, damping: 30 },
                                opacity: { duration: 0.3 },
                                scale: { duration: 0.3 }
                            }}
                            className="absolute left-1/2 -translate-x-1/2 w-full max-w-3xl px-4 flex justify-center"
                        >
                            <div className={cn(styles.superCard, "w-full p-10 md:p-14 flex flex-col items-center text-center bg-white shadow-2xl shadow-blue-900/5 border border-slate-100 rounded-2xl relative overflow-hidden group")}>
                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-violet-500 to-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />

                                <div className="mb-8 relative">
                                    <div className="absolute -inset-4 bg-blue-100/50 rounded-full blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
                                    <Quote className="w-12 h-12 text-blue-500 relative z-10 fill-blue-50" />
                                </div>

                                <p className="text-xl md:text-3xl text-slate-800 mb-10 font-medium leading-relaxed tracking-tight">
                                    "{testimonials[currentIndex].quote}"
                                </p>

                                <div className="flex items-center gap-5">
                                    <div className="h-14 w-14 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-lg border-2 border-white shadow-md">
                                        {testimonials[currentIndex].avatar}
                                    </div>
                                    <div className="text-left">
                                        <div className="font-bold text-slate-900 text-lg">{testimonials[currentIndex].author}</div>
                                        <div className="text-sm text-slate-500 font-medium">{testimonials[currentIndex].role}</div>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </AnimatePresence>

                    {/* Navigation Buttons */}
                    <button
                        className="absolute left-0 md:-left-4 z-20 p-4 rounded-full bg-white border border-slate-100 text-slate-400 hover:text-blue-600 hover:border-blue-100 hover:shadow-lg transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        onClick={() => swipe(-1)}
                        aria-label="Previous testimonial"
                    >
                        <ChevronLeft className="w-6 h-6" />
                    </button>
                    <button
                        className="absolute right-0 md:-right-4 z-20 p-4 rounded-full bg-white border border-slate-100 text-slate-400 hover:text-blue-600 hover:border-blue-100 hover:shadow-lg transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        onClick={() => swipe(1)}
                        aria-label="Next testimonial"
                    >
                        <ChevronRight className="w-6 h-6" />
                    </button>
                </div>

                {/* Dots */}
                <div className="flex justify-center gap-3 mt-12">
                    {testimonials.map((_, idx) => (
                        <button
                            key={idx}
                            onClick={() => {
                                setDirection(idx > currentIndex ? 1 : -1)
                                setCurrentIndex(idx)
                            }}
                            className={cn(
                                "h-2 rounded-full transition-all duration-300",
                                idx === currentIndex ? "bg-blue-600 w-8" : "bg-slate-200 w-2 hover:bg-slate-300"
                            )}
                            aria-label={`Go to testimonial ${idx + 1}`}
                        />
                    ))}
                </div>
            </div>
        </section>
    )
}
