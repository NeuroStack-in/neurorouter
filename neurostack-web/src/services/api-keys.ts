import { api } from '@/lib/api'

export interface ApiKey {
    id: string
    name: string
    key_prefix: string
    last_used_at: string | null
    created_at: string
    is_active: boolean
}

export interface CreateApiKeyResponse {
    api_key: string         // The full secret key (shown only once)
    key_info: ApiKey
}

export const apiKeyService = {
    list: () => api.get('/api-keys') as Promise<ApiKey[]>,
    create: (name: string) => api.post('/api-keys', { name }) as Promise<CreateApiKeyResponse>,
    revoke: (id: string) => api.delete(`/api-keys/${id}`),
}
