'use client'

import { getApiErrorDetail, getApiErrorStatus, fetchBlob, printPdf } from '@/services/api'
import { useEffect, useState, useMemo, useRef } from 'react'
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
import { createSale, getPaymentMethods, getSalePdfPath, type PaymentMethod } from '@/services/sales'
import { toast } from 'sonner'
import {
    Loader2,
    CheckCircle2,
    Plus,
    Trash2,
    Banknote,
    Printer,
} from 'lucide-react'
import { formatCLP } from '@/lib/format'


// Chilean Rounding Law (Ley de Redondeo - Ley 21.054)
// Ends in 1-5 -> Round down to 0
// Ends in 6-9 -> Round up to 10
/**
 * Redondea un monto en efectivo a la decena más cercana, según la regla
 * chilena: de 5 hacia arriba sube a la decena siguiente, de 4 hacia abajo baja
 * a la decena actual. Los pagos con tarjeta se cobran exactos.
 */
function roundCash(amount: number): number {
    const integerAmount = Math.round(amount)
    const lastDigit = integerAmount % 10
    if (lastDigit === 0) return integerAmount
    if (lastDigit < 5) return integerAmount - lastDigit
    return integerAmount + (10 - lastDigit)
}

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

const DTE_LABELS: Record<number, string> = {
    33: 'Factura',
    34: 'Factura Exenta',
    39: 'Boleta',
    41: 'Boleta Exenta',
    52: 'Guía de Despacho',
}

