'use client'

import { useEffect, useState } from 'react'
import { useCartStore, isExemptDte, type CartItem } from '@/lib/store/cartStore'
import { useEsAdmin } from '@/lib/store/sessionStore'
import { useSettingsStore } from '@/lib/store/settingsStore'
import { pesos } from '@/lib/taxes'
import { Minus, Plus, Trash2, ScanBarcode, X, ArrowRight, Lock, Percent } from 'lucide-react'
import EditorDescuento from '@/components/pos/EditorDescuento'
import { Button } from '@/components/ui/button'
import PriceListSelector from '@/components/pos/PriceListSelector'
import { formatCLP } from '@/lib/format'

interface Props {
    /** Paso "vender": abre el cobro. Sin él (paso "cobrar") el ticket es solo lectura. */
    onCobrar?: () => void
    /** Hoja móvil: botón para cerrarla. */
    onClose?: () => void
}

/** Pesos que descuenta la línea sobre el precio que se ve (aproximado en facturas: manda el total). */
function descuentoLinea(item: CartItem): number {
    const bruto = item.precio_bruto * item.quantity
    const d = item.descuento
    if (!d) return 0
    return d.tipo === 'pct' ? pesos(bruto * d.valor / 100) : Math.min(d.valor, bruto)
}

/**
 * El ticket de la venta: una tarjeta baja por producto con precio unitario,
 * total, y controles de cantidad mientras se vende.
 * Documento, cliente y pago no viven acá: se eligen en el paso de cobro.
 */
