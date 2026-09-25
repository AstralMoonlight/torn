'use client'

import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { COLORES } from '@/lib/colores'
import { cn } from '@/lib/utils'

/** Muestras de la paleta cerrada de `lib/colores.ts`, cada una en su tono claro y oscuro. */
export default function PaletaColores({
    valor,
    onElegir,
    className,
}: {
    valor: string | null
    onElegir: (clave: string) => void
    className?: string
}) {
    return (
        <div role="radiogroup" aria-label="Color principal" className={cn('grid grid-cols-10 gap-2', className)}>
            {COLORES.map((c) => (
                <button
                    key={c.clave}
                    type="button"
                    role="radio"
                    aria-checked={valor === c.clave}
                    aria-label={c.nombre}
                    title={c.nombre}
                    onClick={() => onElegir(c.clave)}
                    style={{ '--c-claro': c.claro, '--c-oscuro': c.oscuro } as CSSProperties}
                    className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full text-primary-foreground transition-transform hover:scale-110',
                        'bg-[hsl(var(--c-claro))] dark:bg-[hsl(var(--c-oscuro))]',
                        'ring-offset-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        valor === c.clave && 'ring-2 ring-foreground/60',
                    )}
                >
                    {valor === c.clave && <Check className="h-4 w-4" aria-hidden />}
                </button>
            ))}
        </div>
    )
}
