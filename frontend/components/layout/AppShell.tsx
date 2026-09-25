'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Sidebar from './Sidebar'
import MobileNav from './MobileNav'
import Aviso from './Aviso'
import { useSessionStore } from '@/lib/store/sessionStore'
import { avisar, useUIStore } from '@/lib/store/uiStore'
import { useColorEfectivo, useControlCaja, useSettingsStore } from '@/lib/store/settingsStore'
import { aplicarColor, leerColorUsuario } from '@/lib/colores'
import { getSessionStatus } from '@/services/cash'
import { validateSession } from '@/services/auth'
import { useHydrated } from '@/lib/hooks/useHydrated'

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
    { label: 'Personal', path: '/personal' },
    { label: 'Configuración', path: '/configuracion' },
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

    const isMounted = useHydrated()
    const sinEmpresa = pathname === '/login' || pathname === '/select-tenant' || pathname.startsWith('/saas-admin')

    const cargarSettings = useSettingsStore((s) => s.cargar)
    const limpiarSettings = useSettingsStore((s) => s.limpiar)
    const setColorUsuario = useSettingsStore((s) => s.setColorUsuario)
    const controlCaja = useControlCaja()
    const color = useColorEfectivo()
    const ultimaRuta = useRef<string | null>(null)

    // Auth & Route Protection
    useEffect(() => {
        if (!isMounted) return

        if (!token && pathname !== '/login') {
            router.push('/login')
            return
        }

        if (token && pathname === '/login') {
            if (!selectedTenantId) {
                if (userPayload?.is_superuser) {
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
            const currentTenant = availableTenants.find(t => t.id === selectedTenantId)
            if (currentTenant && !currentTenant.is_active) {
                console.warn('[RouteGuard] Selected tenant is inactive. Redirecting to /select-tenant')
                router.push('/select-tenant')
                return
            }
        }

        if (token && !selectedTenantId && pathname !== '/select-tenant' && !pathname.startsWith('/saas-admin')) {
            if (userPayload?.is_superuser) {
                router.push('/saas-admin')
            } else {
                router.push('/select-tenant')
            }
            return
        }

        // Dynamic Route Guard
        if (token && pathname !== '/login' && pathname !== '/select-tenant' && !pathname.startsWith('/saas-admin') && pathname !== '/pos' && pathname !== '/caja') {
            const user = userPayload
            const currentTenant = availableTenants.find(t => t.id === selectedTenantId)
            // El rol y los permisos son del vínculo tenant-usuario (AvailableTenant),
            // no del usuario SaaS global: éste no tiene rut/role/permissions propios.
            const roleForCurrentTenant = currentTenant?.role_name || ''

            const permissions = currentTenant?.permissions || {}
            const isAdmin = roleForCurrentTenant === 'ADMINISTRADOR' || user?.is_superuser === true

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

    // Ajustes de la empresa (control de caja, color): se recargan al cambiar de empresa.
    useEffect(() => {
        limpiarSettings()
        if (!token || !selectedTenantId) return
        const cargar = () => cargarSettings().catch(() =>
            avisar('No se pudo cargar la configuración de la empresa.', { reintentar: cargar }))
        cargar()
    }, [token, selectedTenantId, cargarSettings, limpiarSettings])

    useEffect(() => {
        setColorUsuario(selectedTenantId && userPayload ? leerColorUsuario(selectedTenantId, userPayload.id) : null)
    }, [selectedTenantId, userPayload, setColorUsuario])

    // Login, selección de empresa y saas-admin van en azul: no hay empresa elegida.
    // Mientras cargan los ajustes queda el color que puso el script de app/layout.tsx.
    useEffect(() => {
        if (sinEmpresa) aplicarColor(null)
        else if (color) aplicarColor(color)
    }, [color, sinEmpresa])

    // El aviso de una página se va al salir de ella. Va antes que el efecto de
    // /caja: si corriera después, borraría en el mismo render el aviso que ese
    // efecto acaba de dejar para la página de destino.
    useEffect(() => {
        const { aviso, cerrarAviso } = useUIStore.getState()
        if (aviso?.ruta && aviso.ruta !== pathname) cerrarAviso()
    }, [pathname])

    // Con el control de caja apagado, /caja no existe: si se entra por URL al abrir
    // el sitio se va al dashboard; si ya se estaba dentro, se vuelve a la página
    // anterior. En los dos casos se explica con un aviso.
    useEffect(() => {
        if (!pathname.startsWith('/caja')) {
            ultimaRuta.current = pathname
            return
        }
        if (controlCaja) return
        const destino = ultimaRuta.current ?? '/dashboard'
        avisar('El control de caja está desactivado. Se activa en Configuración > General.', { tipo: 'info', ruta: destino })
        router.replace(destino)
    }, [pathname, controlCaja, router])

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

    // Ctrl+Alt+S muestra el nombre de cada contenedor (atributo data-section), para
    // poder pedir cambios concretos: "en pos.carrito.documento, ...". Se recuerda.
    useEffect(() => {
        const html = document.documentElement
        const aplicar = (ver: boolean) => {
            if (ver) html.dataset.verSecciones = ''
            else delete html.dataset.verSecciones
        }
        try { aplicar(localStorage.getItem('ver-secciones') === '1') } catch { /* sin storage */ }
        const alTeclear = (e: KeyboardEvent) => {
            if (!(e.ctrlKey && e.altKey && e.code === 'KeyS')) return
            const ver = html.dataset.verSecciones === undefined
            aplicar(ver)
            try { localStorage.setItem('ver-secciones', ver ? '1' : '0') } catch { /* sin storage */ }
        }
        window.addEventListener('keydown', alTeclear)
        return () => window.removeEventListener('keydown', alTeclear)
    }, [])

    if (!isMounted) return null // Prevent hydration mismatch

    const aviso = (
        <div className="sticky top-0 z-30 mx-auto max-w-7xl px-4 pt-4 md:px-6 empty:hidden">
            <Aviso />
        </div>
    )

    if (sinEmpresa) {
        return <main className="min-h-screen bg-background">{aviso}{children}</main>
    }

    if (!token || !selectedTenantId) return null // Wait for redirect

    return (
        <div className="flex h-[100dvh] overflow-hidden">
            <Sidebar />
            <main data-section="contenido" className="flex-1 overflow-auto bg-background pb-16 md:pb-0">
                {/* El POS pone el aviso dentro de su propia zona, para no correr su alto fijo. */}
                {pathname !== '/pos' && aviso}
                {children}
            </main>
            <MobileNav />
        </div>
    )
}
