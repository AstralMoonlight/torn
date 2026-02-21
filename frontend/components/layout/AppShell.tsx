'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Sidebar from './Sidebar'
import { Toaster } from '@/components/ui/toaster'
import MobileNav from './MobileNav'
import { useSessionStore } from '@/lib/store/sessionStore'
import { getSessionStatus } from '@/services/cash'
import { validateSession } from '@/services/auth'

// Definición de grupos para el guardián de rutas
const NAV_PERMISSION_MAP = [
    { label: 'Dashboard', path: '/dashboard' },
    { label: 'Terminal POS', path: '/pos' },
    { label: 'Caja', path: '/caja' },
    { label: 'Productos', path: '/inventario' },
    { label: 'Marcas', path: '/marcas' },
    { label: 'Compras', path: '/compras' },
    { label: 'Clientes', path: '/clientes' },
    { label: 'Proveedores', path: '/proveedores' },
    { label: 'Vendedores', path: '/vendedores' },
    { label: 'Historial', path: '/historial' },
    { label: 'Revisión de Caja', path: '/caja-revision' },
    { label: 'Reportes de Ventas', path: '/reporte-diario' },
    { label: 'Configuración', path: '/configuracion' },
    { label: 'Roles y Permisos', path: '/vendedores/roles' },
]

export default function AppShell({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()

    const setSession = useSessionStore((s) => s.setSession)
    const setStatus = useSessionStore((s) => s.setStatus)
    const syncSession = useSessionStore((s) => s.syncSession)
    const userId = useSessionStore((s) => s.userId)
    const token = useSessionStore((s) => s.token)
    const userPayload = useSessionStore((s) => s.user)
    const availableTenants = useSessionStore((s) => s.availableTenants)
    const selectedTenantId = useSessionStore((s) => s.selectedTenantId)

    const [isMounted, setIsMounted] = useState(false)

    useEffect(() => {
        setIsMounted(true)
    }, [])

    // Auth & Route Protection
    useEffect(() => {
        if (!isMounted) return

        if (!token && pathname !== '/login') {
            router.push('/login')
            return
        }

        if (token && pathname === '/login') {
            if (!selectedTenantId) {
                if ((userPayload as any)?.is_superuser) {
                    router.push('/saas-admin')
                } else {
                    router.push('/select-tenant')
                }
            } else {
                router.push('/pos')
            }
            return
        }

        if (token && selectedTenantId && pathname !== '/select-tenant' && !pathname.startsWith('/saas-admin')) {
            const currentTenant = (availableTenants as any[]).find(t => t.id === selectedTenantId)
            if (currentTenant && !currentTenant.is_active) {
                console.warn('[RouteGuard] Selected tenant is inactive. Redirecting to /select-tenant')
                router.push('/select-tenant')
                return
            }
        }

        if (token && !selectedTenantId && pathname !== '/select-tenant' && !pathname.startsWith('/saas-admin')) {
            if ((userPayload as any)?.is_superuser) {
                router.push('/saas-admin')
            } else {
                router.push('/select-tenant')
            }
            return
        }

        // Dynamic Route Guard
        if (token && pathname !== '/login' && pathname !== '/select-tenant' && !pathname.startsWith('/saas-admin') && pathname !== '/pos' && pathname !== '/caja') {
            const user = (userPayload as any)
            const permissions = user?.role_obj?.permissions || {}
            const isAdmin = user?.role === 'ADMINISTRADOR'

            if (!isAdmin) {
                // Check if the current path starts with any of our restricted paths
                const restrictedMenu = NAV_PERMISSION_MAP.find(m =>
                    pathname === m.path || pathname.startsWith(m.path + '/')
                )

                if (restrictedMenu && permissions[restrictedMenu.label] === false) {
                    console.warn(`[RouteGuard] Access denied for ${pathname}. Redirecting to /access-denied`)
                    router.push('/access-denied')
                }
            }
        }
    }, [token, selectedTenantId, pathname, router, isMounted, userPayload, availableTenants])

    // Sincronización global del perfil y empresas al montar la app
    useEffect(() => {
        if (!token) return

        validateSession()
            .then(data => {
                syncSession(data.user, data.available_tenants)
            })
            .catch(err => console.error('[AppShell] Error syncing profile:', err))
    }, [token, syncSession])

    // Sync cash session with backend on mount
    useEffect(() => {
        if (!token || !userId || !selectedTenantId) return

        getSessionStatus(userId)
            .then((session) => {
                if (session.status === 'OPEN') {
                    setSession(session.id, parseFloat(session.start_amount), session.start_time, session.user_id)
                } else {
                    setStatus('CLOSED')
                }
            })
            .catch(() => {
                setStatus('CLOSED')
            })
    }, [setSession, setStatus, userId, token, selectedTenantId])

    if (!isMounted) return null // Prevent hydration mismatch

    if (pathname === '/login' || pathname === '/select-tenant' || pathname.startsWith('/saas-admin')) {
        return <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950">{children}</main>
    }

    if (!token || !selectedTenantId) return null // Wait for redirect

    return (
        <div className="flex h-[100dvh] overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-auto bg-neutral-50 dark:bg-neutral-900 pb-16 md:pb-0">
                {children}
            </main>
            <MobileNav />
            <Toaster />
        </div>
    )
}
