import { cn } from '@/lib/utils'

export type DatoResumen = {
    etiqueta: string
    valor: React.ReactNode
    /** Frase corta que explica el número. */
    nota?: React.ReactNode
    /** `mal` pinta el valor en rojo (algo que atender). */
    tono?: 'mal'
}

/**
 * Los datos clave de una pantalla, bajo el encabezado: tres (o menos) cifras con
 * una frase que dice qué significan. Mismo formato en todas las vistas de lista.
 */
export default function Resumen({ datos, className }: { datos: DatoResumen[]; className?: string }) {
    return (
        <div className={cn(
            'grid grid-cols-1 rounded-xl border border-border bg-card divide-y divide-border',
            datos.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2',
            'md:divide-y-0 md:divide-x',
            className,
        )}>
            {datos.map((d) => (
                <div key={d.etiqueta} className="px-5 py-4">
                    <p className="text-sm text-muted-foreground">{d.etiqueta}</p>
                    <p className={cn('mt-0.5 text-2xl font-bold tracking-tight font-tabular', d.tono === 'mal' ? 'text-destructive' : 'text-foreground')}>
                        {d.valor}
                    </p>
                    {d.nota && <p className="mt-0.5 text-sm text-muted-foreground">{d.nota}</p>}
                </div>
            ))}
        </div>
    )
}
