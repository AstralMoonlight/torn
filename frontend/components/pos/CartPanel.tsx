'use client'

import { useEffect, useState } from 'react'
import { useCartStore, isExemptDte } from '@/lib/store/cartStore'
import { Trash2, Minus, Plus, ShoppingBag, CreditCard, X, Receipt, FileText, ChevronDown, ChevronRight, FileStack } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
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

function formatDateForInput(d: Date): string {
    return d.toISOString().slice(0, 10)
}

export default function CartPanel({ onClose }: Props) {
    const {
        items, totalNeto, totalIva, totalFinal, tipoDte, setTipoDte,
        customer, setCustomer, referencias, setReferencias,
        removeItem, updateQuantity, clear,
    } = useCartStore()
    const [checkoutOpen, setCheckoutOpen] = useState(false)
    const [availableDtes, setAvailableDtes] = useState<FolioStockOut[]>([])
    const [refsSectionOpen, setRefsSectionOpen] = useState(false)

    // El stock de folios se carga una vez al montar el panel — ya no hace
    // falta esperar a abrir el modal de cobro para saber qué documentos se
    // pueden emitir, porque la elección ahora vive acá.
    useEffect(() => {
        getFoliosStatus()
            .then((f) => setAvailableDtes(f.filter((d) => d.available > 0)))
            .catch(() => toast.error('Error cargando el estado de folios'))
    }, [])

    const isBoleta = [39, 41].includes(tipoDte)

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
    const canCheckout = (isBoleta || !!customer) && !noFoliosAvailable
    const checkoutBlockedReason = noFoliosAvailable
        ? 'No hay folios disponibles. Solicite folios al SII.'
        : !isBoleta && !customer
            ? 'Selecciona un cliente para Factura.'
            : null

    return (
        <div className="flex h-full max-h-[85vh] lg:max-h-full flex-col bg-card">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5 shrink-0">
                <div className="flex items-center gap-2">
                    <ShoppingBag className="h-4 w-4 text-muted-foreground dark:text-muted-foreground" />
                    <h2 className="font-semibold text-sm text-foreground">Ticket</h2>
                    {items.length > 0 && (
                        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-foreground px-1.5 text-[10px] font-bold text-background">
                            {items.length}
                        </span>
                    )}
                </div>
                <PriceListSelector />
                <div className="flex items-center gap-1">
                    {items.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={clear} className="text-[11px] text-destructive hover:bg-destructive/10 h-7 px-2">
                            Limpiar
                        </Button>
                    )}
                    {onClose && (
                        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 lg:hidden">
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-auto px-3 py-2 min-h-0">
                {items.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                        <ShoppingBag className="h-12 w-12 opacity-20" />
                        <p className="mt-2 text-xs">Carrito vacío</p>
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {items.map((item) => (
                            <div
                                key={item.product.id}
                                className="group rounded-lg border border-border bg-muted/50 p-2.5"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <p className="text-xs font-medium text-foreground truncate">
                                                {item.product.full_name}
                                            </p>
                                            {item.price_source === 'price_list' && (
                                                <Badge variant="secondary" className="h-4 text-[9px] px-1 bg-primary/10 text-primary">
                                                    Lista
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="text-[10px] text-muted-foreground font-mono">{item.product.codigo_interno}</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5 font-tabular">
                                            <span className="text-muted-foreground">Neto:</span> {formatCLP(item.precio_neto)} +
                                            <span className="text-muted-foreground ml-1">IVA:</span> {formatCLP(item.precio_bruto - item.precio_neto)} × {item.quantity}
                                        </p>
                                    </div>
                                    <p className="font-bold text-xs text-foreground font-tabular whitespace-nowrap">
                                        {formatCLP(item.precio_bruto * item.quantity)}
                                    </p>
                                </div>

                                <div className="mt-1.5 flex items-center justify-between">
                                    <div className="flex items-center gap-0.5">
                                        <button
                                            onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                                            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent transition active:scale-90"
                                        >
                                            <Minus className="h-3 w-3" />
                                        </button>
                                        <span className="flex h-7 min-w-[28px] items-center justify-center text-xs font-semibold font-tabular">
                                            {item.quantity}
                                        </span>
                                        <button
                                            onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                                            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent transition active:scale-90"
                                        >
                                            <Plus className="h-3 w-3" />
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => removeItem(item.product.id)}
                                        className="flex h-7 w-7 items-center justify-center rounded-md text-destructive hover:bg-destructive/10 transition"
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Documento + Totales + Cobrar */}
            {items.length > 0 && (
                <div className="border-t border-border shrink-0">
                    {/* Documento: tipo de DTE, cliente y referencias — antes vivía
                        dentro del modal de cobro; ahora se decide acá, visible
                        mientras se arma el carro, para no tener que volver atrás
                        en medio del pago si hay que corregir algo. */}
                    <div className="px-4 pt-3 space-y-2 border-b border-border pb-3">
                        {availableDtes.length > 0 ? (
                            <Tabs value={tipoDte.toString()} onValueChange={(v) => setTipoDte(Number(v))}>
                                <TabsList className="grid w-full grid-cols-3">
                                    <TabsTrigger
                                        value="39"
                                        className="gap-1.5 text-xs"
                                        disabled={!availableDtes.some((d) => d.dte_type === 39)}
                                    >
                                        <Receipt className="h-3.5 w-3.5" /> Boleta
                                    </TabsTrigger>

                                    <TabsTrigger
                                        value="33"
                                        className="gap-1.5 text-xs"
                                        disabled={!availableDtes.some((d) => d.dte_type === 33)}
                                    >
                                        <FileText className="h-3.5 w-3.5" /> Factura
                                    </TabsTrigger>

                                    {/* Dropdown para los DTEs extra (exentos) fuera de 33/39 */}
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <TabsTrigger
                                                value={![33, 39].includes(tipoDte) ? tipoDte.toString() : 'extra'}
                                                className="gap-1.5 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                                                disabled={!availableDtes.some((d) => ![33, 39].includes(d.dte_type))}
                                            >
                                                {![33, 39].includes(tipoDte) && availableDtes.find((d) => d.dte_type === tipoDte) ? (
                                                    tipoDte === 34 ? 'Exenta (34)' : tipoDte === 41 ? 'Bol. Exenta (41)' : `DTE ${tipoDte}`
                                                ) : (
                                                    '...'
                                                )}
                                            </TabsTrigger>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-44 text-xs">
                                            {availableDtes.find((d) => d.dte_type === 34) && (
                                                <DropdownMenuItem onClick={() => setTipoDte(34)} className="text-xs flex gap-2">
                                                    <FileText className="h-3.5 w-3.5 text-muted-foreground" /> Factura Exenta (34)
                                                </DropdownMenuItem>
                                            )}
                                            {availableDtes.find((d) => d.dte_type === 41) && (
                                                <DropdownMenuItem onClick={() => setTipoDte(41)} className="text-xs flex gap-2">
                                                    <Receipt className="h-3.5 w-3.5 text-muted-foreground" /> Boleta Exenta (41)
                                                </DropdownMenuItem>
                                            )}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </TabsList>
                            </Tabs>
                        ) : (
                            <div className="p-2 bg-destructive/10 text-destructive text-xs rounded-md text-center font-medium border border-destructive/30">
                                No hay folios de venta disponibles. Solicite folios al SII.
                            </div>
                        )}

                        <div className="space-y-1">
                            <div className="flex justify-between items-center">
                                <Label className="text-[10px] text-muted-foreground">Cliente {isBoleta ? '(Opcional)' : '(Requerido)'}</Label>
                                {isBoleta && !customer && (
                                    <span className="text-[9px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                                        Por defecto: Genérico
                                    </span>
                                )}
                            </div>
                            <CustomerSearchCombobox
                                value={customer}
                                onChange={async (c) => {
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
                                }}
                                required={!isBoleta}
                                placeholder={isBoleta ? 'Buscar cliente (opcional)…' : 'Buscar cliente por Nombre o RUT…'}
                            />
                        </div>

                        {!isBoleta && (
                            <div className="rounded-lg border border-border bg-muted/50 overflow-hidden">
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

                    <div className="space-y-0.5 px-4 py-2.5 font-tabular">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Neto</span>
                            <span>{formatCLP(totalNeto)}</span>
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{isExemptDte(tipoDte) ? 'IVA (exento)' : 'IVA (19%)'}</span>
                            <span>{formatCLP(totalIva)}</span>
                        </div>
                        <Separator className="my-1.5" />
                        <div className="flex justify-between text-base font-bold text-foreground">
                            <span>Total</span>
                            <span>{formatCLP(totalFinal)}</span>
                        </div>
                    </div>

                    <div className="px-4 pb-3 space-y-1.5">
                        {checkoutBlockedReason && (
                            <p className="text-[11px] text-destructive text-center">{checkoutBlockedReason}</p>
                        )}
                        <Button
                            size="lg"
                            className="w-full h-12 text-sm font-bold shadow-lg shadow-primary/25 gap-2 active:scale-[0.98] transition-transform"
                            onClick={() => setCheckoutOpen(true)}
                            disabled={!canCheckout}
                        >
                            <CreditCard className="h-5 w-5" />
                            Cobrar {formatCLP(totalFinal)}
                        </Button>
                    </div>
                </div>
            )}

            <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />
        </div>
    )
}
