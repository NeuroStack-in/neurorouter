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
        <main className="min-h-screen bg-white flex flex-col">
            <Navbar />
            <div className="flex-1 flex items-center justify-center p-6 pt-24 bg-white">
                <Card className="w-full max-w-md border-slate-200 bg-white shadow-xl">
                    <CardHeader className="space-y-1">
                        <CardTitle className="text-2xl font-bold tracking-tight text-slate-900">Contact Support</CardTitle>
                        <CardDescription className="text-slate-500">
                            Need help? Fill out the form below and we'll get back to you.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="name" className="text-slate-700">Name</Label>
                                <Input
                                    id="name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    placeholder="John Doe"
                                    required
                                    className="bg-white border-slate-200 focus-visible:ring-blue-500 text-slate-900 placeholder:text-slate-400"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email" className="text-slate-700">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    placeholder="john@example.com"
                                    required
                                    className="bg-white border-slate-200 focus-visible:ring-blue-500 text-slate-900 placeholder:text-slate-400"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="message" className="text-slate-700">Message</Label>
                                <textarea
                                    id="message"
                                    className="flex min-h-[120px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 resize-y"
                                    value={formData.message}
                                    onChange={handleChange}
                                    placeholder="How can we help?"
                                    required
                                />
                            </div>

                            <Button className="w-full bg-slate-900 text-white hover:bg-slate-800" type="submit" disabled={status === "loading"}>
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
                                <p className="text-green-600 mt-2 text-center text-sm font-medium animate-in fade-in slide-in-from-top-1">Message sent successfully!</p>
                            )}
                            {status === "error" && (
                                <p className="text-red-600 mt-2 text-center text-sm font-medium animate-in fade-in slide-in-from-top-1">Failed to send message. Please try again.</p>
                            )}
                        </form>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-slate-200" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-white px-2 text-slate-500">
                                    Or
                                </span>
                            </div>
                        </div>

                        <div className="text-center text-sm text-slate-500">
                            <p>Email us directly at</p>
                            <a
                                href="mailto:neurostackinfo@gmail.com"
                                className="inline-flex items-center mt-1 font-medium text-blue-600 hover:underline underline-offset-4 transition-colors"
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
