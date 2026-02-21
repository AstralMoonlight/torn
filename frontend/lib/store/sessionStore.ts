'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface User {
    id: number
    rut: string
    name: string
    full_name?: string
    is_superuser: boolean
    email?: string
    role: string
    role_obj?: {
        permissions: Record<string, boolean>
    }
}

export interface AvailableTenant {
    id: number
    name: string
    rut: string
    role_name: string
    is_active: boolean
    max_users: number
    permissions?: Record<string, boolean>
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
    availableTenants: AvailableTenant[]
    selectedTenantId: number | null

    setSession: (id: number, amount: number, time: string, userId: number) => void
    closeSession: () => void
    setStatus: (status: 'OPEN' | 'CLOSED' | 'UNKNOWN') => void

    login: (token: string, user: User, tenants: AvailableTenant[]) => void
    selectTenant: (tenantId: number) => void
    logout: () => void
    syncSession: (user: User, tenants: AvailableTenant[]) => void
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
            availableTenants: [],
            selectedTenantId: null,

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

            login: (token, user, tenants) => set({
                token,
                user,
                availableTenants: tenants,
                // Solo auto-seleccionar si hay exactamente uno Y está activo
                selectedTenantId: (tenants.length === 1 && tenants[0].is_active) ? tenants[0].id : null
            }),

            selectTenant: (tenantId) => set({ selectedTenantId: tenantId }),

            logout: () => set({
                token: null,
                user: null,
                availableTenants: [],
                selectedTenantId: null,
                sessionId: null,
                status: 'UNKNOWN'
            }),

            syncSession: (user, tenants) => set({
                user,
                availableTenants: tenants
            }),
        }),
        {
            name: 'torn-session',
        }
    )
)
