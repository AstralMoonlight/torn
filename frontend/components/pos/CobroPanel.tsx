'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
    ArrowLeft, Banknote, CreditCard, Landmark, Wallet, Receipt, FileText, FileStack,
    CheckCircle2, Printer, Loader2, Plus, Trash2, ChevronDown, ChevronRight,
} from 'lucide-react'
import { useCartStore } from '@/lib/store/cartStore'
import { useSessionStore } from '@/lib/store/sessionStore'
import { getApiErrorDetail, getApiErrorStatus, fetchBlob, printPdf } from '@/services/api'
import {
    createSale, getFoliosStatus, getPaymentMethods, getSalePdfPath,
    type DocumentReference, type FolioStockOut, type PaymentMethod,
} from '@/services/sales'
import type { Customer } from '@/services/customers'
import CustomerSearchCombobox from '@/components/pos/CustomerSearchCombobox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCLP } from '@/lib/format'
import { cn } from '@/lib/utils'

const GENERIC_RUT = '66666666-6'

/**
 * Ley 21.054: el efectivo se redondea a la decena (1-4 baja, 5-9 sube). Los
 * demás medios se cobran exactos. Misma regla que `round_to_nearest_ten` del backend.
 */
function roundCash(amount: number): number {
    const n = Math.round(amount)
    const d = n % 10
    return d === 0 ? n : d < 5 ? n - d : n + (10 - d)
}

/** Monto exacto (redondeado) y los billetes que lo cubren, para no teclear. */
function billetesSugeridos(total: number): number[] {
    const exacto = roundCash(total)
    const s = new Set([exacto])
    for (const b of [1000, 2000, 5000, 10000, 20000]) {
        const n = Math.ceil(exacto / b) * b
        if (n > exacto) s.add(n)
    }
    return [...s].sort((a, b) => a - b).slice(0, 5)
}

const DOCUMENTOS = [
    { tipo: 39, label: 'Boleta', ayuda: 'Consumidor final', Icon: Receipt },
    { tipo: 33, label: 'Factura', ayuda: 'Empresa con RUT', Icon: FileText },
] as const

const OTROS_DOCUMENTOS = [
    { tipo: 41, label: 'Boleta exenta' },
    { tipo: 34, label: 'Factura exenta' },
    { tipo: 52, label: 'Guía de despacho' },
] as const

const NOMBRE_DOC: Record<number, string> = {
    39: 'Boleta', 41: 'Boleta exenta', 33: 'Factura', 34: 'Factura exenta', 52: 'Guía de despacho',
}

const TIPOS_TRASLADO = [
    { value: 1, label: 'Venta (se factura después)' },
    { value: 2, label: 'Venta por efectuar' },
    { value: 3, label: 'Consignación' },
    { value: 5, label: 'Traslado interno' },
    { value: 6, label: 'Otro traslado (no venta)' },
] as const

const REFERENCE_DOC_TYPES = [
    { value: '801', label: 'Orden de compra (801)' },
    { value: '52', label: 'Guía de despacho (52)' },
    { value: 'HES', label: 'Hoja de estado de pago (HES)' },
    { value: '802', label: 'Nota de pedido (802)' },
    { value: '46', label: 'Factura de compra (46)' },
] as const

const ICONO_PAGO: Record<string, typeof Banknote> = {
    EFECTIVO: Banknote, DEBITO: CreditCard, CREDITO: CreditCard, TRANSFERENCIA: Landmark, CREDITO_INTERNO: Wallet,
}

interface LineaPago {
    method: PaymentMethod
    amount: number
}

interface Props {
    /** Vuelve al paso de venta sin perder el ticket. */
    onVolver: () => void
    /** Venta emitida y cerrada (se imprimió o se eligió "Nueva venta"). */
    onTerminado: () => void
}

function Paso({ n, titulo, extra, children }: { n: number; titulo: string; extra?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section className="space-y-3">
            <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground" aria-hidden>{n}</span>
                <h3 className="text-base font-semibold text-foreground">{titulo}</h3>
                {extra && <span className="ml-auto">{extra}</span>}
            </div>
            <div className="pl-10">{children}</div>
        </section>
    )
}

