import Link from "next/link"


export function Navbar() {
    return (
        <nav className="fixed top-0 z-50 w-full border-b border-white/5 bg-background/60 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
            <div className="container mx-auto flex h-16 items-center justify-between px-4">
                <Link href="/" className="flex items-center gap-2 font-bold text-xl tracking-tight">
                    <span className="bg-gradient-to-r from-blue-400 to-violet-400 bg-clip-text text-transparent">
                        NeuroStack
                    </span>
                </Link>
                <div className="flex items-center gap-6 text-sm font-medium text-muted-foreground">
                    <Link href="/docs" className="hover:text-primary transition-colors">
                        Docs
                    </Link>
                    <Link href="/pricing" className="hover:text-primary transition-colors">
                        Pricing
                    </Link>
                    <Link href="/contact" className="hover:text-primary transition-colors">
                        Contact
                    </Link>
                </div>
            </div>
        </nav>
    )
}
