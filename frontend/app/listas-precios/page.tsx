'use client'

import { useEffect, useState, useCallback } from 'react'
import { AlertaError } from '@/components/ui/alerta-error'
import { avisar } from '@/lib/store/uiStore'
import { Plus, Trash2, Loader2, X, Users, Package, CheckCircle2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import ListToolbar from '@/components/layout/ListToolbar'
import { Button } from '@/components/ui/button'
import { AccionFila } from '@/components/ui/accion-fila'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { SearchInput } from '@/components/ui/search-input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableEmpty,
} from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { getApiErrorMessage, getApiErrorDetail } from '@/services/api'
import {
    getPriceLists, getPriceList, createPriceList, updatePriceList, deletePriceList,
    assignProducts, assignCustomers,
    type PriceListRead, type PriceItem,
} from '@/services/price_lists'
import { getProducts, type Product } from '@/services/products'
import { getCustomers, type Customer } from '@/services/customers'
import { DEFAULT_TAX_RATE, normalizeTaxRate, precioBruto } from '@/lib/taxes'
import { formatCLP } from '@/lib/format'
import { cn } from '@/lib/utils'
import Estado from '@/components/layout/Estado'

// ── Types ─────────────────────────────────────────────────────────────────

type Tab = 'products' | 'customers'

interface DraftItem extends PriceItem {
    product_name: string
    tax_rate: number
    precio_bruto_base: number  // Server-computed gross price for display ratio
}

// ── Tax rate normalizer ───────────────────────────────────────────────────
// Normalize to always be in decimal form.

// ── Item Row (usado tanto en la lista base como en listas personalizadas) ──

function PriceListItemRow({
    item, isGrossMode, onPriceChange, onRemove,
}: {
    item: DraftItem
    isGrossMode: boolean
    onPriceChange: (productId: number, rawValue: string) => void
    onRemove?: (productId: number) => void
}) {
    return (
        <div className="flex items-center gap-2 px-3 py-2 bg-muted rounded-lg border border-border group">
            <span className="flex-1 min-w-0 text-sm truncate text-foreground">
                {item.product_name}
            </span>
            <div className="flex items-center gap-1 shrink-0">
                <Label className="text-xs text-muted-foreground mr-1 hidden sm:inline">
                    {isGrossMode ? 'Bruto:' : 'Neto:'}
                </Label>
                <span className="text-xs text-muted-foreground">$</span>
                <Input
                    type="number"
                    min="0"
                    value={
                        String(item.fixed_price) === ''
                            ? ''
                            : isGrossMode
                                ? Math.round(Number(item.fixed_price) * (1 + item.tax_rate))
                                : Number(item.fixed_price)
                    }
                    onChange={e => onPriceChange(item.product_id, e.target.value)}
                    className="w-24 h-7 text-sm text-right"
                />
            </div>
            {onRemove && (
                <button
                    type="button"
                    onClick={() => onRemove(item.product_id)}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    title="Quitar de la lista"
                >
                    <X className="h-4 w-4" />
                </button>
            )}
        </div>
    )
}

// ── Main Page Component ────────────────────────────────────────────────────

