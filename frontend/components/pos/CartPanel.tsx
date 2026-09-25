'use client'

import { useEffect, useState } from 'react'
import { useCartStore, isExemptDte } from '@/lib/store/cartStore'
import { Trash2, Minus, Plus, ShoppingBag, CreditCard, X, ScanBarcode, Receipt, FileText, ChevronDown, ChevronRight, FileStack } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import CheckoutModal from '@/components/pos/CheckoutModal'
import { formatCLP } from '@/lib/format'
import PriceListSelector from '@/components/pos/PriceListSelector'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import CustomerSearchCombobox from '@/components/pos/CustomerSearchCombobox'
import { getFoliosStatus, type FolioStockOut, type DocumentReference } from '@/services/sales'
import type { Customer } from '@/services/customers'
import { toast } from 'sonner'

interface Props {
    onClose?: () => void // Mobile close handler
}

/** Tipos de documento de referencia más usados (SII Chile). */
const REFERENCE_DOC_TYPES = [
    { value: '801', label: '801 - Orden de Compra' },
    { value: '52', label: '52 - Guía de Despacho Electrónica' },
    { value: 'HES', label: 'HES - Hoja de Estado de Pago' },
    { value: '802', label: '802 - Nota de Pedido' },
    { value: '46', label: '46 - Factura de Compra' },
] as const

/** IndTraslado del SII que ofrece el POS. 5: el receptor es la propia empresa. */
const TIPOS_TRASLADO = [
    { value: 1, label: 'Venta (se factura después)' },
    { value: 2, label: 'Venta por efectuar' },
    { value: 3, label: 'Consignación' },
    { value: 5, label: 'Traslado interno' },
    { value: 6, label: 'Otro traslado (no venta)' },
] as const

/** Documentos del menú "…". Se pueden elegir aunque no tengan folios: el botón de cobro avisa. */
const DTE_EXTRA = [
    { tipo: 34, label: 'Factura Exenta (34)', Icon: FileText },
    { tipo: 41, label: 'Boleta Exenta (41)', Icon: Receipt },
    { tipo: 52, label: 'Guía de Despacho (52)', Icon: FileStack },
]

function formatDateForInput(d: Date): string {
    return d.toISOString().slice(0, 10)
}

