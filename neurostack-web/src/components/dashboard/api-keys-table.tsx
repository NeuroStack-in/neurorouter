import { Button } from "@/components/ui/button"
import { Key, Trash2, Calendar, Activity, AlertTriangle } from "lucide-react"
import { ApiKey, apiKeyService } from "@/services/api-keys"
import { useState } from "react"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface ApiKeysTableProps {
    keys: ApiKey[]
    loading: boolean
    onRevoke: () => void
}

export function ApiKeysTable({ keys, loading, onRevoke }: ApiKeysTableProps) {
    const [revokingId, setRevokingId] = useState<string | null>(null)

    const handleRevoke = async () => {
        if (!revokingId) return
        try {
            await apiKeyService.revoke(revokingId)
            onRevoke()
        } catch (error) {
            console.error("Failed to revoke key:", error)
        } finally {
            setRevokingId(null)
        }
    }

    if (loading && keys.length === 0) {
        return (
            <div className="space-y-4">
                {[1, 2].map((i) => (
                    <div key={i} className="h-24 bg-slate-50 rounded-lg animate-pulse" />
                ))}
            </div>
        )
    }

    if (keys.length === 0) {
        return (
            <div className="text-center py-12 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                <Key className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <h3 className="text-sm font-medium text-slate-900">No API keys found</h3>
                <p className="text-sm text-slate-500 mt-1">Create a new key to get started.</p>
            </div>
        )
    }

    return (
        <div className="space-y-4">
            {keys.map((key) => (
                <div
                    key={key.id}
                    className="bg-white rounded-xl border border-slate-200 shadow-sm transition-all hover:shadow-md p-5 flex flex-col md:flex-row md:items-center gap-4"
                >
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1.5">
                            <div className="p-2 bg-blue-50 rounded-lg">
                                <Key className="h-4 w-4 text-blue-600" />
                            </div>
                            <div>
                                <h3 className="font-semibold text-slate-900">{key.name}</h3>
                            </div>
                            {!key.is_active && (
                                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">
                                    Revoked
                                </span>
                            )}
                        </div>
                        <code className="text-sm text-slate-500 font-mono pl-11 block">
                            {key.key_prefix}••••••••••••••••
                        </code>
                    </div>

                    <div className="flex items-center gap-6 md:mr-4 pl-11 md:pl-0">
                        <div className="flex flex-col items-start md:items-end">
                            <span className="text-slate-400 text-xs uppercase tracking-wide font-semibold flex items-center gap-1 mb-1">
                                <Activity className="h-3 w-3" /> Last used
                            </span>
                            <span className="text-slate-700 text-sm font-medium">
                                {key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : "Never"}
                            </span>
                        </div>

                        <div className="flex flex-col items-start md:items-end">
                            <span className="text-slate-400 text-xs uppercase tracking-wide font-semibold flex items-center gap-1 mb-1">
                                <Calendar className="h-3 w-3" /> Created
                            </span>
                            <span className="text-slate-700 text-sm font-medium">
                                {new Date(key.created_at).toLocaleDateString()}
                            </span>
                        </div>
                    </div>

                    <div className="flex justify-end pt-2 md:pt-0 border-t md:border-0 border-slate-100">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            onClick={() => setRevokingId(key.id)}
                            disabled={!key.is_active}
                        >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Revoke</span>
                        </Button>
                    </div>
                </div>
            ))}

            <AlertDialog open={!!revokingId} onOpenChange={(open: boolean) => !open && setRevokingId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2 text-red-600">
                            <AlertTriangle className="h-5 w-5" />
                            Revoke API Key?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to revoke this API key? This action cannot be undone and any applications using this key will stop working immediately.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleRevoke}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            Revoke Key
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
