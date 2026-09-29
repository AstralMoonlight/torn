'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { Descuento } from '@/lib/store/cartStore'

interface Props {
    /** Para el lector de pantalla: "Descuento a Saco", "Descuento al total". */
    etiqueta: string
    valor: Descuento | null | undefined
    onChange: (d: Descuento | null) => void
    /** Tope del personal, solo como ayuda: el backend es el que lo hace cumplir. */
    maximo?: number
}

/** % o $ y el monto. Se aplica al escribir; vacío o 0 quita el descuento. */
export default function EditorDescuento({ etiqueta, valor, onChange, maximo }: Props) {
    const [tipo, setTipo] = useState<Descuento['tipo']>(valor?.tipo ?? 'pct')
    const [texto, setTexto] = useState(valor ? String(valor.valor) : '')

    const aplicar = (t: Descuento['tipo'], s: string) => {
        const n = Number(s.replace(',', '.'))
        onChange(n > 0 && (t === 'monto' || n <= 100) ? { tipo: t, valor: n } : null)
    }

    return (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={etiqueta}>
            <div className="flex rounded-md border border-border p-0.5">
                {(['pct', 'monto'] as const).map((t) => (
                    <button
                        key={t}
                        type="button"
                        aria-pressed={tipo === t}
                        onClick={() => { setTipo(t); aplicar(t, texto) }}
                        className={cn(
                            'h-8 min-w-10 rounded px-2 text-sm font-semibold',
                            tipo === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                        )}
                    >
                        {t === 'pct' ? '%' : '$'}
                    </button>
                ))}
            </div>
            <Input
                autoFocus
                inputMode="decimal"
                value={texto}
                onChange={(e) => { setTexto(e.target.value); aplicar(tipo, e.target.value) }}
                placeholder={tipo === 'pct' ? 'Ej: 10' : 'Ej: 500'}
                aria-label={tipo === 'pct' ? 'Porcentaje de descuento' : 'Pesos de descuento'}
                className="h-9 w-24 text-right font-tabular"
            />
            {maximo !== undefined && <span className="text-xs text-muted-foreground">Hasta {maximo}%</span>}
            {valor && (
                <Button type="button" variant="ghost" size="sm" className="h-9 text-destructive hover:text-destructive"
                    onClick={() => { setTexto(''); onChange(null) }}>
                    Quitar
                </Button>
            )}
        </div>
    )
}