export default function CheckoutModal({ open, onClose }: Props) {
    // Tipo de documento, cliente y referencias ya se deciden en el panel del
    // carrito (CartPanel.tsx) antes de llegar a este modal — acá sólo se
    // resuelve el pago. Evita el vaivén de tener que volver atrás en medio
    // de un formulario de pago a medio llenar para corregir algo de eso.
    const { items, totalFinal, clear, customer, tipoDte, referencias, setReferencias, guia } = useCartStore()
    const { userId } = useSessionStore()
    const [methods, setMethods] = useState<PaymentMethod[]>([])
    const [payments, setPayments] = useState<PaymentLine[]>([])

    const [submitting, setSubmitting] = useState(false)
    const [success, setSuccess] = useState(false)
    const [lastFolio, setLastFolio] = useState<number | null>(null)
    const [lastSaleId, setLastSaleId] = useState<number | null>(null)

    // totalFinal puede cambiar mientras el modal ya está abierto (recálculo
    // async de precio de lista, IVA según el tipo de DTE, etc.). El efecto de
    // apertura sólo debe sembrar el pago inicial UNA vez al abrir, con el
    // total que exista en ese momento — leído de esta ref, no como
    // dependencia del efecto. Si totalFinal fuera dependencia, cada cambio
    // reseteaba TODO el formulario de pago (volvía a Efectivo con el monto
    // redondeado), pisando en silencio un medio de pago ya elegido por el
    // cajero: así se armaba un monto que ya no correspondía al total vigente,
    // y el backend terminaba rechazando la venta por "vuelto sin efectivo".
    const totalFinalRef = useRef(totalFinal)
    useEffect(() => {
        totalFinalRef.current = totalFinal
    }, [totalFinal])

    // Load payment methods on open (sólo al abrir, no en cada cambio de total)
    useEffect(() => {
        if (open) {
            getPaymentMethods()
                .then((m) => {
                    setMethods(m)
                    const cash = m.find((pm) => pm.code === 'EFECTIVO')
                    if (cash) setPayments([{ method: cash, amount: roundCash(totalFinalRef.current) }])
                })
                .catch(() => toast.error('Error cargando medios de pago'))
            setSuccess(false)
            setLastFolio(null)
            setLastSaleId(null)
        }
    }, [open])

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
            // Vía `api` (no fetch()/<a href> directos): el endpoint exige
            // Authorization + X-Tenant-ID, que sólo el interceptor de axios
            // agrega — un fetch a la URL pelada responde 401.
            const { url: blobUrl, isPdf } = await fetchBlob(getSalePdfPath(lastSaleId))

            // Formato carta: es el PDF de dte-torn con el timbre.
            if (isPdf) {
                printPdf(blobUrl)
                handleFinish()
                return
            }

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
            // No hay fallback a la URL directa: sin el token no carga (401),
            // así que sólo se puede avisar y dejar que reimpriman desde Historial.
            toast.error(getApiErrorDetail(err, 'No se pudo cargar el documento para imprimir.'))
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
        if (!method) return
        // El monto de la línea se recalcula para el medio nuevo: si venía de
        // Efectivo, arrastraba el monto redondeado a la decena (ver
        // roundCash), y ese redondeo sólo aplica al pago en efectivo — con
        // tarjeta se cobra exacto. Sin este recálculo, cambiar de Efectivo a
        // Débito/Crédito dejaba un faltante o sobrante de hasta $9 que nadie
        // pedía cobrar ni devolver.
        setPayments((prev) => {
            const otherLinesTotal = prev.reduce((s, p, i) => (i === index ? s : s + p.amount), 0)
            const remainingForThisLine = Math.max(0, totalFinal - otherLinesTotal)
            const amount = method.code === 'EFECTIVO' ? roundCash(remainingForThisLine) : remainingForThisLine
            return prev.map((p, i) => (i === index ? { ...p, method, amount } : p))
        })
    }

    const applySmartCash = (amount: number) => {
        // Apply to the first cash payment line
        const cashIdx = payments.findIndex((p) => p.method.code === 'EFECTIVO')
        if (cashIdx >= 0) {
            updatePaymentAmount(cashIdx, amount)
        }
    }

    const totalPaid = payments.reduce((s, p) => s + p.amount, 0)

    // El redondeo a la decena sólo se aplica a la porción pagada en efectivo
    // (app/utils/taxes.py::round_to_nearest_ten, misma regla que roundCash).
    // No es vuelto: es un ajuste al monto exigible, así que el "remaining" y
    // el botón de cobro tienen que medirse contra el total ya ajustado, no
    // contra totalFinal. Si no, el monto sugerido (redondeado) nunca alcanza
    // para habilitar el cobro y el backend igual lo rechazaría.
    const cashDeclared = payments.filter((p) => p.method.code === 'EFECTIVO').reduce((s, p) => s + p.amount, 0)
    const nonCashDeclared = totalPaid - cashDeclared
    const cashOwed = Math.max(totalFinal - nonCashDeclared, 0)
    const roundingAdjustment = cashDeclared > 0 ? roundCash(cashOwed) - cashOwed : 0
    const adjustedTotal = totalFinal + roundingAdjustment

    // Remaining shows true debt against the rounding-adjusted total
    const remaining = Math.max(0, adjustedTotal - totalPaid)
    const change = totalPaid > adjustedTotal ? totalPaid - adjustedTotal : 0
    // Tarjeta/transferencia no dan vuelto: si el excedente supera el efectivo
    // recibido, el backend lo rechaza (app/routers/sales.py). Se valida acá
    // también para no depender únicamente de que el monto llegue bien
    // armado: si algo lo desincroniza, el cajero ve el problema en el modal
    // en vez de un 400 crudo tras enviar.
    const changeExceedsCash = change > 0 && cashDeclared < change

    // Show smart cash only when there's a cash payment line
    const hasCashPayment = payments.some((p) => p.method.code === 'EFECTIVO')
    const suggestedBills = useMemo(() => getSuggestedBills(totalFinal), [totalFinal])

    // Determine effective RUT
    const isBoleta = [39, 41].includes(tipoDte)
    // La guía no se cobra: se cobra al facturarla (Historial).
    const isGuia = tipoDte === 52
    const trasladoInterno = isGuia && guia.indTraslado === 5
    const effectiveRut = customer?.rut || (isBoleta || trasladoInterno ? GENERIC_RUT : '')

    // El tipo de documento y el cliente ya se validaron en CartPanel antes de
    // poder abrir este modal (ver `canCheckout` ahí) — acá sólo falta que el
    // pago cierre.
    const canSubmit = (isBoleta || trasladoInterno || !!customer) && (isGuia || (remaining <= 0 && !changeExceedsCash))

    const handleSubmit = async () => {
        setSubmitting(true)
        try {
            const sale = await createSale({
                rut_cliente: effectiveRut,
                tipo_dte: tipoDte,
                items: items.map((i) => ({
                    product_id: i.product.id,
                    cantidad: i.quantity,
                })),
                ...(isGuia ? { ind_traslado: guia.indTraslado, tipo_despacho: guia.tipoDespacho ?? undefined } : {}),
                payments: isGuia ? [] : payments.map((p) => ({
                    payment_method_id: p.method.id,
                    amount: p.amount,
                })),
                seller_id: userId || undefined,
                ...(isBoleta ? {} : { referencias: referencias.filter((r) => r.folio.trim() && r.fecha) }),
            })

            setSuccess(true)
            setLastFolio(sale.folio)
            setLastSaleId(sale.id)
            setReferencias([])
            toast.success(`¡Venta registrada! Folio #${sale.folio}`, { duration: 5000 })

            // No auto-open, user must click print or finish
        } catch (err: unknown) {
            console.error("Sale Error:", err)
            const status = getApiErrorStatus(err)
            // El backend explica el motivo real en `detail` ("Stock insuficiente
            // para ...", "No hay folios disponibles ..."); es lo que le sirve al
            // cajero. El 422 es el único caso sin mensaje aprovechable.
            const errorMessage = getApiErrorDetail(
                err,
                status === 422
                    ? 'Error de validación (422). Revise los datos.'
                    : 'Error al crear la venta',
            )

            toast.error(errorMessage, {
                description: `Code: ${status ?? 'Unknown'}`,
                duration: 5000,
                action: {
                    label: 'Copiar',
                    onClick: () => navigator.clipboard.writeText(
                        JSON.stringify({ status, detail: errorMessage }),
                    )
                }
            })
        } finally {
            setSubmitting(false)
        }
    }



    return (
        <>
            <Dialog open={open} onOpenChange={(open) => !open && !success && onClose()}>
                <DialogContent data-section="pos.cobro" className="sm:max-w-lg max-h-[90vh] overflow-y-auto" onInteractOutside={(e) => success && e.preventDefault()}>
                    <DialogHeader>
                        <DialogTitle className="text-xl">
                            {success ? '✅ Venta Exitosa' : `Cobrar ${DTE_LABELS[tipoDte] || ''}`}
                        </DialogTitle>
                        <DialogDescription>
                            {success
                                ? `Folio #${lastFolio} registrado correctamente.`
                                : customer
                                    ? `${customer.razon_social} — Total: ${formatCLP(totalFinal)}`
                                    : `Total: ${formatCLP(totalFinal)}`}
                        </DialogDescription>
                    </DialogHeader>

                    {success ? (
                        <div className="flex flex-col items-center py-6">
                            <CheckCircle2 className="h-16 w-16 text-primary animate-in zoom-in-50" />
                            {change > 0 && (
                                <div className="mt-6 text-center animate-in slide-in-from-bottom-2 fade-in">
                                    <p className="text-sm font-medium text-muted-foreground uppercase tracking-widest">Su Vuelto</p>
                                    <p className="text-4xl font-black text-foreground">
                                        {formatCLP(change)}
                                    </p>
                                </div>
                            )}

                            <div className="mt-8 grid gap-3 w-full max-w-xs">
                                <Button
                                    onClick={handlePrint}
                                    size="lg"
                                    className="w-full gap-2 text-md font-bold h-12 shadow-md shadow-foreground/10"
                                    autoFocus
                                >
                                    <Printer className="h-5 w-5" />
                                    Imprimir Ticket
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={handleFinish}
                                    className="w-full h-10 border-border"
                                >
                                    Finalizar (Nueva Venta)
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {isGuia ? (
                                <p className="text-sm text-muted-foreground">
                                    La guía descuenta el stock y no se cobra.
                                    {trasladoInterno ? ' Traslado interno: el receptor es la propia empresa.' : ' Se cobra al facturarla desde Historial.'}
                                </p>
                            ) : (<>
                            {/* Payment Methods */}
                            <div data-section="pos.cobro.pagos" className="space-y-2.5">
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
                                            <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive shrink-0" onClick={() => removePaymentLine(index)}>
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Smart Cash Suggestions */}
                            {hasCashPayment && (
                                <div className="space-y-1.5">
                                    <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                                        <Banknote className="h-3 w-3" /> Billetes sugeridos
                                    </Label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {suggestedBills.map((bill) => (
                                            <button
                                                key={bill}
                                                onClick={() => applySmartCash(bill)}
                                                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold font-tabular text-foreground transition-colors hover:border-primary/40 hover:bg-accent active:scale-95"
                                            >
                                                {formatCLP(bill)}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <Separator />

                            {/* Summary */}
                            <div data-section="pos.cobro.resumen" className="space-y-1 font-tabular text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Total</span>
                                    <span className="font-semibold">{formatCLP(totalFinal)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Pagado</span>
                                    <span className={totalPaid >= totalFinal ? 'text-foreground' : 'text-destructive'}>
                                        {formatCLP(totalPaid)}
                                    </span>
                                </div>
                                {remaining > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-destructive">Faltante</span>
                                        <Badge variant="destructive" className="text-xs">{formatCLP(remaining)}</Badge>
                                    </div>
                                )}
                                {change > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-foreground font-medium">Vuelto</span>
                                        <Badge variant={changeExceedsCash ? 'destructive' : 'secondary'} className="text-xs">{formatCLP(change)}</Badge>
                                    </div>
                                )}
                                {changeExceedsCash && (
                                    <p className="text-xs text-destructive pt-1">
                                        El vuelto supera el efectivo recibido ({formatCLP(cashDeclared)}); los demás
                                        medios de pago no dan cambio. Ajusta los montos antes de emitir.
                                    </p>
                                )}
                            </div>
                            </>)}
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
                                className="gap-2 text-xs"
                            >
                                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                {`Emitir ${DTE_LABELS[tipoDte] || 'Documento'}`}
                            </Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>
        </>
    )
}
