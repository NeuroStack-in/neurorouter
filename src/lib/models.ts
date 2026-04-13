export interface Model {
    id: string
    object: string
    created: number
    owned_by: string
    context_window?: number
    max_output_tokens?: number
    description?: string

    // Explicit infrastructure label for UI safety
    infrastructure: string
}

export interface ModelMetadata {
    context_window: number
    max_output_tokens: number
    description?: string
}

/**
 * Optional UI metadata enrichment.
 * Backend values always take priority.
 */
export const MODEL_METADATA: Record<string, ModelMetadata> = {
    "llama-3.3-70b-versatile": {
        context_window: 128000,
        max_output_tokens: 32768,
        description: "High-performance open model suitable for complex reasoning and coding tasks."
    },
    "llama-3.1-8b-instant": {
        context_window: 128000,
        max_output_tokens: 8192,
        description: "Fast, lightweight model optimized for chat and simple tasks."
    },
    "mixtral-8x7b-32768": {
        context_window: 32768,
        max_output_tokens: 32768,
        description: "Sparse Mixture-of-Experts model with high throughput."
    },
    "gemma2-9b-it": {
        context_window: 8192,
        max_output_tokens: 8192,
        description: "Google's open model optimized for instruction following."
    },
    "whisper-large-v3": {
        context_window: 0,
        max_output_tokens: 0,
        description: "State-of-the-art automatic speech recognition model."
    }
}

/**
 * Public fallback list (used only if backend is unreachable).
 */
const FALLBACK_MODELS = [
    { "id": "whisper-large-v3-turbo", "object": "model", "created": 1728413088, "owned_by": "OpenAI", "active": true, "context_window": 448, "public_apps": null, "max_completion_tokens": 448 },
    { "id": "qwen/qwen3-32b", "object": "model", "created": 1748396646, "owned_by": "Alibaba Cloud", "active": true, "context_window": 131072, "public_apps": null, "max_completion_tokens": 40960 },
    { "id": "moonshotai/kimi-k2-instruct-0905", "object": "model", "created": 1757046093, "owned_by": "Moonshot AI", "active": true, "context_window": 262144, "public_apps": null, "max_completion_tokens": 16384 },
    { "id": "canopylabs/orpheus-arabic-saudi", "object": "model", "created": 1765926439, "owned_by": "Canopy Labs", "active": true, "context_window": 4000, "public_apps": null, "max_completion_tokens": 50000 },
    { "id": "meta-llama/llama-4-maverick-17b-128e-instruct", "object": "model", "created": 1743877158, "owned_by": "Meta", "active": true, "context_window": 131072, "public_apps": null, "max_completion_tokens": 8192 },
    { "id": "allam-2-7b", "object": "model", "created": 1737672203, "owned_by": "SDAIA", "active": true, "context_window": 4096, "public_apps": null, "max_completion_tokens": 4096 },
    { "id": "meta-llama/llama-prompt-guard-2-86m", "object": "model", "created": 1748632165, "owned_by": "Meta", "active": true, "context_window": 512, "public_apps": null, "max_completion_tokens": 512 },
    { "id": "groq/compound-mini", "object": "model", "created": 1756949707, "owned_by": "Groq", "active": true, "context_window": 131072, "public_apps": null, "max_completion_tokens": 8192 },
    { "id": "llama-3.3-70b-versatile", "object": "model", "created": 1733447754, "owned_by": "Meta", "active": true, "context_window": 131072, "public_apps": null, "max_completion_tokens": 32768 },
    { "id": "openai/gpt-oss-20b", "object": "model", "created": 1754407957, "owned_by": "OpenAI", "active": true, "context_window": 131072, "public_apps": null, "max_completion_tokens": 65536 },
    { "id": "meta-llama/llama-guard-4-12b", "object": "model", "created": 1746743847, "owned_by": "Meta", "active": true, "context_window": 131072, "public_apps": null, "max_completion_tokens": 1024 },
    { "id": "meta-llama/llama-prompt-guard-2-22m", "object": "model", "created": 1748632101, "owned_by": "Meta", "active": true, "context_window": 512, "public_apps": null, "max_completion_tokens": 512 },
    { "id": "openai/gpt-oss-120b", "object": "model", "created": 1754408224, "owned_by": "OpenAI", "active": true, "context_window": 131072, "public_apps": null, "max_completion_tokens": 65536 },
    { "id": "openai/gpt-oss-safeguard-20b", "object": "model", "created": 1761708789, "owned_by": "OpenAI", "active": true, "context_window": 131072, "public_apps": null, "max_completion_tokens": 65536 },
    { "id": "canopylabs/orpheus-v1-english", "object": "model", "created": 1766186316, "owned_by": "Canopy Labs", "active": true, "context_window": 4000, "public_apps": null, "max_completion_tokens": 50000 },
    { "id": "moonshotai/kimi-k2-instruct", "object": "model", "created": 1752435491, "owned_by": "Moonshot AI", "active": true, "context_window": 131072, "public_apps": null, "max_completion_tokens": 16384 },
    { "id": "groq/compound", "object": "model", "created": 1756949530, "owned_by": "Groq", "active": true, "context_window": 131072, "public_apps": null, "max_completion_tokens": 8192 },
    { "id": "llama-3.1-8b-instant", "object": "model", "created": 1693721698, "owned_by": "Meta", "active": true, "context_window": 131072, "public_apps": null, "max_completion_tokens": 131072 },
    { "id": "whisper-large-v3", "object": "model", "created": 1693721698, "owned_by": "OpenAI", "active": true, "context_window": 448, "public_apps": null, "max_completion_tokens": 448 },
    { "id": "meta-llama/llama-4-scout-17b-16e-instruct", "object": "model", "created": 1743874824, "owned_by": "Meta", "active": true, "context_window": 131072, "public_apps": null, "max_completion_tokens": 8192 }
] as const

