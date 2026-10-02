'use client'

import { useState, useEffect, useMemo } from 'react'
import {
    Plus,
    Trash2,
    Search,
    Package,
    Calendar,
    FileText,
    Printer
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AccionFila } from '@/components/ui/accion-fila'
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
    TableEmpty,
} from '@/components/ui/table'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { AlertaError } from '@/components/ui/alerta-error'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { avisar } from '@/lib/store/uiStore'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { getProviders, type Provider } from '@/services/providers'
import { getProducts, type Product } from '@/services/products'
import { productTaxRate } from '@/lib/taxes'
import { createPurchase, getPurchases, deletePurchase, getPurchasePdfPath, type Purchase, type PurchaseCreate } from '@/services/purchases'
import { getApiErrorMessage, getApiErrorDetail, fetchBlobUrl } from '@/services/api'
import { CHILE_TIMEZONE, diaEnPalabras, formatCLP, getTodayChile } from '@/lib/format'
import ProviderSearchCombobox from '@/components/providers/ProviderSearchCombobox'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import ListToolbar from '@/components/layout/ListToolbar'
import Resumen from '@/components/layout/Resumen'
import FiltrosRapidos from '@/components/layout/FiltrosRapidos'

const NOMBRE_DOC: Record<string, string> = { FACTURA: 'Factura', BOLETA: 'Boleta', SIN_DOCUMENTO: 'Sin documento' }
const NOMBRE_MES = new Intl.DateTimeFormat('es-CL', { month: 'long', timeZone: CHILE_TIMEZONE })

/** Mes (aaaa-mm) de una fecha, en hora de Chile. */
const mesDe = (fecha: string | Date) => new Intl.DateTimeFormat('en-CA', { timeZone: CHILE_TIMEZONE }).format(new Date(fecha)).slice(0, 7)

interface CartItem {
    product: Product
    cantidad: number
    precio_costo: number
}