export default function Ticket({ onCobrar, onClose }: Props) {
    const {
        items, totalNeto, totalIva, totalFinal, totalSinDescuento, tipoDte, removeItem, updateQuantity, clear, setTipoDte,
        setDescuentoItem, descuentoGlobal, setDescuentoGlobal,
    } = useCartStore()
    const editable = !!onCobrar
    // Descuentos (#40): el administrador sin tope; el personal hasta `descuento_maximo` (0: nadie).
    const esAdmin = useEsAdmin()
    const maximo = useSettingsStore((s) => s.settings?.descuento_maximo ?? 10)
    const puedeDescontar = editable && (esAdmin || maximo > 0)
    const [editando, setEditando] = useState<number | 'total' | null>(null)
    const alternar = (que: number | 'total') => setEditando((e) => (e === que ? null : que))
    const unidades = items.reduce((s, i) => s + i.quantity, 0)

    // Tras recargar, zustand restaura `items` sin recalcular los totales (no se
    // persisten): se recalculan con la acción que ya lo hace.
    useEffect(() => {
        if (items.length > 0 && totalFinal === 0) setTipoDte(tipoDte)
    }, [items.length, totalFinal, tipoDte, setTipoDte])

    // F12 pasa al cobro. Solo la instancia de escritorio (la hoja móvil trae onClose).
    useEffect(() => {
        if (!onCobrar || onClose) return
        const alTeclear = (e: KeyboardEvent) => {
            if (e.key !== 'F12' || items.length === 0) return
            e.preventDefault()
            onCobrar()
        }
        window.addEventListener('keydown', alTeclear)
        return () => window.removeEventListener('keydown', alTeclear)
    }, [onCobrar, onClose, items.length])

    return (
        <div data-section="pos.ticket" className="flex h-full min-h-0 w-full flex-1 flex-col bg-card">
            <div data-section="pos.ticket.encabezado" className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 shrink-0">
                <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-foreground">Ticket</h2>
                    {unidades > 0 && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground font-tabular"
                            aria-label={`${unidades} ${unidades === 1 ? 'producto' : 'productos'}`}>
                            {unidades}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {editable && <PriceListSelector />}
                    {editable && items.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={clear} className="h-9 px-2.5 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive">
                            Vaciar
                        </Button>
                    )}
                    {onClose && (
                        <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9" aria-label="Cerrar ticket">
                            <X className="h-5 w-5" />
                        </Button>
                    )}
                </div>
            </div>

            <div data-section="pos.ticket.lineas" className="flex-1 overflow-auto min-h-0">
                {items.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
                        <ScanBarcode className="h-10 w-10 text-muted-foreground/60" aria-hidden />
                        <p className="text-sm text-muted-foreground">
                            Escanea un código o toca un producto para agregarlo.
                        </p>
                    </div>
                ) : (
                    <ul className="space-y-1.5 p-2">
                        {items.map((item) => {
                            const id = item.product.id
                            return (
                                <li key={id} className="rounded-lg border border-border bg-background px-2.5 py-1">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="truncate text-sm font-medium text-foreground">{item.product.full_name}</p>
                                        <p className="shrink-0 text-sm font-semibold text-foreground font-tabular">
                                            {formatCLP(item.precio_bruto * item.quantity - descuentoLinea(item))}
                                        </p>
                                    </div>
                                    <div className="mt-0.5 flex items-center justify-between gap-2">
                                        <span className="truncate text-xs text-muted-foreground font-tabular">
                                            {editable ? `${formatCLP(item.precio_bruto)} c/u` : `${item.quantity} × ${formatCLP(item.precio_bruto)}`}
                                            {item.price_source === 'price_list' && ' · lista'}
                                            {item.descuento && (
                                                <span className="font-medium text-primary">
                                                    {' · Dcto '}{item.descuento.tipo === 'pct' ? `${item.descuento.valor}%` : formatCLP(item.descuento.valor)}
                                                </span>
                                            )}
                                        </span>
                                        {editable && (
                                            <div className="flex shrink-0 items-center gap-1">
                                                <Button variant="outline" size="icon" className="h-8 w-8"
                                                    onClick={() => updateQuantity(id, item.quantity - 1)}
                                                    aria-label={`Quitar una unidad de ${item.product.full_name}`}>
                                                    <Minus className="h-3.5 w-3.5" />
                                                </Button>
                                                <span className="w-7 text-center text-sm font-semibold font-tabular" aria-label="Cantidad">{item.quantity}</span>
                                                <Button variant="outline" size="icon" className="h-8 w-8"
                                                    onClick={() => updateQuantity(id, item.quantity + 1)}
                                                    aria-label={`Agregar una unidad de ${item.product.full_name}`}>
                                                    <Plus className="h-3.5 w-3.5" />
                                                </Button>
                                                {puedeDescontar && (
                                                    <Button variant={editando === id || item.descuento ? 'secondary' : 'ghost'} size="icon" className="h-8 w-8"
                                                        onClick={() => alternar(id)}
                                                        aria-expanded={editando === id}
                                                        aria-label={`Descuento a ${item.product.full_name}`}>
                                                        <Percent className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                    onClick={() => removeItem(id)}
                                                    aria-label={`Quitar ${item.product.full_name}`}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                    {editable && editando === id && (
                                        <div className="mt-1.5 pb-1">
                                            <EditorDescuento
                                                etiqueta={`Descuento a ${item.product.full_name}`}
                                                valor={item.descuento}
                                                onChange={(d) => setDescuentoItem(id, d)}
                                                maximo={esAdmin ? undefined : maximo}
                                            />
                                        </div>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                )}
            </div>

            {items.length > 0 && (
                <div data-section="pos.ticket.total" className="border-t border-border px-4 pb-4 pt-3 shrink-0">
                    {puedeDescontar && (
                        <div className="mb-2 space-y-2">
                            <Button variant={editando === 'total' || descuentoGlobal ? 'secondary' : 'outline'} size="sm"
                                className="h-9 gap-1.5" onClick={() => alternar('total')} aria-expanded={editando === 'total'}>
                                <Percent className="h-3.5 w-3.5" aria-hidden />
                                Descuento al total
                                {descuentoGlobal && (
                                    <span className="font-tabular">
                                        ({descuentoGlobal.tipo === 'pct' ? `${descuentoGlobal.valor}%` : formatCLP(descuentoGlobal.valor)})
                                    </span>
                                )}
                            </Button>
                            {editando === 'total' && (
                                <EditorDescuento etiqueta="Descuento al total" valor={descuentoGlobal}
                                    onChange={setDescuentoGlobal} maximo={esAdmin ? undefined : maximo} />
                            )}
                        </div>
                    )}
                    {totalSinDescuento > totalFinal && (
                        <p className="text-sm font-medium text-primary font-tabular">
                            Descuentos: -{formatCLP(totalSinDescuento - totalFinal)}
                        </p>
                    )}
                    <p className="text-xs text-muted-foreground font-tabular">
                        Neto {formatCLP(totalNeto)} · {isExemptDte(tipoDte) ? 'Exento de IVA' : `IVA ${formatCLP(totalIva)}`}
                    </p>
                    <div className="mt-1 flex items-baseline justify-between">
                        <span className="text-base font-medium text-muted-foreground">Total</span>
                        <span className="text-3xl font-bold tracking-tight text-foreground font-tabular">{formatCLP(totalFinal)}</span>
                    </div>
                    {editable ? (
                        <Button
                            size="lg"
                            onClick={onCobrar}
                            className="mt-3 h-14 w-full justify-between px-5 text-lg font-semibold shadow-lg shadow-primary/25"
                        >
                            Cobrar
                            <span className="flex items-center gap-2">
                                {!onClose && <kbd className="rounded border border-primary-foreground/30 px-1.5 text-xs font-medium opacity-80">F12</kbd>}
                                <ArrowRight className="h-5 w-5" aria-hidden />
                            </span>
                        </Button>
                    ) : (
                        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                            <Lock className="h-3.5 w-3.5" aria-hidden /> Para cambiar productos, vuelve a la venta.
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}
