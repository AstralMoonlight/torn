'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
    ShoppingCart,
    Landmark,
    Package,
    History,
    Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSessionStore } from '@/lib/store/sessionStore'
import { Badge } from '@/components/ui/badge'

const navItems = [
    { href: '/pos', label: 'Terminal POS', icon: ShoppingCart },
    { href: '/caja', label: 'Caja', icon: Landmark },
    { href: '/inventario', label: 'Inventario', icon: Package },
    { href: '/historial', label: 'Historial', icon: History },
]

export default function Sidebar() {
    const pathname = usePathname()
    const status = useSessionStore((s) => s.status)

    return (
        <aside className="flex h-screen w-64 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 print:hidden">
            {/* Logo */}
            <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-6 dark:border-slate-800">
                <Activity className="h-7 w-7 text-blue-600" />
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                        Torn POS
                    </h1>
                    <p className="text-[10px] uppercase tracking-widest text-slate-400">
                        Sistema de Ventas
                    </p>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 space-y-1 px-3 py-4">
                {navItems.map((item) => {
                    const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                                isActive
                                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25'
                                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                            )}
                        >
                            <item.icon className="h-5 w-5" />
                            {item.label}
                        </Link>
                    )
                })}
            </nav>

            {/* Cash Session Status */}
            <div className="border-t border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Estado Caja
                    </span>
                    <Badge
                        variant={status === 'OPEN' ? 'default' : 'destructive'}
                        className={cn(
                            'text-[10px]',
                            status === 'OPEN' && 'bg-emerald-600 hover:bg-emerald-700'
                        )}
                    >
                        {status === 'OPEN' ? '● Abierta' : '○ Cerrada'}
                    </Badge>
                </div>
            </div>
        </aside>
    )
}
