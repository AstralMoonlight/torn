import axios, { AxiosError } from 'axios'

const api = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
    headers: {
        'Content-Type': 'application/json',
    },
})

/** Mensaje amigable para errores de API (red, 4xx, 5xx). */
export function getApiErrorMessage(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'code' in error) {
        const err = error as AxiosError & { code?: string }
        if (err.code === 'ERR_NETWORK' || err.message === 'Network Error') {
            return 'No se pudo conectar al servidor. ¿Está el backend en marcha? (puerto 8000)'
        }
        if (err.response?.status) {
            return err.response.status >= 500
                ? 'Error del servidor. Vuelve a intentar.'
                : fallback
        }
    }
    return fallback
}

// Response interceptor for error handling
api.interceptors.response.use(
    (response) => response,
    (error) => {
        // Handle 401 globally when auth is implemented
        return Promise.reject(error)
    }
)

export default api
