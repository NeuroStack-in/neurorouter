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
                    className="flex items-center gap-2 font-bold text-xl tracking-tight"
                >
                    <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent">
                        NeuroStack
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
