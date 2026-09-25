'use client'

import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

/** Nombre de la página para `data-section`: `/saas-admin/tenants` -> `saas-admin.tenants`. */
export function usePagina(): string {
    return usePathname().split('/').filter(Boolean).join('.') || 'inicio'
}

/**
 * Shell estándar para las páginas de tipo lista/CRUD del aside (Dashboard,
 * Inventario, Historial, etc.). Antes cada página traía su propio padding/
 * max-width a mano y no coincidían entre sí.
 */
export default function PageContainer({
    children,
    className,
}: {
    children: React.ReactNode
    className?: string
}) {
    const pagina = usePagina()
    return (
        <div data-section={pagina} className={cn('p-4 md:p-6 space-y-6 max-w-7xl mx-auto', className)}>
            {children}
        </div>
    )
}
