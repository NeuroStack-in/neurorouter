import Link from "next/link"

export function Navbar() {
    return (
        <nav
            className="
        fixed top-0 z-50 w-full border-b
        bg-white/80 border-slate-200
        backdrop-blur-md
      "
        >
            <div className="container mx-auto flex h-16 items-center justify-between px-4">
                {/* Logo */}
                <Link
                    href="/"
                    className="flex items-center gap-1 font-bold tracking-tight"
                >
                    <img src="/logo.png" alt="NeuroRouter" className="h-9 w-auto" />
                    <span style={{ fontFamily: 'Georgia, "Palatino Linotype", "Book Antiqua", serif', fontSize: '1.8rem', lineHeight: 1, marginTop: '0.25rem' }}>
                        <span style={{ color: '#0A1930' }}>Neuro</span><span style={{ color: '#E05A1E' }}>Router</span>
                    </span>
                </Link>

                {/* Nav Links */}
                <div
                    className="
            flex items-center gap-6 text-sm font-medium
            text-slate-600
          "
                >
                    <Link
                        href="/docs"
                        className="hover:text-blue-600 transition-colors"
                    >
                        Docs
                    </Link>

                    <Link
                        href="/pricing"
                        className="hover:text-blue-600 transition-colors"
                    >
                        Pricing
                    </Link>

                    <Link
                        href="/contact"
                        className="hover:text-blue-600 transition-colors"
                    >
                        Contact
                    </Link>
                </div>
            </div>
        </nav>
    )
}
