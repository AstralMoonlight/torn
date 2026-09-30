'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
    ShoppingCart,
    Landmark,
    Package,
    History,
    BarChart3,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useControlCaja } from '@/lib/store/settingsStore'
import { useSessionStore } from '@/lib/store/sessionStore'

// permissionKey: las mismas claves del menú lateral (`Sidebar.tsx`).
const tabs = [
    { href: '/pos', label: 'POS', icon: ShoppingCart, permissionKey: 'Terminal POS' },
    { href: '/caja', label: 'Caja', icon: Landmark, permissionKey: 'Caja' },
    { href: '/dashboard', label: 'Panel', icon: BarChart3, permissionKey: 'Dashboard' },
    { href: '/inventario', label: 'Stock', icon: Package, permissionKey: 'Productos' },
    { href: '/historial', label: 'Ventas', icon: History, permissionKey: 'Historial' },
]

export default function MobileNav() {
    const pathname = usePathname()
    const controlCaja = useControlCaja()
    const isSuperadmin = useSessionStore((s) => s.user?.is_superuser === true)
    const tenant = useSessionStore((s) => s.availableTenants.find((t) => t.id === s.selectedTenantId))
    const isAdmin = isSuperadmin || tenant?.role_name === 'ADMINISTRADOR'
    const visibles = tabs.filter((tab) =>
        (controlCaja || tab.href !== '/caja') && (isAdmin || tenant?.permissions?.[tab.permissionKey] === true))

    return (
        <nav data-section="menu-movil" className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden border-t border-border bg-background/95 backdrop-blur-md print:hidden safe-bottom">
            {visibles.map((tab) => {
                const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/')
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        className={cn(
                            'flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors',
                            isActive
                                ? 'text-primary'
                                : 'text-muted-foreground active:text-muted-foreground'
                        )}
                    >
                        <tab.icon className={cn('h-5 w-5', isActive && 'stroke-[2.5]')} />
                        {tab.label}
                    </Link>
                )
            })}
        </nav>
    )
}
