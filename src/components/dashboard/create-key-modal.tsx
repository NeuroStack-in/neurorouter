import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Check, Copy, Plus, Loader2 } from "lucide-react"
import { useState } from "react"
import { apiKeyService, CreateApiKeyResponse } from "@/services/api-keys"

interface CreateApiKeyModalProps {
    onSuccess: () => void
}

export function CreateApiKeyModal({ onSuccess }: CreateApiKeyModalProps) {
    const [open, setOpen] = useState(false)
    const [name, setName] = useState("")
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<CreateApiKeyResponse | null>(null)
    const [copied, setCopied] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleCreate = async () => {
        if (!name.trim()) return
        setLoading(true)
        setError(null)
        try {
            const data = await apiKeyService.create(name)
            setResult(data)
            onSuccess()
        } catch (err: any) {
            setError(err.message || "Failed to create key")
        } finally {
            setLoading(false)
        }
    }

    const handleClose = () => {
        setOpen(false)
        setResult(null)
        setName("")
        setCopied(false)
        setError(null)
    }

    const copyToClipboard = () => {
        if (result?.api_key) {
            navigator.clipboard.writeText(result.api_key)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(val) => !val && handleClose()}>
            <DialogTrigger asChild>
                <Button className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm" onClick={() => setOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create New Key
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                {!result ? (
                    <>
                        <DialogHeader>
                            <DialogTitle>Create new API key</DialogTitle>
                            <DialogDescription>
                                Give your key a name to easily identify it later (e.g., "Production App").
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <label htmlFor="key-name" className="text-sm font-medium text-slate-700">
                                    Key Name
                                </label>
                                <Input
                                    id="key-name"
                                    placeholder="e.g. My Awesome App"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    autoFocus
                                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                                />
                                {error && <p className="text-sm text-red-600">{error}</p>}
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={handleClose}>Cancel</Button>
                            <Button onClick={handleCreate} disabled={!name.trim() || loading}>
                                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Create Key"}
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-green-600">
                                <Check className="h-5 w-5" />
                                Key Created Successfully
                            </DialogTitle>
                            <DialogDescription>
                                Please copy this key now. You won't be able to see it again!
                            </DialogDescription>
                        </DialogHeader>
                        <div className="bg-slate-50 p-4 rounded-md border border-slate-200 my-4 relative group">
                            <code className="text-sm font-mono break-all text-slate-800">
                                {result.api_key}
                            </code>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute top-2 right-2 h-8 w-8 bg-white shadow-sm hover:bg-slate-100"
                                onClick={copyToClipboard}
                            >
                                {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                            </Button>
                        </div>
                        <div className="bg-yellow-50 border border-yellow-100 rounded p-3 text-sm text-yellow-800 mb-2">
                            This API key will not be shown again. Please store it securely.
                        </div>
                        <DialogFooter>
                            <Button onClick={handleClose}>Done</Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
