'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SessionState {
    sessionId: number | null
    status: 'OPEN' | 'CLOSED' | 'UNKNOWN'
    startAmount: number
    startTime: string | null

    setSession: (id: number, amount: number, time: string) => void
    closeSession: () => void
    setStatus: (status: 'OPEN' | 'CLOSED' | 'UNKNOWN') => void
}

export const useSessionStore = create<SessionState>()(
    persist(
        (set) => ({
            sessionId: null,
            status: 'UNKNOWN',
            startAmount: 0,
            startTime: null,

            setSession: (id, amount, time) =>
                set({
                    sessionId: id,
                    status: 'OPEN',
                    startAmount: amount,
                    startTime: time,
                }),

            closeSession: () =>
                set({
                    sessionId: null,
                    status: 'CLOSED',
                    startAmount: 0,
                    startTime: null,
                }),

            setStatus: (status) => set({ status }),
        }),
        {
            name: 'torn-session',
        }
    )
)
