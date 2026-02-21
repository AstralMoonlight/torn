import axios, { AxiosError } from 'axios'

const api = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000',
    headers: {
        'Content-Type': 'application/json',
    },
})

/** Mensaje amigable para errores de API (red, 4xx, 5xx). */
export function getApiErrorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'response' in error) {
        const err = error as AxiosError & { response: { status: number } }
        const status = err.response?.status

        if (status === 401) return 'Credenciales inválidas o sesión expirada.'
        if (status === 403) return 'No tienes permisos para realizar esta acción.'
        if (status === 404) return 'El recurso solicitado no existe.'
        if (status === 422) return 'Los datos ingresados no son válidos.'
        if (status >= 500) return 'Error interno del servidor. Inténtalo más tarde.'
    }

    if (error && typeof error === 'object' && 'code' in error) {
        const err = error as AxiosError & { code?: string }
        if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') {
            return 'No se pudo conectar al servidor. Revisa tu conexión.'
        }
    }

    return fallback
}

// Response interceptor for error handling
api.interceptors.response.use(
    (response) => response,
    (error) => {
        // Redirigir al login si el token expira (401) fuera del flujo de autenticación
        const status = error.response?.status
        const isLoginRequest = error.config?.url?.includes('/auth/login')

        if (status === 401 && !isLoginRequest) {
            console.warn('[API] Token expirado o inválido. Cerrando sesión...')
            localStorage.removeItem('torn-session')
            window.location.href = '/login'
        }

        return Promise.reject(error)
    }
)

// Request interceptor to add auth token and tenant header
api.interceptors.request.use((config) => {
    try {
        const sessionStr = localStorage.getItem('torn-session')
        if (sessionStr) {
            const { state } = JSON.parse(sessionStr)
            if (state.token) {
                config.headers.Authorization = `Bearer ${state.token}`
            }
            if (state.selectedTenantId) {
                config.headers['X-Tenant-ID'] = state.selectedTenantId.toString()
            }
        }
    } catch (err) {
        console.error('Error reading token/tenant from localStorage', err)
    }
    return config
})

export default api
