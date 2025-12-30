"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"
import { Send, Mail } from "lucide-react"
import emailjs from "emailjs-com"

// EmailJS Credentials Placeholders
// Replace these with your actual credentials from EmailJS dashboard
const SERVICE_ID = "service_g4ilu4s"
const TEMPLATE_ID = "template_pudhk8e"
const PUBLIC_KEY = "tPc8mRF3uK9XY_5kN"

export default function ContactPage() {
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        message: ""
    })
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFormData(prev => ({
            ...prev,
            [e.target.id]: e.target.value
        }))
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setStatus("loading")

        try {
            // Integration with EmailJS
            await emailjs.send(
                SERVICE_ID,
                TEMPLATE_ID,
                {
                    from_name: formData.name,
                    from_email: formData.email,
                    message: formData.message,
                },
                PUBLIC_KEY
            )
            setStatus("success")
            setFormData({ name: "", email: "", message: "" }) // Reset form
        } catch (error) {
            console.error("EmailJS Error:", error)
            setStatus("error")
        }
    }

    return (
        <main className="min-h-screen bg-background flex flex-col">
            <Navbar />
            <div className="flex-1 flex items-center justify-center p-6 pt-24 bg-gradient-to-b from-background to-muted/20">
                <Card className="w-full max-w-md border-white/10 bg-white/5 backdrop-blur-xl shadow-2xl">
                    <CardHeader className="space-y-1">
                        <CardTitle className="text-2xl font-bold tracking-tight">Contact Support</CardTitle>
                        <CardDescription className="text-muted-foreground">
                            Need help? Fill out the form below and we'll get back to you.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Name</Label>
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    placeholder="John Doe"
                                    required
                                    className="bg-background/50 border-input focus-visible:ring-primary backdrop-blur-sm"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    placeholder="john@example.com"
                                    required
                                    className="bg-background/50 border-input focus-visible:ring-primary backdrop-blur-sm"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="message">Message</Label>
                                <textarea
                                    id="message"
                                    className="flex min-h-[120px] w-full rounded-md border border-input bg-background/50 backdrop-blur-sm px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                                    value={formData.message}
                                    onChange={handleChange}
                                    placeholder="How can we help?"
                                    required
                                />
                            </div>

                            <Button className="w-full" type="submit" disabled={status === "loading"}>
                                {status === "loading" ? (
                                    "Sending..."
                                ) : (
                                    <>
                                        Send Message
                                        <Send className="ml-2 h-4 w-4" />
                                    </>
                                )}
                            </Button>

                            {/* Status Messages */}
                            {status === "success" && (
                                <p className="text-green-500 mt-2 text-center text-sm font-medium animate-in fade-in slide-in-from-top-1">Message sent successfully!</p>
                            )}
                            {status === "error" && (
                                <p className="text-destructive mt-2 text-center text-sm font-medium animate-in fade-in slide-in-from-top-1">Failed to send message. Please try again.</p>
                            )}
                        </form>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-muted" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-background px-2 text-muted-foreground">
                                    Or
                                </span>
                            </div>
                        </div>

                        <div className="text-center text-sm text-muted-foreground">
                            <p>Email us directly at</p>
                            <a
                                href="mailto:neurostackinfo@gmail.com"
                                className="inline-flex items-center mt-1 font-medium text-primary hover:underline underline-offset-4 transition-colors"
                            >
                                <Mail className="mr-2 h-3 w-3" />
                                neurostackinfo@gmail.com
                            </a>
                        </div>
                    </CardContent>
                </Card>
            </div>
            <Footer />
        </main>
    )
}
