'use client'

import { useState } from 'react'
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
import { Badge } from '@/components/ui/badge'
import { createProduct } from '@/services/products'
import { toast } from 'sonner'
import {
    Loader2,
    Plus,
    Trash2,
    Package,
    CheckCircle2,
    Grid3X3,
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
import { useEffect } from 'react'

interface VariantRow {
    attributes: string[] // e.g. ["40", "Rojo"]
    sku: string
    precio: string
    stock: string
    barcode: string
}

interface Props {
    open: boolean
    onClose: (refresh?: boolean) => void
}

export default function ProductWizard({ open, onClose }: Props) {
    const [step, setStep] = useState(1) // 1: base product, 2: attributes, 3: variant matrix

    // Step 1: Base product
    const [baseName, setBaseName] = useState('')
    const [baseSku, setBaseSku] = useState('')
    // const [basePrice, setBasePrice] = useState('') // Removed: Price is now per variant
    const [basePrice, setBasePrice] = useState('') // Re-added for Simple Product flow

    const [baseDescription, setBaseDescription] = useState('')
    const [controlStock, setControlStock] = useState(true)
    const [selectedBrand, setSelectedBrand] = useState<string>('')
    const [selectedTax, setSelectedTax] = useState<string>('')
    const [brands, setBrands] = useState<Brand[]>([])
    const [taxes, setTaxes] = useState<any[]>([])
    const [isCreatingBrand, setIsCreatingBrand] = useState(false)
    const [newBrandName, setNewBrandName] = useState('')

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

    // Step 2: Attribute axes
    const [axes, setAxes] = useState<{ name: string; values: string }[]>([
        { name: 'Talla', values: '' },
    ])

    // Step 3: Generated matrix
    const [variants, setVariants] = useState<VariantRow[]>([])
    const [creating, setCreating] = useState(false)

    const addAxis = () => {
        setAxes([...axes, { name: '', values: '' }])
    }

    const removeAxis = (i: number) => {
        setAxes(axes.filter((_, idx) => idx !== i))
    }

    const updateAxis = (i: number, field: 'name' | 'values', value: string) => {
        setAxes(axes.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)))
    }

    // Generate cartesian product of attribute values
    const generateMatrix = () => {
        const validAxes = axes.filter((a) => a.name.trim() && a.values.trim())
        if (validAxes.length === 0) {
            toast.error('Agrega al menos un atributo con valores')
            return
        }

        const axisValues = validAxes.map((a) =>
            a.values.split(',').map((v) => v.trim()).filter(Boolean)
        )

        // Cartesian product
        const combinations: string[][] = axisValues.reduce<string[][]>(
            (acc, values) => acc.flatMap((combo) => values.map((v) => [...combo, v])),
            [[]]
        )

        const rows: VariantRow[] = combinations.map((combo) => {
            const suffix = combo.join('-')
            return {
                attributes: combo,
                sku: `${baseSku}-${suffix}`.toUpperCase(),
                precio: '',
                stock: '0',
                barcode: '',
            }
        })

        setVariants(rows)
        setStep(3)
    }

    const updateVariant = (i: number, field: keyof VariantRow, value: string) => {
        setVariants(variants.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)))
    }

    const removeVariant = (i: number) => {
        setVariants(variants.filter((_, idx) => idx !== i))
    }

    const handleCreate = async () => {
        setCreating(true)
        try {
            // Create parent product
            const parent = await createProduct({
                codigo_interno: baseSku,
                nombre: baseName,
                descripcion: baseDescription || undefined,
                precio_neto: 0, // Parent is a container, not sellable
                controla_stock: false,
                stock_actual: 0,
                stock_minimo: 0,
                tax_id: selectedTax ? parseInt(selectedTax) : undefined,
            })

            // Create each variant as child
            let created = 0
            for (const v of variants) {
                const attrLabel = v.attributes.join(' - ')
                await createProduct({
                    codigo_interno: v.sku,
                    nombre: attrLabel,
                    precio_neto: parseFloat(v.precio) || 0,
                    controla_stock: controlStock,
                    stock_actual: parseInt(v.stock) || 0,
                    stock_minimo: 0,
                    codigo_barras: v.barcode || undefined,
                    parent_id: parent.id,
                    brand_id: selectedBrand ? parseInt(selectedBrand) : undefined,
                    tax_id: selectedTax ? parseInt(selectedTax) : undefined,
                })
                created++
            }

            toast.success(`✓ ${baseName} creado con ${created} variantes`)
            resetForm()
            onClose(true)
        } catch (err: unknown) {
            const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            toast.error(detail || 'Error al crear producto')
        } finally {
            setCreating(false)
        }
    }

    // Also allow simple product (no variants)
    const handleCreateSimple = async () => {
        setCreating(true)
        try {
            await createProduct({
                codigo_interno: baseSku,
                // Removed duplicates (nombre, descripcion, precio_neto were here)
                // Actually, if we create simple product, we should probably ask for price. 
                // But the user said "precio lo estamos colocando en el padre, cuando deberia ser en cada variable".
                // Ideally we treat simple product as having 1 variant or just ask price here.
                // Re-reading: "cuando el principal es tener codigo de barras, aparte del sku, además estos codigos se deben manejar en las variantes, no en el producto padre."
                // "creando variantes... precio lo estamos colocando en el padre, cuando debería ser en cada variable".
                // So for simple products, we DO need price. I will keep price for simple product creation flow, but maybe move it to UI?
                // Actually, I removed `basePrice` state. I should restore it ONLY for simple product flow or add it to variant.
                // Let's re-add a specific input for simple product price if we are in "Crear Sin Variantes" mode?
                // The current UI layout for Step 1 had Price. I removed it.
                // I should probably keep it but ONLY use it for simple product or as default for variants?
                // User said "precio... debería ser en cada variable".
                // I will add a default price input in Step 3 (Matrix) which I did (v.precio).
                // For SIMPLE product, I need to ask price.
                // I'll add a "Precio" field to Step 1 that is ONLY used for Simple Product or as pre-fill?
                // Or better: When clicking "Crear Sin Variantes", show a small prompt or just let Step 1 have price but clarify it's for Simple.
                // Let's restore basePrice state but clarify in UI.
                // Wait, I already removed basePrice state in previous chunk. I should handle this.
                // Let's assume for now I removed it. I will add it back but renamed or scoped.
                // Actually, let's look at the UI code I'm replacing below.
                nombre: baseName,
                descripcion: baseDescription || undefined,
                precio_neto: parseFloat(basePrice) || 0,
                controla_stock: controlStock,
                stock_actual: 0,
                stock_minimo: 0,
                brand_id: selectedBrand ? parseInt(selectedBrand) : undefined,
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

    const resetForm = () => {
        setStep(1)
        setBaseName('')
        setBaseSku('')
        setBaseName('')
        setBaseSku('')
        setBasePrice('')
        setBaseDescription('')
        setSelectedBrand('')
        setBaseDescription('')
        setSelectedBrand('')
        setIsCreatingBrand(false)
        setNewBrandName('')
        setControlStock(true)
        setAxes([{ name: 'Talla', values: '' }])
        setVariants([])
    }

    const canProceedStep1 = baseName.trim() !== '' && baseSku.trim() !== ''
    const canProceedStep2 = axes.some((a) => a.name.trim() !== '' && a.values.trim() !== '')

    const nextStep = () => {
        setStep(2)
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
                        {step === 2 && 'Define los ejes de variantes (Talla, Color, etc.)'}
                        {step === 3 && `Revisa las ${variants.length} variantes generadas`}
                    </DialogDescription>
                </DialogHeader>

                {/* Progress */}
                <div className="flex gap-1 mb-2">
                    {[1, 2, 3].map((s) => (
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
                                <Label className="text-xs">SKU Base *</Label>
                                <Input
                                    placeholder="ZAP-RUN"
                                    value={baseSku}
                                    onChange={(e) => setBaseSku(e.target.value.toUpperCase())}
                                    className="h-9 text-sm font-mono"
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
                            <div className="space-y-1 flex items-end">
                                <label className="flex items-center gap-2 text-xs cursor-pointer mb-2">
                                    <input
                                        type="checkbox"
                                        checked={controlStock}
                                        onChange={(e) => setControlStock(e.target.checked)}
                                        className="rounded border-slate-300"
                                    />
                                    Controlar stock globalmente
                                </label>
                            </div>
                        </div>

                        {/* Price Input Only for Simple Product Hint? Or just show it? 
                            User wanted "precio en cada variable". 
                            But for simple product (no variants), this Base Price IS the variable price.
                            So we should show it.
                        */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label className="text-xs">Precio Neto (Para Sin Variantes)</Label>
                                <Input
                                    type="number"
                                    placeholder="50000"
                                    value={basePrice}
                                    onChange={(e) => setBasePrice(e.target.value)}
                                    className="h-9 text-sm font-tabular"
                                    min={0}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Impuesto Asociado</Label>
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

                        <div className="space-y-1">
                            <Label className="text-xs">Descripción (opcional)</Label>
                            <Input
                                placeholder="Zapatilla deportiva para correr..."
                                value={baseDescription}
                                onChange={(e) => setBaseDescription(e.target.value)}
                                className="h-9 text-sm"
                            />
                        </div>
                    </div>
                )}

                {/* ── Step 2: Attribute Axes ─────────── */}
                {step === 2 && (
                    <div className="space-y-3">
                        <p className="text-xs text-slate-500">
                            Ingresa los ejes de variación. Separa los valores con comas.
                        </p>

                        {axes.map((axis, i) => (
                            <div key={i} className="flex items-start gap-2">
                                <div className="space-y-1 w-32 shrink-0">
                                    <Label className="text-[10px]">Atributo</Label>
                                    <Input
                                        placeholder="Talla"
                                        value={axis.name}
                                        onChange={(e) => updateAxis(i, 'name', e.target.value)}
                                        className="h-8 text-xs"
                                    />
                                </div>
                                <div className="space-y-1 flex-1">
                                    <Label className="text-[10px]">Valores (coma-separados)</Label>
                                    <Input
                                        placeholder="38, 39, 40, 41, 42"
                                        value={axis.values}
                                        onChange={(e) => updateAxis(i, 'values', e.target.value)}
                                        className="h-8 text-xs"
                                    />
                                </div>
                                {axes.length > 1 && (
                                    <button
                                        onClick={() => removeAxis(i)}
                                        className="mt-5 text-red-400 hover:text-red-600"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                        ))}

                        <Button variant="outline" size="sm" onClick={addAxis} className="text-xs gap-1 h-7">
                            <Plus className="h-3 w-3" /> Agregar Atributo
                        </Button>

                        {canProceedStep2 && (
                            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
                                <Grid3X3 className="inline h-3 w-3 mr-1" />
                                Se generarán{' '}
                                <strong>
                                    {axes
                                        .filter((a) => a.name.trim() && a.values.trim())
                                        .reduce(
                                            (acc, a) =>
                                                acc *
                                                a.values.split(',').filter((v) => v.trim()).length,
                                            1
                                        )}
                                </strong>{' '}
                                variantes
                            </div>
                        )}
                    </div>
                )}

                {/* ── Step 3: Variant Matrix ──────────── */}
                {step === 3 && (
                    <div className="space-y-3">
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-slate-200 dark:border-slate-700">
                                        <th className="text-left pb-1.5 font-medium text-slate-400 text-[10px]">Variante</th>
                                        <th className="text-left pb-1.5 font-medium text-slate-400 text-[10px]">SKU</th>
                                        <th className="text-left pb-1.5 font-medium text-slate-400 text-[10px]">Precio</th>
                                        <th className="text-left pb-1.5 font-medium text-slate-400 text-[10px]">Stock</th>
                                        <th className="text-left pb-1.5 font-medium text-slate-400 text-[10px]">Código Barras</th>
                                        <th className="w-8"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {variants.map((v, i) => (
                                        <tr key={i}>
                                            <td className="py-1.5">
                                                <div className="flex gap-1">
                                                    {v.attributes.map((a, j) => (
                                                        <Badge key={j} variant="secondary" className="text-[10px] px-1.5 py-0">
                                                            {a}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="py-1.5">
                                                <Input
                                                    value={v.sku}
                                                    onChange={(e) => updateVariant(i, 'sku', e.target.value)}
                                                    className="h-7 w-28 text-[11px] font-mono"
                                                />
                                            </td>
                                            <td className="py-1.5">
                                                <Input
                                                    type="number"
                                                    value={v.precio}
                                                    onChange={(e) => updateVariant(i, 'precio', e.target.value)}
                                                    className="h-7 w-24 text-[11px] font-tabular"
                                                />
                                            </td>
                                            <td className="py-1.5">
                                                <Input
                                                    type="number"
                                                    value={v.stock}
                                                    onChange={(e) => updateVariant(i, 'stock', e.target.value)}
                                                    className="h-7 w-20 text-[11px] font-tabular"
                                                />
                                            </td>
                                            <td className="py-1.5">
                                                <Input
                                                    value={v.barcode}
                                                    onChange={(e) => updateVariant(i, 'barcode', e.target.value)}
                                                    placeholder="Opcional"
                                                    className="h-7 w-28 text-[11px] font-mono"
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
                    </div>
                )}

                <Separator />

                <DialogFooter className="flex-col sm:flex-row gap-2">
                    {step > 1 && (
                        <Button type="button" variant="outline" onClick={() => setStep(step - 1)} className="text-xs">
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
                                Crear Sin Variantes
                            </Button>
                            <Button
                                type="button"
                                onClick={nextStep}
                                disabled={!canProceedStep1}
                                className="text-xs gap-1"
                            >
                                Con Variantes →
                            </Button>
                        </div>
                    )}

                    {step === 2 && (
                        <Button
                            onClick={generateMatrix}
                            disabled={!canProceedStep2}
                            className="text-xs gap-1"
                        >
                            <Grid3X3 className="h-3.5 w-3.5" /> Siguiente: Variantes →
                        </Button>
                    )}

                    {step === 3 && (
                        <Button
                            onClick={handleCreate}
                            disabled={creating || variants.length === 0}
                            className="text-xs gap-1 bg-emerald-600 hover:bg-emerald-700"
                        >
                            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            Crear {variants.length} Variantes
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog >
    )
}
