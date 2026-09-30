'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Building2, CreditCard, LayoutDashboard, LogOut, Package, Store, Users } from 'lucide-react'
import { useSessionStore } from '@/lib/store/sessionStore'
import { useHydrated } from '@/lib/hooks/useHydrated'
import { Button } from '@/components/ui/button'
import ThemeToggle from '@/components/layout/ThemeToggle'
import { LogoutConfirmModal } from '@/components/layout/LogoutConfirmModal'
import { cn } from '@/lib/utils'

/** Menú del panel: cada entrada se ve solo con su permiso (`null` = solo el dueño). */
const MENU = [
    { href: '/saas-admin', texto: 'Resumen', icono: LayoutDashboard, permiso: 'empresas.ver' },
    { href: '/saas-admin/empresas', texto: 'Empresas', icono: Building2, permiso: 'empresas.ver' },
    { href: '/saas-admin/pagos', texto: 'Pagos', icono: CreditCard, permiso: 'cobros.ver' },
    { href: '/saas-admin/planes', texto: 'Planes', icono: Package, permiso: 'empresas.ver' },
    { href: '/saas-admin/equipo', texto: 'Equipo', icono: Users, permiso: null },
] as const

export default function SaasAdminLayout({ children }: { children: React.ReactNode }) {
    const router = useRouter()
    const pathname = usePathname()
    const { user, token } = useSessionStore()
    const isMounted = useHydrated()

    useEffect(() => {
        if (!isMounted) return
        if (!token) router.push('/login')
        else if (!user?.is_superuser) router.push('/access-denied')
    }, [token, user, isMounted, router])

    if (!isMounted || !user?.is_superuser) return null

    const permisos = user.permisos ?? []
    const visibles = MENU.filter((m) => (m.permiso === null ? user.es_dueno : permisos.includes(m.permiso)))
    const activo = (href: string) => (href === '/saas-admin' ? pathname === href : pathname.startsWith(href))

    return (
        <div className="min-h-screen bg-background">
            <header data-section="saas-admin.barra" className="border-b border-border bg-card">
                <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 md:px-6">
                    <div className="mr-auto">
                        <p className="text-sm font-semibold text-foreground">Factureando</p>
                        <p className="text-xs text-muted-foreground">{user.full_name || user.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {permisos.includes('empresas.entrar') && (
                            <Button variant="outline" size="sm" onClick={() => router.push('/select-tenant')}>
                                <Store className="h-4 w-4" /> Entrar a una empresa
                            </Button>
                        )}
                        <ThemeToggle />
                        <LogoutConfirmModal>
                            <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10">
                                <LogOut className="h-4 w-4" /> Salir
                            </Button>
                        </LogoutConfirmModal>
                    </div>
                </div>
                <nav aria-label="Panel de administración" className="mx-auto max-w-7xl overflow-x-auto px-2 md:px-4">
                    <ul className="flex gap-1">
                        {visibles.map(({ href, texto, icono: Icono }) => (
                            <li key={href}>
                                <Link
                                    href={href}
                                    aria-current={activo(href) ? 'page' : undefined}
                                    className={cn(
                                        'flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                                        activo(href)
                                            ? 'border-primary text-foreground'
                                            : 'border-transparent text-muted-foreground hover:text-foreground',
                                    )}
                                >
                                    <Icono className="h-4 w-4" aria-hidden /> {texto}
                                </Link>
                            </li>
                        ))}
                    </ul>
                </nav>
            </header>
            {children}
        </div>
    )
}
