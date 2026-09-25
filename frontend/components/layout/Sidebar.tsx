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
    LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import DistintivoModo from '@/components/layout/DistintivoModo'
import { useSessionStore } from '@/lib/store/sessionStore'
import { useUIStore } from '@/lib/store/uiStore'
import { Badge } from '@/components/ui/badge'
import ThemeToggle from './ThemeToggle'
import SelectorColor from './SelectorColor'
import { useControlCaja } from '@/lib/store/settingsStore'
import { LogoutConfirmModal } from './LogoutConfirmModal'

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
            { href: '/listas-precios', label: 'Listas de precios', icon: Tags, permissionKey: 'Productos' },
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
            { href: '/reporte-diario', label: 'Reportes de ventas', icon: BarChart3, permissionKey: 'Reportes de Ventas' },
        ]
    },
    {
        label: 'Sistema',
        items: [
            { href: '/configuracion', label: 'Configuración', icon: Settings, permissionKey: 'Configuración' },
            { href: '/saas-admin', label: 'Terminal SaaS global', icon: Globe, permissionKey: '__SUPERADMIN__' },
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
    const controlCaja = useControlCaja()

    const currentTenant = availableTenants.find(t => t.id === selectedTenantId)
    // El rol y los permisos son del vínculo tenant-usuario (AvailableTenant),
    // no del usuario SaaS global: éste no tiene rut/role/permissions propios.
    const roleForCurrentTenant = currentTenant?.role_name || ''

    const permissions = currentTenant?.permissions || {}
    const isAdmin = roleForCurrentTenant === 'ADMINISTRADOR'
    const isSuperadmin = userPayload?.is_superuser === true

    return (
        <aside data-section="menu-lateral"
            className={cn(
                'hidden md:flex h-screen flex-col border-r border-border bg-card transition-all duration-300 print:hidden',
                collapsed ? 'w-[68px]' : 'w-60'
            )}
        >
            {/* Logo */}
            <div className={cn(
                'flex h-14 items-center border-b border-border shrink-0',
                collapsed ? 'justify-center px-2' : 'gap-2.5 px-4'
            )}>
                <Activity className="h-6 w-6 text-primary shrink-0" />
                {!collapsed && (
                    <div className="overflow-hidden">
                        <h1 className="text-sm font-bold tracking-tight text-foreground leading-tight truncate max-w-[160px]" title={currentTenant?.name || 'Torn'}>
                            {currentTenant?.name || 'Torn'}
                        </h1>
                        <p className="text-xs uppercase tracking-widest text-muted-foreground leading-none">
                            punto de venta
                        </p>
                        <DistintivoModo className="mt-1 w-fit" />
                    </div>
                )}
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-2 py-4 overflow-y-auto custom-scrollbar">
                {navGroups.map((group, groupIdx) => {
                    // Filter items based on dynamic permissions
                    const filteredItems = group.items.filter(item => {
                        if (item.permissionKey === '__SUPERADMIN__') return isSuperadmin
                        if (item.href === '/caja' && !controlCaja) return false
                        if (isAdmin) return true
                        return permissions[item.permissionKey] === true
                    })

                    if (filteredItems.length === 0) return null

                    return (
                        <div key={group.label} className={cn(groupIdx > 0 && "mt-5")}>
                            {!collapsed && (
                                <h2 className="mb-2 px-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
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
                                                    ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                                                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                                            )}
                                        >
                                            <item.icon className={cn(
                                                "h-[18px] w-[18px] shrink-0",
                                                isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-accent-foreground"
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
            <div className="border-t border-border shrink-0">
                {/* User Info */}
                {!collapsed && (
                    <div className="px-3 pt-3 flex flex-col">
                        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground truncate">
                            {userPayload?.full_name || userPayload?.email || 'Usuario'}
                        </span>
                        <span className="text-xs text-muted-foreground truncate lowercase italic">
                            {roleForCurrentTenant.replace('_', ' ')}
                        </span>
                    </div>
                )}

                {/* Cash Status */}
                {controlCaja && (
                <div className={cn(
                    'flex items-center px-3 py-2',
                    collapsed ? 'justify-center' : 'justify-between'
                )}>
                    {!collapsed && (
                        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Caja
                        </span>
                    )}
                    <Badge
                        variant={status === 'OPEN' ? 'default' : 'destructive'}
                        className={cn(
                            'text-xs px-1.5 py-0',
                        )}
                    >
                        {collapsed
                            ? (status === 'OPEN' ? '●' : '○')
                            : (status === 'OPEN' ? '● Abierta' : '○ Cerrada')}
                    </Badge>
                </div>
                )}

                {/* Theme + Logout + Collapse */}
                <div className={cn(
                    'flex items-center border-t border-border px-2 py-1.5',
                    collapsed ? 'flex-col justify-center gap-2' : 'flex-row justify-between'
                )}>
                    <div className={cn('flex items-center gap-1', collapsed && 'flex-col gap-2')}>
                        <ThemeToggle />
                        <SelectorColor />
                    </div>

                    <LogoutConfirmModal>
                        <button
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10"
                            title="Cerrar sesión"
                        >
                            <LogOut className="h-4 w-4" />
                        </button>
                    </LogoutConfirmModal>

                    <button
                        onClick={toggle}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
