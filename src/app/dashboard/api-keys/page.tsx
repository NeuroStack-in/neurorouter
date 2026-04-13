"use client"

import { AlertCircle } from "lucide-react"
import styles from "../dashboard.module.css"
import { ApiKeysTable } from "@/components/dashboard/api-keys-table"
import { CreateApiKeyModal } from "@/components/dashboard/create-key-modal"
import { ApiKey, apiKeyService } from "@/services/api-keys"
import { useEffect, useState } from "react"


export default function ApiKeysPage() {
    const [keys, setKeys] = useState<ApiKey[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchKeys = async () => {
        setLoading(true)
        try {
            const data = await apiKeyService.list()
            setKeys(data)
            setError(null)
        } catch (err: any) {
            console.error("Failed to fetch keys:", err)
            setError("Failed to load API keys. Please try again.")
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchKeys()
    }, [])

    return (
        <div className={styles.container}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className={styles.pageHeader} style={{ marginBottom: 0 }}>
                    <h2 className={styles.pageTitle}>API Keys</h2>
                    <p className={styles.pageDescription}>
                        Manage your secret keys for accessing the NeuroRouter API.
                    </p>
                </div>

                <CreateApiKeyModal onSuccess={fetchKeys} />
            </div>

            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 text-sm">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                </div>
            )}

            <ApiKeysTable keys={keys} loading={loading} onRevoke={fetchKeys} />

            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 flex items-start gap-3 mt-8">
                <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                <div className="text-sm text-blue-800">
                    <p className="font-medium mb-1">Security Best Practices</p>
                    <p className="opacity-90">Do not share your API keys with others or expose them in client-side code (browsers, apps). Rotate your keys periodically to ensure security.</p>
                </div>
            </div>
        </div>
    )
}

