import { cn } from '@/lib/utils'

export type TonoEstado = 'neutro' | 'bien' | 'alerta' | 'mal'

const TONOS: Record<TonoEstado, string> = {
    neutro: 'bg-muted text-foreground/80',
    bien: 'bg-primary/10 text-primary',
    alerta: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    mal: 'bg-destructive/10 text-destructive',
}

/** Estado de una fila en palabras ("Agotado", "Lleva 42 días de atraso"), con su color. */
export default function Estado({ tono = 'neutro', children, className }: { tono?: TonoEstado; children: React.ReactNode; className?: string }) {
    return (
        <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-medium', TONOS[tono], className)}>
            {children}
        </span>
    )
}
