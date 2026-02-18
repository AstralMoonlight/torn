'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Sidebar from './Sidebar'
import { Toaster } from '@/components/ui/toaster'
import MobileNav from './MobileNav'
import { useSessionStore } from '@/lib/store/sessionStore'
import { getSessionStatus } from '@/services/cash'

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
    const userId = useSessionStore((s) => s.userId)
    const token = useSessionStore((s) => s.token)
    const userPayload = useSessionStore((s) => s.user)

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
            router.push('/pos')
            return
        }

        // Dynamic Route Guard
        if (token && pathname !== '/login' && pathname !== '/pos' && pathname !== '/caja') {
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
    }, [token, pathname, router, isMounted, userPayload])

    // Sync cash session with backend on mount
    useEffect(() => {
        if (!token || !userId) return

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
    }, [setSession, setStatus, userId, token])

    if (!isMounted) return null // Prevent hydration mismatch

    if (pathname === '/login') {
        return <main className="min-h-screen bg-slate-50 dark:bg-slate-950">{children}</main>
    }

    if (!token) return null // Wait for redirect

    return (
        <div className="flex h-[100dvh] overflow-hidden">
            <Sidebar />
            <main className="flex-1 overflow-auto bg-slate-50 dark:bg-slate-900 pb-16 md:pb-0">
                {children}
            </main>
            <MobileNav />
            <Toaster />
        </div>
    )
}
