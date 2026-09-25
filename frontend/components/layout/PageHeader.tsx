'use client'

import Link from 'next/link'
import { ArrowLeft, type LucideIcon } from 'lucide-react'
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
    volver,
    children,
}: {
    icon?: LucideIcon
    title: string
    description?: string
    actions?: React.ReactNode
    /** Enlace "Volver" sobre el título (páginas de detalle). */
    volver?: { href: string; label: string }
    /** Datos extra bajo el título (p. ej. RUT y esquema de una empresa). */
    children?: React.ReactNode
}) {
    const pagina = usePagina()
    return (
        <div data-section={`${pagina}.encabezado`} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="space-y-1">
                {volver && (
                    <Link href={volver.href} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                        <ArrowLeft className="h-4 w-4" /> {volver.label}
                    </Link>
                )}
                <div className="flex items-center gap-3">
                    {Icon && <Icon className="h-6 w-6 text-primary shrink-0" />}
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
                        {description && (
                            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
                        )}
                        {children}
                    </div>
                </div>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
    )
}
