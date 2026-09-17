'use client'

import { useState, useEffect, useMemo } from 'react'
import {
    ShoppingBag,
    Plus,
    Trash2,
    Search,
    Package,
    Calendar,
    FileText,
    Clock,
    Printer
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import { type Provider } from '@/services/providers'
import { getProducts, type Product } from '@/services/products'
import { productTaxRate } from '@/lib/taxes'
import { createPurchase, getPurchases, deletePurchase, getPurchasePdfPath, type Purchase, type PurchaseCreate } from '@/services/purchases'
import { getApiErrorMessage, fetchBlobUrl } from '@/services/api'
import { formatCLP, getTodayChile } from '@/lib/format'
import ProviderSearchCombobox from '@/components/providers/ProviderSearchCombobox'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'

interface CartItem {
    product: Product
    cantidad: number
    precio_costo: number
}


export default function ComprasPage() {
    const [products, setProducts] = useState<Product[]>([])
    const [items, setItems] = useState<CartItem[]>([])
    const [purchases, setPurchases] = useState<Purchase[]>([])
    const [loadingPurchases, setLoadingPurchases] = useState(false)

    // Form State
    const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
    const [folio, setFolio] = useState('')
    const [tipoDoc, setTipoDoc] = useState('FACTURA')
    const [fecha, setFecha] = useState(getTodayChile())
    const [observacion, setObservacion] = useState('')

    // Product Selection State
    const [searchQuery, setSearchQuery] = useState('')
    const [isSearching, setIsSearching] = useState(false)
    const [submitting, setSubmitting] = useState(false)

    // Purchase Detail Modal
    const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null)
    const [deleteId, setDeleteId] = useState<number | null>(null)

    const verPdfCompra = async (purchaseId: number) => {
        try {
            const blobUrl = await fetchBlobUrl(getPurchasePdfPath(purchaseId))
            window.open(blobUrl, '_blank')
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
        } catch (err) {
            toast.error(getApiErrorMessage(err, 'No se pudo cargar el documento.'))
        }
    }

    useEffect(() => {
        loadInitialData()
    }, [])

    const loadInitialData = () => {
        Promise.all([getProducts(), getPurchases()])
            .then(([prodData, purchaseData]) => {
                // Filter: Only products that DON'T have children (leaves)
                const leafProducts = prodData.filter(p => {
                    const hasChildren = prodData.some(child => child.parent_id === p.id)
                    return !hasChildren
                })
                setProducts(leafProducts)
                setPurchases(purchaseData)
            })
            .catch(err => toast.error(getApiErrorMessage(err, 'Error al cargar datos')))
    }

    const refreshPurchases = async () => {
        setLoadingPurchases(true)
        try {
            const data = await getPurchases()
            setPurchases(data)
        } catch {
            toast.error('Error al actualizar historial')
        } finally {
            setLoadingPurchases(false)
        }
    }

    const filteredSearchResults = useMemo(() => {
        if (!searchQuery.trim()) return []
        const q = searchQuery.toLowerCase()
        return products.filter(p =>
            p.nombre.toLowerCase().includes(q) ||
            p.codigo_interno.toLowerCase().includes(q)
        ).slice(0, 10)
    }, [searchQuery, products])

    const addItem = (product: Product) => {
        const existing = items.find(i => i.product.id === product.id)
        if (existing) {
            toast.info(`${product.full_name} ya está en la lista`)
            return
        }

        setItems([...items, {
            product,
            cantidad: 1,
            precio_costo: parseFloat(product.costo_unitario) || 0
        }])
        setSearchQuery('')
        setIsSearching(false)
    }

    const removeItem = (index: number) => {
        setItems(items.filter((_, i) => i !== index))
    }

    const updateItem = (index: number, field: 'cantidad' | 'precio_costo', value: number) => {
        const newItems = [...items]
        newItems[index] = { ...newItems[index], [field]: value }
        setItems(newItems)
    }

    const totalNeto = items.reduce((sum, item) => sum + (item.cantidad * item.precio_costo), 0)
    // El IVA se calcula por línea con el impuesto de cada producto, igual que
    // en el backend (app/utils/taxes.py): un insumo exento no suma impuesto
    // aunque el documento sea factura.
    const totalIva = tipoDoc === 'FACTURA'
        ? items.reduce(
            (sum, item) => sum + item.cantidad * item.precio_costo * productTaxRate(item.product),
            0,
        )
        : 0
    const totalFinal = totalNeto + totalIva

    const handleSave = async () => {
        if (!selectedProvider) {
            toast.error('Seleccione un proveedor')
            return
        }
        if (items.length === 0) {
            toast.error('Agregue al menos un producto')
            return
        }

        setSubmitting(true)
        try {
            const payload: PurchaseCreate = {
                provider_id: selectedProvider.id,
                folio,
                tipo_documento: tipoDoc,
                fecha_compra: fecha ? new Date(fecha).toISOString() : undefined,
                observacion,
                items: items.map(i => ({
                    product_id: i.product.id,
                    cantidad: i.cantidad,
                    precio_costo_unitario: i.precio_costo
                }))
            }

            await createPurchase(payload)
            toast.success('Ingreso de mercadería registrado con éxito')

            // Reset form
            setItems([])
            setFolio('')
            setObservacion('')
            setSelectedProvider(null)
            refreshPurchases()
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Error al registrar compra'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async () => {
        if (!deleteId) return
        try {
            await deletePurchase(deleteId)
            toast.success('Compra eliminada y stock revertido')
            setDeleteId(null)
            refreshPurchases()
        } catch {
            toast.error('Error al eliminar compra')
        }
    }

    return (
        <PageContainer>
            <PageHeader
                icon={ShoppingBag}
                title="Ingreso de Mercadería"
                description="Registre compras y actualice stock de productos."
            />

            <Tabs defaultValue="nuevo" className="w-full">
                <TabsList className="grid w-full grid-cols-2 max-w-md mx-auto mb-6">
                    <TabsTrigger value="nuevo" className="gap-2">
                        <Plus className="h-4 w-4" /> Nuevo Ingreso
                    </TabsTrigger>
                    <TabsTrigger value="historial" className="gap-2" onClick={refreshPurchases}>
                        <Clock className="h-4 w-4" /> Historial / Gestión
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="nuevo" className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Left Panel: Form Info */}
                        <Card className="lg:col-span-1 shadow-sm">
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <FileText className="h-4 w-4" /> Datos del Documento
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Proveedor</Label>
                                    <ProviderSearchCombobox
                                        value={selectedProvider}
                                        onChange={setSelectedProvider}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Tipo</Label>
                                        <Select value={tipoDoc} onValueChange={setTipoDoc}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="FACTURA">Factura</SelectItem>
                                                <SelectItem value="BOLETA">Boleta</SelectItem>
                                                <SelectItem value="SIN_DOCUMENTO">Sin Docto.</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Folio</Label>
                                        <Input
                                            placeholder="N° Docto."
                                            value={folio}
                                            onChange={e => setFolio(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Fecha Compra</Label>
                                    <div className="relative">
                                        <Calendar className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            type="date"
                                            className="pl-9"
                                            value={fecha}
                                            onChange={e => setFecha(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="text-xs uppercase tracking-wider text-muted-foreground font-bold">Observaciones</Label>
                                    <textarea
                                        className="w-full min-h-[80px] rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
                                        placeholder="Notas adicionales..."
                                        value={observacion}
                                        onChange={e => setObservacion(e.target.value)}
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        {/* Right Panel: Items Selection and List */}
                        <div className="lg:col-span-2 space-y-6">
                            {/* Product Search */}
                            <Card className="shadow-sm">
                                <CardContent className="p-4">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                                        <Input
                                            placeholder="Buscar productos a ingresar por nombre o SKU..."
                                            className="pl-11 h-11 text-lg"
                                            value={searchQuery}
                                            onChange={e => {
                                                setSearchQuery(e.target.value)
                                                setIsSearching(true)
                                            }}
                                            onFocus={() => setIsSearching(true)}
                                        />

                                        {isSearching && searchQuery.length > 1 && (
                                            <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-border bg-popover shadow-xl animate-in fade-in zoom-in-95">
                                                <div className="p-2">
                                                    {filteredSearchResults.length === 0 ? (
                                                        <div className="p-4 text-center text-muted-foreground">
                                                            No se encontraron resultados
                                                        </div>
                                                    ) : (
                                                        filteredSearchResults.map(product => (
                                                            <button
                                                                key={product.id}
                                                                onClick={() => addItem(product)}
                                                                className="flex w-full items-center justify-between rounded-lg p-3 text-left transition-colors hover:bg-accent group"
                                                            >
                                                                <div>
                                                                    <p className="font-semibold text-foreground group-hover:text-primary">{product.full_name || product.nombre}</p>
                                                                    <p className="text-xs text-muted-foreground font-mono">{product.codigo_interno}</p>
                                                                </div>
                                                                <div className="text-right">
                                                                    <p className="text-sm font-bold text-muted-foreground">
                                                                        Costo: {formatCLP(parseFloat(product.costo_unitario) || 0)}
                                                                    </p>
                                                                    <Plus className="h-4 w-4 ml-auto text-primary mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                                </div>
                                                            </button>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Items Table */}
                            <Card className="shadow-sm overflow-hidden">
                                <CardHeader className="bg-muted/50 flex flex-row items-center justify-between">
                                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                                        <Package className="h-4 w-4" /> Ítems a Ingresar
                                    </CardTitle>
                                    <Badge variant="secondary" className="font-tabular">
                                        {items.length} productos
                                    </Badge>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="max-h-[400px] overflow-y-auto">
                                        <Table>
                                            <TableHeader className="bg-muted/80 backdrop-blur sticky top-0 z-10">
                                                <TableRow>
                                                    <TableHead>Producto</TableHead>
                                                    <TableHead className="w-24 text-center">Cantidad</TableHead>
                                                    <TableHead className="w-32 text-right">Costo Unitario</TableHead>
                                                    <TableHead className="w-32 text-right">Subtotal</TableHead>
                                                    <TableHead className="w-12"></TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {items.length === 0 ? (
                                                    <TableRow>
                                                        <TableCell colSpan={5} className="h-40 text-center text-muted-foreground">
                                                            <div className="flex flex-col items-center gap-2">
                                                                <Package className="h-8 w-8 opacity-20" />
                                                                <p>Busque productos arriba para agregarlos</p>
                                                            </div>
                                                        </TableCell>
                                                    </TableRow>
                                                ) : (
                                                    items.map((item, index) => (
                                                        <TableRow key={item.product.id}>
                                                            <TableCell>
                                                                <div>
                                                                    <p className="font-medium text-sm leading-tight">{item.product.full_name || item.product.nombre}</p>
                                                                    <p className="text-[10px] text-muted-foreground font-mono">{item.product.codigo_interno}</p>
                                                                </div>
                                                            </TableCell>
                                                            <TableCell>
                                                                <Input
                                                                    type="number"
                                                                    className="h-8 text-center px-1"
                                                                    value={item.cantidad}
                                                                    onChange={e => updateItem(index, 'cantidad', parseFloat(e.target.value) || 0)}
                                                                />
                                                            </TableCell>
                                                            <TableCell>
                                                                <div className="relative">
                                                                    <span className="absolute left-1.5 top-1.5 text-[10px] text-muted-foreground">$</span>
                                                                    <Input
                                                                        type="number"
                                                                        className="h-8 text-right pl-4 pr-1"
                                                                        value={item.precio_costo}
                                                                        onChange={e => updateItem(index, 'precio_costo', parseFloat(e.target.value) || 0)}
                                                                    />
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="text-right font-medium font-tabular">
                                                                {formatCLP(item.cantidad * item.precio_costo)}
                                                            </TableCell>
                                                            <TableCell>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                                                                    onClick={() => removeItem(index)}
                                                                >
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </TableCell>
                                                        </TableRow>
                                                    ))
                                                )}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </CardContent>

                                {(items.length > 0) && (
                                    <CardFooter className="bg-muted/50 p-6 flex flex-col gap-4">
                                        <div className="w-full space-y-2">
                                            <div className="flex justify-between text-sm text-muted-foreground">
                                                <span>Subtotal Neto</span>
                                                <span>{formatCLP(totalNeto)}</span>
                                            </div>
                                            {tipoDoc === 'FACTURA' && (
                                                <div className="flex justify-between text-sm text-muted-foreground">
                                                    <span>IVA (19%)</span>
                                                    <span>{formatCLP(totalIva)}</span>
                                                </div>
                                            )}
                                            <Separator className="my-2" />
                                            <div className="flex justify-between text-xl font-bold text-foreground">
                                                <span>Total</span>
                                                <span className="text-primary">{formatCLP(totalFinal)}</span>
                                            </div>
                                        </div>

                                        <Button
                                            className="w-full h-12 text-lg font-bold gap-2"
                                            size="lg"
                                            onClick={handleSave}
                                            disabled={submitting}
                                        >
                                            {submitting ? 'Registrando...' : 'Finalizar Ingreso'}
                                            {!submitting && <Plus className="h-5 w-5" />}
                                        </Button>
                                    </CardFooter>
                                )}
                            </Card>
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="historial" className="space-y-4">
                    <Card>
                        <CardHeader className="py-4">
                            <CardTitle className="text-base">Historial de Compras</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader className="bg-muted/60">
                                    <TableRow className="border-b border-border hover:bg-transparent dark:hover:bg-transparent">
                                        <TableHead className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Fecha</TableHead>
                                        <TableHead className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Documento</TableHead>
                                        <TableHead className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Proveedor</TableHead>
                                        <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground font-medium">Total</TableHead>
                                        <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground font-medium">Acciones</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loadingPurchases ? (
                                        <TableRow><TableCell colSpan={5} className="text-center py-10">Cargando...</TableCell></TableRow>
                                    ) : purchases.length === 0 ? (
                                        <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">No hay compras registradas</TableCell></TableRow>
                                    ) : (
                                        purchases.map(p => (
                                            <TableRow key={p.id} className="hover:bg-accent/50 transition-colors">
                                                <TableCell className="text-xs">
                                                    {new Date(p.fecha_compra).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                    <div className="font-medium">{p.tipo_documento}</div>
                                                    <div className="text-muted-foreground font-mono">#{p.folio || 'S/N'}</div>
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                    {p.provider?.razon_social}
                                                </TableCell>
                                                <TableCell className="text-right font-medium font-tabular">
                                                    {formatCLP(p.monto_total)}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                            title="Imprimir Comprobante"
                                                            onClick={() => verPdfCompra(p.id)}
                                                        >
                                                            <Printer className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                            onClick={() => setSelectedPurchase(p)}
                                                            title="Ver Detalle"
                                                        >
                                                            <Search className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                            onClick={() => setDeleteId(p.id)}
                                                            title="Eliminar"
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Purchase Detail Modal */}
            <Dialog open={!!selectedPurchase} onOpenChange={() => setSelectedPurchase(null)}>
                <DialogContent className="max-w-3xl overflow-y-auto max-h-[90vh]">
                    <DialogHeader>
                        <div className="flex items-center justify-between pr-8">
                            <div>
                                <DialogTitle>Detalle de Compra #{selectedPurchase?.id}</DialogTitle>
                                <DialogDescription>
                                    {selectedPurchase?.tipo_documento} Folio #{selectedPurchase?.folio || 'S/N'} — {selectedPurchase?.provider?.razon_social}
                                </DialogDescription>
                            </div>
                            <button
                                type="button"
                                onClick={() => selectedPurchase && verPdfCompra(selectedPurchase.id)}
                                className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 active:scale-95 transition shadow-sm"
                            >
                                <Printer className="h-3.5 w-3.5" />
                                Imprimir
                            </button>
                        </div>
                    </DialogHeader>
                    {selectedPurchase && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm bg-muted/50 p-4 rounded-lg">
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase font-bold">Fecha Compra</p>
                                    <p>{new Date(selectedPurchase.fecha_compra).toLocaleString('es-CL', { timeZone: 'America/Santiago' })}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground uppercase font-bold">Monto Total</p>
                                    <p className="font-bold text-foreground text-lg">{formatCLP(selectedPurchase.monto_total)}</p>
                                </div>
                                {selectedPurchase.observacion && (
                                    <div className="col-span-2">
                                        <p className="text-xs text-muted-foreground uppercase font-bold">Observación</p>
                                        <p className="italic">&ldquo;{selectedPurchase.observacion}&rdquo;</p>
                                    </div>
                                )}
                            </div>

                            <div className="rounded-md border border-border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Producto</TableHead>
                                            <TableHead className="text-center">Cantidad</TableHead>
                                            <TableHead className="text-right">Costo Unit.</TableHead>
                                            <TableHead className="text-right">Subtotal</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {selectedPurchase.details.map(d => (
                                            <TableRow key={d.id}>
                                                <TableCell>
                                                    <p className="font-medium text-xs">{d.product?.full_name || d.product?.nombre}</p>
                                                    <p className="text-[10px] text-muted-foreground font-mono">{d.product?.codigo_interno}</p>
                                                </TableCell>
                                                <TableCell className="text-center font-tabular text-xs">
                                                    {parseFloat(String(d.cantidad))}
                                                </TableCell>
                                                <TableCell className="text-right font-tabular text-xs">
                                                    {formatCLP(d.precio_costo_unitario)}
                                                </TableCell>
                                                <TableCell className="text-right font-tabular text-xs font-semibold">
                                                    {formatCLP(d.subtotal)}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <Dialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>¿Está seguro de eliminar esta compra?</DialogTitle>
                        <DialogDescription>
                            Esta acción revertirá el stock de todos los productos incluidos en este documento.
                            No se puede deshacer.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteId(null)}>Cancelar</Button>
                        <Button onClick={handleDelete} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
                            Eliminar definitivamente
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Click outside search logic */}
            {isSearching && (
                <div
                    className="fixed inset-0 z-40 bg-transparent"
                    onClick={() => setIsSearching(false)}
                />
            )}
        </PageContainer>
    )
}