export default function CobroPanel({ onVolver, onTerminado }: Props) {
    const {
        items, totalFinal, tipoDte, setTipoDte, customer, setCustomer,
        referencias, setReferencias, guia, setGuia, clear,
    } = useCartStore()
    const { userId } = useSessionStore()

    const [folios, setFolios] = useState<FolioStockOut[] | null>(null)
    const [methods, setMethods] = useState<PaymentMethod[]>([])
    const [pagos, setPagos] = useState<LineaPago[]>([])
    const [dividir, setDividir] = useState(false)
    const [verOtros, setVerOtros] = useState(false)
    const [verAvanzado, setVerAvanzado] = useState(false)
    const [enviando, setEnviando] = useState(false)
    const [emitida, setEmitida] = useState<{ id: number; folio: number; tipo: number; vuelto: number } | null>(null)
    // El cajero tecleó el efectivo recibido: un cambio de total (otro documento) no lo pisa.
    const recibidoEditado = useRef(false)

    const isBoleta = tipoDte === 39 || tipoDte === 41
    const isGuia = tipoDte === 52
    const trasladoInterno = isGuia && guia.indTraslado === 5
    const pideCliente = !isBoleta && !trasladoInterno
    const hayFolios = folios === null || folios.some((f) => f.dte_type === tipoDte)

    useEffect(() => {
        getFoliosStatus()
            .then((f) => setFolios(f.filter((d) => d.available > 0)))
            .catch(() => setFolios([]))
        getPaymentMethods()
            .then((m) => {
                setMethods(m)
                const efectivo = m.find((pm) => pm.code === 'EFECTIVO') ?? m[0]
                if (efectivo) setPagos([{ method: efectivo, amount: 0 }])
            })
            .catch(() => toast.error('No se pudieron cargar los medios de pago'))
        if ([41, 34, 52].includes(tipoDte)) setVerOtros(true)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al entrar al cobro
    }, [])

    // Con un solo medio de pago, el monto sigue al total (el documento puede
    // cambiar el IVA). El efectivo se redondea; si el cajero ya tecleó lo
    // recibido, se respeta.
    useEffect(() => {
        if (dividir) return
        setPagos((prev) => prev.slice(0, 1).map((p) => {
            const exacto = p.method.code === 'EFECTIVO' ? roundCash(totalFinal) : totalFinal
            if (p.method.code === 'EFECTIVO' && recibidoEditado.current && p.amount >= exacto) return p
            return { ...p, amount: exacto }
        }))
    }, [totalFinal, dividir, methods])

    const elegirMetodo = (method: PaymentMethod) => {
        recibidoEditado.current = false
        setDividir(false)
        setPagos([{ method, amount: method.code === 'EFECTIVO' ? roundCash(totalFinal) : totalFinal }])
    }

    // Totales del pago, con el redondeo solo sobre la parte en efectivo.
    const pagado = pagos.reduce((s, p) => s + p.amount, 0)
    const efectivo = pagos.filter((p) => p.method.code === 'EFECTIVO').reduce((s, p) => s + p.amount, 0)
    const deudaEfectivo = Math.max(totalFinal - (pagado - efectivo), 0)
    const ajuste = efectivo > 0 ? roundCash(deudaEfectivo) - deudaEfectivo : 0
    const totalAjustado = totalFinal + ajuste
    const falta = Math.max(0, totalAjustado - pagado)
    const vuelto = pagado > totalAjustado ? pagado - totalAjustado : 0
    const vueltoSinEfectivo = vuelto > 0 && efectivo < vuelto

    const bloqueo =
        items.length === 0 ? 'El ticket está vacío.'
            : !hayFolios ? `No quedan folios de ${NOMBRE_DOC[tipoDte] ?? 'este documento'}. Solicítalos al SII.`
                : pideCliente && !customer ? 'Elige el cliente.'
                    : isGuia ? null
                        : falta > 0 ? `Faltan ${formatCLP(falta)}.`
                            : vueltoSinEfectivo ? 'El vuelto solo se entrega en efectivo: ajusta los montos.'
                                : null

    const handleCustomerChange = async (c: Customer | null) => {
        if (c?.price_list_id) {
            try {
                const { getPriceList } = await import('@/services/price_lists')
                const list = await getPriceList(c.price_list_id)
                setCustomer(c, list)
                toast.success(`Lista de precios aplicada: ${list.name}`)
                return
            } catch { /* sigue con precio base */ }
        }
        setCustomer(c)
    }

    const confirmar = async () => {
        if (bloqueo || enviando) return
        setEnviando(true)
        try {
            const sale = await createSale({
                rut_cliente: customer?.rut || GENERIC_RUT,
                tipo_dte: tipoDte,
                items: items.map((i) => ({ product_id: i.product.id, cantidad: i.quantity })),
                ...(isGuia ? { ind_traslado: guia.indTraslado, tipo_despacho: guia.tipoDespacho ?? undefined } : {}),
                payments: isGuia ? [] : pagos.filter((p) => p.amount > 0).map((p) => ({ payment_method_id: p.method.id, amount: p.amount })),
                seller_id: userId || undefined,
                ...(isBoleta ? {} : { referencias: referencias.filter((r) => r.folio.trim() && r.fecha) }),
            })
            setEmitida({ id: sale.id, folio: sale.folio, tipo: sale.tipo_dte, vuelto: isGuia ? 0 : vuelto })
        } catch (err) {
            const status = getApiErrorStatus(err)
            toast.error(getApiErrorDetail(err, status === 422 ? 'Datos inválidos. Revisa la venta.' : 'No se pudo emitir el documento.'), { duration: 6000 })
        } finally {
            setEnviando(false)
        }
    }

    const terminar = () => {
        clear()
        onTerminado()
    }

    const imprimir = async () => {
        if (!emitida) return
        try {
            // Vía `api`: el PDF exige Authorization + X-Tenant-ID.
            const { url, isPdf } = await fetchBlob(getSalePdfPath(emitida.id))
            if (isPdf) {
                printPdf(url)
            } else {
                const frame = document.createElement('iframe')
                frame.style.display = 'none'
                frame.onload = () => {
                    try { frame.contentWindow?.print() } catch { window.open(url, '_blank') }
                    setTimeout(() => { URL.revokeObjectURL(url); frame.remove() }, 60000)
                }
                frame.src = url
                document.body.appendChild(frame)
            }
        } catch (err) {
            toast.error(getApiErrorDetail(err, 'No se pudo cargar el documento. Reimprímelo desde Historial.'))
        }
        terminar()
    }

    // Esc vuelve a la venta (tras emitir, pasa a la venta nueva); F12 confirma.
    // En captura: ningún campo del cobro se queda con la tecla.
    useEffect(() => {
        const alTeclear = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (enviando) return
                e.preventDefault()
                if (emitida) terminar()
                else onVolver()
            }
            if (e.key === 'F12' && !emitida) { e.preventDefault(); confirmar() }
        }
        window.addEventListener('keydown', alTeclear, true)
        return () => window.removeEventListener('keydown', alTeclear, true)
    })

    const sugeridos = useMemo(() => billetesSugeridos(totalFinal), [totalFinal])

    // ── Venta emitida ────────────────────────────────────────────────
    if (emitida) {
        return (
            <div data-section="pos.cobro.listo" className="flex h-full flex-col items-center justify-center gap-6 p-6 text-center">
                <CheckCircle2 className="h-16 w-16 text-emerald-600" aria-hidden />
                <div>
                    <p className="text-2xl font-bold text-foreground">{NOMBRE_DOC[emitida.tipo] ?? 'Documento'} N° {emitida.folio}</p>
                    <p className="mt-1 text-muted-foreground">Emitida correctamente</p>
                </div>
                {emitida.vuelto > 0 && (
                    <div className="rounded-2xl bg-muted px-10 py-5">
                        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Vuelto</p>
                        <p className="text-5xl font-bold text-foreground font-tabular">{formatCLP(emitida.vuelto)}</p>
                    </div>
                )}
                <div className="grid w-full max-w-sm gap-3">
                    <Button size="lg" className="h-14 gap-2 text-lg" onClick={imprimir} autoFocus>
                        <Printer className="h-5 w-5" aria-hidden /> Imprimir
                    </Button>
                    <Button size="lg" variant="outline" className="h-12 text-base" onClick={terminar}>
                        Nueva venta sin imprimir <kbd className="ml-2 rounded border border-border px-1.5 text-xs font-medium text-muted-foreground">Esc</kbd>
                    </Button>
                </div>
            </div>
        )
    }

    // ── Cobro ────────────────────────────────────────────────────────
    const metodo = pagos[0]?.method
    return (
        <div data-section="pos.cobro" className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3 md:px-6 shrink-0">
                <Button variant="ghost" size="sm" onClick={onVolver} className="h-10 gap-2 px-3 text-base">
                    <ArrowLeft className="h-5 w-5" aria-hidden /> Volver
                    <kbd className="hidden md:inline rounded border border-border px-1.5 text-xs font-medium text-muted-foreground">Esc</kbd>
                </Button>
                <h2 className="text-lg font-semibold text-foreground">Cobrar</h2>
                <span className="ml-auto text-2xl font-bold text-foreground font-tabular">{formatCLP(totalFinal)}</span>
            </div>

            <div className="flex-1 overflow-auto px-4 py-4 md:px-6 space-y-5 min-h-0">
                <div data-section="pos.cobro.documento">
                    <Paso n={1} titulo="Documento">
                        <div className="grid grid-cols-2 gap-3">
                            {DOCUMENTOS.map(({ tipo, label, ayuda, Icon }) => (
                                <OpcionGrande key={tipo} activa={tipoDte === tipo} onClick={() => setTipoDte(tipo)}
                                    sinFolios={folios !== null && !folios.some((f) => f.dte_type === tipo)}>
                                    <Icon className="h-6 w-6" aria-hidden />
                                    <span className="text-base font-semibold">{label}</span>
                                    <span className="text-xs opacity-75">{ayuda}</span>
                                </OpcionGrande>
                            ))}
                        </div>
                        <button type="button" onClick={() => setVerOtros((v) => !v)}
                            className="mt-3 flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                            aria-expanded={verOtros}>
                            {verOtros ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            Otros documentos
                        </button>
                        {verOtros && (
                            <div className="mt-2 flex flex-wrap gap-2">
                                {OTROS_DOCUMENTOS.map(({ tipo, label }) => {
                                    const sinFolios = folios !== null && !folios.some((f) => f.dte_type === tipo)
                                    return (
                                        <button key={tipo} type="button" onClick={() => setTipoDte(tipo)} aria-pressed={tipoDte === tipo}
                                            className={cn('h-10 rounded-lg border px-4 text-sm font-medium transition-colors cursor-pointer',
                                                tipoDte === tipo ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary/40')}>
                                            {label}{sinFolios && <span className="ml-1.5 text-xs opacity-70">(sin folios)</span>}
                                        </button>
                                    )
                                })}
                            </div>
                        )}
                        {isGuia && (
                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <Label htmlFor="traslado">Tipo de traslado</Label>
                                    <select id="traslado" value={guia.indTraslado}
                                        onChange={(e) => setGuia({ ...guia, indTraslado: Number(e.target.value) })}
                                        className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm">
                                        {TIPOS_TRASLADO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="despacho">Despacho</Label>
                                    <select id="despacho" value={guia.tipoDespacho ?? ''}
                                        onChange={(e) => setGuia({ ...guia, tipoDespacho: e.target.value ? Number(e.target.value) : null })}
                                        className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm">
                                        <option value="">Sin indicar</option>
                                        <option value={1}>Por cuenta del cliente</option>
                                        <option value={2}>Emisor a local del cliente</option>
                                        <option value={3}>Emisor a otras instalaciones</option>
                                    </select>
                                </div>
                            </div>
                        )}
                    </Paso>
                </div>

                {!trasladoInterno && (
                    <div data-section="pos.cobro.cliente">
                        <Paso n={2} titulo="Cliente" extra={!pideCliente && <span className="text-sm text-muted-foreground">Opcional</span>}>
                            <CustomerSearchCombobox compact={false} value={customer} onChange={handleCustomerChange} required={pideCliente} />
                        </Paso>
                    </div>
                )}

                <div data-section="pos.cobro.pago">
                    <Paso n={trasladoInterno ? 2 : 3} titulo="Pago"
                        extra={!isGuia && !dividir && methods.length > 1 && (
                            <button type="button" onClick={() => { setDividir(true); recibidoEditado.current = true }}
                                className="text-sm font-medium text-primary hover:underline cursor-pointer">
                                Pagar con dos o más medios
                            </button>
                        )}>
                        {isGuia ? (
                            <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
                                La guía descuenta el stock y no se cobra ahora.
                                {trasladoInterno ? ' En traslado interno el receptor es la propia empresa.' : ' Se cobra al facturarla desde Historial.'}
                            </p>
                        ) : !dividir ? (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
                                    {methods.map((m) => {
                                        const Icon = ICONO_PAGO[m.code] ?? CreditCard
                                        return (
                                            <OpcionGrande key={m.id} fila activa={metodo?.id === m.id} onClick={() => elegirMetodo(m)}>
                                                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                                                <span className="text-sm font-semibold">{m.name}</span>
                                            </OpcionGrande>
                                        )
                                    })}
                                </div>
                                {metodo?.code === 'EFECTIVO' && (
                                    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                                        <div className="flex items-end gap-4">
                                            <div className="flex-1 space-y-1.5">
                                                <Label htmlFor="recibido">Recibido</Label>
                                                <Input id="recibido" type="number" inputMode="numeric" min={0}
                                                    value={pagos[0]?.amount || ''}
                                                    onChange={(e) => { recibidoEditado.current = true; setPagos([{ method: metodo, amount: parseInt(e.target.value) || 0 }]) }}
                                                    onFocus={(e) => e.target.select()}
                                                    className="h-14 text-2xl font-semibold font-tabular" />
                                            </div>
                                            <div className="min-w-[8rem] text-right">
                                                <p className="text-sm text-muted-foreground">{falta > 0 ? 'Falta' : 'Vuelto'}</p>
                                                <p className={cn('text-3xl font-bold font-tabular', falta > 0 ? 'text-destructive' : 'text-foreground')}>
                                                    {formatCLP(falta > 0 ? falta : vuelto)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {sugeridos.map((b, i) => (
                                                <button key={b} type="button"
                                                    onClick={() => { recibidoEditado.current = true; setPagos([{ method: metodo, amount: b }]) }}
                                                    className="h-11 min-w-[5.5rem] rounded-lg border border-border bg-background px-3 text-sm font-semibold font-tabular hover:border-primary/50 hover:bg-accent cursor-pointer">
                                                    {i === 0 ? 'Exacto' : formatCLP(b)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {pagos.map((p, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                        <select value={p.method.id} aria-label="Medio de pago"
                                            onChange={(e) => {
                                                const m = methods.find((x) => x.id === Number(e.target.value))
                                                if (m) setPagos(pagos.map((q, i) => (i === idx ? { ...q, method: m } : q)))
                                            }}
                                            className="h-11 flex-1 rounded-lg border border-input bg-background px-3 text-sm">
                                            {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                                        </select>
                                        <Input type="number" inputMode="numeric" min={0} aria-label="Monto" value={p.amount || ''}
                                            onChange={(e) => setPagos(pagos.map((q, i) => (i === idx ? { ...q, amount: parseInt(e.target.value) || 0 } : q)))}
                                            className="h-11 w-36 text-right text-base font-tabular" />
                                        <Button variant="ghost" size="icon" className="h-11 w-11 text-destructive" aria-label="Quitar medio de pago"
                                            disabled={pagos.length === 1}
                                            onClick={() => setPagos(pagos.filter((_, i) => i !== idx))}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                                <div className="flex items-center justify-between pt-1">
                                    <Button variant="outline" size="sm" className="h-10 gap-1.5"
                                        onClick={() => {
                                            const m = methods.find((x) => !pagos.some((q) => q.method.id === x.id)) ?? methods[0]
                                            if (m) setPagos([...pagos, { method: m, amount: falta }])
                                        }}>
                                        <Plus className="h-4 w-4" /> Agregar medio
                                    </Button>
                                    <p className="text-sm font-tabular">
                                        {falta > 0
                                            ? <span className="font-semibold text-destructive">Falta {formatCLP(falta)}</span>
                                            : <span className="text-muted-foreground">Vuelto <span className="font-semibold text-foreground">{formatCLP(vuelto)}</span></span>}
                                    </p>
                                </div>
                            </div>
                        )}
                    </Paso>
                </div>

                {!isBoleta && (
                    <div data-section="pos.cobro.avanzado">
                        <button type="button" onClick={() => setVerAvanzado((v) => !v)} aria-expanded={verAvanzado}
                            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground cursor-pointer">
                            {verAvanzado ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            Opciones avanzadas: referencias (OC, guía…)
                            {referencias.length > 0 && <span className="ml-1 rounded-full bg-muted px-2 text-xs">{referencias.length}</span>}
                        </button>
                        {verAvanzado && (
                            <Referencias referencias={referencias} setReferencias={setReferencias} />
                        )}
                    </div>
                )}
            </div>

            <div data-section="pos.cobro.confirmar" className="border-t border-border bg-card px-4 py-4 md:px-6 shrink-0 space-y-2">
                {bloqueo && <p className="text-center text-sm text-destructive" role="status">{bloqueo}</p>}
                <Button size="lg" onClick={confirmar} disabled={!!bloqueo || enviando}
                    className="h-14 w-full justify-between px-5 text-lg font-semibold shadow-lg shadow-primary/25">
                    <span className="flex items-center gap-2">
                        {enviando ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : isGuia ? <FileStack className="h-5 w-5" aria-hidden /> : <CheckCircle2 className="h-5 w-5" aria-hidden />}
                        {isGuia ? 'Emitir guía' : `Emitir ${NOMBRE_DOC[tipoDte]?.toLowerCase() ?? 'documento'}`}
                    </span>
                    <span className="flex items-center gap-3 font-tabular">
                        {formatCLP(isGuia ? totalFinal : totalAjustado)}
                        <kbd className="hidden md:inline rounded border border-primary-foreground/30 px-1.5 text-xs font-medium opacity-80">F12</kbd>
                    </span>
                </Button>
            </div>
        </div>
    )
}

function OpcionGrande({ activa, sinFolios, fila, onClick, children }: {
    activa: boolean; sinFolios?: boolean; fila?: boolean; onClick: () => void; children: React.ReactNode
}) {
    return (
        <button type="button" onClick={onClick} aria-pressed={activa}
            className={cn(
                'relative flex items-center justify-center rounded-xl border-2 p-3 text-center transition-colors cursor-pointer',
                fila ? 'min-h-14 flex-row gap-2' : 'min-h-[4.75rem] flex-col gap-0.5',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                activa ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-foreground hover:border-primary/40',
            )}>
            {children}
            {sinFolios && <span className="absolute right-2 top-2 rounded bg-destructive/10 px-1.5 text-[11px] font-medium text-destructive">sin folios</span>}
        </button>
    )
}

function Referencias({ referencias, setReferencias }: {
    referencias: DocumentReference[]; setReferencias: (r: DocumentReference[]) => void
}) {
    const hoy = new Date().toISOString().slice(0, 10)
    const cambiar = (i: number, campo: keyof DocumentReference, valor: string) =>
        setReferencias(referencias.map((r, j) => (j === i ? { ...r, [campo]: valor } : r)))
    return (
        <div className="mt-3 space-y-2 rounded-lg border border-border p-3">
            {referencias.map((r, i) => (
                <div key={i} className="grid grid-cols-[1fr_7rem_9rem_auto] gap-2">
                    <select value={r.tipo_documento} aria-label="Tipo de documento" onChange={(e) => cambiar(i, 'tipo_documento', e.target.value)}
                        className="h-10 rounded-lg border border-input bg-background px-2 text-sm">
                        {REFERENCE_DOC_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <Input value={r.folio} placeholder="Folio" aria-label="Folio" onChange={(e) => cambiar(i, 'folio', e.target.value)} className="h-10" />
                    <Input type="date" value={r.fecha} aria-label="Fecha" onChange={(e) => cambiar(i, 'fecha', e.target.value)} className="h-10" />
                    <Button variant="ghost" size="icon" className="h-10 w-10 text-destructive" aria-label="Quitar referencia"
                        onClick={() => setReferencias(referencias.filter((_, j) => j !== i))}>
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            ))}
            <Button variant="outline" size="sm" className="h-10 gap-1.5"
                onClick={() => setReferencias([...referencias, { tipo_documento: '801', folio: '', fecha: hoy }])}>
                <Plus className="h-4 w-4" /> Agregar referencia
            </Button>
        </div>
    )
}