export default function ComprasPage() {
    const [products, setProducts] = useState<Product[]>([])
    const [items, setItems] = useState<CartItem[]>([])
    const [purchases, setPurchases] = useState<Purchase[]>([])
    const [loadingPurchases, setLoadingPurchases] = useState(true)

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
    const [errorIngreso, setErrorIngreso] = useState<string | null>(null)
    const [errorDetalle, setErrorDetalle] = useState<string | null>(null)

    // Purchase Detail Modal
    const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null)
    const [deleteId, setDeleteId] = useState<number | null>(null)

    // La lista de compras es la vista principal; el formulario se abre al registrar.
    // Desde Proveedores se llega con ?registrar=<id> para abrir el formulario con ese proveedor.
    const [registrando, setRegistrando] = useState(() => new URLSearchParams(window.location.search).has('registrar'))
    const [periodo, setPeriodo] = useState<'mes' | 'pasado' | 'todas'>('mes')
    const [buscar, setBuscar] = useState('')

    const verPdfCompra = async (purchaseId: number) => {
        setErrorDetalle(null)
        try {
            const blobUrl = await fetchBlobUrl(getPurchasePdfPath(purchaseId))
            window.open(blobUrl, '_blank')
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
        } catch (err) {
            setErrorDetalle(getApiErrorMessage(err, 'No se pudo cargar el documento.'))
        }
    }

    useEffect(() => {
        loadInitialData()
        const proveedor = Number(new URLSearchParams(window.location.search).get('registrar'))
        if (proveedor) getProviders().then((ps) => setSelectedProvider(ps.find((p) => p.id === proveedor) ?? null)).catch(() => null)
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
            .catch(err => avisar(getApiErrorMessage(err, 'Error al cargar datos'), { reintentar: loadInitialData }))
            .finally(() => setLoadingPurchases(false))
    }

    const refreshPurchases = async () => {
        setLoadingPurchases(true)
        try {
            const data = await getPurchases()
            setPurchases(data)
        } catch {
            avisar('No se pudo actualizar el historial de compras.', { reintentar: refreshPurchases })
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
            avisar(`${product.full_name} ya está en la lista`, { tipo: 'info' })
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

    const ahora = new Date()
    const esteMes = mesDe(ahora)
    const mesPasado = mesDe(new Date(ahora.getFullYear(), ahora.getMonth() - 1, 15))
    const delMes = purchases.filter((p) => mesDe(p.fecha_compra) === esteMes)
    const ultima = [...purchases].sort((a, b) => b.fecha_compra.localeCompare(a.fecha_compra))[0]
    const enPeriodo = periodo === 'todas' ? purchases
        : purchases.filter((p) => mesDe(p.fecha_compra) === (periodo === 'mes' ? esteMes : mesPasado))
    const q = buscar.trim().toLowerCase()
    const visibles = q
        ? enPeriodo.filter((p) => p.provider?.razon_social.toLowerCase().includes(q) || (p.folio ?? '').includes(q) || p.provider?.rut.includes(q))
        : enPeriodo

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
        setErrorIngreso(null)
        if (!selectedProvider) {
            setErrorIngreso('Selecciona un proveedor.')
            return
        }
        if (items.length === 0) {
            setErrorIngreso('Agrega al menos un producto.')
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

            // Reset form
            setItems([])
            setFolio('')
            setObservacion('')
            setSelectedProvider(null)
            setRegistrando(false)
            refreshPurchases()
        } catch (error) {
            setErrorIngreso(getApiErrorDetail(error, 'No se pudo registrar la compra.'))
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async () => {
        if (!deleteId) return
        try {
            await deletePurchase(deleteId)
            refreshPurchases()
        } catch (err) {
            avisar(getApiErrorDetail(err, 'No se pudo eliminar la compra.'))
        }
    }

    return (
        <PageContainer>
            <PageHeader
                title="Compras"
                description="Lo que le compras a tus proveedores. Al registrar una compra se suma el stock de cada producto."
                actions={registrando ? (
                    <Button variant="outline" className="h-11" onClick={() => setRegistrando(false)}>Volver a las compras</Button>
                ) : (
                    <Button className="h-11 text-base" onClick={() => setRegistrando(true)}>
                        <Plus className="h-4 w-4" /> Registrar compra
                    </Button>
                )}
            />

            {registrando ? (
                <div data-section="compras.nueva" className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Left Panel: Form Info */}
                        <Card className="lg:col-span-1 shadow-sm">
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <FileText className="h-4 w-4" /> Datos del documento
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Proveedor</Label>
                                    <ProviderSearchCombobox
                                        value={selectedProvider}
                                        onChange={setSelectedProvider}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Tipo</Label>
                                        <Select value={tipoDoc} onValueChange={setTipoDoc}>
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="FACTURA">Factura</SelectItem>
                                                <SelectItem value="BOLETA">Boleta</SelectItem>
                                                <SelectItem value="SIN_DOCUMENTO">Sin docto.</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Folio</Label>
                                        <Input
                                            placeholder="N° Docto."
                                            value={folio}
                                            onChange={e => setFolio(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label>Fecha de compra</Label>
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
                                    <Label>Observaciones</Label>
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
                                        <Package className="h-4 w-4" /> Ítems a ingresar
                                    </CardTitle>
                                    <Badge variant="secondary" className="font-tabular">
                                        {items.length} productos
                                    </Badge>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="max-h-[400px] overflow-y-auto">
                                        <Table>
                                            <TableHeader className="sticky top-0 z-10 backdrop-blur">
                                                <TableRow>
                                                    <TableHead>Producto</TableHead>
                                                    <TableHead className="w-24 text-center">Cantidad</TableHead>
                                                    <TableHead className="w-32 text-right">Costo unitario</TableHead>
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
                                                                    <p className="text-xs text-muted-foreground font-mono">{item.product.codigo_interno}</p>
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
                                                                    <span className="absolute left-1.5 top-1.5 text-xs text-muted-foreground">$</span>
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
                                                                <AccionFila icon={Trash2} label="Quitar" onClick={() => removeItem(index)} peligro />
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
                                                <span>Subtotal neto</span>
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

                                        <AlertaError mensaje={errorIngreso} className="w-full" />
                                        <Button
                                            className="w-full h-12 text-lg font-bold gap-2"
                                            size="lg"
                                            onClick={handleSave}
                                            disabled={submitting}
                                        >
                                            {submitting ? 'Registrando...' : 'Finalizar ingreso'}
                                            {!submitting && <Plus className="h-5 w-5" />}
                                        </Button>
                                    </CardFooter>
                                )}
                            </Card>
                        </div>
                    </div>
                </div>
            ) : (
                <>
                    {!loadingPurchases && (
                        <Resumen datos={[
                            {
                                etiqueta: `Compraste en ${NOMBRE_MES.format(new Date())}`,
                                valor: formatCLP(delMes.reduce((t, p) => t + Number(p.monto_total), 0)),
                                nota: delMes.length
                                    ? `${delMes.length} ${delMes.length === 1 ? 'compra' : 'compras'} a ${new Set(delMes.map((p) => p.provider_id)).size} ${new Set(delMes.map((p) => p.provider_id)).size === 1 ? 'proveedor' : 'proveedores'}`
                                    : 'Todavía no hay compras este mes',
                            },
                            {
                                etiqueta: 'IVA de tus compras del mes',
                                valor: formatCLP(delMes.reduce((t, p) => t + Number(p.iva), 0)),
                                nota: 'Se descuenta del IVA que pagas en el F29',
                            },
                            {
                                etiqueta: 'Última compra',
                                valor: ultima ? <span className="first-letter:uppercase inline-block">{diaEnPalabras(ultima.fecha_compra)}</span> : 'Ninguna',
                                nota: ultima ? `${ultima.provider?.razon_social}, ${formatCLP(ultima.monto_total)}` : 'Regístrala con el botón de arriba',
                            },
                        ]} />
                    )}

                    <ListToolbar
                        busqueda={buscar}
                        onBusqueda={setBuscar}
                        placeholder="Proveedor o número de factura"
                        visibles={visibles.length}
                        total={enPeriodo.length}
                        unidad="compras"
                        filtros={
                            <FiltrosRapidos
                                etiqueta="Período"
                                valor={periodo}
                                onChange={setPeriodo}
                                opciones={[
                                    { valor: 'mes', etiqueta: 'Este mes' },
                                    { valor: 'pasado', etiqueta: 'Mes pasado' },
                                    { valor: 'todas', etiqueta: 'Todas' },
                                ]}
                            />
                        }
                    />

                    <div data-section="compras.historial" className="overflow-hidden rounded-xl border border-border bg-card">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Proveedor</TableHead>
                                    <TableHead>Documento</TableHead>
                                    <TableHead className="hidden md:table-cell">Productos</TableHead>
                                    <TableHead className="text-right">Total</TableHead>
                                    <TableHead><span className="sr-only">Acciones</span></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loadingPurchases ? (
                                    <TableEmpty colSpan={6} loading />
                                ) : visibles.length === 0 ? (
                                    <TableEmpty colSpan={6}>
                                        {buscar ? 'Ninguna compra coincide con la búsqueda.' : 'No hay compras en este período.'}
                                    </TableEmpty>
                                ) : (
                                    visibles.map(p => (
                                        <TableRow key={p.id}>
                                            <TableCell className="text-[15px] first-letter:uppercase">{diaEnPalabras(p.fecha_compra)}</TableCell>
                                            <TableCell className="text-[15px]">
                                                <p className="text-foreground">{p.provider?.razon_social}</p>
                                                <p className="text-sm text-muted-foreground">{p.provider?.rut}</p>
                                            </TableCell>
                                            <TableCell className="text-[15px]">{NOMBRE_DOC[p.tipo_documento] ?? p.tipo_documento}{p.folio ? ` ${p.folio}` : ''}</TableCell>
                                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                                                {p.details.length} {p.details.length === 1 ? 'producto' : 'productos'}
                                            </TableCell>
                                            <TableCell className="text-right text-[15px] font-semibold font-tabular">{formatCLP(p.monto_total)}</TableCell>
                                            <TableCell>
                                                <div className="flex items-center justify-end gap-1">
                                                    <Button variant="outline" size="sm" onClick={() => setSelectedPurchase(p)}>Ver</Button>
                                                    <AccionFila icon={Printer} label="Imprimir comprobante" onClick={() => verPdfCompra(p.id)} />
                                                    <AccionFila icon={Trash2} label="Eliminar" onClick={() => setDeleteId(p.id)} peligro />
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </>
            )}

            {/* Purchase Detail Modal */}
            <Dialog open={!!selectedPurchase} onOpenChange={() => { setSelectedPurchase(null); setErrorDetalle(null) }}>
                <DialogContent data-section="compras.detalle" className="max-w-3xl overflow-y-auto max-h-[90vh]">
                    <DialogHeader>
                        <div className="flex items-center justify-between pr-8">
                            <div>
                                <DialogTitle>Detalle de compra #{selectedPurchase?.id}</DialogTitle>
                                <DialogDescription>
                                    {selectedPurchase?.tipo_documento} Folio #{selectedPurchase?.folio || 'S/N'} - {selectedPurchase?.provider?.razon_social}
                                </DialogDescription>
                            </div>
                            <Button size="sm" onClick={() => selectedPurchase && verPdfCompra(selectedPurchase.id)}>
                                <Printer className="h-4 w-4" /> Imprimir
                            </Button>
                        </div>
                    </DialogHeader>
                    <AlertaError mensaje={errorDetalle} />
                    {selectedPurchase && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4 text-sm bg-muted/50 p-4 rounded-lg">
                                <div>
                                    <p className="text-sm text-muted-foreground">Fecha de compra</p>
                                    <p>{new Date(selectedPurchase.fecha_compra).toLocaleString('es-CL', { timeZone: 'America/Santiago' })}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-muted-foreground">Monto total</p>
                                    <p className="font-bold text-foreground text-lg">{formatCLP(selectedPurchase.monto_total)}</p>
                                </div>
                                {selectedPurchase.observacion && (
                                    <div className="col-span-2">
                                        <p className="text-sm text-muted-foreground">Observación</p>
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
                                            <TableHead className="text-right">Costo unit.</TableHead>
                                            <TableHead className="text-right">Subtotal</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {selectedPurchase.details.map(d => (
                                            <TableRow key={d.id}>
                                                <TableCell>
                                                    <p className="font-medium text-xs">{d.product?.full_name || d.product?.nombre}</p>
                                                    <p className="text-xs text-muted-foreground font-mono">{d.product?.codigo_interno}</p>
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
            <ConfirmDialog
                open={!!deleteId}
                onOpenChange={(o) => !o && setDeleteId(null)}
                title="¿Eliminar esta compra?"
                description="Se revierte el stock de todos los productos del documento. No se puede deshacer."
                confirmLabel="Eliminar definitivamente"
                onConfirm={handleDelete}
            />

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
