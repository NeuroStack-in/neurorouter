"use client"

import { Button } from "@/components/ui/button"
import { Check } from "lucide-react"
import Link from "next/link"
import styles from "@/app/home.module.css"
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
            "Access to all routable LLM models",
            "1M input tokens / month",
            "1M output tokens / month",
            "Post-quota: Input $2 / 1M tokens",
            "Post-quota: Output $8 / 1M tokens",
        ],
        highlight: true,
        cta: "Upgrade",
        href: "/auth?plan=developer",
    },
    {
        name: "Enterprise",
        price: "Custom",
        description: "Built for high-scale teams",
        features: ["Dedicated support & custom limits"],
        cta: "Contact Sales",
        href: "/contact",
    },
]

export function PricingSection() {
    return (
        <section className={styles.section} id="pricing">
            <div className={styles.container}>
                <div className="text-center mb-16">
                    <h2 className={styles.heroTitle} style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>
                        Simple, Transparent Pricing
                    </h2>
                    <p className="text-lg text-muted-foreground">
                        Start free, scale with predictable token-based pricing.
                    </p>
                </div>

                <div className={styles.pricingGrid}>
                    {plans.map((plan) => (
                        <div
                            key={plan.name}
                            className={cn(styles.pricingCard, plan.highlight && styles.highlight)}
                        >
                            {plan.highlight && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-blue-500 px-3 py-1 text-xs font-medium text-white shadow-lg">
                                    Most Popular
                                </div>
                            )}

                            <h3 className="text-lg font-semibold">{plan.name}</h3>
                            <div className="mt-4 flex items-baseline text-4xl font-bold">
                                {plan.price}
                                {plan.price !== "Custom" && (
                                    <span className="ml-1 text-base font-medium text-muted-foreground">/mo</span>
                                )}
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">{plan.description}</p>

                            <ul className="mt-8 flex-1 space-y-4">
                                {plan.features.map((feature) => (
                                    <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground">
                                        <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                                        <span>{feature}</span>
                                    </li>
                                ))}
                            </ul>

                            <div className="mt-8">
                                <Link href={plan.href}>
                                    <Button
                                        className="w-full"
                                        variant={plan.highlight ? "glow" : "outline"}
                                    >
                                        {plan.cta}
                                    </Button>
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 text-center border-t border-slate-100 pt-8">
                    <div className="text-sm text-muted-foreground">
                        <span className="font-medium text-slate-900 block mb-1">Real-time Usage</span>
                        Track token usage in real-time
                    </div>
                    <div className="text-sm text-muted-foreground">
                        <span className="font-medium text-slate-900 block mb-1">Cost Breakdown</span>
                        Monthly usage & cost breakdown dashboard
                    </div>
                    <div className="text-sm text-muted-foreground">
                        <span className="font-medium text-slate-900 block mb-1">No Auto-Debit</span>
                        No automated payment collection
                    </div>
                </div>
            </div>
        </section>
    )
}
