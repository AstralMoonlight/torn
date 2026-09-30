import { cn } from '@/lib/utils'
import type { EstadoSuscripcion } from '@/services/saas'

const ESTADOS: Record<EstadoSuscripcion, { texto: string; clase: string }> = {
    AL_DIA: { texto: 'Al día', clase: 'bg-primary/10 text-primary' },
    CORTESIA: { texto: 'Cortesía', clase: 'bg-muted text-muted-foreground' },
    POR_VENCER: { texto: 'Por vencer', clase: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
    SIN_PAGO: { texto: 'Sin primer pago', clase: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
    EN_GRACIA: { texto: 'Vencida (en gracia)', clase: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
    PRORROGA: { texto: 'Con prórroga', clase: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
    SUSPENDIDA: { texto: 'Suspendida', clase: 'bg-destructive/10 text-destructive' },
}

export const textoEstado = (estado: EstadoSuscripcion) => ESTADOS[estado]?.texto ?? estado

/** Estado de la suscripción de una empresa, con texto (no solo color). */
export function EstadoSuscripcionBadge({ estado, className }: { estado: EstadoSuscripcion; className?: string }) {
    const e = ESTADOS[estado] ?? { texto: estado, clase: 'bg-muted text-muted-foreground' }
    return (
        <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', e.clase, className)}>
            {e.texto}
        </span>
    )
}
