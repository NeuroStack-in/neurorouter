"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Check } from "lucide-react"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import styles from "./pricing.module.css"
import { cn } from "@/lib/utils"

const plans = [
    {
        name: "Free",
        price: "₹0",
        description: "Ideal for testing and experimentation",
        features: ["Access to all Groq-equivalent models (policy-based)"],
        cta: "Get Started",
        href: "/auth",
    },
    {
        name: "Developer",
        price: "₹1,599",
        description: "For startups and growing teams.",
        features: [
            "Core infrastructure access",
            "Access to all routable LLM models",
            "1M input tokens / month included",
            "1M output tokens / month included",
            "Post-quota: Input $2 / 1M tokens",
            "Post-quota: Output $8 / 1M tokens",
            "Overage calculated monthly",
        ],
        highlight: true,
        cta: "Upgrade",
        href: "/auth?plan=developer",
    },
    {
        name: "Enterprise",
        price: "Custom",
        description: "Built for high-scale teams",
        features: ["Custom pricing", "Dedicated support & custom limits"],
        cta: "Contact Sales",
        href: "/contact",
    },
]

export default function PricingPage() {
    return (
        <main className={styles.page}>
            <Navbar />
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Simple, Transparent Pricing</h1>
                    <p className={styles.subtitle}>
                        Start free, scale with predictable token-based pricing.
                    </p>
                    <div className="mt-8 max-w-2xl mx-auto p-4 bg-slate-50 rounded-lg border border-slate-100 text-sm text-slate-600 text-center">
                        <p className="font-medium text-slate-900 mb-1">
                            Pricing includes access to all self-hosted LLMs available in NeuroRouter.
                        </p>
                        Token usage is measured internally based on actual inference performed within NeuroStack infrastructure.
                        <br />
                        <span className="text-xs text-slate-400 mt-2 block">
                            NeuroRouter does not resell Groq Cloud services.
                        </span>
                    </div>
                </div>

                <div className={styles.grid}>
                    {plans.map((plan) => (
                        <div
                            key={plan.name}
                            className={cn("bg-white rounded-xl border p-8 shadow-sm hover:shadow-md transition-all relative flex flex-col", plan.highlight ? "border-blue-200 shadow-blue-100 ring-1 ring-blue-500/20" : "border-slate-200")}
                        >
                            {plan.highlight && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-500 px-3 py-1 text-xs font-medium text-white shadow-lg">
                                    Most Popular
                                </div>
                            )}

                            <h3 className="text-lg font-semibold text-slate-900">{plan.name}</h3>
                            <div className="mt-4 flex items-baseline text-4xl font-bold text-slate-900">
                                {plan.price}
                                {plan.price !== "Custom" && <span className="ml-1 text-base font-medium text-muted-foreground">/mo</span>}
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>

                            <ul className="mt-8 flex-1 space-y-4">
                                {plan.features.map((feature) => (
                                    <li key={feature} className="flex items-start gap-2 text-sm text-slate-600">
                                        <Check className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                                        <span>{feature}</span>
                                    </li>
                                ))}
                            </ul>

                            <div className="mt-8">
                                <Button className={cn("w-full h-10", plan.highlight ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-white border border-slate-200 text-slate-900 hover:bg-slate-50")}>
                                    {plan.cta}
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 text-center border-t border-slate-100 pt-8">
                    <div className="text-sm text-muted-foreground">
                        <span className="font-medium text-slate-900 block mb-1">Clear Token Counters</span>
                        Clear token usage counters
                    </div>
                    <div className="text-sm text-muted-foreground">
                        <span className="font-medium text-slate-900 block mb-1">Usage & Cost Breakdown</span>
                        Usage and cost breakdown dashboard
                    </div>
                    <div className="text-sm text-muted-foreground">
                        <span className="font-medium text-slate-900 block mb-1">No Auto-Collection</span>
                        No automated payment collection
                    </div>
                </div>
            </div>
            <Footer />
        </main>
    )
}
