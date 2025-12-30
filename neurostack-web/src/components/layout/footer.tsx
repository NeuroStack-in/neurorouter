"use client"

import Link from "next/link"
import React from "react"
import { Github, Twitter, Linkedin } from "lucide-react"

export function Footer() {
    return (
        <footer className="border-t border-slate-200 bg-white pt-16 pb-12">
            <div className="container mx-auto px-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">
                    {/* Brand Column */}
                    <div className="space-y-4">
                        <Link href="/" className="inline-block">
                            <span className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-mono text-sm">NS</div>
                                NeuroStack
                            </span>
                        </Link>
                        <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
                            The enterprise-grade router for the AI era. Connect to any model, optimize costs, and scale without limits.
                        </p>
                        <div className="flex gap-4 pt-2">
                            <SocialLink href="#" icon={<Github className="w-5 h-5" />} />
                            <SocialLink href="#" icon={<Twitter className="w-5 h-5" />} />
                            <SocialLink href="#" icon={<Linkedin className="w-5 h-5" />} />
                        </div>
                    </div>

                    {/* Links Columns */}
                    <div className="grid grid-cols-2 gap-8 lg:col-span-2">
                        <div className="space-y-4">
                            <h4 className="font-semibold text-slate-900">Product</h4>
                            <ul className="space-y-2 text-sm text-slate-500">
                                <FooterLink href="/features">Features</FooterLink>
                                <FooterLink href="/pricing">Pricing</FooterLink>
                                <FooterLink href="/docs">Documentation</FooterLink>
                                <FooterLink href="/changelog">Changelog</FooterLink>
                            </ul>
                        </div>
                        <div className="space-y-4">
                            <h4 className="font-semibold text-slate-900">Company</h4>
                            <ul className="space-y-2 text-sm text-slate-500">
                                <FooterLink href="/about">About Us</FooterLink>
                                <FooterLink href="/blog">Blog</FooterLink>
                                <FooterLink href="/careers">Careers</FooterLink>
                                <FooterLink href="/contact">Contact</FooterLink>
                            </ul>
                        </div>
                    </div>

                    {/* Newsletter Column */}
                    <div className="space-y-4">
                        <h4 className="font-semibold text-slate-900">Stay Updated</h4>
                        <p className="text-sm text-slate-500">
                            Subscribe to our newsletter for the latest routing models and updates.
                        </p>
                        <form className="flex gap-2" onSubmit={(e) => e.preventDefault()}>
                            <input
                                type="email"
                                placeholder="Enter your email"
                                className="flex-1 min-w-0 bg-white border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-slate-900 placeholder:text-slate-400"
                            />
                            <button
                                type="submit"
                                className="bg-slate-900 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-800 transition-colors"
                            >
                                Subscribe
                            </button>
                        </form>
                    </div>
                </div>

                {/* Bottom Bar */}
                <div className="pt-8 border-t border-slate-100 flex flex-col md:flex-row items-center justify-between gap-4">
                    <p className="text-sm text-slate-400">
                        © {new Date().getFullYear()} NeuroStack Inc. All rights reserved.
                    </p>
                    <div className="flex gap-8 text-sm text-slate-400">
                        <Link href="/privacy" className="hover:text-slate-600 transition-colors">Privacy Policy</Link>
                        <Link href="/terms" className="hover:text-slate-600 transition-colors">Terms of Service</Link>
                        <Link href="/cookies" className="hover:text-slate-600 transition-colors">Cookie Settings</Link>
                    </div>
                </div>
            </div>
        </footer>
    )
}

function SocialLink({ href, icon }: { href: string; icon: React.ReactNode }) {
    return (
        <a
            href={href}
            className="w-10 h-10 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-white hover:text-blue-600 hover:border-blue-200 transition-all hover:-translate-y-1"
        >
            {icon}
        </a>
    )
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
    return (
        <li>
            <Link href={href} className="hover:text-blue-600 transition-colors">
                {children}
            </Link>
        </li>
    )
}
