'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AccionFila } from '@/components/ui/accion-fila'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertaError } from '@/components/ui/alerta-error'
import { getBrands, createBrand, updateBrand, deleteBrand, Brand } from '@/services/brands'
import { getProducts } from '@/services/products'
import { getApiErrorMessage, getApiErrorDetail } from '@/services/api'
import { avisar } from '@/lib/store/uiStore'
import { Trash2, Plus, Loader2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import ListToolbar from '@/components/layout/ListToolbar'

export default function BrandsPage() {
    const [brands, setBrands] = useState<Brand[]>([])
    const [productosPorMarca, setProductosPorMarca] = useState<Map<number, number>>(new Map())
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('')

    // Agregar arriba, sin ventana aparte.
    const [nueva, setNueva] = useState('')
    const [agregando, setAgregando] = useState(false)
    const [errorNueva, setErrorNueva] = useState<string | null>(null)

    // Renombrar en la misma fila.
    const [editando, setEditando] = useState<number | null>(null)
    const [nombreEditado, setNombreEditado] = useState('')
    const [errorEdicion, setErrorEdicion] = useState<string | null>(null)
    const [guardando, setGuardando] = useState(false)

    const [toDelete, setToDelete] = useState<Brand | null>(null)

    const loadBrands = async () => {
        setLoading(true)
        try {
            const [marcas, productos] = await Promise.all([getBrands(), getProducts()])
            setBrands(marcas)
            const cuenta = new Map<number, number>()
            productos.filter((p) => p.parent_id === null && p.brand_id)
                .forEach((p) => cuenta.set(p.brand_id!, (cuenta.get(p.brand_id!) ?? 0) + 1))
            setProductosPorMarca(cuenta)
        } catch (error) {
            console.error(error)
            avisar(getApiErrorMessage(error, 'Error al cargar marcas'), { reintentar: loadBrands })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { loadBrands() }, [])

    const agregar = async (e: React.FormEvent) => {
        e.preventDefault()
        const name = nueva.trim()
        setErrorNueva(null)
        if (!name) {
            setErrorNueva('Escribe el nombre de la marca.')
            return
        }
        setAgregando(true)
        try {
            const created = await createBrand({ name })
            setBrands((bs) => [...bs, created])
            setNueva('')
        } catch (error) {
            setErrorNueva(getApiErrorDetail(error, 'No se pudo agregar la marca.'))
        } finally {
            setAgregando(false)
        }
    }

    const empezarEdicion = (brand: Brand) => {
        setEditando(brand.id)
        setNombreEditado(brand.name)
        setErrorEdicion(null)
    }

    const guardarEdicion = async (e: React.FormEvent) => {
        e.preventDefault()
        if (editando === null) return
        const name = nombreEditado.trim()
        if (!name) {
            setErrorEdicion('El nombre no puede quedar vacío.')
            return
        }
        setGuardando(true)
        try {
            const updated = await updateBrand(editando, { name })
            setBrands((bs) => bs.map((b) => (b.id === updated.id ? updated : b)))
            setEditando(null)
        } catch (error) {
            setErrorEdicion(getApiErrorDetail(error, 'No se pudo cambiar el nombre.'))
        } finally {
            setGuardando(false)
        }
    }

    const handleDelete = async (brand: Brand) => {
        try {
            await deleteBrand(brand.id)
            setBrands((bs) => bs.filter((b) => b.id !== brand.id))
        } catch (error) {
            console.error(error)
            avisar(getApiErrorDetail(error, 'No se pudo eliminar la marca (¿está en uso?).'))
        }
    }

    const ordenadas = [...brands].sort((a, b) => a.name.localeCompare(b.name))
    const filteredBrands = ordenadas.filter((b) => b.name.toLowerCase().includes(filter.toLowerCase()))

    return (
        <PageContainer className="max-w-4xl">
            <PageHeader
                title="Marcas"
                description="Agrupan tus productos para encontrarlos más rápido en el punto de venta."
            />

            <form data-section="marcas.agregar" onSubmit={agregar} className="space-y-2">
                <Label htmlFor="nueva-marca">Agregar una marca</Label>
                <div className="flex gap-2">
                    <Input id="nueva-marca" value={nueva} onChange={(e) => setNueva(e.target.value)}
                        placeholder="Escribe el nombre, por ejemplo Soprole" className="h-11 text-base" />
                    <Button type="submit" disabled={agregando} className="h-11 text-base">
                        {agregando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Agregar
                    </Button>
                </div>
                <AlertaError mensaje={errorNueva} />
            </form>

            {brands.length > 8 && (
                <ListToolbar
                    busqueda={filter}
                    onBusqueda={setFilter}
                    placeholder="Buscar marca"
                    visibles={filteredBrands.length}
                    total={brands.length}
                    unidad="marcas"
                />
            )}

            <div data-section="marcas.lista" className="overflow-hidden rounded-xl border border-border bg-card">
                {loading ? (
                    <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando marcas...</p>
                ) : filteredBrands.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-muted-foreground">
                        {brands.length === 0 ? 'Todavía no hay marcas. Agrega la primera arriba.' : 'Ninguna marca coincide con la búsqueda.'}
                    </p>
                ) : (
                    <ul className="divide-y divide-border">
                        {filteredBrands.map((brand) => {
                            const n = productosPorMarca.get(brand.id) ?? 0
                            return (
                                <li key={brand.id} className="px-5 py-3">
                                    {editando === brand.id ? (
                                        <form onSubmit={guardarEdicion} className="space-y-2">
                                            <div className="flex flex-wrap gap-2">
                                                <Input value={nombreEditado} onChange={(e) => setNombreEditado(e.target.value)} autoFocus
                                                    aria-label={`Nuevo nombre para ${brand.name}`} className="h-10 flex-1 text-base" />
                                                <Button type="submit" disabled={guardando}>
                                                    {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                                                    Guardar
                                                </Button>
                                                <Button type="button" variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
                                            </div>
                                            <AlertaError mensaje={errorEdicion} />
                                        </form>
                                    ) : (
                                        <div className="flex items-center gap-4">
                                            <span className="flex-1 text-[15px] font-medium text-foreground">{brand.name}</span>
                                            <span className="text-sm text-muted-foreground font-tabular">{n} {n === 1 ? 'producto' : 'productos'}</span>
                                            <span className="flex items-center gap-1">
                                                <Button variant="outline" size="sm" onClick={() => empezarEdicion(brand)}>Renombrar</Button>
                                                <AccionFila icon={Trash2} label="Eliminar" onClick={() => setToDelete(brand)} peligro />
                                            </span>
                                        </div>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                )}
            </div>

            <ConfirmDialog
                open={!!toDelete}
                onOpenChange={(o) => !o && setToDelete(null)}
                title="¿Eliminar marca?"
                description={toDelete?.name}
                onConfirm={async () => { if (toDelete) await handleDelete(toDelete) }}
            />
        </PageContainer>
    )
}
