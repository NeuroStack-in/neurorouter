"use client"

import Link from "next/link"
import React from "react"
import { Github, Twitter, Linkedin } from "lucide-react"

export function Footer() {
    return (
        <footer className="border-t border-slate-200 bg-white pt-16 pb-12">
            <div className="container mx-auto px-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-16">

                    {/* Brand */}
                    <div className="space-y-4">
                        <Link href="/" prefetch={false} className="inline-block">
                            <span className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-mono text-sm">
                                    NS
                                </div>
                                NeuroStack
                            </span>
                        </Link>

                        <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
                            The enterprise-grade router for the AI era. Connect to any model, optimize costs, and scale without limits.
                        </p>

                        <div className="flex gap-4 pt-2">
                            <SocialLink href="https://github.com" icon={<Github className="w-5 h-5" />} />
                            <SocialLink href="https://twitter.com" icon={<Twitter className="w-5 h-5" />} />
                            <SocialLink href="https://linkedin.com" icon={<Linkedin className="w-5 h-5" />} />
                        </div>
                    </div>

                    {/* Links */}
                    <div className="grid grid-cols-2 gap-8 lg:col-span-2">
                        <div className="space-y-4">
                            <h4 className="font-semibold text-slate-900">Product</h4>
                            <ul className="space-y-2 text-sm text-slate-500">
                                <DisabledLink>Features</DisabledLink>
                                <FooterLink href="/pricing">Pricing</FooterLink>
                                <FooterLink href="/docs">Documentation</FooterLink>
                                <DisabledLink>Changelog</DisabledLink>
                            </ul>
                        </div>

                        <div className="space-y-4">
                            <h4 className="font-semibold text-slate-900">Company</h4>
                            <ul className="space-y-2 text-sm text-slate-500">
                                <DisabledLink>About Us</DisabledLink>
                                <DisabledLink>Blog</DisabledLink>
                                <DisabledLink>Careers</DisabledLink>
                                <FooterLink href="/contact">Contact</FooterLink>
                            </ul>
                        </div>
                    </div>

                    {/* Newsletter */}
                    <div className="space-y-4">
                        <h4 className="font-semibold text-slate-900">Stay Updated</h4>
                        <p className="text-sm text-slate-500">
                            Subscribe to our newsletter for the latest updates.
                        </p>

                        <form className="flex gap-2" onSubmit={(e) => e.preventDefault()}>
                            <input
                                type="email"
                                placeholder="Enter your email"
                                className="flex-1 bg-white border border-slate-200 rounded-md px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                        <span className="cursor-not-allowed">Privacy Policy</span>
                        <span className="cursor-not-allowed">Terms of Service</span>
                        <span className="cursor-not-allowed">Cookie Settings</span>
                    </div>
                </div>
            </div>
        </footer>
    )
}

/* ---------- Helpers ---------- */

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
    return (
        <li>
            <Link href={href} prefetch={false} className="hover:text-blue-600 transition-colors">
                {children}
            </Link>
        </li>
    )
}

function DisabledLink({ children }: { children: React.ReactNode }) {
    return (
        <li className="text-slate-400 cursor-not-allowed">
            {children}
        </li>
    )
}

function SocialLink({ href, icon }: { href: string; icon: React.ReactNode }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="w-10 h-10 rounded-full bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-white hover:text-blue-600 hover:border-blue-200 transition-all hover:-translate-y-1"
        >
            {icon}
        </a>
    )
}