export default function PriceListsPage() {
    const [priceLists, setPriceLists] = useState<PriceListRead[]>([])
    const [busqueda, setBusqueda] = useState('')
    const [loading, setLoading] = useState(true)
    const [deleteId, setDeleteId] = useState<number | null>(null)

    // Modal state
    const [openModal, setOpenModal] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [errorGuardar, setErrorGuardar] = useState<string | null>(null)
    const [editingId, setEditingId] = useState<number | 'base' | null>(null)
    const [activeTab, setActiveTab] = useState<Tab>('products')
    const [isGrossMode, setIsGrossMode] = useState(false)

    // Form fields
    const [formName, setFormName] = useState('')
    const [formDescription, setFormDescription] = useState('')

    // Products tab
    const [allProducts, setAllProducts] = useState<Product[]>([])
    const [productSearch, setProductSearch] = useState('')
    const [draftSearch, setDraftSearch] = useState('')
    const [draftItems, setDraftItems] = useState<DraftItem[]>([])

    // Customers tab
    const [allCustomers, setAllCustomers] = useState<Customer[]>([])
    const [customerSearch, setCustomerSearch] = useState('')
    const [selectedCustomerIds, setSelectedCustomerIds] = useState<number[]>([])

    // ── Fetch Price Lists ──────────────────────────────────────────────────

    // Lista elegida para ver sus precios, y lo necesario para contar y mostrarlos.
    const [elegidaId, setElegidaId] = useState<number | null>(null)
    const [detalles, setDetalles] = useState<Record<number, PriceItem[]>>({})
    const [clientesPorLista, setClientesPorLista] = useState<Map<number, number>>(new Map())
    const [catalogo, setCatalogo] = useState<Product[]>([])
    const [buscarPrecio, setBuscarPrecio] = useState('')

    const fetchLists = useCallback(() => {
        setLoading(true)
        Promise.all([getPriceLists(), getCustomers(), getProducts()])
            .then(async ([listas, clientes, productos]) => {
                setPriceLists(listas)
                setCatalogo(productos)
                const cuenta = new Map<number, number>()
                clientes.forEach(c => { if (c.price_list_id) cuenta.set(c.price_list_id, (cuenta.get(c.price_list_id) ?? 0) + 1) })
                setClientesPorLista(cuenta)
                const conItems = await Promise.all(listas.map(l => getPriceList(l.id)))
                setDetalles(Object.fromEntries(conItems.map(d => [d.id, d.items])))
            })
            .catch(err => avisar(getApiErrorMessage(err, 'Error cargando las listas de precios'), { reintentar: fetchLists }))
            .finally(() => setLoading(false))
    }, [])

    useEffect(() => { fetchLists() }, [fetchLists])

    // ── Flatten helper ─────────────────────────────────────────────────────

    const flattenProducts = (prods: Product[]): Product[] => {
        const result: Product[] = []
        prods.forEach(p => {
            if (!p.parent_id) {
                if (p.variants && p.variants.length > 0) {
                    p.variants.forEach(v => {
                        if (v.is_active) result.push({ ...v, full_name: `${p.nombre} - ${v.nombre}` } as Product)
                    })
                } else if (p.is_active) {
                    result.push(p)
                }
            }
        })
        return result
    }

    // ── Open Create Modal ──────────────────────────────────────────────────

    const openCreate = async () => {
        setEditingId(null)
        setFormName('')
        setFormDescription('')
        setDraftItems([])
        setSelectedCustomerIds([])
        setDraftSearch('')
        setProductSearch('')
        setActiveTab('products')
        setIsGrossMode(false)
        const [prods, custs] = await Promise.all([getProducts(), getCustomers()])
        setAllProducts(flattenProducts(prods))
        setAllCustomers(custs.filter(c => c.is_active))
        setOpenModal(true)
    }

    // ── Open Edit Base ─────────────────────────────────────────────────────

    const openEditBase = async () => {
        setEditingId('base')
        setFormName('Precio base (catálogo general)')
        setFormDescription('Precios por defecto de todos los productos (netos).')
        setActiveTab('products')
        setDraftSearch('')
        setProductSearch('')
        setIsGrossMode(false)

        const prods = await getProducts()
        const flat = flattenProducts(prods)
        setAllProducts(flat)

        setDraftItems(flat.map(p => ({
            product_id: p.id,
            product_name: p.full_name,
            fixed_price: parseFloat(String(p.precio_neto)),
            tax_rate: normalizeTaxRate(p.tax?.rate ?? 0.19),
            precio_bruto_base: Number(p.precio_bruto)
        })))

        setOpenModal(true)
    }

    // ── Open Edit Modal ────────────────────────────────────────────────────

    const openEdit = async (id: number) => {
        setEditingId(id)
        setActiveTab('products')
        setDraftSearch('')
        setProductSearch('')
        setIsGrossMode(false)
        const [detail, prods, custs] = await Promise.all([
            getPriceList(id),
            getProducts(),
            getCustomers(),
        ])
        setFormName(detail.name)
        setFormDescription(detail.description ?? '')

        const flat = flattenProducts(prods)
        setAllProducts(flat)
        setAllCustomers(custs.filter(c => c.is_active))

        const prodMap = new Map(flat.map(p => [p.id, p]))
        setDraftItems(detail.items.map(item => {
            const prod = prodMap.get(item.product_id)
            return {
                ...item,
                product_name: prod?.full_name ?? `Producto #${item.product_id}`,
                tax_rate: normalizeTaxRate(prod?.tax?.rate ?? 0.19),
                precio_bruto_base: prod ? Number(prod.precio_bruto) : 0
            }
        }))

        const assignedIds = custs.filter(c => c.price_list_id === id).map(c => c.id)
        setSelectedCustomerIds(assignedIds)

        setOpenModal(true)
    }

    // ── Save ───────────────────────────────────────────────────────────────

    const handleSave = async () => {
        setErrorGuardar(null)
        if (!formName.trim()) {
            setErrorGuardar('El nombre de la lista es obligatorio.')
            return
        }
        setIsSaving(true)
        try {
            if (editingId === 'base') {
                const { updateProduct } = await import('@/services/products')
                const changed = draftItems.filter(draft => {
                    const original = allProducts.find(p => p.id === draft.product_id)
                    return original && parseFloat(original.precio_neto) !== parseFloat(String(draft.fixed_price))
                })
                await Promise.all(changed.map(item =>
                    updateProduct(item.product_id, { precio_neto: String(item.fixed_price) })
                ))
            } else {
                let listId = editingId
                if (listId) {
                    await updatePriceList(listId, { name: formName, description: formDescription || undefined })
                } else {
                    const created = await createPriceList({ name: formName, description: formDescription || undefined })
                    listId = created.id
                }
                await assignProducts(listId!, draftItems.map(i => ({ product_id: i.product_id, fixed_price: Number(i.fixed_price) })))
                await assignCustomers(listId!, selectedCustomerIds)
            }
            setOpenModal(false)
            fetchLists()
        } catch (err) {
            setErrorGuardar(getApiErrorDetail(err, 'No se pudieron guardar los cambios.'))
        } finally {
            setIsSaving(false)
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────

    const handleDelete = async () => {
        if (!deleteId) return
        try {
            await deletePriceList(deleteId)
            fetchLists()
        } catch (err) {
            avisar(getApiErrorDetail(err, 'No se pudo eliminar la lista.'))
        }
    }

    // ── Products tab helpers ──────────────────────────────────────────────

    const addedIds = new Set(draftItems.map(d => d.product_id))

    const catalogProducts = allProducts.filter(p => {
        const notAdded = !addedIds.has(p.id)
        if (!productSearch) return notAdded
        return notAdded && (
            p.full_name.toLowerCase().includes(productSearch.toLowerCase()) ||
            p.codigo_interno.toLowerCase().includes(productSearch.toLowerCase())
        )
    })

    const addProduct = (p: Product) => {
        setDraftItems(prev => [...prev, {
            product_id: p.id,
            product_name: p.full_name,
            fixed_price: parseFloat(String(p.precio_neto)),
            tax_rate: normalizeTaxRate(p.tax?.rate ?? 0.19),
            precio_bruto_base: Number(p.precio_bruto)
        }])
    }

    const removeProduct = (product_id: number) =>
        setDraftItems(prev => prev.filter(i => i.product_id !== product_id))

    const updateFixedPrice = (product_id: number, rawValue: string) => {
        setDraftItems(prev => prev.map(i => {
            if (i.product_id === product_id) {
                if (rawValue === '') return { ...i, fixed_price: '' }
                const val = parseFloat(rawValue)
                if (isNaN(val)) return i
                if (isGrossMode) {
                    return { ...i, fixed_price: parseFloat((val / (1 + i.tax_rate)).toFixed(4)) }
                }
                return { ...i, fixed_price: val }
            }
            return i
        }))
    }

    // ── Customers tab helpers ─────────────────────────────────────────────

    const filteredCustomers = allCustomers.filter(c =>
        c.razon_social.toLowerCase().includes(customerSearch.toLowerCase()) ||
        c.rut.includes(customerSearch)
    )

    const toggleCustomer = (id: number) =>
        setSelectedCustomerIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

    // ── Render ────────────────────────────────────────────────────────────

    const listasVisibles = priceLists.filter(pl => pl.name.toLowerCase().includes(busqueda.trim().toLowerCase()))
    const elegida = priceLists.find(pl => pl.id === elegidaId) ?? listasVisibles[0]
    const productoPorId = new Map(flattenProducts(catalogo).map(p => [p.id, p]))
    const preciosElegida = (detalles[elegida?.id ?? -1] ?? [])
        .map(item => {
            const prod = productoPorId.get(item.product_id)
            const tasa = normalizeTaxRate(prod?.tax?.rate ?? DEFAULT_TAX_RATE)
            const normal = prod ? Number(prod.precio_bruto) : 0
            const enLista = precioBruto(Number(item.fixed_price), tasa)
            return { id: item.product_id, nombre: prod?.full_name ?? `Producto #${item.product_id}`, normal, enLista }
        })
        .filter(p => p.nombre.toLowerCase().includes(buscarPrecio.trim().toLowerCase()))

    return (
        <PageContainer>
            <PageHeader
                title="Listas de precios"
                description="Precios especiales para grupos de clientes. Quien tiene una lista asignada paga esos precios en vez del normal."
                actions={
                    <>
                        <Button variant="outline" onClick={openEditBase} className="h-11">Cambiar precios normales</Button>
                        <Button onClick={openCreate} className="h-11 text-base">
                            <Plus className="h-4 w-4" /> Nueva lista
                        </Button>
                    </>
                }
            />

            {priceLists.length > 3 && (
                <ListToolbar
                    busqueda={busqueda}
                    onBusqueda={setBusqueda}
                    placeholder="Buscar lista por nombre"
                    visibles={listasVisibles.length}
                    total={priceLists.length}
                    unidad="listas"
                />
            )}

            {loading ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando listas...</p>
            ) : priceLists.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center">
                    <p className="text-base font-medium text-foreground">Todavía no tienes listas de precios.</p>
                    <p className="mt-1 text-sm text-muted-foreground">Crea una para cobrarle otros precios a un grupo de clientes, por ejemplo a los mayoristas.</p>
                    <Button onClick={openCreate} className="mt-4"><Plus className="h-4 w-4" /> Nueva lista</Button>
                </div>
            ) : (
                <>
                    <div data-section="listas-precios.tarjetas" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {listasVisibles.map(pl => {
                            const activa = pl.id === elegida?.id
                            const clientes = clientesPorLista.get(pl.id) ?? 0
                            const productos = detalles[pl.id]?.length ?? 0
                            return (
                                <div key={pl.id} className={cn(
                                    'flex flex-col gap-3 rounded-xl border bg-card p-5 transition-colors',
                                    activa ? 'border-primary ring-1 ring-primary' : 'border-border',
                                )}>
                                    <button type="button" onClick={() => setElegidaId(pl.id)} className="text-left cursor-pointer" aria-pressed={activa}>
                                        <h2 className="text-base font-semibold text-foreground">{pl.name}</h2>
                                        <p className="mt-1 text-sm text-muted-foreground">{pl.description || 'Sin descripción'}</p>
                                    </button>
                                    <div className="flex flex-wrap gap-2">
                                        <Estado>{clientes} {clientes === 1 ? 'cliente' : 'clientes'}</Estado>
                                        <Estado>{productos} {productos === 1 ? 'producto' : 'productos'}</Estado>
                                    </div>
                                    <div className="mt-auto flex items-center gap-1">
                                        <Button variant="outline" size="sm" onClick={() => openEdit(pl.id)}>Editar lista</Button>
                                        <AccionFila icon={Trash2} label="Eliminar" onClick={() => setDeleteId(pl.id)} peligro />
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {elegida && (
                        <section data-section="listas-precios.precios" className="space-y-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                                <div>
                                    <h2 className="text-lg font-semibold text-foreground">Precios de {elegida.name}</h2>
                                    <p className="text-sm text-muted-foreground">Los productos que no están aquí se cobran a precio normal. Precios con impuesto.</p>
                                </div>
                                <SearchInput className="w-full sm:max-w-xs" placeholder="Buscar en la lista" value={buscarPrecio}
                                    onChange={e => setBuscarPrecio(e.target.value)} onClear={() => setBuscarPrecio('')} />
                            </div>
                            <div className="overflow-hidden rounded-xl border border-border bg-card">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Producto</TableHead>
                                            <TableHead className="text-right">Precio normal</TableHead>
                                            <TableHead className="text-right">Precio en la lista</TableHead>
                                            <TableHead className="text-right">Diferencia</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {preciosElegida.length === 0 ? (
                                            <TableEmpty colSpan={4}>
                                                {buscarPrecio ? 'Ningún producto coincide.' : 'Esta lista todavía no tiene productos. Agrégalos con Editar lista.'}
                                            </TableEmpty>
                                        ) : preciosElegida.map(p => {
                                            const dif = p.normal > 0 ? Math.round(((p.enLista - p.normal) / p.normal) * 100) : 0
                                            return (
                                                <TableRow key={p.id}>
                                                    <TableCell className="text-[15px] text-foreground">{p.nombre}</TableCell>
                                                    <TableCell className="text-right text-[15px] text-muted-foreground font-tabular">{formatCLP(p.normal)}</TableCell>
                                                    <TableCell className="text-right text-[15px] font-semibold text-foreground font-tabular">{formatCLP(p.enLista)}</TableCell>
                                                    <TableCell className="text-right">
                                                        <Estado tono={dif < 0 ? 'bien' : dif > 0 ? 'alerta' : 'neutro'}>{dif > 0 ? '+' : ''}{dif}%</Estado>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        </section>
                    )}
                </>
            )}

            {/* Create / Edit Modal */}
            <Dialog open={openModal} onOpenChange={(o) => { setOpenModal(o); setErrorGuardar(null) }}>
                <DialogContent data-section="listas-precios.formulario" className="sm:max-w-4xl bg-card border-border max-h-[90vh] flex flex-col overflow-hidden">
                    <DialogHeader>
                        <DialogTitle>
                            {editingId === 'base' ? 'Editar lista base' : (editingId ? 'Editar lista de precios' : 'Nueva lista de precios')}
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground">
                            {editingId === 'base'
                                ? 'Modifica directamente los precios netos por defecto de tus productos.'
                                : 'Define el nombre, los productos con precios fijos y los clientes asignados.'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto space-y-5 py-4 pr-1">

                        {/* Basic fields */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Nombre <span className="text-destructive">*</span></Label>
                                <Input
                                    placeholder="Ej. Clientes mayoristas"
                                    value={formName}
                                    onChange={e => setFormName(e.target.value)}
                                    disabled={editingId === 'base'}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Descripción</Label>
                                <Input
                                    placeholder="Ej. Descuentos especiales para clientes B2B"
                                    value={formDescription}
                                    onChange={e => setFormDescription(e.target.value)}
                                    disabled={editingId === 'base'}
                                />
                            </div>
                        </div>

                        {/* Tabs */}
                        <Tabs value={activeTab} onValueChange={v => setActiveTab(v as Tab)}>
                            <TabsList>
                                <TabsTrigger value="products" className="gap-2">
                                    <Package className="h-4 w-4" /> Productos
                                    {draftItems.length > 0 && <Badge variant="secondary" className="h-5 px-1.5 text-xs">{draftItems.length}</Badge>}
                                </TabsTrigger>
                                {editingId !== 'base' && (
                                    <TabsTrigger value="customers" className="gap-2">
                                        <Users className="h-4 w-4" /> Clientes
                                        {selectedCustomerIds.length > 0 && <Badge variant="secondary" className="h-5 px-1.5 text-xs">{selectedCustomerIds.length}</Badge>}
                                    </TabsTrigger>
                                )}
                            </TabsList>
                        </Tabs>

                        {/* Products Tab */}
                        {activeTab === 'products' && (
                            <div className="space-y-4 flex flex-col">

                                {/* Toggle (search bars live inside each panel for custom lists; base mode keeps a single global one) */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
                                    {editingId === 'base' && (
                                        <SearchInput className="flex-1" placeholder="Filtrar catálogo por nombre..." value={draftSearch} onChange={e => setDraftSearch(e.target.value)} />
                                    )}
                                    <div className="flex items-center gap-2 shrink-0 bg-muted px-3 py-1.5 rounded-lg border border-border ml-auto">
                                        <Label htmlFor="tax-toggle" className="text-xs font-medium text-muted-foreground cursor-pointer">
                                            {isGrossMode ? 'Bruto (c/ IVA)' : 'Neto (s/ IVA)'}
                                        </Label>
                                        <Switch
                                            id="tax-toggle"
                                            checked={isGrossMode}
                                            onCheckedChange={setIsGrossMode}
                                        />
                                    </div>
                                </div>

                                {editingId === 'base' ? (
                                    /* ── Lista base: un solo panel, todo el catálogo ya está "en la lista" ── */
                                    <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-0.5">
                                        {draftItems
                                            .filter(item => item.product_name.toLowerCase().includes(draftSearch.toLowerCase()))
                                            .map(item => (
                                                <PriceListItemRow
                                                    key={item.product_id}
                                                    item={item}
                                                    isGrossMode={isGrossMode}
                                                    onPriceChange={updateFixedPrice}
                                                />
                                            ))}
                                    </div>
                                ) : (
                                    /* ── Lista personalizada: seleccionados y catálogo lado a lado, para que
                                       lo que ya está en la lista no quede tapado ni empujado hacia abajo. ── */
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-h-0">
                                        {/* Columna izquierda: lo que ya está en la lista */}
                                        <div className="space-y-2 min-w-0 flex flex-col">
                                            <div className="flex items-center gap-2 shrink-0">
                                                <div className="flex items-center justify-center h-6 w-6 rounded-md bg-primary/10 text-primary shrink-0">
                                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-foreground leading-tight">
                                                        Esta lista ({draftItems.length})
                                                    </p>
                                                    <p className="text-xs text-muted-foreground leading-tight">
                                                        Precios que se guardarán al confirmar
                                                    </p>
                                                </div>
                                            </div>
                                            <SearchInput className="shrink-0" placeholder="Buscar dentro de esta lista..." value={draftSearch} onChange={e => setDraftSearch(e.target.value)} disabled={draftItems.length === 0} />
                                            <div className="rounded-lg border border-border bg-card h-[336px] overflow-y-auto p-1.5">
                                                {draftItems.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground text-xs px-4">
                                                        <Package className="h-7 w-7 mb-2 opacity-40" />
                                                        Aún no has agregado productos.
                                                        <br />Selecciónalos del catálogo de la derecha →
                                                    </div>
                                                ) : (() => {
                                                    const visibleItems = draftItems.filter(item =>
                                                        item.product_name.toLowerCase().includes(draftSearch.toLowerCase())
                                                    )
                                                    return visibleItems.length === 0 ? (
                                                        <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground text-xs px-4">
                                                            Sin resultados para &quot;{draftSearch}&quot; en esta lista.
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-1.5">
                                                            {visibleItems.map(item => (
                                                                <PriceListItemRow
                                                                    key={item.product_id}
                                                                    item={item}
                                                                    isGrossMode={isGrossMode}
                                                                    onPriceChange={updateFixedPrice}
                                                                    onRemove={removeProduct}
                                                                />
                                                            ))}
                                                        </div>
                                                    )
                                                })()}
                                            </div>
                                        </div>

                                        {/* Columna derecha: catálogo disponible para agregar */}
                                        <div className="space-y-2 min-w-0 flex flex-col">
                                            <div className="flex items-center gap-2 shrink-0">
                                                <div className="flex items-center justify-center h-6 w-6 rounded-md bg-muted text-muted-foreground shrink-0">
                                                    <Package className="h-3.5 w-3.5" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold text-foreground leading-tight">
                                                        Catálogo completo
                                                    </p>
                                                    <p className="text-xs text-muted-foreground leading-tight">
                                                        Haz clic en un producto para agregarlo a la lista ←
                                                    </p>
                                                </div>
                                            </div>
                                            <SearchInput className="shrink-0" placeholder="Buscar producto por nombre o código..." value={productSearch} onChange={e => setProductSearch(e.target.value)} />
                                            <div className="rounded-lg border border-border bg-card h-[336px] overflow-y-auto p-1.5">
                                                {allProducts.length === 0 ? (
                                                    <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground text-xs px-4">
                                                        <Package className="h-7 w-7 mb-2 opacity-40" />
                                                        No hay productos en el catálogo todavía.
                                                        <br />Agrégalos desde Inventario.
                                                    </div>
                                                ) : catalogProducts.length > 0 ? (
                                                    <div className="space-y-1.5">
                                                        {catalogProducts.map(p => (
                                                            <button
                                                                key={p.id}
                                                                type="button"
                                                                onClick={() => addProduct(p)}
                                                                className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-background hover:border-primary/40 hover:bg-primary/5 transition-all text-left group cursor-pointer"
                                                            >
                                                                <div className="min-w-0 flex-1">
                                                                    <p className="text-xs font-medium text-foreground truncate leading-tight">{p.full_name}</p>
                                                                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{p.codigo_interno}</p>
                                                                </div>
                                                                <div className="shrink-0 ml-2 text-right flex items-center gap-1.5">
                                                                    <p className="text-xs font-semibold text-muted-foreground">
                                                                        ${(isGrossMode
                                                                            ? Number(p.precio_bruto)
                                                                            : Number(p.precio_neto)
                                                                        ).toLocaleString('es-CL')}
                                                                    </p>
                                                                    <Plus className="h-3.5 w-3.5 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col items-center justify-center h-full text-center text-xs px-4">
                                                        {productSearch ? (
                                                            <span className="text-muted-foreground">Sin resultados para &quot;{productSearch}&quot;</span>
                                                        ) : (
                                                            <span className="flex items-center gap-2 text-primary">
                                                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                                                                Todo el catálogo ya está en esta lista.
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Customers Tab */}
                        {activeTab === 'customers' && (
                            <div className="space-y-3">
                                <SearchInput placeholder="Buscar cliente por nombre o RUT..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} />

                                {selectedCustomerIds.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {allCustomers
                                            .filter(c => selectedCustomerIds.includes(c.id))
                                            .map(c => (
                                                <Badge
                                                    key={c.id}
                                                    className="flex items-center gap-1 bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer text-xs"
                                                    onClick={() => toggleCustomer(c.id)}
                                                >
                                                    {c.razon_social}
                                                    <X className="h-3 w-3" />
                                                </Badge>
                                            ))}
                                    </div>
                                )}

                                <div className="rounded-lg border border-border bg-card max-h-64 overflow-y-auto">
                                    {filteredCustomers.length === 0
                                        ? <p className="text-xs text-muted-foreground px-4 py-3 text-center">Sin clientes que coincidan</p>
                                        : filteredCustomers.map(c => {
                                            const isSelected = selectedCustomerIds.includes(c.id)
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    onClick={() => toggleCustomer(c.id)}
                                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors text-left ${isSelected
                                                        ? 'bg-primary/10 text-primary'
                                                        : 'hover:bg-accent text-foreground'
                                                        }`}
                                                >
                                                    <span>{c.razon_social}</span>
                                                    <span className="text-xs text-muted-foreground font-mono">{c.rut}</span>
                                                </button>
                                            )
                                        })}
                                </div>

                                <p className="text-xs text-muted-foreground">
                                    {selectedCustomerIds.length} cliente(s) seleccionado(s). Al guardar, se aplicará esta lista a todos ellos.
                                </p>
                            </div>
                        )}
                    </div>

                    <AlertaError mensaje={errorGuardar} />
                    <DialogFooter className="border-t border-border pt-4">
                        <Button type="button" variant="outline" onClick={() => setOpenModal(false)} className="border-border cursor-pointer">
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="cursor-pointer"
                        >
                            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                            {isSaving ? 'Guardando...' : (editingId ? 'Guardar cambios' : 'Crear lista')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <ConfirmDialog
                open={!!deleteId}
                onOpenChange={o => !o && setDeleteId(null)}
                title="¿Eliminar lista de precios?"
                description="Los clientes asignados quedarán sin lista de precios y se aplicará el precio base. Esta acción no se puede deshacer."
                onConfirm={handleDelete}
            />
        </PageContainer>
    )
}
