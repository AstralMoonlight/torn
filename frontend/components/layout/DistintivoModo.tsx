'use client'

import { useSessionStore } from '@/lib/store/sessionStore'
import { cn } from '@/lib/utils'

const MODOS = {
    DEV: {
        nombre: 'Desarrollador',
        detalle: 'Las ventas no se envían al SII y sus documentos no tienen validez tributaria.',
        clase: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    },
    CERT: {
        nombre: 'Certificación',
        detalle: 'Los documentos van al ambiente de pruebas del SII.',
        clase: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
    },
} as const

/** Modo del emisor de la empresa actual. Lo cambia solo el superusuario, en
 * saas-admin; en producción (PROD) no se muestra nada. */
export default function DistintivoModo({ conDetalle = false, className }: { conDetalle?: boolean; className?: string }) {
    const modo = useSessionStore((s) => s.availableTenants.find((t) => t.id === s.selectedTenantId)?.sii_ambiente)
    if (modo !== 'DEV' && modo !== 'CERT') return null
    const { nombre, detalle, clase } = MODOS[modo]
    return (
        <p
            data-section="modo-emisor"
            title={detalle}
            className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', clase, className)}
        >
            Modo {nombre}{conDetalle && <span className="font-normal">. {detalle}</span>}
        </p>
    )
}