export default function CartPanel({ onClose }: Props) {
    const {
        items, totalNeto, totalIva, totalFinal, tipoDte, setTipoDte,
        customer, setCustomer, referencias, setReferencias, guia, setGuia,
        removeItem, updateQuantity, clear,
    } = useCartStore()
    const [checkoutOpen, setCheckoutOpen] = useState(false)
    const [availableDtes, setAvailableDtes] = useState<FolioStockOut[]>([])
    const [refsSectionOpen, setRefsSectionOpen] = useState(false)

    // `totalNeto`/`totalIva`/`totalFinal` no están en el `partialize` del
    // store (sólo items/customer/priceList) — es a propósito, son campos
    // derivados. Pero al recargar la página con un carro ya persistido en
    // localStorage, la rehidratación de zustand restaura `items` sin volver
    // a correr `recalcTotals`, así que quedan en 0 hasta la próxima acción
    // que sí lo dispare (agregar/quitar producto, cambiar cantidad...). Sin
    // este efecto, un F5 con productos en el carro mostraba Total $0 aunque
    // cada línea individual sí tuviera su precio correcto.
    useEffect(() => {
        if (items.length > 0 && totalFinal === 0) {
            setTipoDte(tipoDte)
        }
    }, [items.length, totalFinal, tipoDte, setTipoDte])

    // El stock de folios se carga una vez al montar el panel — ya no hace
    // falta esperar a abrir el modal de cobro para saber qué documentos se
    // pueden emitir, porque la elección ahora vive acá.
    useEffect(() => {
        getFoliosStatus()
            .then((f) => setAvailableDtes(f.filter((d) => d.available > 0)))
            .catch(() => toast.error('Error cargando el estado de folios'))
    }, [])

    const isBoleta = [39, 41].includes(tipoDte)
    const unidades = items.reduce((sum, i) => sum + i.quantity, 0)
    // La guía descuenta stock y no se cobra (se cobra al facturarla desde Historial).
    const isGuia = tipoDte === 52
    const trasladoInterno = isGuia && guia.indTraslado === 5

    const handleCustomerChange = async (c: Customer | null) => {
        if (c && c.price_list_id) {
            try {
                const { getPriceList } = await import('@/services/price_lists')
                const list = await getPriceList(c.price_list_id)
                setCustomer(c, list)
                toast.success(`Lista aplicada: ${list.name}`)
            } catch {
                setCustomer(c)
            }
        } else {
            setCustomer(c)
            if (c) toast.info('Cliente sin lista especial (Precio Base)')
        }
    }

    const addReferencia = () => {
        setReferencias([...referencias, { tipo_documento: '801', folio: '', fecha: formatDateForInput(new Date()) }])
    }
    const removeReferencia = (index: number) => {
        setReferencias(referencias.filter((_, i) => i !== index))
    }
    const updateReferencia = (index: number, field: keyof DocumentReference, value: string) => {
        setReferencias(referencias.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
    }

    // Bloquea "Cobrar" si Factura/Exenta no tiene cliente, o si no quedan
    // folios para ningún tipo de documento — antes este chequeo vivía recién
    // dentro del modal, así que se podía abrir el cobro para descubrir ahí
    // que faltaba el cliente.
    const noFoliosAvailable = availableDtes.length === 0
    const sinFoliosDelTipo = !availableDtes.some((d) => d.dte_type === tipoDte)
    const canCheckout = (isBoleta || trasladoInterno || !!customer) && !sinFoliosDelTipo
    const checkoutBlockedReason = noFoliosAvailable
        ? 'No hay folios disponibles. Solicite folios al SII.'
        : sinFoliosDelTipo
            ? 'No quedan folios para este documento.'
            : !isBoleta && !trasladoInterno && !customer
                ? 'Selecciona un cliente.'
                : null

    // F12 abre el cobro. Solo la instancia de escritorio: la hoja móvil trae onClose.
    useEffect(() => {
        if (onClose) return
        const alTeclear = (e: KeyboardEvent) => {
            if (e.key !== 'F12' || !canCheckout || checkoutOpen) return
            e.preventDefault()
            setCheckoutOpen(true)
        }
        window.addEventListener('keydown', alTeclear)
        return () => window.removeEventListener('keydown', alTeclear)
    }, [onClose, canCheckout, checkoutOpen])

    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col bg-card">
            {/* Header */}
            <div data-section="pos.carrito.encabezado" className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 shrink-0">
                <div className="flex items-center gap-2">
                    <ShoppingBag className="h-5 w-5 text-muted-foreground" aria-hidden />
                    <h2 className="text-base font-semibold text-foreground">Venta actual</h2>
                    {unidades > 0 && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground font-tabular">
                            {unidades} {unidades === 1 ? 'unidad' : 'unidades'}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <PriceListSelector />
                    {items.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={clear} className="h-9 gap-1.5 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive">
                            <Trash2 className="h-4 w-4" aria-hidden /> Vaciar
                        </Button>
                    )}
                    {onClose && (
                        <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9 lg:hidden" aria-label="Cerrar carrito">
                            <X className="h-5 w-5" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Items */}
            <div data-section="pos.carrito.items" className="flex-1 overflow-auto px-3 py-3 min-h-0">
                {items.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                            <ScanBarcode className="h-8 w-8" aria-hidden />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-foreground">Sin productos</p>
                            <p className="mt-1 text-xs">Escanea un código o toca un producto para empezar.</p>
                        </div>
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {items.map((item) => (
                            <li key={item.product.id} className="rounded-lg border border-border bg-background p-2.5">
                                <div className="flex items-start justify-between gap-3">
                                    <p className="text-sm font-medium leading-snug text-foreground line-clamp-2">
                                        {item.product.full_name}
                                    </p>
                                    <p className="shrink-0 text-sm font-semibold text-foreground font-tabular">
                                        {formatCLP(item.precio_bruto * item.quantity)}
                                    </p>
                                </div>
                                <div className="mt-2 flex items-center justify-between gap-2">
                                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground font-tabular">
                                        {formatCLP(item.precio_bruto)} c/u
                                        {item.price_source === 'price_list' && (
                                            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] bg-primary/10 text-primary">Lista</Badge>
                                        )}
                                    </p>
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                                            aria-label={`Quitar una unidad de ${item.product.full_name}`}
                                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground active:scale-95 transition cursor-pointer"
                                        >
                                            <Minus className="h-4 w-4" />
                                        </button>
                                        <span className="min-w-[2.25rem] text-center text-sm font-semibold font-tabular" aria-label="Cantidad">
                                            {item.quantity}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                                            aria-label={`Agregar una unidad de ${item.product.full_name}`}
                                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground active:scale-95 transition cursor-pointer"
                                        >
                                            <Plus className="h-4 w-4" />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => removeItem(item.product.id)}
                                            aria-label={`Eliminar ${item.product.full_name}`}
                                            className="ml-1 flex h-9 w-9 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10 transition cursor-pointer"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {/* Documento + Totales + Cobrar */}
            {items.length > 0 && (
                <div className="border-t border-border shrink-0">
                    {/* Documento: tipo de DTE, cliente y referencias — antes vivía
                        dentro del modal de cobro; ahora se decide acá, visible
                        mientras se arma el carro, para no tener que volver atrás
                        en medio del pago si hay que corregir algo. */}
                    <div data-section="pos.carrito.documento" className="px-4 pt-3 space-y-2 border-b border-border pb-3">
                        {(
                            <div className="space-y-1.5">
                                {/* flex-wrap: si el ícono de cliente se expande (panel inline,
                                    no modal), no cabe junto a los tabs y baja a su propia línea
                                    en vez de quedar apretado o cortado. */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <Tabs value={tipoDte.toString()} onValueChange={(v) => { if (v === "33" || v === "39") setTipoDte(Number(v)) }} className="flex-1 min-w-0">
                                        <TabsList className="grid w-full grid-cols-3">
                                            <TabsTrigger
                                                value="39"
                                                className="gap-1.5 text-xs"
                                            >
                                                <Receipt className="h-3.5 w-3.5" /> Boleta
                                            </TabsTrigger>

                                            <TabsTrigger
                                                value="33"
                                                className="gap-1.5 text-xs"
                                            >
                                                <FileText className="h-3.5 w-3.5" /> Factura
                                            </TabsTrigger>

                                            {/* Dropdown para los DTEs extra (exentos) fuera de 33/39 */}
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <TabsTrigger
                                                        value={![33, 39].includes(tipoDte) ? tipoDte.toString() : 'extra'}
                                                        className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                                                    >
                                                        {![33, 39].includes(tipoDte) ? (
                                                            tipoDte === 34 ? 'Exenta (34)' : tipoDte === 41 ? 'Bol. Exenta (41)' : tipoDte === 52 ? 'Guía (52)' : `DTE ${tipoDte}`
                                                        ) : (
                                                            '...'
                                                        )}
                                                    </TabsTrigger>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="w-52 text-xs">
                                                    {DTE_EXTRA.map(({ tipo, label, Icon }) => (
                                                        <DropdownMenuItem key={tipo} onClick={() => setTipoDte(tipo)} className="text-xs flex gap-2">
                                                            <Icon className="h-3.5 w-3.5 text-muted-foreground" /> {label}
                                                            {!availableDtes.some((d) => d.dte_type === tipo) && (
                                                                <span className="ml-auto text-[10px] text-muted-foreground">sin folios</span>
                                                            )}
                                                        </DropdownMenuItem>
                                                    ))}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TabsList>
                                    </Tabs>

                                    {/* Boleta: cliente opcional, basta un ícono compacto junto a
                                        los tabs. Factura (y exentas): el cliente es obligatorio y
                                        lleva más datos, así que baja a una barra propia más abajo. */}
                                    {isBoleta && (
                                        <CustomerSearchCombobox
                                            value={customer}
                                            onChange={handleCustomerChange}
                                            required={false}
                                        />
                                    )}
                                </div>

                                {isGuia && (
                                    <div className="grid grid-cols-2 gap-1.5">
                                        <select
                                            value={guia.indTraslado}
                                            onChange={(e) => setGuia({ ...guia, indTraslado: Number(e.target.value) })}
                                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                                            aria-label="Tipo de traslado"
                                        >
                                            {TIPOS_TRASLADO.map((t) => (
                                                <option key={t.value} value={t.value}>{t.label}</option>
                                            ))}
                                        </select>
                                        <select
                                            value={guia.tipoDespacho ?? ''}
                                            onChange={(e) => setGuia({ ...guia, tipoDespacho: e.target.value ? Number(e.target.value) : null })}
                                            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                                            aria-label="Tipo de despacho"
                                        >
                                            <option value="">Despacho: sin indicar</option>
                                            <option value={1}>Por cuenta del cliente</option>
                                            <option value={2}>Emisor a local del cliente</option>
                                            <option value={3}>Emisor a otras instalaciones</option>
                                        </select>
                                        <p className="col-span-2 text-[10px] text-muted-foreground">
                                            Descuenta stock y no se cobra.
                                            {trasladoInterno ? ' El receptor es la propia empresa.' : ' Se cobra al facturarla desde Historial.'}
                                        </p>
                                    </div>
                                )}

                                {!isBoleta && !trasladoInterno && (
                                    <CustomerSearchCombobox
                                        compact={false}
                                        value={customer}
                                        onChange={handleCustomerChange}
                                        required
                                    />
                                )}
                            </div>
                        )}

                        {!isBoleta && !isGuia && (
                            <div data-section="pos.carrito.referencias" className="rounded-lg border border-border bg-muted/50 overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setRefsSectionOpen((o) => !o)}
                                    className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs font-medium text-foreground hover:bg-accent transition-colors"
                                >
                                    <span className="flex items-center gap-1.5">
                                        <FileStack className="h-3.5 w-3.5 text-muted-foreground" />
                                        Referencias
                                        {referencias.length > 0 && (
                                            <Badge variant="secondary" className="text-[10px]">{referencias.length}</Badge>
                                        )}
                                    </span>
                                    {refsSectionOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                                </button>
                                {refsSectionOpen && (
                                    <div className="px-2.5 pb-2.5 pt-0 space-y-2 border-t border-border">
                                        <p className="text-[10px] text-muted-foreground pt-2">Opcional. Documentos previos que respaldan la factura.</p>
                                        {referencias.map((ref, idx) => (
                                            <div key={idx} className="grid grid-cols-[1fr_1fr_auto] gap-1.5 items-end">
                                                <div className="space-y-0.5">
                                                    <Label className="text-[10px] text-muted-foreground">Tipo</Label>
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
                                                    <Label className="text-[10px] text-muted-foreground">Folio</Label>
                                                    <Input
                                                        value={ref.folio}
                                                        onChange={(e) => updateReferencia(idx, 'folio', e.target.value)}
                                                        placeholder="Nº"
                                                        className="h-8 text-xs"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-0.5">
                                                    <div className="space-y-0.5">
                                                        <Label className="text-[10px] text-muted-foreground">Fecha</Label>
                                                        <Input
                                                            type="date"
                                                            value={ref.fecha}
                                                            onChange={(e) => updateReferencia(idx, 'fecha', e.target.value)}
                                                            className="h-8 w-[110px] text-xs"
                                                        />
                                                    </div>
                                                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive shrink-0" onClick={() => removeReferencia(idx)}>
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
                    </div>

                    <div data-section="pos.carrito.totales" className="px-4 pt-3 font-tabular">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Neto</span>
                            <span>{formatCLP(totalNeto)}</span>
                        </div>
                        <div className="mt-0.5 flex justify-between text-xs text-muted-foreground">
                            <span>{isExemptDte(tipoDte) ? 'IVA (exento)' : 'IVA 19%'}</span>
                            <span>{formatCLP(totalIva)}</span>
                        </div>
                        <div className="mt-2 flex items-baseline justify-between">
                            <span className="text-sm font-medium text-muted-foreground">Total</span>
                            <span className="text-3xl font-bold tracking-tight text-foreground">{formatCLP(totalFinal)}</span>
                        </div>
                    </div>

                    <div className="px-4 pb-4 pt-3 space-y-2">
                        {checkoutBlockedReason && (
                            <p className="text-xs text-destructive text-center" role="status">{checkoutBlockedReason}</p>
                        )}
                        <Button
                            size="lg"
                            className="h-14 w-full justify-between gap-2 px-5 text-base font-semibold shadow-lg shadow-primary/25 active:scale-[0.99] transition-transform"
                            onClick={() => setCheckoutOpen(true)}
                            disabled={!canCheckout}
                        >
                            <span className="flex items-center gap-2">
                                {isGuia ? <FileStack className="h-5 w-5" aria-hidden /> : <CreditCard className="h-5 w-5" aria-hidden />}
                                {isGuia ? 'Emitir guía' : 'Cobrar'}
                            </span>
                            <kbd className="hidden lg:inline-flex h-6 items-center rounded border border-primary-foreground/30 px-1.5 text-[11px] font-medium opacity-80">F12</kbd>
                        </Button>
                    </div>
                </div>
            )}

            <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />
        </div>
    )
}
