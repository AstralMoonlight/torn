'use client'

import { useEffect, useState, useMemo } from 'react'
import { useCartStore } from '@/lib/store/cartStore'
import { useSessionStore } from '@/lib/store/sessionStore'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/components/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createSale, getPaymentMethods, getSalePdfUrl, getFoliosStatus, type PaymentMethod, type DocumentReference, type FolioStockOut } from '@/services/sales'
import { type Customer } from '@/services/customers'
import { toast } from 'sonner'
import {
    Loader2,
    CheckCircle2,
    Plus,
    Trash2,
    Banknote,
    Receipt,
    FileText,
    Printer,
    ChevronDown,
    ChevronRight,
    FileStack,
} from 'lucide-react'
import CustomerSearchCombobox from '@/components/pos/CustomerSearchCombobox'
import { formatCLP } from '@/lib/format'


// Chilean Rounding Law (Ley de Redondeo - Ley 21.054)
// Ends in 1-5 -> Round down to 0
// Ends in 6-9 -> Round up to 10
function roundCash(amount: number): number {
    const integerAmount = Math.round(amount)
    const lastDigit = integerAmount % 10
    if (lastDigit === 0) return integerAmount
    if (lastDigit <= 5) return integerAmount - lastDigit
    return integerAmount + (10 - lastDigit)
}

// Chilean bill denominations
const BILLS = [1000, 2000, 5000, 10000, 20000]

function getSuggestedBills(total: number): number[] {
    const suggestions: number[] = []

    // 1. Exact amount (Rounded for cash)
    const cashTotal = roundCash(total)
    suggestions.push(cashTotal)

    // 2. Next "round" bill amount that covers total
    // Included 500 as requested by user
    const roundings = [500, 1000, 5000, 10000, 20000]
    for (const round of roundings) {
        const next = Math.ceil(cashTotal / round) * round
        if (next > cashTotal && !suggestions.includes(next)) {
            suggestions.push(next)
        }
    }

    return suggestions.sort((a, b) => a - b).slice(0, 5)
}

interface PaymentLine {
    method: PaymentMethod
    amount: number
}

interface Props {
    open: boolean
    onClose: () => void
}

const GENERIC_RUT = '66666666-6'

/** Tipos de documento de referencia más usados (SII Chile). */
const REFERENCE_DOC_TYPES = [
    { value: '801', label: '801 - Orden de Compra' },
    { value: '52', label: '52 - Guía de Despacho Electrónica' },
    { value: 'HES', label: 'HES - Hoja de Estado de Pago' },
    { value: '802', label: '802 - Nota de Pedido' },
    { value: '46', label: '46 - Factura de Compra' },
] as const

function formatDateForInput(d: Date): string {
    return d.toISOString().slice(0, 10)
}

