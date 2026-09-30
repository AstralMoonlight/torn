'use client'

import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SearchInput } from '@/components/ui/search-input'
import { searchActecos, type ActecoItem, type EconomicActivity } from '@/services/saas'
import { formatRut, validateRut } from '@/lib/rut'
import { cn } from '@/lib/utils'

export interface DatosEmpresa {
    name: string
    rut: string
    giro: string
    address: string
    commune: string
    city: string
    economic_activities: EconomicActivity[]
}

export const EMPRESA_VACIA: DatosEmpresa = {
    name: '', rut: '', giro: '', address: '', commune: '', city: '', economic_activities: [],
}

/** Nombre, RUT, giro, dirección y actividades económicas (ACTECO) de una empresa. */
export function EmpresaForm({ valor, onChange, rutFijo = false }: {
    valor: DatosEmpresa
    onChange: (v: DatosEmpresa) => void
    /** El RUT de una empresa creada no cambia: de él salen su esquema y su emisor. */
    rutFijo?: boolean
}) {
    const [busqueda, setBusqueda] = useState('')
    const [resultados, setResultados] = useState<ActecoItem[]>([])
    const [buscando, setBuscando] = useState(false)
    const [errorBusqueda, setErrorBusqueda] = useState(false)
    const set = (cambio: Partial<DatosEmpresa>) => onChange({ ...valor, ...cambio })
    const rutValido = valor.rut === '' || validateRut(valor.rut)

    useEffect(() => {
        const t = setTimeout(() => {
            setBuscando(true)
            setErrorBusqueda(false)
            searchActecos(busqueda || undefined, 50)
                .then(setResultados)
                .catch(() => { setResultados([]); setErrorBusqueda(true) })
                .finally(() => setBuscando(false))
        }, 300)
        return () => clearTimeout(t)
    }, [busqueda])

    const alternar = (a: EconomicActivity) => set({
        economic_activities: valor.economic_activities.some((x) => x.code === a.code)
            ? valor.economic_activities.filter((x) => x.code !== a.code)
            : [...valor.economic_activities, a],
    })

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label htmlFor="empresa-nombre">Razón social</Label>
                    <Input id="empresa-nombre" placeholder="Ej. Comercializadora SpA" required
                        value={valor.name} onChange={(e) => set({ name: e.target.value })} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="empresa-rut">RUT</Label>
                    <Input
                        id="empresa-rut"
                        placeholder="Ej. 76.543.210-K"
                        required
                        disabled={rutFijo}
                        aria-invalid={!rutValido}
                        aria-describedby={!rutValido ? 'empresa-rut-error' : undefined}
                        value={valor.rut}
                        className={cn('font-mono', !rutValido && 'border-destructive focus-visible:ring-destructive')}
                        onChange={(e) => {
                            const limpio = e.target.value.toUpperCase().replace(/[^0-9K]/g, '')
                            set({ rut: limpio.length > 1 ? formatRut(limpio) : limpio })
                        }}
                    />
                    {!rutValido && <p id="empresa-rut-error" className="text-xs text-destructive">RUT inválido: revise el dígito verificador.</p>}
                </div>
                <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="empresa-giro">Giro</Label>
                    <Input id="empresa-giro" placeholder="Ej. Venta al por menor de abarrotes"
                        value={valor.giro} onChange={(e) => set({ giro: e.target.value })} />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="empresa-direccion">Dirección casa matriz</Label>
                    <Input id="empresa-direccion" placeholder="Ej. Av. Principal 123"
                        value={valor.address} onChange={(e) => set({ address: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                        <Label htmlFor="empresa-comuna">Comuna</Label>
                        <Input id="empresa-comuna" value={valor.commune} onChange={(e) => set({ commune: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="empresa-ciudad">Ciudad</Label>
                        <Input id="empresa-ciudad" value={valor.city} onChange={(e) => set({ city: e.target.value })} />
                    </div>
                </div>
            </div>

            <fieldset className="space-y-3 rounded-lg border border-border bg-muted/40 p-4">
                <div className="flex items-center justify-between">
                    <legend className="text-sm font-medium">Actividades económicas (ACTECO)</legend>
                    <Badge variant="outline" className="text-xs">{valor.economic_activities.length} elegidas</Badge>
                </div>
                <SearchInput placeholder="Buscar por código o nombre..." value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)} onClear={() => setBusqueda('')} />
                <div className="h-36 overflow-y-auto rounded border border-border bg-card p-1" aria-busy={buscando}>
                    {buscando ? (
                        <p className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> Buscando...
                        </p>
                    ) : resultados.length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">
                            {errorBusqueda ? 'No se pudo buscar. Intente de nuevo.' : 'Sin resultados.'}
                        </p>
                    ) : resultados.map((a) => {
                        const elegida = valor.economic_activities.some((x) => x.code === a.code)
                        return (
                            <button
                                type="button"
                                key={a.code}
                                aria-pressed={elegida}
                                onClick={() => alternar(a)}
                                className={cn(
                                    'flex w-full flex-col items-start rounded px-2 py-1.5 text-left text-xs transition-colors',
                                    elegida ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent',
                                )}
                            >
                                <span className="font-bold">{a.code}</span>
                                <span className="line-clamp-1">{a.name}</span>
                            </button>
                        )
                    })}
                </div>
                {valor.economic_activities.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {valor.economic_activities.map((a) => (
                            <Badge key={a.code} variant="secondary" className="gap-1 pr-1">
                                {a.code}
                                <button type="button" onClick={() => alternar(a)} aria-label={`Quitar ${a.code}`}
                                    className="rounded-full p-0.5 hover:bg-background">
                                    <X className="h-3 w-3" aria-hidden />
                                </button>
                            </Badge>
                        ))}
                    </div>
                )}
            </fieldset>
        </div>
    )
}
