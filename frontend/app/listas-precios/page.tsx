'use client'

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Plus, Pencil, Trash2, Loader2, Tag, Search, X, Users, Package, CheckCircle2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { getApiErrorMessage } from '@/services/api'
import {
    getPriceLists, getPriceList, createPriceList, updatePriceList, deletePriceList,
    assignProducts, assignCustomers,
    type PriceListRead, type PriceItem,
} from '@/services/price_lists'
import { getProducts, type Product } from '@/services/products'
import { getCustomers, type Customer } from '@/services/customers'

// ── Types ─────────────────────────────────────────────────────────────────

type Tab = 'products' | 'customers'

interface DraftItem extends PriceItem {
    product_name: string
    tax_rate: number
}

// ── Main Page Component ────────────────────────────────────────────────────

export default function PriceListsPage() {
    const [priceLists, setPriceLists] = useState<PriceListRead[]>([])
    const [loading, setLoading] = useState(true)
    const [deleteId, setDeleteId] = useState<number | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)

    // Modal state
    const [openModal, setOpenModal] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
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

    const fetchLists = useCallback(() => {
        setLoading(true)
        getPriceLists()
            .then(setPriceLists)
            .catch(err => toast.error(getApiErrorMessage(err, 'Error cargando las listas de precios')))
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
        setFormName('Precio Base (Catálogo General)')
        setFormDescription('Precios por defecto de todos los productos (Netos).')
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
            tax_rate: p.tax?.rate ?? 0.19
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
                tax_rate: prod?.tax?.rate ?? 0.19
            }
        }))

        const assignedIds = custs.filter(c => (c as any).price_list_id === id).map(c => c.id)
        setSelectedCustomerIds(assignedIds)

        setOpenModal(true)
    }

    // ── Save ───────────────────────────────────────────────────────────────

    const handleSave = async () => {
        if (!formName.trim()) {
            toast.error('El nombre de la lista es obligatorio.')
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
                toast.success('Precios base actualizados correctamente')
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
                toast.success(editingId ? 'Lista actualizada' : 'Lista creada correctamente')
            }
            setOpenModal(false)
            fetchLists()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Error guardando los cambios'))
        } finally {
            setIsSaving(false)
        }
    }

    // ── Delete ────────────────────────────────────────────────────────────

    const handleDelete = async () => {
        if (!deleteId) return
        setIsDeleting(true)
        try {
            await deletePriceList(deleteId)
            toast.success('Lista eliminada')
            setDeleteId(null)
            fetchLists()
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'Error al eliminar'))
        } finally {
            setIsDeleting(false)
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
            tax_rate: p.tax?.rate ?? 0.19
        }])
    }

    const removeProduct = (product_id: number) =>
        setDraftItems(prev => prev.filter(i => i.product_id !== product_id))

    const updateFixedPrice = (product_id: number, rawValue: string) => {
        setDraftItems(prev => prev.map(i => {
            if (i.product_id === product_id) {
                if (rawValue === '') return { ...i, fixed_price: '' as any }
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

    return (
        <div className="p-6 md:p-10 space-y-6 max-w-5xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-neutral-900 dark:text-white flex items-center gap-2">
                        <Tag className="h-6 w-6 text-blue-600" />
                        Listas de Precios
                    </h1>
                    <p className="text-sm text-neutral-500 mt-1">
                        Crea listas con precios fijos para grupos de clientes.
                    </p>
                </div>
                <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-600/20 cursor-pointer">
                    <Plus className="h-4 w-4 mr-2" /> Nueva Lista
                </Button>
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden">
                <Table>
                    <TableHeader className="bg-neutral-50 dark:bg-neutral-900/60 border-b border-neutral-200 dark:border-neutral-800">
                        <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
                            <TableHead className="text-xs uppercase tracking-wider text-neutral-400 font-medium">Nombre</TableHead>
                            <TableHead className="text-xs uppercase tracking-wider text-neutral-400 font-medium">Descripción</TableHead>
                            <TableHead className="text-right text-xs uppercase tracking-wider text-neutral-400 font-medium">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {/* Lista Base hardcodeada */}
                        {!loading && (
                            <TableRow className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30 transition-colors">
                                <TableCell className="font-medium">
                                    <div className="flex items-center gap-2">
                                        <Tag className="h-4 w-4 text-neutral-400 shrink-0" />
                                        Precio Base (Catálogo General)
                                    </div>
                                </TableCell>
                                <TableCell className="text-sm text-neutral-500 dark:text-neutral-400">
                                    Precios por defecto de todos los productos del sistema.
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-neutral-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                                        onClick={openEditBase}
                                        title="Editar Precios Base"
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        )}
                        {loading && Array(3).fill(0).map((_, i) => (
                            <TableRow key={i} className="border-b border-neutral-100 dark:border-neutral-800">
                                <TableCell><Skeleton className="h-4 w-[200px]" /></TableCell>
                                <TableCell><Skeleton className="h-4 w-[300px]" /></TableCell>
                                <TableCell />
                            </TableRow>
                        ))}
                        {!loading && priceLists.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={3} className="py-12 text-center text-neutral-400">
                                    No hay listas personalizadas aún. Crea tu primera lista con el botón de arriba.
                                </TableCell>
                            </TableRow>
                        )}
                        {!loading && priceLists.map(pl => (
                            <TableRow key={pl.id} className="border-b border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30 transition-colors">
                                <TableCell className="font-medium text-neutral-900 dark:text-neutral-100">
                                    <div className="flex items-center gap-2">
                                        <Tag className="h-4 w-4 text-blue-500 shrink-0" />
                                        {pl.name}
                                    </div>
                                </TableCell>
                                <TableCell className="text-neutral-500 dark:text-neutral-400 text-sm">
                                    {pl.description || <span className="italic text-neutral-300 dark:text-neutral-600">Sin descripción</span>}
                                </TableCell>
                                <TableCell className="text-right">
                                    <div className="flex items-center justify-end gap-1">
                                        <Button
                                            variant="ghost" size="icon"
                                            className="h-8 w-8 text-neutral-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer"
                                            onClick={() => openEdit(pl.id)}
                                            title="Editar"
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost" size="icon"
                                            className="h-8 w-8 text-neutral-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 cursor-pointer"
                                            onClick={() => setDeleteId(pl.id)}
                                            title="Eliminar"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Create / Edit Modal */}
            <Dialog open={openModal} onOpenChange={setOpenModal}>
                <DialogContent className="sm:max-w-2xl bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 max-h-[90vh] flex flex-col overflow-hidden">
                    <DialogHeader>
                        <DialogTitle>
                            {editingId === 'base' ? 'Editar Lista Base' : (editingId ? 'Editar Lista de Precios' : 'Nueva Lista de Precios')}
                        </DialogTitle>
                        <DialogDescription className="text-neutral-500">
                            {editingId === 'base'
                                ? 'Modifica directamente los precios netos por defecto de tus productos.'
                                : 'Define el nombre, los productos con precios fijos y los clientes asignados.'}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex-1 overflow-y-auto space-y-5 py-4 pr-1">

                        {/* Basic fields */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Nombre <span className="text-red-500">*</span></Label>
                                <Input
                                    placeholder="Ej. Clientes Mayoristas"
                                    value={formName}
                                    onChange={e => setFormName(e.target.value)}
                                    disabled={editingId === 'base'}
                                    className="border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Descripción</Label>
                                <Input
                                    placeholder="Ej. Descuentos especiales para clientes B2B"
                                    value={formDescription}
                                    onChange={e => setFormDescription(e.target.value)}
                                    disabled={editingId === 'base'}
                                    className="border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500"
                                />
                            </div>
                        </div>

                        {/* Tabs */}
                        <div className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
                            {([
                                ['products', 'Productos', Package],
                                ...(editingId === 'base' ? [] : [['customers', 'Clientes', Users]])
                            ] as const).map(([key, label, Icon]: any) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setActiveTab(key as Tab)}
                                    className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === key
                                        ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                                        : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
                                        }`}
                                >
                                    <Icon className="h-4 w-4" />
                                    {label}
                                    {key === 'products' && draftItems.length > 0 &&
                                        <Badge className="ml-1 h-4 text-[10px] px-1 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">{draftItems.length}</Badge>
                                    }
                                    {key === 'customers' && selectedCustomerIds.length > 0 &&
                                        <Badge className="ml-1 h-4 text-[10px] px-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{selectedCustomerIds.length}</Badge>
                                    }
                                </button>
                            ))}
                        </div>

                        {/* Products Tab */}
                        {activeTab === 'products' && (
                            <div className="space-y-4 flex flex-col">

                                {/* Search + Toggle */}
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
                                        <Input
                                            placeholder={editingId === 'base' ? 'Filtrar catálogo por nombre...' : 'Buscar producto por nombre o código...'}
                                            value={editingId === 'base' ? draftSearch : productSearch}
                                            onChange={e => editingId === 'base' ? setDraftSearch(e.target.value) : setProductSearch(e.target.value)}
                                            className="pl-9 border-neutral-200 dark:border-neutral-800 text-sm"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 bg-neutral-50 dark:bg-neutral-800/50 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700">
                                        <Label htmlFor="tax-toggle" className="text-xs font-medium text-neutral-600 dark:text-neutral-300 cursor-pointer">
                                            {isGrossMode ? 'Bruto (c/ IVA)' : 'Neto (s/ IVA)'}
                                        </Label>
                                        <Switch
                                            id="tax-toggle"
                                            checked={isGrossMode}
                                            onCheckedChange={setIsGrossMode}
                                        />
                                    </div>
                                </div>

                                {/* ── Catalog browser: shown only for custom lists (not base mode) ── */}
                                {editingId !== 'base' && (
                                    <div className="shrink-0 space-y-2">
                                        {catalogProducts.length > 0 ? (
                                            <>
                                                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
                                                    {productSearch
                                                        ? `${catalogProducts.length} resultado${catalogProducts.length !== 1 ? 's' : ''} — haz clic para agregar`
                                                        : `Catálogo disponible (${catalogProducts.length}) — haz clic en un producto para agregarlo`}
                                                </p>
                                                <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-0.5">
                                                    {catalogProducts.map(p => (
                                                        <button
                                                            key={p.id}
                                                            type="button"
                                                            onClick={() => addProduct(p)}
                                                            className="flex items-center justify-between px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-blue-400 hover:bg-blue-50/60 dark:hover:bg-blue-900/20 transition-all text-left group cursor-pointer"
                                                        >
                                                            <div className="min-w-0 flex-1">
                                                                <p className="text-xs font-medium text-neutral-800 dark:text-neutral-100 truncate leading-tight">{p.full_name}</p>
                                                                <p className="text-[10px] text-neutral-400 font-mono mt-0.5">{p.codigo_interno}</p>
                                                            </div>
                                                            <div className="shrink-0 ml-2 text-right">
                                                                <p className="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">
                                                                    ${(isGrossMode
                                                                        ? Math.round(Number(p.precio_neto) * (1 + (p.tax?.rate ?? 0.19)))
                                                                        : Number(p.precio_neto)
                                                                    ).toLocaleString('es-CL')}
                                                                </p>
                                                                <Plus className="h-3 w-3 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
                                                            </div>
                                                        </button>
                                                    ))}
                                                </div>
                                            </>
                                        ) : productSearch ? (
                                            <p className="text-xs text-neutral-400 px-1">Sin resultados para &quot;{productSearch}&quot;</p>
                                        ) : allProducts.length > 0 ? (
                                            <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 py-1">
                                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                                                Todos los productos del catálogo ya están incluidos en esta lista.
                                            </div>
                                        ) : null}
                                    </div>
                                )}

                                {/* ── Selected products with price inputs ── */}
                                {draftItems.length > 0 && (
                                    <div className="shrink-0 space-y-2">
                                        {editingId !== 'base' && (
                                            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wide">
                                                En esta lista ({draftItems.length})
                                            </p>
                                        )}
                                        <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5">
                                            {draftItems
                                                .filter(item =>
                                                    editingId !== 'base' ||
                                                    item.product_name.toLowerCase().includes(draftSearch.toLowerCase())
                                                )
                                                .map(item => (
                                                    <div
                                                        key={item.product_id}
                                                        className="flex items-center gap-3 px-3 py-2 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-200 dark:border-neutral-800 group"
                                                    >
                                                        <span className="flex-1 text-sm truncate text-neutral-800 dark:text-neutral-200">
                                                            {item.product_name}
                                                        </span>
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            <Label className="text-xs text-neutral-400 mr-1">
                                                                {isGrossMode ? 'Bruto:' : 'Neto:'}
                                                            </Label>
                                                            <span className="text-xs text-neutral-400">$</span>
                                                            <Input
                                                                type="number"
                                                                min="0"
                                                                value={
                                                                    String(item.fixed_price) === ''
                                                                        ? ''
                                                                        : isGrossMode
                                                                            ? Math.round(Number(item.fixed_price) * (1 + item.tax_rate))
                                                                            : item.fixed_price
                                                                }
                                                                onChange={e => updateFixedPrice(item.product_id, e.target.value)}
                                                                className="w-28 h-7 text-sm text-right border-neutral-300 dark:border-neutral-700 focus-visible:ring-blue-500"
                                                            />
                                                        </div>
                                                        {editingId !== 'base' && (
                                                            <button
                                                                type="button"
                                                                onClick={() => removeProduct(item.product_id)}
                                                                className="text-neutral-300 hover:text-red-500 transition-colors"
                                                                title="Quitar de la lista"
                                                            >
                                                                <X className="h-4 w-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                        </div>
                                    </div>
                                )}

                                {/* True empty state: no products in the catalog at all */}
                                {editingId !== 'base' && allProducts.length === 0 && (
                                    <div className="flex flex-col items-center justify-center py-10 text-neutral-400 text-sm rounded-lg border border-dashed border-neutral-200 dark:border-neutral-800">
                                        <Package className="h-8 w-8 mb-2 opacity-40" />
                                        No hay productos en el catálogo todavía. Agrégalos desde Inventario.
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Customers Tab */}
                        {activeTab === 'customers' && (
                            <div className="space-y-3">
                                <div className="relative">
                                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-neutral-400" />
                                    <Input
                                        placeholder="Buscar cliente por nombre o RUT..."
                                        value={customerSearch}
                                        onChange={e => setCustomerSearch(e.target.value)}
                                        className="pl-9 border-neutral-200 dark:border-neutral-800 text-sm"
                                    />
                                </div>

                                {selectedCustomerIds.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                        {allCustomers
                                            .filter(c => selectedCustomerIds.includes(c.id))
                                            .map(c => (
                                                <Badge
                                                    key={c.id}
                                                    className="flex items-center gap-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 hover:bg-emerald-200 cursor-pointer text-xs"
                                                    onClick={() => toggleCustomer(c.id)}
                                                >
                                                    {c.razon_social}
                                                    <X className="h-3 w-3" />
                                                </Badge>
                                            ))}
                                    </div>
                                )}

                                <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 max-h-64 overflow-y-auto">
                                    {filteredCustomers.length === 0
                                        ? <p className="text-xs text-neutral-400 px-4 py-3 text-center">Sin clientes que coincidan</p>
                                        : filteredCustomers.map(c => {
                                            const isSelected = selectedCustomerIds.includes(c.id)
                                            return (
                                                <button
                                                    key={c.id}
                                                    type="button"
                                                    onClick={() => toggleCustomer(c.id)}
                                                    className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors text-left ${isSelected
                                                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
                                                        : 'hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                                                        }`}
                                                >
                                                    <span>{c.razon_social}</span>
                                                    <span className="text-xs text-neutral-400 font-mono">{c.rut}</span>
                                                </button>
                                            )
                                        })}
                                </div>

                                <p className="text-xs text-neutral-400">
                                    {selectedCustomerIds.length} cliente(s) seleccionado(s). Al guardar, se aplicará esta lista a todos ellos.
                                </p>
                            </div>
                        )}
                    </div>

                    <DialogFooter className="border-t border-neutral-100 dark:border-neutral-800 pt-4">
                        <Button type="button" variant="outline" onClick={() => setOpenModal(false)} className="border-neutral-200 dark:border-neutral-800 cursor-pointer">
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
                        >
                            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isSaving ? 'Guardando...' : (editingId ? 'Guardar Cambios' : 'Crear Lista')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirm */}
            <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
                <AlertDialogContent className="bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-red-600">¿Eliminar lista de precios?</AlertDialogTitle>
                        <AlertDialogDescription className="text-neutral-500">
                            Los clientes asignados quedarán sin lista de precios y se aplicará el precio base. Esta acción no se puede deshacer.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="border-neutral-200 dark:border-neutral-800">Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="bg-red-600 hover:bg-red-700 text-white"
                        >
                            {isDeleting ? 'Eliminando...' : 'Sí, eliminar'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
