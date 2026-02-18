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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { createSale, getPaymentMethods, getSalePdfUrl, type PaymentMethod } from '@/services/sales'
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

export default function CheckoutModal({ open, onClose }: Props) {
    const { items, totalFinal, clear } = useCartStore()
    const { userId } = useSessionStore()
    const [methods, setMethods] = useState<PaymentMethod[]>([])
    const [payments, setPayments] = useState<PaymentLine[]>([])
    const [dteType, setDteType] = useState<'boleta' | 'factura'>('boleta')

    // Customer State — single source of truth
    const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

    const [submitting, setSubmitting] = useState(false)
    const [success, setSuccess] = useState(false)
    const [lastFolio, setLastFolio] = useState<number | null>(null)
    const [lastSaleId, setLastSaleId] = useState<number | null>(null)

    // Load payment methods on open
    useEffect(() => {
        if (open) {
            getPaymentMethods()
                .then((m) => {
                    setMethods(m)
                    const cash = m.find((pm) => pm.code === 'EFECTIVO')
                    if (cash) setPayments([{ method: cash, amount: roundCash(totalFinal) }])
                })
                .catch(() => toast.error('Error cargando medios de pago'))
            setSuccess(false)
            setLastFolio(null)
            setLastSaleId(null)
            setSelectedCustomer(null)
            setDteType('boleta')
        }
    }, [open, totalFinal])

    const handleFinish = () => {
        clear()
        setPayments([])
        setSuccess(false)
        setLastFolio(null)
        setLastSaleId(null)
        onClose()
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
    const isBoleta = dteType === 'boleta'
    const effectiveRut = selectedCustomer?.rut || (isBoleta ? GENERIC_RUT : '')

    // Can submit: Boleta always OK (generic fallback), Factura needs a selected customer
    const canSubmit = (isBoleta || !!selectedCustomer) && remaining <= 0

    const handleSubmit = async () => {
        setSubmitting(true)
        try {
            const sale = await createSale({
                rut_cliente: effectiveRut,
                tipo_dte: isBoleta ? 39 : 33,
                items: items.map((i) => ({
                    product_id: i.product.id,
                    cantidad: i.quantity,
                })),
                payments: payments.map((p) => ({
                    payment_method_id: p.method.id,
                    amount: p.amount,
                })),
                seller_id: userId || undefined
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
                                    <p className="text-sm font-medium text-slate-500 uppercase tracking-widest">Su Vuelto</p>
                                    <p className="text-4xl font-black text-blue-600">
                                        {formatCLP(change)}
                                    </p>
                                </div>
                            )}

                            <div className="mt-8 grid gap-3 w-full max-w-xs">
                                <Button
                                    onClick={handlePrint}
                                    size="lg"
                                    className="w-full gap-2 text-md font-bold h-12 shadow-md shadow-blue-900/10"
                                    autoFocus
                                >
                                    <Printer className="h-5 w-5" />
                                    Imprimir Ticket
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={handleFinish}
                                    className="w-full h-10 border-slate-300"
                                >
                                    Finalizar (Nueva Venta)
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* DTE Type Toggle */}
                            <Tabs value={dteType} onValueChange={(v) => setDteType(v as 'boleta' | 'factura')}>
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="boleta" className="gap-1.5 text-xs">
                                        <Receipt className="h-3.5 w-3.5" />
                                        Boleta (39)
                                    </TabsTrigger>
                                    <TabsTrigger value="factura" className="gap-1.5 text-xs">
                                        <FileText className="h-3.5 w-3.5" />
                                        Factura (33)
                                    </TabsTrigger>
                                </TabsList>
                            </Tabs>

                            {/* Customer Section — Smart Autocomplete */}
                            <div className="space-y-1.5">
                                <div className="flex justify-between items-center">
                                    <Label className="text-xs">Cliente {isBoleta ? '(Opcional)' : '(Requerido)'}</Label>
                                    {isBoleta && !selectedCustomer && (
                                        <span className="text-[10px] text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                                            Por defecto: Cliente Genérico
                                        </span>
                                    )}
                                </div>

                                <CustomerSearchCombobox
                                    value={selectedCustomer}
                                    onChange={setSelectedCustomer}
                                    required={!isBoleta}
                                    placeholder={isBoleta ? 'Buscar cliente (opcional)…' : 'Buscar cliente por Nombre o RUT…'}
                                />
                            </div>

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
                                    <Label className="text-[10px] text-slate-400 uppercase tracking-wider flex items-center gap-1">
                                        <Banknote className="h-3 w-3" /> Billetes sugeridos
                                    </Label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {suggestedBills.map((bill) => (
                                            <button
                                                key={bill}
                                                onClick={() => applySmartCash(bill)}
                                                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold font-tabular text-slate-700 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-blue-500 dark:hover:bg-blue-900/30"
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
                                    <span className="text-slate-500">Total</span>
                                    <span className="font-semibold">{formatCLP(totalFinal)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Pagado</span>
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
                                        <span className="text-blue-600 font-medium">Vuelto</span>
                                        <Badge className="bg-blue-600 text-xs">{formatCLP(change)}</Badge>
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
                                {isBoleta ? 'Emitir Boleta' : 'Emitir Factura'}
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>
        </>
    )
}
