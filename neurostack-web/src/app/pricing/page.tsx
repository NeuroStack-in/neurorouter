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
        name: "Developer",
        price: "$0",
        description: "For hobbyists and side projects.",
        features: ["1,000 requests/month", "1 API Key", "Community Support", "Llama 3.3 70B Access"],
    },
    {
        name: "Pro",
        price: "$29",
        description: "For startups and growing teams.",
        features: [
            "100,000 requests/month",
            "Unlimited API Keys",
            "Priority Support",
            "Higher Rate Limits",
            "Usage Analytics"
        ],
        highlight: true,
    },
    {
        name: "Enterprise",
        price: "Custom",
        description: "For large-scale applications.",
        features: ["Unlimited requests", "SLA Support", "Dedicated Infrastructure", "Custom Models", "SSO"],
    },
]

export default function PricingPage() {
    return (
        <main className={styles.page}>
            <Navbar />
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Simple Pricing</h1>
                    <p className={styles.subtitle}>
                        Start free, upgrade as you grow. No hidden fees.
                    </p>
                </div>

                <div className={styles.grid}>
                    {plans.map((plan) => (
                        <Card
                            key={plan.name}
                            className={cn(styles.card, plan.highlight && styles.cardHighlight)}
                        >
                            <CardHeader>
                                <CardTitle>{plan.name}</CardTitle>
                                <div className={styles.cardTitle}>
                                    {plan.price}
                                    {plan.price !== "Custom" && <span className="ml-1 text-sm font-medium text-muted-foreground">/mo</span>}
                                </div>
                                <CardDescription>{plan.description}</CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1">
                                <ul className={styles.cardFeatures}>
                                    {plan.features.map((feature) => (
                                        <li key={feature} className={styles.featureItem}>
                                            <Check className="h-4 w-4 text-primary" />
                                            {feature}
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                            <CardFooter>
                                <Button className="w-full" variant={plan.highlight ? "default" : "outline"}>
                                    {plan.price === "Custom" ? "Contact Sales" : "Get Started"}
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            </div>
            <Footer />
        </main>
    )
}
