'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
    ShoppingCart,
    Landmark,
    Package,
    History,
    BarChart3,
    Activity,
    PanelLeftClose,
    PanelLeftOpen,
    Globe,
    Truck,
    ShoppingBag,
    Tags,
    Users,
    Settings,
    ShieldCheck,
    LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSessionStore } from '@/lib/store/sessionStore'
import { useUIStore } from '@/lib/store/uiStore'
import { Badge } from '@/components/ui/badge'
import ThemeToggle from './ThemeToggle'

const navGroups = [
    {
        label: 'Operaciones',
        items: [
            { href: '/dashboard', label: 'Dashboard', icon: BarChart3, permissionKey: 'Dashboard' },
            { href: '/pos', label: 'Terminal POS', icon: ShoppingCart, permissionKey: 'Terminal POS' },
            { href: '/caja', label: 'Caja', icon: Landmark, permissionKey: 'Caja' },
        ]
    },
    {
        label: 'Inventario',
        items: [
            { href: '/inventario', label: 'Productos', icon: Package, permissionKey: 'Productos' },
            { href: '/marcas', label: 'Marcas', icon: Tags, permissionKey: 'Marcas' },
            { href: '/compras', label: 'Compras', icon: ShoppingBag, permissionKey: 'Compras' },
        ]
    },
    {
        label: 'Entidades',
        items: [
            { href: '/clientes', label: 'Clientes', icon: Globe, permissionKey: 'Clientes' },
            { href: '/proveedores', label: 'Proveedores', icon: Truck, permissionKey: 'Proveedores' },
            { href: '/personal', label: 'Personal', icon: Users, permissionKey: 'Vendedores' },
        ]
    },
    {
        label: 'Auditoría',
        items: [
            { href: '/historial', label: 'Historial', icon: History, permissionKey: 'Historial' },
            { href: '/reporte-diario', label: 'Reportes de Ventas', icon: BarChart3, permissionKey: 'Reportes de Ventas' },
        ]
    },
    {
        label: 'Sistema',
        items: [
            { href: '/configuracion', label: 'Configuración', icon: Settings, permissionKey: 'Configuración' },
            { href: '/saas-admin', label: 'Terminal SaaS Global', icon: Globe, permissionKey: '__SUPERADMIN__' },
        ]
    }
]

