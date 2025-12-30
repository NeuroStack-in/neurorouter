import { redirect } from 'next/navigation'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:7860"

interface FetchOptions extends RequestInit {
    headers?: Record<string, string>
}

export class ApiError extends Error {
    status: number
    constructor(message: string, status: number) {
        super(message)
        this.status = status
    }
}

async function fetchWithAuth(endpoint: string, options: FetchOptions = {}) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('jwt') : null

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...options.headers,
    }

    if (token) {
        headers['Authorization'] = `Bearer ${token}`
    }

    const config = {
        ...options,
        headers,
    }

    try {
        console.log(`[API] Fetching: ${API_BASE}${endpoint}`)
        const response = await fetch(`${API_BASE}${endpoint}`, config)

        if (response.status === 401) {
            if (typeof window !== 'undefined') {
                localStorage.removeItem('jwt')
                window.location.href = '/auth?tab=login'
            }
            throw new ApiError('Unauthorized', 401)
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new ApiError(errorData.detail || 'API request failed', response.status)
        }

        // For DELETE requests or empty responses
        if (response.status === 204) {
            return null
        }

        return response.json()
    } catch (error) {
        if (error instanceof ApiError) throw error
        throw new Error('Network error or server unreachable')
    }
}

export const api = {
    get: (endpoint: string) => fetchWithAuth(endpoint, { method: 'GET' }),
    post: (endpoint: string, body: any) => fetchWithAuth(endpoint, { method: 'POST', body: JSON.stringify(body) }),
    put: (endpoint: string, body: any) => fetchWithAuth(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (endpoint: string) => fetchWithAuth(endpoint, { method: 'DELETE' }),
}
