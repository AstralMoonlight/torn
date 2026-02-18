'use client'

import { useState, useEffect } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { createProduct, createProductWithVariants } from '@/services/products'
import { toast } from 'sonner'
import {
    Loader2,
    Plus,
    Trash2,
    Package,
    CheckCircle2,
    Barcode,
} from 'lucide-react'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { createBrand, getBrands, Brand } from '@/services/brands'

interface VariantRow {
    nombre: string      // e.g. "Talla 42", "Rojo XL"
    sku: string         // optional, auto-gen if empty
    barcode: string     // optional, auto-gen if empty
    precio: string      // required
    descripcion: string // optional
}

interface Props {
    open: boolean
    onClose: (refresh?: boolean) => void
}

const emptyVariant = (): VariantRow => ({
    nombre: '',
    sku: '',
    barcode: '',
    precio: '',
    descripcion: '',
})

export default function ProductWizard({ open, onClose }: Props) {
    const [step, setStep] = useState(1) // 1: base product, 2: variants

    // Step 1: Base product
    const [baseName, setBaseName] = useState('')
    const [baseSku, setBaseSku] = useState('')
    const [baseBarcode, setBaseBarcode] = useState('')
    const [basePrice, setBasePrice] = useState('')
    const [baseDescription, setBaseDescription] = useState('')
    const [controlStock, setControlStock] = useState(true)
    const [selectedBrand, setSelectedBrand] = useState<string>('')
    const [selectedTax, setSelectedTax] = useState<string>('')
    const [brands, setBrands] = useState<Brand[]>([])
    const [taxes, setTaxes] = useState<any[]>([])
    const [isCreatingBrand, setIsCreatingBrand] = useState(false)
    const [newBrandName, setNewBrandName] = useState('')

    // Step 2: Variants list
    const [variants, setVariants] = useState<VariantRow[]>([])
    const [creating, setCreating] = useState(false)

    // Load brands and taxes
    useEffect(() => {
        if (open) {
            getBrands().then(setBrands).catch(console.error)
            import('@/services/config').then(m => m.getTaxes()).then(t => {
                setTaxes(t)
                const def = t.find(tx => tx.is_default)
                if (def) setSelectedTax(def.id.toString())
            }).catch(console.error)
        }
    }, [open])

    const addVariant = () => {
        setVariants([...variants, emptyVariant()])
    }

    const removeVariant = (i: number) => {
        setVariants(variants.filter((_, idx) => idx !== i))
    }

    const updateVariant = (i: number, field: keyof VariantRow, value: string) => {
        setVariants(variants.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)))
    }

    // ── Create simple product (no variants) ──
    const handleCreateSimple = async () => {
        setCreating(true)
        try {
            await createProduct({
                codigo_interno: baseSku || undefined,
                nombre: baseName,
                descripcion: baseDescription || undefined,
                precio_neto: parseFloat(basePrice) || 0,
                codigo_barras: baseBarcode || undefined,
                controla_stock: controlStock,
                stock_actual: 0,
                stock_minimo: 0,
                brand_id: selectedBrand ? parseInt(selectedBrand) : undefined,
                tax_id: selectedTax ? parseInt(selectedTax) : undefined,
            })
            toast.success(`✓ ${baseName} creado`)
            resetForm()
            onClose(true)
        } catch (err: unknown) {
            const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            toast.error(detail || 'Error al crear producto')
        } finally {
            setCreating(false)
        }
    }

    // ── Create product with variants ──
    const handleCreateWithVariants = async () => {
        // Validate all variants have name and price
        const invalid = variants.some(v => !v.nombre.trim() || !v.precio.trim())
        if (invalid) {
            toast.error('Cada variante necesita Nombre y Precio')
            return
        }

        setCreating(true)
        try {
            await createProductWithVariants({
                nombre: baseName,
                codigo_interno: baseSku || undefined,
                descripcion: baseDescription || undefined,
                precio_neto: parseFloat(basePrice) || 0,
                controla_stock: controlStock,
                brand_id: selectedBrand ? parseInt(selectedBrand) : undefined,
                tax_id: selectedTax ? parseInt(selectedTax) : undefined,
                variants: variants.map(v => ({
                    nombre: v.nombre,
                    codigo_interno: v.sku || undefined,
                    codigo_barras: v.barcode || undefined,
                    precio_neto: parseFloat(v.precio) || 0,
                    descripcion: v.descripcion || undefined,
                })),
            })
            toast.success(`✓ ${baseName} creado con ${variants.length} variantes`)
            resetForm()
            onClose(true)
        } catch (err: unknown) {
            const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            toast.error(detail || 'Error al crear producto')
        } finally {
            setCreating(false)
        }
    }

    const resetForm = () => {
        setStep(1)
        setBaseName('')
        setBaseSku('')
        setBaseBarcode('')
        setBasePrice('')
        setBaseDescription('')
        setSelectedBrand('')
        setSelectedTax('')
        setIsCreatingBrand(false)
        setNewBrandName('')
        setControlStock(true)
        setVariants([])
    }

    const handleCreateBrand = async () => {
        if (!newBrandName.trim()) return
        try {
            const brand = await createBrand({ name: newBrandName })
            setBrands([...brands, brand])
            setSelectedBrand(brand.id.toString())
            setIsCreatingBrand(false)
            setNewBrandName('')
            toast.success('Marca creada')
        } catch (error) {
            console.error(error)
            toast.error('Error al crear marca')
        }
    }

    const canProceedStep1 = baseName.trim() !== ''

    return (
        <Dialog open={open} onOpenChange={(val) => {
            if (!val) { resetForm(); onClose() }
        }}>
            <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        <Package className="h-5 w-5 text-blue-600" />
                        Nuevo Producto
                    </DialogTitle>
                    <DialogDescription>
                        {step === 1 && 'Datos del producto base'}
                        {step === 2 && `Define las variantes del producto`}
                    </DialogDescription>
                </DialogHeader>

                {/* Progress */}
                <div className="flex gap-1 mb-2">
                    {[1, 2].map((s) => (
                        <div
                            key={s}
                            className={`h-1 flex-1 rounded-full transition-colors ${s <= step ? 'bg-blue-600' : 'bg-slate-200 dark:bg-slate-700'
                                }`}
                        />
                    ))}
                </div>

                {/* ── Step 1: Base Product ─────────── */}
                {step === 1 && (
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Nombre *</Label>
                                <Input
                                    placeholder="Zapatilla Running Pro"
                                    value={baseName}
                                    onChange={(e) => setBaseName(e.target.value)}
                                    className="h-9 text-sm"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">SKU <span className="text-slate-400">(opcional)</span></Label>
                                <Input
                                    placeholder="Se genera automáticamente"
                                    value={baseSku}
                                    onChange={(e) => setBaseSku(e.target.value.toUpperCase())}
                                    className="h-9 text-sm font-mono"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Código de Barras <span className="text-slate-400">(opcional)</span></Label>
                                <div className="relative">
                                    <Barcode className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                                    <Input
                                        placeholder="Se genera automáticamente"
                                        value={baseBarcode}
                                        onChange={(e) => setBaseBarcode(e.target.value)}
                                        className="h-9 text-sm font-mono pl-8"
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Precio Neto</Label>
                                <Input
                                    type="number"
                                    placeholder="50000"
                                    value={basePrice}
                                    onChange={(e) => setBasePrice(e.target.value)}
                                    className="h-9 text-sm font-tabular"
                                    min={0}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Marca</Label>
                                {isCreatingBrand ? (
                                    <div className="flex gap-2">
                                        <Input
                                            value={newBrandName}
                                            onChange={(e) => setNewBrandName(e.target.value)}
                                            placeholder="Nueva marca..."
                                            className="h-9 text-xs"
                                        />
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={handleCreateBrand}
                                            disabled={!newBrandName.trim()}
                                            className="h-9 w-9 px-0 shrink-0 bg-blue-600 hover:bg-blue-700"
                                        >
                                            <Plus className="h-4 w-4 text-white" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setIsCreatingBrand(false)}
                                            className="h-9 w-9 px-0 shrink-0"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="flex gap-2">
                                        <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                                            <SelectTrigger className="h-9 text-xs flex-1">
                                                <SelectValue placeholder="Seleccionar marca..." />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {brands.map(b => (
                                                    <SelectItem key={b.id} value={b.id.toString()}>
                                                        {b.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setIsCreatingBrand(true)}
                                            className="h-9 w-9 px-0 shrink-0"
                                            title="Crear nueva marca"
                                        >
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Impuesto</Label>
                                <Select value={selectedTax} onValueChange={setSelectedTax}>
                                    <SelectTrigger className="h-9 text-xs">
                                        <SelectValue placeholder="Seleccionar impuesto..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {taxes.map(t => (
                                            <SelectItem key={t.id} value={t.id.toString()}>
                                                {t.name} ({(t.rate * 100).toFixed(0)}%)
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Descripción <span className="text-slate-400">(opcional)</span></Label>
                                <Input
                                    placeholder="Zapatilla deportiva para correr..."
                                    value={baseDescription}
                                    onChange={(e) => setBaseDescription(e.target.value)}
                                    className="h-9 text-sm"
                                />
                            </div>
                            <div className="space-y-1 flex items-end">
                                <label className="flex items-center gap-2 text-xs cursor-pointer mb-2">
                                    <input
                                        type="checkbox"
                                        checked={controlStock}
                                        onChange={(e) => setControlStock(e.target.checked)}
                                        className="rounded border-slate-300"
                                    />
                                    Controlar stock
                                </label>
                            </div>
                        </div>

                        {/* Hint for optional fields */}
                        <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 px-3 py-2 text-[11px] text-slate-500">
                            <Barcode className="inline h-3 w-3 mr-1" />
                            Los campos SKU y Código de Barras se generan automáticamente si no los ingresas.
                        </div>
                    </div>
                )}

                {/* ── Step 2: Simplified Variants ─────────── */}
                {step === 2 && (
                    <div className="space-y-3">
                        <p className="text-xs text-slate-500">
                            Agrega las variantes del producto. Cada variante tiene su propio nombre, precio, y opcionalmente SKU y código de barras.
                            El control de stock e impuestos se <strong>heredan del producto padre</strong>.
                        </p>

                        {variants.length === 0 ? (
                            <div className="text-center py-8 text-slate-400 text-sm">
                                <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
                                No hay variantes aún. Agrega la primera.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-200 dark:border-slate-700">
                                            <th className="text-left pb-1.5 font-medium text-slate-400 text-[10px]">Nombre *</th>
                                            <th className="text-left pb-1.5 font-medium text-slate-400 text-[10px]">SKU</th>
                                            <th className="text-left pb-1.5 font-medium text-slate-400 text-[10px]">Cód. Barras</th>
                                            <th className="text-left pb-1.5 font-medium text-slate-400 text-[10px]">Precio *</th>
                                            <th className="text-left pb-1.5 font-medium text-slate-400 text-[10px]">Descripción</th>
                                            <th className="w-8"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {variants.map((v, i) => (
                                            <tr key={i}>
                                                <td className="py-1.5 pr-1">
                                                    <Input
                                                        value={v.nombre}
                                                        onChange={(e) => updateVariant(i, 'nombre', e.target.value)}
                                                        placeholder="Talla 42"
                                                        className="h-7 w-28 text-[11px]"
                                                    />
                                                </td>
                                                <td className="py-1.5 pr-1">
                                                    <Input
                                                        value={v.sku}
                                                        onChange={(e) => updateVariant(i, 'sku', e.target.value.toUpperCase())}
                                                        placeholder="Auto"
                                                        className="h-7 w-24 text-[11px] font-mono"
                                                    />
                                                </td>
                                                <td className="py-1.5 pr-1">
                                                    <Input
                                                        value={v.barcode}
                                                        onChange={(e) => updateVariant(i, 'barcode', e.target.value)}
                                                        placeholder="Auto"
                                                        className="h-7 w-24 text-[11px] font-mono"
                                                    />
                                                </td>
                                                <td className="py-1.5 pr-1">
                                                    <Input
                                                        type="number"
                                                        value={v.precio}
                                                        onChange={(e) => updateVariant(i, 'precio', e.target.value)}
                                                        placeholder="0"
                                                        className="h-7 w-20 text-[11px] font-tabular"
                                                    />
                                                </td>
                                                <td className="py-1.5 pr-1">
                                                    <Input
                                                        value={v.descripcion}
                                                        onChange={(e) => updateVariant(i, 'descripcion', e.target.value)}
                                                        placeholder="Opcional"
                                                        className="h-7 w-28 text-[11px]"
                                                    />
                                                </td>
                                                <td className="py-1.5">
                                                    <button onClick={() => removeVariant(i)} className="text-red-400 hover:text-red-600">
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        <Button variant="outline" size="sm" onClick={addVariant} className="text-xs gap-1 h-7">
                            <Plus className="h-3 w-3" /> Agregar Variante
                        </Button>
                    </div>
                )}

                <Separator />

                <DialogFooter className="flex-col sm:flex-row gap-2">
                    {step > 1 && (
                        <Button type="button" variant="outline" onClick={() => setStep(1)} className="text-xs">
                            ← Atrás
                        </Button>
                    )}
                    <div className="flex-1" />

                    {step === 1 && (
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleCreateSimple}
                                disabled={!canProceedStep1 || creating}
                                className="text-xs"
                            >
                                {creating && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                                Crear Sin Variantes
                            </Button>
                            <Button
                                type="button"
                                onClick={() => setStep(2)}
                                disabled={!canProceedStep1}
                                className="text-xs gap-1"
                            >
                                Con Variantes →
                            </Button>
                        </div>
                    )}

                    {step === 2 && (
                        <Button
                            onClick={handleCreateWithVariants}
                            disabled={creating || variants.length === 0}
                            className="text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                        >
                            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            Crear {variants.length} Variante{variants.length !== 1 ? 's' : ''}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
