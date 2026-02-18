'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface User {
    id: number
    rut: string
    name: string
    role: string
}

interface SessionState {
    sessionId: number | null
    userId: number | null
    status: 'OPEN' | 'CLOSED' | 'UNKNOWN'
    startAmount: number
    startTime: string | null

    // Auth
    token: string | null
    user: User | null

    setSession: (id: number, amount: number, time: string, userId: number) => void
    closeSession: () => void
    setStatus: (status: 'OPEN' | 'CLOSED' | 'UNKNOWN') => void

    login: (token: string, user: User) => void
    logout: () => void
}

export const useSessionStore = create<SessionState>()(
    persist(
        (set) => ({
            sessionId: null,
            userId: null,
            status: 'UNKNOWN',
            startAmount: 0,
            startTime: null,
            token: null,
            user: null,

            setSession: (id, amount, time, userId) =>
                set({
                    sessionId: id,
                    status: 'OPEN',
                    startAmount: amount,
                    startTime: time,
                    userId: userId,
                }),

            closeSession: () =>
                set({
                    sessionId: null,
                    status: 'CLOSED',
                    startAmount: 0,
                    startTime: null,
                    // userId: null // Keep userId if we want to remember who was last
                }),

            setStatus: (status) => set({ status }),

            login: (token, user) => set({ token, user }),
            logout: () => set({ token: null, user: null, sessionId: null, status: 'UNKNOWN' }),
        }),
        {
            name: 'torn-session',
        }
    )
)
