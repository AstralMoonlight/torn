import { cn } from '@/lib/utils'

export type OpcionFiltro<T extends string> = {
    valor: T
    etiqueta: string
    /** Cuántos hay con ese filtro; se muestra junto a la etiqueta. */
    n?: number
    /** Filtro de algo que hay que atender (rechazados, deuda vencida). */
    peligro?: boolean
}

/** Fichas de filtro de una sola elección, con su conteo. */
export default function FiltrosRapidos<T extends string>({
    opciones,
    valor,
    onChange,
    etiqueta,
}: {
    opciones: OpcionFiltro<T>[]
    valor: T
    onChange: (valor: T) => void
    /** Nombre del grupo para lectores de pantalla. */
    etiqueta: string
}) {
    return (
        <div className="flex flex-wrap gap-2" role="group" aria-label={etiqueta}>
            {opciones.map((o) => {
                const activo = o.valor === valor
                return (
                    <button
                        key={o.valor}
                        type="button"
                        onClick={() => onChange(o.valor)}
                        aria-pressed={activo}
                        className={cn(
                            'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors cursor-pointer',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            activo
                                ? 'border-primary bg-primary text-primary-foreground'
                                : o.peligro
                                    ? 'border-destructive/40 bg-card text-destructive hover:bg-destructive/5'
                                    : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40',
                        )}
                    >
                        {o.etiqueta}
                        {o.n !== undefined && <span className="text-xs font-semibold opacity-75 font-tabular">{o.n}</span>}
                    </button>
                )
            })}
        </div>
    )
}
