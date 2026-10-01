'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Usuario global del SaaS, tal como lo devuelven /auth/login y /auth/validate
 * (equivale a SaaSUserOut en el backend: sin rut, name ni role propios -
 * esos campos son del usuario operativo local, no del usuario SaaS). */
interface User {
    id: number
    email: string
    full_name?: string
    is_superuser: boolean
    /** Superusuario sin cargo: tiene todos los permisos y arma el equipo. */
    es_dueno?: boolean
    /** Permisos del panel saas-admin (`backend/app/dependencies/saas.py`). */
    permisos?: string[]
}

export interface AvailableTenant {
    id: number
    name: string
    rut: string
    role_name: string
    is_active: boolean
    max_users: number
    permissions?: Record<string, boolean>
    /** Modo del emisor: CERT (maullín), PROD (palena) o DEV (Desarrollador, sin SII). */
    sii_ambiente?: 'CERT' | 'PROD' | 'DEV'
    /** Para el aviso de pago (`AvisoSuscripcion`). */
    suscripcion_estado?: 'CORTESIA' | 'SIN_PAGO' | 'AL_DIA' | 'POR_VENCER' | 'EN_GRACIA' | 'PRORROGA' | 'SUSPENDIDA'
    suscripcion_vence?: string | null
    prorroga_hasta?: string | null
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
    /** Por qué se cerró la última sesión sin que el usuario lo pidiera; lo muestra el login. */
    motivoCierre: string | null

    setSession: (id: number, amount: number, time: string, userId: number) => void
    closeSession: () => void
    setStatus: (status: 'OPEN' | 'CLOSED' | 'UNKNOWN') => void

    login: (token: string, user: User, tenants: AvailableTenant[]) => void
    selectTenant: (tenantId: number) => void
    logout: (motivo?: string) => void
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
            motivoCierre: null,

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
                motivoCierre: null,
                // Solo auto-seleccionar si hay exactamente uno Y está activo
                selectedTenantId: (tenants.length === 1 && tenants[0].is_active) ? tenants[0].id : null
            }),

            // El turno de caja guardado es de la empresa anterior: AppShell lo vuelve a pedir.
            selectTenant: (tenantId) => set({ selectedTenantId: tenantId, sessionId: null, status: 'UNKNOWN' }),

            logout: (motivo) => set({
                motivoCierre: motivo ?? null,
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

/** Administrador de la empresa elegida, o superusuario del SaaS (como `es_admin` del backend). */
export const useEsAdmin = () => useSessionStore((s) =>
    s.user?.is_superuser === true ||
    s.availableTenants.find((t) => t.id === s.selectedTenantId)?.role_name === 'ADMINISTRADOR')

/** El usuario tiene este permiso del panel saas-admin. */
export const usePermisoSaas = (permiso: string) => useSessionStore((s) => s.user?.permisos?.includes(permiso) === true)
