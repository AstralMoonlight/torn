'use client'

import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'

const ID = 'pos-busqueda'

/** Lleva el foco al buscador (atajo F2 del POS). */
export function enfocarBusqueda() {
    const input = document.getElementById(ID) as HTMLInputElement | null
    input?.focus()
    input?.select()
}

interface Props {
    value: string
    onChange: (query: string) => void
    /** Enter: la página agrega el producto si la búsqueda dejó uno solo. */
    onEnter: () => void
    /** Cantidad de resultados, o null si no hay búsqueda. */
    resultados: number | null
}

export default function ProductSearch({ value, onChange, onEnter, resultados }: Props) {
    return (
        <div data-section="pos.buscador" className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
                id={ID}
                type="search"
                value={value}
                aria-label="Buscar producto"
                placeholder="Buscar por nombre, SKU o código de barras"
                className="h-12 rounded-xl border-border bg-card pl-12 pr-12 md:pr-32 text-base shadow-sm focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') onEnter()
                    if (e.key === 'Escape') onChange('')
                }}
                autoFocus
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-2">
                {resultados !== null && (
                    <span className="text-xs text-muted-foreground font-tabular" aria-live="polite">
                        {resultados} {resultados === 1 ? 'resultado' : 'resultados'}
                    </span>
                )}
                {value ? (
                    <button
                        type="button"
                        onClick={() => onChange('')}
                        aria-label="Limpiar búsqueda"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                    >
                        <X className="h-4 w-4" />
                    </button>
                ) : (
                    <kbd className="hidden md:inline-flex h-6 items-center rounded border border-border bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">F2</kbd>
                )}
            </div>
        </div>
    )
}
