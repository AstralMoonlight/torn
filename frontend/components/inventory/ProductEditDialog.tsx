'use client'

import { useState, useEffect } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from 'sonner'
import { Loader2, Package, RefreshCw } from 'lucide-react'
import { Product, updateProduct } from '@/services/products'
import { getBrands, Brand } from '@/services/brands'

interface Props {
    open: boolean
    product: Product | null
    onClose: (refresh?: boolean) => void
}

export default function ProductEditDialog({ open, product, onClose }: Props) {
    const [loading, setLoading] = useState(false)
    const [baseName, setBaseName] = useState('')
    const [baseSku, setBaseSku] = useState('')
    const [baseDescription, setBaseDescription] = useState('')
    const [selectedBrand, setSelectedBrand] = useState<string>('')
    const [controlStock, setControlStock] = useState(true)

    // For simple products (no variants)
    const [simplePrice, setSimplePrice] = useState(0)
    const [simpleStock, setSimpleStock] = useState(0)
    const [simpleBarcode, setSimpleBarcode] = useState('')

    // Variants state (local copy for editing)
    const [variants, setVariants] = useState<Product[]>([])
    const [brands, setBrands] = useState<Brand[]>([])

    useEffect(() => {
        if (open && product) {
            setBaseName(product.nombre)
            setBaseSku(product.codigo_interno)
            setBaseDescription(product.descripcion || '')
            setSelectedBrand(product.brand_id ? product.brand_id.toString() : '')
            setControlStock(product.controla_stock)

            if (product.variants && product.variants.length > 0) {
                setVariants(product.variants)
            } else {
                setVariants([])
                // Init simple product fields
                setSimplePrice(parseFloat(product.precio_neto) || 0)
                setSimpleStock(parseFloat(product.stock_actual) || 0)
                setSimpleBarcode(product.codigo_barras || '')
            }

            getBrands().then(setBrands).catch(console.error)
        }
    }, [open, product])

    const handleSaveGeneral = async () => {
        if (!product) return
        setLoading(true)
        try {
            const payload: any = {
                nombre: baseName,
                codigo_interno: baseSku,
                descripcion: baseDescription || undefined,
                brand_id: selectedBrand ? parseInt(selectedBrand) : undefined,
                controla_stock: controlStock,
            }

            // If simple product, also save price/stock/barcode here? 
            // Or only in the other tab? Let's save general info here.
            await updateProduct(product.id, payload)

            toast.success('Información general actualizada')
            onClose(true)
        } catch (error) {
            console.error(error)
            toast.error('Error al actualizar producto')
        } finally {
            setLoading(false)
        }
    }

    const handleUpdateVariantState = (index: number, field: keyof Product, value: any) => {
        const newVariants = [...variants]
        newVariants[index] = { ...newVariants[index], [field]: value }
        setVariants(newVariants)
    }

    const handleSaveVariants = async () => {
        if (!product) return
        setLoading(true)
        try {
            let updatedCount = 0
            for (const v of variants) {
                await updateProduct(v.id, {
                    codigo_interno: v.codigo_interno,
                    precio_neto: v.precio_neto as any, // Cast to any to allow number/string mix without TS complaint
                    stock_actual: v.stock_actual as any,
                    codigo_barras: v.codigo_barras || undefined,
                    controla_stock: controlStock,
                })
                updatedCount++
            }
            toast.success(`${updatedCount} variantes actualizadas`)
            onClose(true)
        } catch (error) {
            console.error(error)
            toast.error('Error al actualizar variantes')
        } finally {
            setLoading(false)
        }
    }

    const handleSaveSimple = async () => {
        if (!product) return
        setLoading(true)
        try {
            await updateProduct(product.id, {
                precio_neto: simplePrice.toString(), // Convert to string as per Product interface?
                stock_actual: simpleStock.toString(),
                codigo_barras: simpleBarcode || undefined,
                controla_stock: controlStock,
            } as any) // temporary cast if types differ significantly or fixing type definition

            toast.success('Precio y stock actualizados')
            onClose(true)
        } catch (error) {
            console.error(error)
            toast.error('Error al actualizar')
        } finally {
            setLoading(false)
        }
    }

    if (!product) return null

    const isParent = product.variants && product.variants.length > 0

    return (
        <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
            <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Package className="h-5 w-5 text-blue-600" />
                        Editar Producto: {baseName}
                    </DialogTitle>
                    <DialogDescription>
                        SKU: {baseSku}
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="general" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="general">Información General</TabsTrigger>
                        <TabsTrigger value="variants">
                            {isParent ? `Variantes (${variants.length})` : 'Precio y Stock'}
                        </TabsTrigger>
                    </TabsList>

                    {/* ── General Tab ──────────────────────────────── */}
                    <TabsContent value="general" className="space-y-4 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Nombre del Producto</Label>
                                <Input
                                    value={baseName}
                                    onChange={(e) => setBaseName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>SKU Base</Label>
                                <Input
                                    value={baseSku}
                                    onChange={(e) => setBaseSku(e.target.value)}
                                    className="font-mono"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Marca</Label>
                                <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Seleccionar marca" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="0">Sin Marca</SelectItem>
                                        {brands.map(b => (
                                            <SelectItem key={b.id} value={b.id.toString()}>{b.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2 pt-8">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <Input
                                        type="checkbox"
                                        checked={controlStock}
                                        onChange={(e) => setControlStock(e.target.checked)}
                                        className="w-4 h-4"
                                    />
                                    <span className="text-sm font-medium">Controlar Stock Globalmente</span>
                                </label>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>Descripción</Label>
                            <Input
                                value={baseDescription}
                                onChange={(e) => setBaseDescription(e.target.value)}
                            />
                        </div>

                        <div className="flex justify-end pt-4">
                            <Button onClick={handleSaveGeneral} disabled={loading} className="gap-2">
                                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                                Guardar General
                            </Button>
                        </div>
                    </TabsContent>

                    {/* ── Variants/Pricing Tab ────────────────────── */}
                    <TabsContent value="variants" className="space-y-4 py-4">
                        {isParent ? (
                            <>
                                <div className="rounded-md border border-slate-200 overflow-hidden">
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-50">
                                            <tr>
                                                <th className="px-3 py-2 text-left font-medium text-slate-500 text-xs uppercase">Variante / SKU</th>
                                                <th className="px-3 py-2 text-left font-medium text-slate-500 text-xs uppercase">Precio Neto</th>
                                                <th className="px-3 py-2 text-left font-medium text-slate-500 text-xs uppercase">Stock</th>
                                                <th className="px-3 py-2 text-left font-medium text-slate-500 text-xs uppercase">Código Barras</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {variants.map((v, i) => (
                                                <tr key={v.id}>
                                                    <td className="px-3 py-2">
                                                        <div className="font-medium text-xs">{v.nombre.replace(baseName + ' - ', '')}</div>
                                                        <Input
                                                            value={v.codigo_interno}
                                                            onChange={(e) => handleUpdateVariantState(i, 'codigo_interno', e.target.value)}
                                                            className="h-7 text-xs font-mono mt-1 w-32"
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <Input
                                                            type="number"
                                                            value={v.precio_neto.toString()}
                                                            onChange={(e) => handleUpdateVariantState(i, 'precio_neto', parseFloat(e.target.value) || 0)}
                                                            className="h-8 w-24 text-right font-tabular"
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <Input
                                                            type="number"
                                                            value={v.stock_actual.toString()}
                                                            onChange={(e) => handleUpdateVariantState(i, 'stock_actual', parseFloat(e.target.value) || 0)}
                                                            className="h-8 w-20 text-center font-tabular"
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <Input
                                                            value={v.codigo_barras || ''}
                                                            onChange={(e) => handleUpdateVariantState(i, 'codigo_barras', e.target.value)}
                                                            placeholder="EAN-13"
                                                            className="h-8 w-32 font-mono text-xs"
                                                        />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="flex justify-end pt-4">
                                    <Button onClick={handleSaveVariants} disabled={loading || variants.length === 0} className="gap-2 bg-blue-600 hover:bg-blue-700">
                                        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                                        <RefreshCw className="h-4 w-4" />
                                        Actualizar Variantes
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <div className="bg-slate-50 p-6 rounded-lg border border-slate-200">
                                <h3 className="text-sm font-medium mb-4 text-slate-700">Configuración de Inventario (Producto Simple)</h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                    <div className="space-y-2">
                                        <Label>Precio Neto</Label>
                                        <Input
                                            type="number"
                                            value={simplePrice.toString()}
                                            onChange={(e) => setSimplePrice(parseFloat(e.target.value) || 0)}
                                            className="font-tabular"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Stock Actual</Label>
                                        <Input
                                            type="number"
                                            value={simpleStock.toString()}
                                            onChange={(e) => setSimpleStock(parseFloat(e.target.value) || 0)}
                                            className="font-tabular"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Código de Barras</Label>
                                        <Input
                                            value={simpleBarcode}
                                            onChange={(e) => setSimpleBarcode(e.target.value)}
                                            className="font-mono"
                                            placeholder="Escanea aquí..."
                                        />
                                    </div>
                                </div>
                                <div className="flex justify-end pt-6">
                                    <Button onClick={handleSaveSimple} disabled={loading} className="gap-2 bg-blue-600 hover:bg-blue-700">
                                        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                                        <RefreshCw className="h-4 w-4" />
                                        Actualizar Datos
                                    </Button>
                                </div>
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    )
}