export default function CheckoutModal({ open, onClose }: Props) {
    const { items, totalFinal, clear, customer, setCustomer } = useCartStore()
    const { userId } = useSessionStore()
    const [methods, setMethods] = useState<PaymentMethod[]>([])
    const [payments, setPayments] = useState<PaymentLine[]>([])
    const [dteType, setDteType] = useState<number>(39)
    const [availableDtes, setAvailableDtes] = useState<FolioStockOut[]>([])

    // Customer State is now managed by cartStore to allow auto-switching lists


    const [submitting, setSubmitting] = useState(false)
    const [success, setSuccess] = useState(false)
    const [lastFolio, setLastFolio] = useState<number | null>(null)
    const [lastSaleId, setLastSaleId] = useState<number | null>(null)
    const [refsSectionOpen, setRefsSectionOpen] = useState(false)
    const [referencias, setReferencias] = useState<DocumentReference[]>([])

    // Load payment methods on open
    useEffect(() => {
        if (open) {
            Promise.all([
                getPaymentMethods(),
                getFoliosStatus()
            ])
                .then(([m, f]) => {
                    setMethods(m)
                    const cash = m.find((pm) => pm.code === 'EFECTIVO')
                    if (cash) setPayments([{ method: cash, amount: roundCash(totalFinal) }])

                    const validDtes = f.filter(d => d.available > 0)
                    setAvailableDtes(validDtes)
                    if (validDtes.length > 0) {
                        const boleta = validDtes.find(d => d.dte_type === 39)
                        setDteType(boleta ? 39 : validDtes[0].dte_type)
                    }
                })
                .catch(() => toast.error('Error cargando datos de caja'))
            setSuccess(false)
            setLastFolio(null)
            setLastSaleId(null)
            setDteType(39)
            setReferencias([])
            setRefsSectionOpen(false)
        }
    }, [open, totalFinal])

    const handleFinish = () => {
        clear()
        setPayments([])
        setSuccess(false)
        setLastFolio(null)
        setLastSaleId(null)
        setReferencias([])
        onClose()
    }

    const addReferencia = () => {
        setReferencias((prev) => [...prev, { tipo_documento: '801', folio: '', fecha: formatDateForInput(new Date()) }])
    }
    const removeReferencia = (index: number) => {
        setReferencias((prev) => prev.filter((_, i) => i !== index))
    }
    const updateReferencia = (index: number, field: keyof DocumentReference, value: string) => {
        setReferencias((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
    }

    const handlePrint = async () => {
        if (!lastSaleId) return

        try {
            // Fetch as blob to avoid CORS issues with iframe.contentWindow.print()
            const response = await fetch(getSalePdfUrl(lastSaleId))
            if (!response.ok) throw new Error("Error loading PDF")

            const blob = await response.blob()
            const blobUrl = URL.createObjectURL(blob)

            const iframeId = 'receipt-hidden-frame'
            let iframe = document.getElementById(iframeId) as HTMLIFrameElement

            if (iframe) document.body.removeChild(iframe)

            iframe = document.createElement('iframe')
            iframe.id = iframeId
            iframe.style.display = 'none'
            document.body.appendChild(iframe)

            iframe.onload = () => {
                try {
                    iframe.contentWindow?.print()
                    // Cleanup URL to avoid memory leaks (optional, but good practice after a delay)
                    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
                    // Close modal and clear cart after printing
                    handleFinish()
                } catch (e) {
                    console.error("Print error:", e)
                    window.open(blobUrl, '_blank')
                    handleFinish()
                }
            }
            iframe.src = blobUrl
        } catch (err) {
            console.error("Fetch error:", err)
            // Fallback to direct URL if fetch fails
            window.open(getSalePdfUrl(lastSaleId), '_blank')
            handleFinish()
        }
    }

    const addPaymentLine = () => {
        const remaining = totalFinal - payments.reduce((s, p) => s + p.amount, 0)
        const nextMethod = methods.find((m) => !payments.find((p) => p.method.id === m.id)) || methods[0]
        if (nextMethod) {
            setPayments([...payments, { method: nextMethod, amount: Math.max(0, remaining) }])
        }
    }

    const removePaymentLine = (index: number) => {
        setPayments(payments.filter((_, i) => i !== index))
    }

    const updatePaymentAmount = (index: number, amount: number) => {
        setPayments(payments.map((p, i) => (i === index ? { ...p, amount } : p)))
    }

    const updatePaymentMethod = (index: number, methodId: number) => {
        const method = methods.find((m) => m.id === methodId)
        if (method) {
            setPayments(payments.map((p, i) => (i === index ? { ...p, method } : p)))
        }
    }

    const applySmartCash = (amount: number) => {
        // Apply to the first cash payment line
        const cashIdx = payments.findIndex((p) => p.method.code === 'EFECTIVO')
        if (cashIdx >= 0) {
            updatePaymentAmount(cashIdx, amount)
        }
    }

    const totalPaid = payments.reduce((s, p) => s + p.amount, 0)
    // Remaining shows true debt
    const remaining = Math.max(0, totalFinal - totalPaid)
    // Change is always cash, so it should be rounded
    const rawChange = totalPaid > totalFinal ? totalPaid - totalFinal : 0
    const change = roundCash(rawChange)

    // Show smart cash only when there's a cash payment line
    const hasCashPayment = payments.some((p) => p.method.code === 'EFECTIVO')
    const suggestedBills = useMemo(() => getSuggestedBills(totalFinal), [totalFinal])

    // Determine effective RUT
    const isBoleta = [39, 41].includes(dteType)
    const effectiveRut = customer?.rut || (isBoleta ? GENERIC_RUT : '')

    // Can submit: Boleta always OK (generic fallback), Factura needs a selected customer
    const canSubmit = (isBoleta || !!customer) && remaining <= 0 && availableDtes.length > 0

    const handleSubmit = async () => {
        setSubmitting(true)
        try {
            const sale = await createSale({
                rut_cliente: effectiveRut,
                tipo_dte: dteType,
                items: items.map((i) => ({
                    product_id: i.product.id,
                    cantidad: i.quantity,
                })),
                payments: payments.map((p) => ({
                    payment_method_id: p.method.id,
                    amount: p.amount,
                })),
                seller_id: userId || undefined,
                ...(isBoleta ? {} : { referencias: referencias.filter((r) => r.folio.trim() && r.fecha) }),
            })

            setSuccess(true)
            setLastFolio(sale.folio)
            setLastSaleId(sale.id)
            toast.success(`¡Venta registrada! Folio #${sale.folio}`, { duration: 5000 })

            // No auto-open, user must click print or finish
        } catch (err: unknown) {
            console.error("Sale Error:", err)
            const response = (err as any)?.response
            const detail = response?.data?.detail

            // Construct a more helpful error message
            let errorMessage = 'Error al crear la venta'
            if (typeof detail === 'string') {
                errorMessage = detail
            } else if (typeof detail === 'object') {
                errorMessage = JSON.stringify(detail)
            } else if (response?.status === 422) {
                errorMessage = 'Error de validación (422). Revise los datos.'
            }

            toast.error(errorMessage, {
                description: `Code: ${response?.status || 'Unknown'}`,
                duration: 5000,
                action: {
                    label: 'Copiar',
                    onClick: () => navigator.clipboard.writeText(JSON.stringify(response?.data || err))
                }
            })
        } finally {
            setSubmitting(false)
        }
    }



    return (
        <>
            <Dialog open={open} onOpenChange={(open) => !open && !success && onClose()}>
                <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" onInteractOutside={(e) => success && e.preventDefault()}>
                    <DialogHeader>
                        <DialogTitle className="text-xl">
                            {success ? '✅ Venta Exitosa' : 'Cobrar'}
                        </DialogTitle>
                        <DialogDescription>
                            {success
                                ? `Folio #${lastFolio} registrado correctamente.`
                                : `Total: ${formatCLP(totalFinal)}`}
                        </DialogDescription>
                    </DialogHeader>

                    {success ? (
                        <div className="flex flex-col items-center py-6">
                            <CheckCircle2 className="h-16 w-16 text-emerald-500 animate-in zoom-in-50" />
                            {change > 0 && (
                                <div className="mt-6 text-center animate-in slide-in-from-bottom-2 fade-in">
                                    <p className="text-sm font-medium text-neutral-500 uppercase tracking-widest">Su Vuelto</p>
                                    <p className="text-4xl font-black text-neutral-900 dark:text-white">
                                        {formatCLP(change)}
                                    </p>
                                </div>
                            )}

                            <div className="mt-8 grid gap-3 w-full max-w-xs">
                                <Button
                                    onClick={handlePrint}
                                    size="lg"
                                    className="w-full gap-2 text-md font-bold h-12 shadow-md shadow-neutral-900/10"
                                    autoFocus
                                >
                                    <Printer className="h-5 w-5" />
                                    Imprimir Ticket
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={handleFinish}
                                    className="w-full h-10 border-neutral-300"
                                >
                                    Finalizar (Nueva Venta)
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* DTE Type Toggle */}
                            {availableDtes.length > 0 ? (
                                <Tabs value={dteType.toString()} onValueChange={(v) => setDteType(Number(v))}>
                                    <TabsList className="grid w-full grid-cols-3">
                                        <TabsTrigger
                                            value="39"
                                            className="gap-1.5 text-xs"
                                            disabled={!availableDtes.some(d => d.dte_type === 39)}
                                        >
                                            <Receipt className="h-3.5 w-3.5" /> Boleta
                                        </TabsTrigger>

                                        <TabsTrigger
                                            value="33"
                                            className="gap-1.5 text-xs"
                                            disabled={!availableDtes.some(d => d.dte_type === 33)}
                                        >
                                            <FileText className="h-3.5 w-3.5" /> Factura
                                        </TabsTrigger>

                                        {/* Dropdown Menu para los DTEs extra o seleccionados fuera de 33/39 */}
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <TabsTrigger
                                                    value={![33, 39].includes(dteType) ? dteType.toString() : "extra"}
                                                    className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                                                    disabled={!availableDtes.some(d => ![33, 39].includes(d.dte_type))}
                                                >
                                                    {![33, 39].includes(dteType) && availableDtes.find(d => d.dte_type === dteType) ? (
                                                        availableDtes.find(d => d.dte_type === dteType)?.dte_type === 34 ? 'Factura Exenta (34)' :
                                                            availableDtes.find(d => d.dte_type === dteType)?.dte_type === 41 ? 'Boleta E. (41)' :
                                                                `DTE ${dteType}`
                                                    ) : (
                                                        "..."
                                                    )}
                                                </TabsTrigger>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-40 text-xs">
                                                {availableDtes.find(d => d.dte_type === 34) && (
                                                    <DropdownMenuItem onClick={() => setDteType(34)} className="text-xs flex gap-2">
                                                        <FileText className="h-3.5 w-3.5 text-neutral-500" /> Factura Exenta (34)
                                                    </DropdownMenuItem>
                                                )}
                                                {availableDtes.find(d => d.dte_type === 41) && (
                                                    <DropdownMenuItem onClick={() => setDteType(41)} className="text-xs flex gap-2">
                                                        <Receipt className="h-3.5 w-3.5 text-neutral-500" /> Boleta E. (41)
                                                    </DropdownMenuItem>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TabsList>
                                </Tabs>
                            ) : (
                                <div className="p-3 bg-red-50 text-red-600 text-xs rounded-md text-center font-medium border border-red-200">
                                    No hay folios de venta disponibles. Solicite folios al SII.
                                </div>
                            )}

                            {/* Customer Section — Smart Autocomplete */}
                            <div className="space-y-1.5">
                                <div className="flex justify-between items-center">
                                    <Label className="text-xs">Cliente {isBoleta ? '(Opcional)' : '(Requerido)'}</Label>
                                    {isBoleta && !customer && (
                                        <span className="text-[10px] text-neutral-500 bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-full">
                                            Por defecto: Cliente Genérico
                                        </span>
                                    )}
                                </div>

                                <CustomerSearchCombobox
                                    value={customer}
                                    onChange={async (c) => {
                                        if (c && (c as any).price_list_id) {
                                            try {
                                                const { getPriceList } = await import('@/services/price_lists')
                                                const list = await getPriceList((c as any).price_list_id)
                                                setCustomer(c, list)
                                                toast.success(`Lista aplicada: ${list.name}`)
                                            } catch (err) {
                                                setCustomer(c)
                                            }
                                        } else {
                                            setCustomer(c)
                                            if (c) toast.info('Cliente sin lista especial (Precio Base)')
                                        }
                                    }}
                                    required={!isBoleta}
                                    placeholder={isBoleta ? 'Buscar cliente (opcional)…' : 'Buscar cliente por Nombre o RUT…'}
                                />
                            </div>

                            {/* Referencias (solo Factura) */}
                            {!isBoleta && (
                                <div className="space-y-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-800/30 overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => setRefsSectionOpen((o) => !o)}
                                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/50 transition-colors"
                                    >
                                        <span className="flex items-center gap-2">
                                            <FileStack className="h-3.5 w-3.5 text-neutral-500" />
                                            Referencias (OC, Guía, etc.)
                                            {referencias.length > 0 && (
                                                <Badge variant="secondary" className="text-[10px]">{referencias.length}</Badge>
                                            )}
                                        </span>
                                        {refsSectionOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                                    </button>
                                    {refsSectionOpen && (
                                        <div className="px-3 pb-3 pt-0 space-y-2 border-t border-neutral-200 dark:border-neutral-700">
                                            <p className="text-[10px] text-neutral-500 pt-2">Opcional. Documentos previos que respaldan la factura.</p>
                                            {referencias.map((ref, idx) => (
                                                <div key={idx} className="grid grid-cols-[1fr 1fr auto] gap-1.5 items-end">
                                                    <div className="space-y-0.5">
                                                        <Label className="text-[10px] text-neutral-500">Tipo</Label>
                                                        <select
                                                            value={ref.tipo_documento}
                                                            onChange={(e) => updateReferencia(idx, 'tipo_documento', e.target.value)}
                                                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                                                        >
                                                            {REFERENCE_DOC_TYPES.map((opt) => (
                                                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div className="space-y-0.5">
                                                        <Label className="text-[10px] text-neutral-500">Folio</Label>
                                                        <Input
                                                            value={ref.folio}
                                                            onChange={(e) => updateReferencia(idx, 'folio', e.target.value)}
                                                            placeholder="Nº"
                                                            className="h-8 text-xs"
                                                        />
                                                    </div>
                                                    <div className="flex items-center gap-0.5">
                                                        <div className="space-y-0.5">
                                                            <Label className="text-[10px] text-neutral-500">Fecha</Label>
                                                            <Input
                                                                type="date"
                                                                value={ref.fecha}
                                                                onChange={(e) => updateReferencia(idx, 'fecha', e.target.value)}
                                                                className="h-8 w-[110px] text-xs"
                                                            />
                                                        </div>
                                                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 shrink-0" onClick={() => removeReferencia(idx)}>
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                            <Button type="button" variant="outline" size="sm" onClick={addReferencia} className="h-7 text-[11px] gap-1 w-full">
                                                <Plus className="h-3 w-3" /> Añadir referencia
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            )}

                            <Separator />

                            {/* Payment Methods */}
                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs">Medios de Pago</Label>
                                    <Button variant="outline" size="sm" onClick={addPaymentLine} className="h-7 text-[11px] gap-1">
                                        <Plus className="h-3 w-3" /> Agregar
                                    </Button>
                                </div>

                                {payments.map((payment, index) => (
                                    <div key={index} className="flex items-center gap-1.5">
                                        <select
                                            value={payment.method.id}
                                            onChange={(e) => updatePaymentMethod(index, parseInt(e.target.value))}
                                            className="h-9 rounded-md border border-input bg-background px-2 py-1 text-xs flex-1 min-w-0"
                                        >
                                            {methods.map((m) => (
                                                <option key={m.id} value={m.id}>{m.name}</option>
                                            ))}
                                        </select>
                                        <Input
                                            type="number"
                                            value={payment.amount || ''}
                                            onChange={(e) => updatePaymentAmount(index, parseInt(e.target.value) || 0)}
                                            className="w-28 font-tabular text-right h-9 text-sm"
                                            min={0}
                                        />
                                        {payments.length > 1 && (
                                            <Button variant="ghost" size="icon" className="h-9 w-9 text-red-400 hover:text-red-600 shrink-0" onClick={() => removePaymentLine(index)}>
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Smart Cash Suggestions */}
                            {hasCashPayment && (
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] text-neutral-400 uppercase tracking-wider flex items-center gap-1">
                                        <Banknote className="h-3 w-3" /> Billetes sugeridos
                                    </Label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {suggestedBills.map((bill) => (
                                            <button
                                                key={bill}
                                                onClick={() => applySmartCash(bill)}
                                                className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold font-tabular text-neutral-700 transition-colors hover:border-neutral-400 hover:bg-neutral-50 hover:text-neutral-900 active:scale-95 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-500 dark:hover:bg-neutral-700 dark:hover:text-white"
                                            >
                                                {formatCLP(bill)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <Separator />

                            {/* Summary */}
                            <div className="space-y-1 font-tabular text-sm">
                                <div className="flex justify-between">
                                    <span className="text-neutral-500">Total</span>
                                    <span className="font-semibold">{formatCLP(totalFinal)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-neutral-500">Pagado</span>
                                    <span className={totalPaid >= totalFinal ? 'text-emerald-600' : 'text-amber-600'}>
                                        {formatCLP(totalPaid)}
                                    </span>
                                </div>
                                {remaining > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-red-500">Faltante</span>
                                        <Badge variant="destructive" className="text-xs">{formatCLP(remaining)}</Badge>
                                    </div>
                                )}
                                {change > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-neutral-900 dark:text-white font-medium">Vuelto</span>
                                        <Badge variant="secondary" className="text-xs">{formatCLP(change)}</Badge>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {!success && (
                        <DialogFooter className="gap-2 sm:gap-0">
                            <Button variant="outline" onClick={onClose} disabled={submitting} className="text-xs">
                                Cancelar
                            </Button>
                            <Button
                                onClick={handleSubmit}
                                disabled={submitting || !canSubmit}
                                className="bg-emerald-600 hover:bg-emerald-700 gap-2 text-xs"
                            >
                                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                {`Emitir ${dteType === 33 ? 'Factura' : dteType === 34 ? 'Exenta' : dteType === 41 ? 'Boleta Exenta' : 'Boleta'}`}
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>
        </>
    )
}
