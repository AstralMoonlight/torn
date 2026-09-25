'use client'

import type { LucideIcon } from 'lucide-react'
import { usePagina } from './PageContainer'

/**
 * Encabezado estándar para las páginas del aside: mismo tamaño/peso de
 * título, mismo color de ícono y de subtítulo en todas. Antes cada página
 * traía su propia combinación de tamaño de `<h1>`, con o sin `tracking-tight`,
 * y colores hardcodeados (`text-foreground`, `text-primary`)
 * que no correspondían exactamente a los tokens del tema.
 */
export default function PageHeader({
    icon: Icon,
    title,
    description,
    actions,
}: {
    icon?: LucideIcon
    title: string
    description?: string
    actions?: React.ReactNode
}) {
    const pagina = usePagina()
    return (
        <div data-section={`${pagina}.encabezado`} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
                {Icon && <Icon className="h-6 w-6 text-primary shrink-0" />}
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
                    {description && (
                        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
                    )}
                </div>
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
    )
}
