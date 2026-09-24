import axios, { AxiosError } from 'axios'

const api = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
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

/**
 * Código HTTP de un error de la API, si lo tiene.
 *
 * Evita repetir `(err as { response?: { status?: number } })?.response?.status`
 * o, peor, tipar el `catch` como `any`.
 */
export function getApiErrorStatus(error: unknown): number | undefined {
    if (error && typeof error === 'object' && 'response' in error) {
        const err = error as AxiosError
        return err.response?.status
    }
    return undefined
}

/**
 * Mensaje `detail` que devuelve FastAPI en los errores.
 *
 * A diferencia de `getApiErrorMessage`, que da un texto genérico según el
 * código, esto entrega la explicación concreta del backend ("Stock insuficiente
 * para ...", "No hay folios disponibles ..."), que suele ser lo que el usuario
 * necesita leer.
 *
 * @param error Error capturado.
 * @param fallback Texto si el error no trae `detail`.
 */
export function getApiErrorDetail(error: unknown, fallback: string): string {
    if (error && typeof error === 'object' && 'response' in error) {
        const err = error as AxiosError<{ detail?: unknown }>
        const detail = err.response?.data?.detail
        if (typeof detail === 'string' && detail.trim()) return detail
        // FastAPI devuelve una lista de errores en las respuestas 422.
        if (Array.isArray(detail) && detail.length > 0) {
            const primero = detail[0]
            if (primero && typeof primero === 'object' && 'msg' in primero) {
                return String((primero as { msg: unknown }).msg)
            }
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

/**
 * Descarga un recurso protegido (PDF/HTML de impresión) como blob y devuelve
 * una URL local para abrirlo o imprimirlo.
 *
 * Los endpoints de impresión (`/sales/{id}/pdf`, `/purchases/{id}/pdf`)
 * requieren `Authorization` y `X-Tenant-ID`. Un `<a href>` o un `fetch()`
 * directo a esa URL no los envía (esos headers sólo los agrega el
 * interceptor de `api`), así que el backend responde 401 "Not
 * authenticated". Pasar por `api.get` con `responseType: 'blob'` sí los
 * incluye.
 *
 * El caller es responsable de revocar la URL (`URL.revokeObjectURL`) cuando
 * ya no la necesite.
 */
export async function fetchBlobUrl(path: string): Promise<string> {
    return (await fetchBlob(path)).url
}

/**
 * Abre el diálogo de impresión de un PDF (con su vista previa).
 *
 * Un PDF abierto en una pestaña no puede imprimirse solo, a diferencia de los
 * HTML de impresión, que llaman a `window.print()` al cargar. Se carga en un
 * iframe invisible del mismo origen (blob:) y se imprime desde ahí. No puede ser
 * `display: none`: Chrome no carga el visor de PDF en un iframe oculto así.
 * Si el navegador no lo permite, se abre en una pestaña.
 */
export function printPdf(url: string): void {
    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0'
    iframe.onload = () => {
        // El visor de PDF termina de montarse un poco después del onload.
        setTimeout(() => {
            try {
                iframe.contentWindow?.focus()
                iframe.contentWindow?.print()
            } catch {
                window.open(url, '_blank')
            }
        }, 500)
    }
    iframe.src = url
    document.body.appendChild(iframe)
    setTimeout(() => {
        iframe.remove()
        URL.revokeObjectURL(url)
    }, 120000)
}

/** Como `fetchBlobUrl`, pero dice además si es un PDF o un HTML de impresión. */
export async function fetchBlob(path: string): Promise<{ url: string; isPdf: boolean }> {
    const response = await api.get<Blob>(path, { responseType: 'blob' })
    return { url: URL.createObjectURL(response.data), isPdf: response.data.type === 'application/pdf' }
}

export default api
