import axios from 'axios'
import { useSessionStore } from '@/lib/store/sessionStore'

const api = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000',
    headers: {
        'Content-Type': 'application/json',
    },
})

// Request interceptor to add token
api.interceptors.request.use(
    (config) => {
        const token = useSessionStore.getState().token
        if (token) {
            config.headers.Authorization = `Bearer ${token}`
        }
        return config
    },
    (error) => Promise.reject(error)
)

// Response interceptor for error handling
api.interceptors.response.use(
    (response) => response,
    (error) => {
        // Handle 401 globally if needed
        if (error.response?.status === 401) {
            useSessionStore.getState().clearSession()
            // Optional: Redirect to login
        }
        return Promise.reject(error)
    }
)

export default api
