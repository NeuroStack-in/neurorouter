"use client"

import { Button } from "@/components/ui/button"
import { Check } from "lucide-react"
import Link from "next/link"
import styles from "@/app/home.module.css"
import { cn } from "@/lib/utils"

const plans = [
    {
        name: "Developer",
        price: "$0",
        description: "For hobbyists and side projects.",
        features: ["1,000 requests/month", "1 API Key", "Community Support"],
    },
    {
        name: "Pro",
        price: "$29",
        description: "For growing teams.",
        features: ["100,000 requests/month", "Unlimited Keys", "Priority Support"],
        highlight: true,
    },
    {
        name: "Enterprise",
        price: "Custom",
        description: "For large-scale applications.",
        features: ["Unlimited requests", "SLA Support", "Dedicated Infra"],
    },
]

export function PricingSection() {
    return (
        <section className={styles.section} id="pricing">
            <div className={styles.container}>
                <h2 className={styles.heroTitle} style={{ fontSize: "2.5rem", textAlign: "center", marginBottom: "4rem" }}>
                    Simple Pricing
                </h2>

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
                                    <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <Check className="h-4 w-4 text-primary" />
                                        {feature}
                                    </li>
                                ))}
                            </ul>

                            <div className="mt-8">
                                <Link href={plan.price === "Custom" ? "/contact" : "/auth"}>
                                    <Button
                                        className="w-full"
                                        variant={plan.highlight ? "glow" : "outline"}
                                    >
                                        {plan.price === "Custom" ? "Contact Sales" : "Get Started"}
                                    </Button>
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}
