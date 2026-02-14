import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SessionState {
    token: string | null
    user: string | null
    setSession: (token: string, user: string) => void
    clearSession: () => void
    isAuthenticated: () => boolean
}

export const useSessionStore = create<SessionState>()(
    persist(
        (set, get) => ({
            token: null,
            user: null,
            setSession: (token, user) => set({ token, user }),
            clearSession: () => set({ token: null, user: null }),
            isAuthenticated: () => !!get().token,
        }),
        {
            name: 'session-storage',
        }
    )
)