export default function Sidebar() {
    const pathname = usePathname()
    const userPayload = useSessionStore((s) => s.user)
    const status = useSessionStore((s) => s.status)
    const collapsed = useUIStore((s) => s.sidebarCollapsed)
    const toggle = useUIStore((s) => s.toggleSidebar)
    const availableTenants = useSessionStore((s) => s.availableTenants)
    const selectedTenantId = useSessionStore((s) => s.selectedTenantId)

    const currentTenant = availableTenants.find(t => t.id === selectedTenantId)
    const roleForCurrentTenant = currentTenant?.role_name || userPayload?.role || ''

    const permissions = currentTenant?.permissions || userPayload?.role_obj?.permissions || {}
    const isAdmin = roleForCurrentTenant === 'ADMINISTRADOR'
    const isSuperadmin = userPayload?.is_superuser === true

    return (
        <aside
            className={cn(
                'hidden md:flex h-screen flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 transition-all duration-300 print:hidden',
                collapsed ? 'w-[68px]' : 'w-60'
            )}
        >
            {/* Logo */}
            <div className={cn(
                'flex h-14 items-center border-b border-neutral-200 dark:border-neutral-800 shrink-0',
                collapsed ? 'justify-center px-2' : 'gap-2.5 px-4'
            )}>
                <Activity className="h-6 w-6 text-blue-600 shrink-0" />
                {!collapsed && (
                    <div className="overflow-hidden">
                        <h1 className="text-sm font-bold tracking-tight text-neutral-900 dark:text-white leading-tight truncate max-w-[160px]" title={currentTenant?.name || 'Torn'}>
                            {currentTenant?.name || 'Torn'}
                        </h1>
                        <p className="text-[9px] uppercase tracking-widest text-neutral-400 leading-none">
                            punto de venta
                        </p>
                    </div>
                )}
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-2 py-4 overflow-y-auto custom-scrollbar">
                {navGroups.map((group, groupIdx) => {
                    // Filter items based on dynamic permissions
                    const filteredItems = group.items.filter(item => {
                        if (item.permissionKey === '__SUPERADMIN__') return isSuperadmin
                        if (isAdmin) return true
                        return permissions[item.permissionKey] === true
                    })

                    if (filteredItems.length === 0) return null

                    return (
                        <div key={group.label} className={cn(groupIdx > 0 && "mt-5")}>
                            {!collapsed && (
                                <h2 className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                                    {group.label}
                                </h2>
                            )}
                            <div className="space-y-1">
                                {filteredItems.map((item) => {
                                    let itemHref = item.href;
                                    if (item.permissionKey === '__SUPERADMIN__' && selectedTenantId) {
                                        itemHref = `/saas-admin/tenants/${selectedTenantId}`;
                                    }

                                    const isActive = pathname === itemHref || pathname.startsWith(itemHref + '/')
                                    return (
                                        <Link
                                            key={item.href}
                                            href={itemHref}
                                            title={collapsed ? item.label : undefined}
                                            className={cn(
                                                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all group',
                                                collapsed && 'justify-center px-0',
                                                isActive
                                                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                                                    : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white'
                                            )}
                                        >
                                            <item.icon className={cn(
                                                "h-[18px] w-[18px] shrink-0",
                                                isActive ? "text-white" : "text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300"
                                            )} />
                                            {!collapsed && <span className="truncate">{item.label}</span>}
                                        </Link>
                                    )
                                })}
                            </div>
                        </div>
                    )
                })}
            </nav>

            {/* Footer */}
            <div className="border-t border-neutral-200 dark:border-neutral-800 shrink-0">
                {/* User Info */}
                {!collapsed && (
                    <div className="px-3 pt-3 flex flex-col">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-400 truncate">
                            {userPayload?.full_name || userPayload?.name || 'Usuario'}
                        </span>
                        <span className="text-[10px] text-neutral-500 truncate lowercase italic">
                            {roleForCurrentTenant.replace('_', ' ')}
                        </span>
                    </div>
                )}

                {/* Cash Status */}
                <div className={cn(
                    'flex items-center px-3 py-2',
                    collapsed ? 'justify-center' : 'justify-between'
                )}>
                    {!collapsed && (
                        <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">
                            Caja
                        </span>
                    )}
                    <Badge
                        variant={status === 'OPEN' ? 'default' : 'destructive'}
                        className={cn(
                            'text-[9px] px-1.5 py-0',
                            status === 'OPEN' && 'bg-emerald-600 hover:bg-emerald-700'
                        )}
                    >
                        {collapsed
                            ? (status === 'OPEN' ? '●' : '○')
                            : (status === 'OPEN' ? '● Abierta' : '○ Cerrada')}
                    </Badge>
                </div>

                {/* Theme + Logout + Collapse */}
                <div className={cn(
                    'flex items-center border-t border-neutral-200 dark:border-neutral-800 px-2 py-1.5',
                    collapsed ? 'flex-col justify-center gap-2' : 'flex-row justify-between'
                )}>
                    <ThemeToggle />

                    <button
                        onClick={() => {
                            useSessionStore.getState().logout()
                            window.location.href = '/login'
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300"
                        title="Cerrar Sesión"
                    >
                        <LogOut className="h-4 w-4" />
                    </button>

                    <button
                        onClick={toggle}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-white"
                        title={collapsed ? 'Expandir' : 'Colapsar'}
                    >
                        {collapsed ? (
                            <PanelLeftOpen className="h-4 w-4" />
                        ) : (
                            <PanelLeftClose className="h-4 w-4" />
                        )}
                    </button>
                </div>
            </div>
        </aside>
    )
}