/**
 * Public model fetch for Docs / frontend display.
 * No authentication required.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL!

/**
 * Public model fetch for Docs / frontend display.
 * Tries /config/models (Go config-service) first, then /v1/models fallback.
 */
export const fetchModels = async (): Promise<Model[]> => {
    // Try the Go config-service first
    try {
        const res = await fetch(`${API_URL}/config/models`, { cache: "no-store" })
        if (res.ok) {
            const models = await res.json()
            if (Array.isArray(models)) {
                return models.map((model: any) => {
                    const meta = MODEL_METADATA[model.id]
                    return {
                        id: model.id,
                        object: "model",
                        created: 1700000000,
                        owned_by: model.provider,
                        context_window: meta?.context_window,
                        max_output_tokens: meta?.max_output_tokens,
                        description: meta?.description || model.display_name,
                        infrastructure: "Self-Hosted in NeuroRouter Infra"
                    }
                }).sort((a: Model, b: Model) => a.id.localeCompare(b.id))
            }
        }
    } catch (error) {
        console.error("Failed to fetch from /config/models:", error)
    }

    // Fallback to /v1/models
    try {
        const res = await fetch(`${API_URL}/v1/models`, { cache: "no-store" })
        if (res.ok) {
            const json = await res.json()
            if (Array.isArray(json.data)) {
                return json.data.map((model: any) => {
                    const meta = MODEL_METADATA[model.id]
                    return {
                        ...model,
                        context_window: model.context_window ?? meta?.context_window,
                        max_output_tokens: model.max_output_tokens ?? model.max_completion_tokens ?? meta?.max_output_tokens,
                        description: meta?.description,
                        infrastructure: "Self-Hosted in NeuroRouter Infra"
                    }
                }).sort((a: Model, b: Model) => a.id.localeCompare(b.id))
            }
        }
    } catch (error) {
        console.error("Failed to fetch from /v1/models:", error)
    }

    // Final fallback
    console.warn("Using fallback model list for Docs display.")
    return FALLBACK_MODELS.map((model) => ({
        ...model,
        max_output_tokens: model.max_completion_tokens,
        description: MODEL_METADATA[model.id]?.description,
        infrastructure: "Self-Hosted in NeuroRouter Infra"
    }))
}
