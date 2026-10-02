'use client'

import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AlertaError } from '@/components/ui/alerta-error'
import { getApiErrorDetail } from '@/services/api'
import { Loader2 } from 'lucide-react'
import { Product, updateProduct } from '@/services/products'
import { getBrands, Brand } from '@/services/brands'
import { type Tax } from '@/services/config'
import { formatCLP } from '@/lib/format'
import { DEFAULT_TAX_RATE, normalizeTaxRate, precioBruto } from '@/lib/taxes'

// Radix no admite "" como valor de un SelectItem; "Sin marca" usa este y se
// manda como null (un 0 viola la FK de brands).
const SIN_MARCA = 'ninguna'

interface Props {
    open: boolean
    product: Product | null
    onClose: (refresh?: boolean) => void
    /** El stock no se edita aquí: se ajusta con su motivo, para que quede en el kardex. */
    onAjustarStock: (product: Product) => void
}

/** Edición de un producto en un panel lateral: la lista sigue a la vista detrás. */
export default function ProductEditDialog({ open, product, onClose, onAjustarStock }: Props) {
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [baseName, setBaseName] = useState('')
    const [baseSku, setBaseSku] = useState('')
    const [baseDescription, setBaseDescription] = useState('')
    const [selectedBrand, setSelectedBrand] = useState<string>('')
    const [selectedTax, setSelectedTax] = useState<string>('')
    const [controlStock, setControlStock] = useState(true)
    const [stockMinimo, setStockMinimo] = useState('')

    // For simple products (no variants)
    const [simplePrice, setSimplePrice] = useState(0)
    const [simpleBarcode, setSimpleBarcode] = useState('')

    // Variants state (local copy for editing)
    const [variants, setVariants] = useState<Product[]>([])
    const [brands, setBrands] = useState<Brand[]>([])
    const [taxes, setTaxes] = useState<Tax[]>([])

    useEffect(() => {
        if (open && product) {
            setBaseName(product.nombre)
            setBaseSku(product.codigo_interno)
            setBaseDescription(product.descripcion || '')
            setSelectedBrand(product.brand_id ? product.brand_id.toString() : SIN_MARCA)
            setSelectedTax(product.tax_id ? product.tax_id.toString() : '')
            setControlStock(product.controla_stock)
            setStockMinimo(String(Number(product.stock_minimo) || ''))

            if (product.variants && product.variants.length > 0) {
                setVariants(product.variants)
            } else {
                setVariants([])
                setSimplePrice(parseFloat(product.precio_neto) || 0)
                setSimpleBarcode(product.codigo_barras || '')
            }

            getBrands().then(setBrands).catch(console.error)
            import('@/services/config').then(m => m.getTaxes()).then(setTaxes).catch(console.error)
        }
    }, [open, product])

    const handleSave = async () => {
        if (!product) return
        setError(null)
        setLoading(true)
        try {
            const mainPayload: Partial<Product> = {
                nombre: baseName,
                codigo_interno: baseSku,
                descripcion: baseDescription || null,
                brand_id: selectedBrand && selectedBrand !== SIN_MARCA ? parseInt(selectedBrand) : null,
                tax_id: selectedTax ? parseInt(selectedTax) : null,
                controla_stock: controlStock,
            }

            if (!isParent) {
                // Producto simple: precio, código de barras y aviso de stock van en el mismo update.
                mainPayload.precio_neto = simplePrice.toString()
                mainPayload.codigo_barras = simpleBarcode || null
                mainPayload.stock_minimo = String(parseFloat(stockMinimo) || 0)
            }

            await updateProduct(product.id, mainPayload)

            if (isParent) {
                for (const v of variants) {
                    await updateProduct(v.id, {
                        nombre: v.nombre,
                        codigo_interno: v.codigo_interno,
                        precio_neto: v.precio_neto,
                        codigo_barras: v.codigo_barras || null,
                        controla_stock: controlStock,
                        tax_id: selectedTax ? parseInt(selectedTax) : null,
                    })
                }
            }

            onClose(true)
        } catch (err) {
            console.error(err)
            setError(getApiErrorDetail(err, 'No se pudo actualizar el producto.'))
        } finally {
            setLoading(false)
        }
    }

    if (!product) return null

    const isParent = product.variants && product.variants.length > 0
    const impuesto = taxes.find((t) => t.id.toString() === selectedTax)
    const tasa = impuesto ? normalizeTaxRate(impuesto.rate) : product.tax ? normalizeTaxRate(product.tax.rate) : DEFAULT_TAX_RATE
    const costo = parseFloat(product.costo_unitario) || 0
    const ganancia = simplePrice - costo

    return (
        <Sheet open={open} onOpenChange={(val) => { if (!val) { setError(null); onClose() } }}>
            <SheetContent data-section="inventario.editar-producto" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
                <SheetHeader className="border-b border-border px-6 py-5 pr-12">
                    <SheetTitle>{product.full_name || baseName}</SheetTitle>
                    <SheetDescription>Los cambios se aplican al guardar.</SheetDescription>
                </SheetHeader>

                <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
                    <div className="space-y-1.5">
                        <Label htmlFor="ep-nombre">Nombre</Label>
                        <Input id="ep-nombre" value={baseName} onChange={(e) => setBaseName(e.target.value)} className="h-11 text-base" />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="ep-sku">Código</Label>
                            <Input id="ep-sku" value={baseSku} onChange={(e) => setBaseSku(e.target.value)} className="h-11 font-mono" />
                        </div>
                        {!isParent && (
                            <div className="space-y-1.5">
                                <Label htmlFor="ep-barras">Código de barras</Label>
                                <Input id="ep-barras" value={simpleBarcode} onChange={(e) => setSimpleBarcode(e.target.value)}
                                    className="h-11 font-mono" placeholder="Escanea aquí..." />
                            </div>
                        )}
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>Marca</Label>
                            <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                                <SelectTrigger className="h-11"><SelectValue placeholder="Elegir marca" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value={SIN_MARCA}>Sin marca</SelectItem>
                                    {brands.map(b => <SelectItem key={b.id} value={b.id.toString()}>{b.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Impuesto</Label>
                            <Select value={selectedTax} onValueChange={setSelectedTax}>
                                <SelectTrigger className="h-11"><SelectValue placeholder="IVA (por defecto)" /></SelectTrigger>
                                <SelectContent>
                                    {taxes.map(t => (
                                        <SelectItem key={t.id} value={t.id.toString()}>{t.name} ({(normalizeTaxRate(t.rate) * 100).toFixed(0)}%)</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="ep-desc">Descripción</Label>
                        <Input id="ep-desc" value={baseDescription} onChange={(e) => setBaseDescription(e.target.value)} className="h-11" />
                    </div>

                    {isParent ? (
                        <div className="space-y-2">
                            <h3 className="text-sm font-semibold text-foreground">Variantes ({variants.length})</h3>
                            <div className="overflow-x-auto rounded-lg border border-border">
                                <Table compacta>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Variante y código</TableHead>
                                            <TableHead>Precio neto</TableHead>
                                            <TableHead>Stock</TableHead>
                                            <TableHead>Código de barras</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {variants.map((v, i) => {
                                            const cambiar = (campo: Partial<Product>) =>
                                                setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, ...campo } : x)))
                                            return (
                                                <TableRow key={v.id}>
                                                    <TableCell>
                                                        <Input value={v.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} className="mb-1 h-9 text-sm" aria-label="Nombre de la variante" />
                                                        <Input value={v.codigo_interno} onChange={(e) => cambiar({ codigo_interno: e.target.value })} className="h-9 w-32 font-mono text-xs" aria-label="Código de la variante" />
                                                    </TableCell>
                                                    <TableCell>
                                                        <Input type="number" value={v.precio_neto.toString()} onChange={(e) => cambiar({ precio_neto: e.target.value })}
                                                            className="h-9 w-24 text-right font-tabular" aria-label="Precio neto" />
                                                    </TableCell>
                                                    <TableCell className="whitespace-nowrap">
                                                        <span className="mr-2 font-tabular">{Number(v.stock_actual)}</span>
                                                        {controlStock && (
                                                            <Button variant="outline" size="sm" onClick={() => { onClose(); onAjustarStock(v) }}>Ajustar</Button>
                                                        )}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Input value={v.codigo_barras || ''} onChange={(e) => cambiar({ codigo_barras: e.target.value })}
                                                            placeholder="EAN-13" className="h-9 w-32 font-mono text-xs" aria-label="Código de barras" />
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label htmlFor="ep-precio">Precio neto</Label>
                                    <Input id="ep-precio" type="number" inputMode="numeric" value={simplePrice.toString()}
                                        onChange={(e) => setSimplePrice(parseFloat(e.target.value) || 0)} className="h-11 text-base font-tabular" />
                                    <p className="text-sm text-muted-foreground">Con impuesto se cobra {formatCLP(precioBruto(simplePrice, tasa))}</p>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Lo que te cuesta</Label>
                                    <p className="flex h-11 items-center text-base font-tabular text-foreground">{costo > 0 ? formatCLP(costo) : 'Sin compras registradas'}</p>
                                    <p className="text-sm text-muted-foreground">Sin IVA, de tus compras</p>
                                </div>
                            </div>
                            {costo > 0 && simplePrice > 0 && (
                                <p className="rounded-lg bg-primary/10 px-4 py-3 text-sm text-foreground">
                                    {ganancia >= 0 ? 'Ganas' : 'Pierdes'} <strong className="font-tabular">{formatCLP(Math.abs(ganancia))}</strong> por unidad
                                    {ganancia >= 0 && <>: el {Math.round((ganancia / simplePrice) * 100)}% de lo que cobras sin IVA</>}.
                                </p>
                            )}
                        </>
                    )}

                    <div className="space-y-4 rounded-lg border border-border p-4">
                        <label className="flex cursor-pointer items-center justify-between gap-3">
                            <span>
                                <span className="block text-sm font-medium text-foreground">Controlar stock</span>
                                <span className="block text-sm text-muted-foreground">Descuenta lo vendido y avisa cuando se acaba.</span>
                            </span>
                            <Switch checked={controlStock} onCheckedChange={setControlStock} />
                        </label>
                        {!isParent && controlStock && (
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label>Stock actual</Label>
                                    <div className="flex h-11 items-center gap-3">
                                        <span className="text-lg font-semibold font-tabular">{Number(product.stock_actual)}</span>
                                        {product.controla_stock && (
                                            <Button variant="outline" size="sm" onClick={() => { onClose(); onAjustarStock(product) }}>Ajustar stock</Button>
                                        )}
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="ep-minimo">Avísame cuando queden</Label>
                                    <Input id="ep-minimo" type="number" inputMode="numeric" min={0} value={stockMinimo}
                                        onChange={(e) => setStockMinimo(e.target.value)} className="h-11 font-tabular" placeholder="0" />
                                </div>
                            </div>
                        )}
                    </div>

                    <AlertaError mensaje={error} />
                </div>

                <div className="flex gap-3 border-t border-border px-6 py-4">
                    <Button onClick={handleSave} disabled={loading || (isParent && variants.length === 0)} className="h-11 flex-1 text-base">
                        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                        Guardar cambios
                    </Button>
                    <Button variant="outline" className="h-11" onClick={() => onClose()}>Cancelar</Button>
                </div>
            </SheetContent>
        </Sheet>
    )
}
