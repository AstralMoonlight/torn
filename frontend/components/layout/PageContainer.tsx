import { cn } from '@/lib/utils'

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
    return (
        <div className={cn('p-4 md:p-6 space-y-6 max-w-7xl mx-auto', className)}>
            {children}
        </div>
    )
}
