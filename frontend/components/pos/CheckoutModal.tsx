'use client'

import { useEffect, useState } from 'react'
import { useCartStore } from '@/lib/store/cartStore'
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
import { createSale, getPaymentMethods, type PaymentMethod } from '@/services/sales'
import { getCustomerByRut } from '@/services/customers'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, Plus, Trash2, Search } from 'lucide-react'

function formatCLP(value: number): string {
    return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        minimumFractionDigits: 0,
    }).format(value)
}

interface PaymentLine {
    method: PaymentMethod
    amount: number
}

interface Props {
    open: boolean
    onClose: () => void
}

export default function CheckoutModal({ open, onClose }: Props) {
    const { items, totalFinal, clear } = useCartStore()
    const [methods, setMethods] = useState<PaymentMethod[]>([])
    const [payments, setPayments] = useState<PaymentLine[]>([])
    const [rut, setRut] = useState('')
    const [customerName, setCustomerName] = useState('')
    const [customerLoading, setCustomerLoading] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [success, setSuccess] = useState(false)

    // Load payment methods on open
    useEffect(() => {
        if (open) {
            getPaymentMethods()
                .then((m) => {
                    setMethods(m)
                    // Default: single cash payment for full amount
                    const cash = m.find((pm) => pm.code === 'EFECTIVO')
                    if (cash) {
                        setPayments([{ method: cash, amount: totalFinal }])
                    }
                })
                .catch(() => toast.error('Error cargando medios de pago'))

            setSuccess(false)
        }
    }, [open, totalFinal])

    const searchCustomer = async () => {
        if (!rut.trim()) return
        setCustomerLoading(true)
        try {
            const c = await getCustomerByRut(rut.trim())
            setCustomerName(c.razon_social)
        } catch {
            setCustomerName('')
            toast.error('Cliente no encontrado')
        } finally {
            setCustomerLoading(false)
        }
    }

    const addPaymentLine = () => {
        const remaining = totalFinal - payments.reduce((s, p) => s + p.amount, 0)
        const nextMethod = methods.find(
            (m) => !payments.find((p) => p.method.id === m.id)
        ) || methods[0]
        if (nextMethod) {
            setPayments([...payments, { method: nextMethod, amount: Math.max(0, remaining) }])
        }
    }

    const removePaymentLine = (index: number) => {
        setPayments(payments.filter((_, i) => i !== index))
    }

    const updatePaymentAmount = (index: number, amount: number) => {
        setPayments(
            payments.map((p, i) => (i === index ? { ...p, amount } : p))
        )
    }

    const updatePaymentMethod = (index: number, methodId: number) => {
        const method = methods.find((m) => m.id === methodId)
        if (method) {
            setPayments(
                payments.map((p, i) => (i === index ? { ...p, method } : p))
            )
        }
    }

    const totalPaid = payments.reduce((s, p) => s + p.amount, 0)
    const remaining = totalFinal - totalPaid

    const handleSubmit = async () => {
        if (!rut.trim()) {
            toast.error('Debes ingresar el RUT del cliente')
            return
        }
        if (remaining > 0) {
            toast.error(`Faltan ${formatCLP(remaining)} por pagar`)
            return
        }

        setSubmitting(true)
        try {
            const sale = await createSale({
                rut_cliente: rut.trim(),
                tipo_dte: 33,
                items: items.map((i) => ({
                    product_id: i.product.id,
                    cantidad: i.quantity,
                })),
                payments: payments.map((p) => ({
                    payment_method_id: p.method.id,
                    amount: p.amount,
                })),
            })

            setSuccess(true)
            toast.success(`¡Venta registrada! Folio #${sale.folio}`, {
                duration: 5000,
            })

            // Auto-close after success animation
            setTimeout(() => {
                clear()
                setRut('')
                setCustomerName('')
                setPayments([])
                setSuccess(false)
                onClose()
            }, 2000)
        } catch (err: unknown) {
            const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            toast.error(detail || 'Error al crear la venta')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle className="text-xl">
                        {success ? '✅ Venta Exitosa' : 'Cobrar'}
                    </DialogTitle>
                    <DialogDescription>
                        {success
                            ? 'La venta ha sido registrada correctamente.'
                            : `Total a cobrar: ${formatCLP(totalFinal)}`}
                    </DialogDescription>
                </DialogHeader>

                {success ? (
                    <div className="flex flex-col items-center py-8">
                        <CheckCircle2 className="h-20 w-20 text-emerald-500 animate-in zoom-in-50" />
                        <p className="mt-4 text-lg font-bold text-emerald-600">¡Listo!</p>
                    </div>
                ) : (
                    <div className="space-y-5">
                        {/* Customer RUT */}
                        <div className="space-y-2">
                            <Label>RUT del Cliente</Label>
                            <div className="flex gap-2">
                                <Input
                                    placeholder="12345678-9"
                                    value={rut}
                                    onChange={(e) => setRut(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && searchCustomer()}
                                    className="font-mono"
                                />
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={searchCustomer}
                                    disabled={customerLoading}
                                >
                                    {customerLoading ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Search className="h-4 w-4" />
                                    )}
                                </Button>
                            </div>
                            {customerName && (
                                <p className="text-sm text-emerald-600 font-medium">
                                    ✓ {customerName}
                                </p>
                            )}
                        </div>

                        <Separator />

                        {/* Payment Methods */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <Label>Medios de Pago</Label>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={addPaymentLine}
                                    className="h-7 text-xs gap-1"
                                >
                                    <Plus className="h-3 w-3" />
                                    Agregar
                                </Button>
                            </div>

                            {payments.map((payment, index) => (
                                <div key={index} className="flex items-center gap-2">
                                    <select
                                        value={payment.method.id}
                                        onChange={(e) =>
                                            updatePaymentMethod(index, parseInt(e.target.value))
                                        }
                                        className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm flex-1"
                                    >
                                        {methods.map((m) => (
                                            <option key={m.id} value={m.id}>
                                                {m.name}
                                            </option>
                                        ))}
                                    </select>
                                    <Input
                                        type="number"
                                        value={payment.amount || ''}
                                        onChange={(e) =>
                                            updatePaymentAmount(index, parseInt(e.target.value) || 0)
                                        }
                                        className="w-32 font-tabular text-right"
                                        min={0}
                                    />
                                    {payments.length > 1 && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-10 w-10 text-red-400 hover:text-red-600"
                                            onClick={() => removePaymentLine(index)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>

                        <Separator />

                        {/* Summary */}
                        <div className="space-y-1 font-tabular">
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Total</span>
                                <span className="font-semibold">{formatCLP(totalFinal)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Pagado</span>
                                <span className={totalPaid >= totalFinal ? 'text-emerald-600' : 'text-amber-600'}>
                                    {formatCLP(totalPaid)}
                                </span>
                            </div>
                            {remaining > 0 && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-red-500">Faltante</span>
                                    <Badge variant="destructive">{formatCLP(remaining)}</Badge>
                                </div>
                            )}
                            {remaining < 0 && (
                                <div className="flex justify-between text-sm">
                                    <span className="text-blue-500">Vuelto</span>
                                    <Badge className="bg-blue-600">{formatCLP(Math.abs(remaining))}</Badge>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {!success && (
                    <DialogFooter>
                        <Button variant="outline" onClick={onClose} disabled={submitting}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={submitting || !rut.trim() || remaining > 0}
                            className="bg-emerald-600 hover:bg-emerald-700 gap-2"
                        >
                            {submitting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <CheckCircle2 className="h-4 w-4" />
                            )}
                            Confirmar Venta
                        </Button>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    )
}
