const API_BASE = process.env.NEXT_PUBLIC_API_URL!

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

async function tryRefreshToken(): Promise<boolean> {
    if (typeof window === 'undefined') return false
    const refreshToken = localStorage.getItem('refresh_token')
    if (!refreshToken) return false

    try {
        const res = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
        })
        if (res.ok) {
            const data = await res.json()
            if (data.access_token) {
                localStorage.setItem('jwt', data.access_token)
                return true
            }
        }
    } catch {
        // refresh failed
    }
    return false
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
        const response = await fetch(`${API_BASE}${endpoint}`, config)

        if (response.status === 401) {
            // Try refresh token before redirecting
            const refreshed = await tryRefreshToken()
            if (refreshed) {
                // Retry with new token
                const newToken = localStorage.getItem('jwt')
                if (newToken) {
                    headers['Authorization'] = `Bearer ${newToken}`
                }
                const retryResponse = await fetch(`${API_BASE}${endpoint}`, { ...config, headers })
                if (retryResponse.ok) {
                    if (retryResponse.status === 204) return null
                    return retryResponse.json()
                }
            }

            if (typeof window !== 'undefined') {
                localStorage.removeItem('jwt')
                localStorage.removeItem('refresh_token')
                window.location.href = '/auth?tab=login'
            }
            throw new ApiError('Unauthorized', 401)
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new ApiError(errorData.detail || 'API request failed', response.status)
        }

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
    post: (endpoint: string, body?: any) => fetchWithAuth(endpoint, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
    put: (endpoint: string, body: any) => fetchWithAuth(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (endpoint: string) => fetchWithAuth(endpoint, { method: 'DELETE' }),
}

export { API_BASE }
