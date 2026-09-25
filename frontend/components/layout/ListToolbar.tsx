'use client'

import { SearchInput } from '@/components/ui/search-input'
import { usePagina } from './PageContainer'

/**
 * Barra de herramientas de las vistas de listado, debajo de `PageHeader`:
 * buscador (mismo ancho en todas), filtros, contador "N de M" y acciones
 * secundarias a la derecha. Antes cada página ponía el buscador con otro ancho
 * y en otro lugar.
 */
export default function ListToolbar({
    busqueda,
    onBusqueda,
    placeholder,
    visibles,
    total,
    unidad,
    filtros,
    acciones,
}: {
    busqueda: string
    onBusqueda: (valor: string) => void
    placeholder: string
    /** Filas que se ven con la búsqueda y los filtros aplicados. */
    visibles: number
    total: number
    /** Plural de lo que se cuenta: "clientes", "productos"... */
    unidad: string
    filtros?: React.ReactNode
    acciones?: React.ReactNode
}) {
    const pagina = usePagina()
    return (
        <div data-section={`${pagina}.herramientas`} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchInput
                className="w-full sm:max-w-sm"
                placeholder={placeholder}
                value={busqueda}
                onChange={(e) => onBusqueda(e.target.value)}
                onClear={() => onBusqueda('')}
            />
            {filtros && <div className="flex flex-wrap items-center gap-2">{filtros}</div>}
            <div className="flex items-center gap-3 sm:ml-auto">
                <span className="text-sm text-muted-foreground whitespace-nowrap font-tabular" role="status">
                    {visibles === total ? `${total} ${unidad}` : `${visibles} de ${total} ${unidad}`}
                </span>
                {acciones && <div className="flex items-center gap-2">{acciones}</div>}
            </div>
        </div>
    )
}
