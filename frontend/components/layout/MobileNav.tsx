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

const tabs = [
    { href: '/pos', label: 'POS', icon: ShoppingCart },
    { href: '/caja', label: 'Caja', icon: Landmark },
    { href: '/dashboard', label: 'Panel', icon: BarChart3 },
    { href: '/inventario', label: 'Stock', icon: Package },
    { href: '/historial', label: 'Ventas', icon: History },
]

export default function MobileNav() {
    const pathname = usePathname()
    const controlCaja = useControlCaja()

    return (
        <nav data-section="menu-movil" className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden border-t border-border bg-background/95 backdrop-blur-md print:hidden safe-bottom">
            {tabs.filter((tab) => controlCaja || tab.href !== '/caja').map((tab) => {
                const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/')
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        className={cn(
                            'flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
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
