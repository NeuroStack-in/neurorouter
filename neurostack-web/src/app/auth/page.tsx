"use client"

import { Button } from "@/components/ui/button"
import { Navbar } from "@/components/layout/navbar"
import { Footer } from "@/components/layout/footer"

import {
    Card,
    CardContent,
    CardDescription,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import { Eye, EyeOff, Mail, Lock, User, Loader2, AlertCircle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import styles from "./auth.module.css"

type AuthView = "login" | "register"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:7860"

export default function AuthPage() {
    const router = useRouter()
    const [loading, setLoading] = useState(false)
    const [view, setView] = useState<AuthView>("login")
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirmPassword, setShowConfirmPassword] = useState(false)
    const [errors, setErrors] = useState<Record<string, string>>({})

    const [formData, setFormData] = useState({
        email: "",
        password: "",
        confirmPassword: "",
        name: "",
    })

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { id, value } = e.target
        let key = id
        if (id.startsWith('login-')) key = id.replace('login-', '')
        if (id.startsWith('register-')) key = id.replace('register-', '')
        if (key === 'confirm-password') key = 'confirmPassword'

        setFormData(prev => ({ ...prev, [key]: value }))

        // Clear error when user starts typing
        if (errors[key]) {
            setErrors(prev => ({ ...prev, [key]: "" }))
        }
    }

    const validateForm = (isRegister: boolean) => {
        const newErrors: Record<string, string> = {}

        if (!formData.email) {
            newErrors.email = "Email is required"
        } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
            newErrors.email = "Email is invalid"
        }

        if (!formData.password) {
            newErrors.password = "Password is required"
        } else if (formData.password.length < 8) {
            newErrors.password = "Password must be at least 8 characters"
        }

        if (isRegister) {
            if (!formData.name) {
                newErrors.name = "Name is required"
            }

            if (!formData.confirmPassword) {
                newErrors.confirmPassword = "Please confirm your password"
            } else if (formData.password !== formData.confirmPassword) {
                newErrors.confirmPassword = "Passwords do not match"
            }
        }

        setErrors(newErrors)
        return Object.keys(newErrors).length === 0
    }

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault()
        const isRegister = view === "register"

        if (!validateForm(isRegister)) {
            return
        }

        setLoading(true)
        try {
            if (isRegister) {
                const registerRes = await fetch(`${API_BASE}/auth/register`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email: formData.email,
                        full_name: formData.name,
                        password: formData.password,
                    }),
                })
                if (!registerRes.ok) {
                    let msg = "Registration failed. Please try again."
                    try {
                        const data = await registerRes.json()
                        if (data?.detail) msg = data.detail
                    } catch (err) {
                        // keep default
                    }
                    throw new Error(msg)
                }
            }

            const loginRes = await fetch(`${API_BASE}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: formData.email,
                    password: formData.password,
                }),
            })

            if (!loginRes.ok) {
                let msg = "Authentication failed. Please try again."
                try {
                    const data = await loginRes.json()
                    if (data?.detail) msg = data.detail
                } catch (err) {
                    // keep default
                }
                throw new Error(msg)
            }

            const data = await loginRes.json()
            const token = data?.access_token
            if (!token) throw new Error("Missing access token")

            localStorage.setItem("jwt", token)
            if (data.refresh_token) {
                localStorage.setItem("refresh_token", data.refresh_token)
            }

            // Fetch user profile to cache account status
            try {
                const meRes = await fetch(`${API_BASE}/auth/me`, {
                    headers: { "Authorization": `Bearer ${token}` },
                })
                if (meRes.ok) {
                    const profile = await meRes.json()
                    localStorage.setItem("user_profile", JSON.stringify(profile))
                }
            } catch {
                // profile fetch is best-effort
            }

            router.push("/dashboard")
        } catch (error: any) {
            const msg = error?.message || "Authentication failed. Please try again."
            setErrors({ submit: msg })
        } finally {
            setLoading(false)
        }
    }

    const handleGoogleAuth = async (response: any) => {
        setLoading(true)
        try {
            const googleIdToken = response.credential
            if (!googleIdToken) {
                throw new Error("Google Login failed. No credential received.")
            }

            const res = await fetch(`${API_BASE}/auth/google`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: googleIdToken }),
            })

            if (!res.ok) {
                let msg = "Google authentication failed. Please try again."
                try {
                    const data = await res.json()
                    if (data?.detail) msg = data.detail
                } catch (err) {
                    // keep default
                }
                throw new Error(msg)
            }

            const data = await res.json()
            const token = data?.access_token
            if (!token) throw new Error("Missing access token")

            localStorage.setItem("jwt", token)
            if (data.refresh_token) {
                localStorage.setItem("refresh_token", data.refresh_token)
            }
            router.push("/dashboard")
        } catch (error: any) {
            const msg = error?.message || "Google authentication failed. Please try again."
            setErrors({ submit: msg })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        // Reset form on mount
        setFormData({ email: "", password: "", confirmPassword: "", name: "" })
        setErrors({})

        // Initialize Google Sign-In (only if client ID is configured)
        const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
        const initializeGoogle = () => {
            if ((window as any).google && googleClientId) {
                (window as any).google.accounts.id.initialize({
                    client_id: googleClientId,
                    callback: handleGoogleAuth
                });
                (window as any).google.accounts.id.renderButton(
                    document.getElementById("google-signin-button"),
                    { theme: "outline", size: "large", width: "100%" }
                );
            }
        }

        const script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
        if (script) {
            script.addEventListener('load', initializeGoogle);
        }

        // If script is already loaded
        if ((window as any).google) {
            initializeGoogle();
        }

        return () => {
            if (script) {
                script.removeEventListener('load', initializeGoogle);
            }
        }
    }, [])

    const toggleView = () => {
        setView(prev => prev === "login" ? "register" : "login")
        setErrors({})
        setFormData({ email: "", password: "", confirmPassword: "", name: "" })
    }

    return (
        <>
            <Navbar />
            <div className={styles.container}>
                {/* Animated Background - Reduced opacity for cleaner look */}
                <div className={styles.backgroundGlow}>
                    <div className={styles.glowBlob} />
                    <div className={styles.glowBlob2} />
                    <div className={styles.glowBlob3} />
                </div>

                <div className={styles.contentWrapper}>
                    {/* Left Side - Branding */}
                    <div className={styles.brandSection}>
                        <div className={styles.brandLogo}>
                            <img src="/logo.png" alt="NeuroRouter" className="h-10 w-auto" />
                        </div>
                        <h1 className={styles.brandTitle}>
                            AI-Powered Development Platform
                        </h1>
                        <p className={styles.brandSubtitle}>
                            Build, deploy, and scale AI applications with our comprehensive toolkit.
                            Join thousands of developers building the future.
                        </p>
                        <div className={styles.featuresList}>
                            <div className={styles.feature}>
                                <div className={styles.featureIcon}>✨</div>
                                <span>Enterprise-grade security</span>
                            </div>
                            <div className={styles.feature}>
                                <div className={styles.featureIcon}>⚡</div>
                                <span>High-performance APIs</span>
                            </div>
                            <div className={styles.feature}>
                                <div className={styles.featureIcon}>🌐</div>
                                <span>Global infrastructure</span>
                            </div>
                        </div>
                    </div>

                    {/* Right Side - Auth Card */}
                    <div className={styles.authSection}>
                        <Card className={styles.authCard}>
                            <CardHeader className={styles.cardHeader}>
                                <CardTitle className={styles.cardTitle}>
                                    {view === "login" ? "Welcome Back" : "Create Account"}
                                </CardTitle>
                                <CardDescription className={styles.cardDescription}>
                                    {view === "login"
                                        ? "Sign in to access your NeuroRouter dashboard"
                                        : "Start building with NeuroRouter today"
                                    }
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {errors.submit && (
                                    <Alert variant="destructive" className="mb-4 bg-red-50 border-red-200 text-red-600">
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertDescription>{errors.submit}</AlertDescription>
                                    </Alert>
                                )}

                                <div id="google-signin-button" className="w-full h-10 flex justify-center"></div>

                                <div className={styles.separator}>
                                    <span>OR</span>
                                </div>

                                <form onSubmit={handleAuth} className="space-y-4" autoComplete="off">
                                    {view === "register" && (
                                        <div className="space-y-2">
                                            <Label htmlFor="register-name" className={styles.label}>
                                                <User className={styles.labelIcon} />
                                                Full Name
                                            </Label>
                                            <Input
                                                id="register-name"
                                                type="text"
                                                placeholder="John Doe"
                                                className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-blue-500"
                                                value={formData.name}
                                                onChange={handleChange}
                                                disabled={loading}
                                            />
                                            {errors.name && (
                                                <p className={styles.errorText}>
                                                    <AlertCircle className="w-3 h-3" />
                                                    {errors.name}
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        <Label htmlFor="email" className={styles.label}>
                                            <Mail className={styles.labelIcon} />
                                            Email Address
                                        </Label>
                                        <Input
                                            id={view === "login" ? "login-email" : "register-email"}
                                            type="email"
                                            placeholder="name@example.com"
                                            className="bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-blue-500"
                                            value={formData.email}
                                            onChange={handleChange}
                                            disabled={loading}
                                        />
                                        {errors.email && (
                                            <p className={styles.errorText}>
                                                <AlertCircle className="w-3 h-3" />
                                                {errors.email}
                                            </p>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <Label htmlFor="password" className={styles.label}>
                                                <Lock className={styles.labelIcon} />
                                                Password
                                            </Label>
                                            {view === "login" && (
                                                <button
                                                    type="button"
                                                    className={styles.forgotPassword}
                                                    tabIndex={-1}
                                                >
                                                    Forgot password?
                                                </button>
                                            )}
                                        </div>
                                        <div className="relative">
                                            <Input
                                                id={view === "login" ? "login-password" : "register-password"}
                                                type={showPassword ? "text" : "password"}
                                                className={`bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-blue-500 pr-10 ${styles.hidePasswordToggle}`}
                                                value={formData.password}
                                                onChange={handleChange}
                                                disabled={loading}
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="absolute right-0 top-0 h-full px-3 text-slate-400 hover:text-slate-600 hover:bg-transparent"
                                                onClick={() => setShowPassword(!showPassword)}
                                                disabled={loading}
                                            >
                                                {showPassword ? (
                                                    <EyeOff className="h-4 w-4" />
                                                ) : (
                                                    <Eye className="h-4 w-4" />
                                                )}
                                            </Button>
                                        </div>
                                        {errors.password && (
                                            <p className={styles.errorText}>
                                                <AlertCircle className="w-3 h-3" />
                                                {errors.password}
                                            </p>
                                        )}
                                    </div>

                                    {view === "register" && (
                                        <div className="space-y-2">
                                            <Label htmlFor="confirm-password" className={styles.label}>
                                                <Lock className={styles.labelIcon} />
                                                Confirm Password
                                            </Label>
                                            <div className="relative">
                                                <Input
                                                    id="confirm-password"
                                                    type={showConfirmPassword ? "text" : "password"}
                                                    className={`bg-white border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-blue-500 pr-10 ${styles.hidePasswordToggle}`}
                                                    value={formData.confirmPassword}
                                                    onChange={handleChange}
                                                    disabled={loading}
                                                />
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="absolute right-0 top-0 h-full px-3 text-slate-400 hover:text-slate-600 hover:bg-transparent"
                                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                                    disabled={loading}
                                                >
                                                    {showConfirmPassword ? (
                                                        <EyeOff className="h-4 w-4" />
                                                    ) : (
                                                        <Eye className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </div>
                                            {errors.confirmPassword && (
                                                <p className={styles.errorText}>
                                                    <AlertCircle className="w-3 h-3" />
                                                    {errors.confirmPassword}
                                                </p>
                                            )}
                                        </div>
                                    )}

                                    <Button
                                        type="submit"
                                        className={styles.submitButton}
                                        disabled={loading}
                                    >
                                        {loading ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                {view === "login" ? "Signing in..." : "Creating account..."}
                                            </>
                                        ) : (
                                            view === "login" ? "Sign In" : "Create Account"
                                        )}
                                    </Button>
                                </form>
                            </CardContent>
                            <CardFooter className="flex justify-center border-t border-slate-100 pt-6 mt-2">
                                <p className="text-sm text-slate-500">
                                    {view === "login" ? "Don't have an account? " : "Already have an account? "}
                                    <button
                                        onClick={toggleView}
                                        className="font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors focus:outline-none focus:underline"
                                    >
                                        {view === "login" ? "Sign up" : "Sign in"}
                                    </button>
                                </p>
                            </CardFooter>
                        </Card>
                    </div>
                </div>
            </div>
            <Footer />
        </>
    )
}
