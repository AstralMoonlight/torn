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
            { href: '/dashboard', label: 'Dashboard', icon: BarChart3 },
            { href: '/pos', label: 'Terminal POS', icon: ShoppingCart },
            { href: '/caja', label: 'Caja', icon: Landmark },
        ]
    },
    {
        label: 'Inventario',
        items: [
            { href: '/inventario', label: 'Productos', icon: Package },
            { href: '/marcas', label: 'Marcas', icon: Tags },
            { href: '/compras', label: 'Compras', icon: ShoppingBag },
        ]
    },
    {
        label: 'Entidades',
        items: [
            { href: '/clientes', label: 'Clientes', icon: Globe },
            { href: '/proveedores', label: 'Proveedores', icon: Truck },
            { href: '/vendedores', label: 'Vendedores', icon: Users },
        ]
    },
    {
        label: 'Auditoría',
        items: [
            { href: '/historial', label: 'Historial', icon: History },
            { href: '/reporte-diario', label: 'Reportes de Ventas', icon: BarChart3 },
        ]
    },
    {
        label: 'Sistema',
        items: [
            { href: '/configuracion', label: 'Configuración', icon: Settings },
        ]
    }
]

export default function Sidebar() {
    const pathname = usePathname()
    const user = useSessionStore((s) => s.user)
    const status = useSessionStore((s) => s.status)
    const collapsed = useUIStore((s) => s.sidebarCollapsed)
    const toggle = useUIStore((s) => s.toggleSidebar)

    return (
        <aside
            className={cn(
                'hidden md:flex h-screen flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 transition-all duration-300 print:hidden',
                collapsed ? 'w-[68px]' : 'w-60'
            )}
        >
            {/* Logo */}
            <div className={cn(
                'flex h-14 items-center border-b border-slate-200 dark:border-slate-800 shrink-0',
                collapsed ? 'justify-center px-2' : 'gap-2.5 px-4'
            )}>
                <Activity className="h-6 w-6 text-blue-600 shrink-0" />
                {!collapsed && (
                    <div className="overflow-hidden">
                        <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
                            Torn
                        </h1>
                        <p className="text-[9px] uppercase tracking-widest text-slate-400 leading-none">
                            punto de venta
                        </p>
                    </div>
                )}
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-2 py-4 overflow-y-auto custom-scrollbar">
                {navGroups.map((group, groupIdx) => {
                    // Role-based filtering
                    if (user?.role === 'VENDEDOR') {
                        if (['Inventario', 'Entidades', 'Auditoría', 'Sistema'].includes(group.label)) return null
                        if (group.label === 'Operaciones') {
                            // On Operaciones, seller only sees POS and Caja
                            group = {
                                ...group,
                                items: group.items.filter(i => i.label !== 'Dashboard')
                            }
                        }
                    }

                    return (
                        <div key={group.label} className={cn(groupIdx > 0 && "mt-5")}>
                            {!collapsed && (
                                <h2 className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                    {group.label}
                                </h2>
                            )}
                            <div className="space-y-1">
                                {group.items.map((item) => {
                                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                                    return (
                                        <Link
                                            key={item.href}
                                            href={item.href}
                                            title={collapsed ? item.label : undefined}
                                            className={cn(
                                                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-all group',
                                                collapsed && 'justify-center px-0',
                                                isActive
                                                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                                                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                                            )}
                                        >
                                            <item.icon className={cn(
                                                "h-[18px] w-[18px] shrink-0",
                                                isActive ? "text-white" : "text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300"
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
            <div className="border-t border-slate-200 dark:border-slate-800 shrink-0">
                {/* Cash Status */}
                <div className={cn(
                    'flex items-center px-3 py-2',
                    collapsed ? 'justify-center' : 'justify-between'
                )}>
                    {!collapsed && (
                        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
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

                {/* Theme + Collapse */}
                <div className={cn(
                    'flex items-center border-t border-slate-200 dark:border-slate-800 px-2 py-1.5',
                    collapsed ? 'justify-center' : 'justify-between'
                )}>
                    {!collapsed && <ThemeToggle />}
                    <button
                        onClick={toggle}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"
                        title={collapsed ? 'Expandir' : 'Colapsar'}
                    >
                        {collapsed ? (
                            <PanelLeftOpen className="h-4 w-4" />
                        ) : (
                            <PanelLeftClose className="h-4 w-4" />
                        )}
                    </button>
                    {collapsed && <ThemeToggle />}
                </div>
            </div>
        </aside>
    )
}
