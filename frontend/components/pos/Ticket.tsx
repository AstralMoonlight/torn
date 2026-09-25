'use client'

import { useEffect, useState } from 'react'
import { useCartStore, isExemptDte } from '@/lib/store/cartStore'
import { Minus, Plus, Trash2, ScanBarcode, X, ArrowRight, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import PriceListSelector from '@/components/pos/PriceListSelector'
import { formatCLP } from '@/lib/format'
import { cn } from '@/lib/utils'

interface Props {
    /** Paso "vender": abre el cobro. Sin él (paso "cobrar") el ticket es solo lectura. */
    onCobrar?: () => void
    /** Hoja móvil: botón para cerrarla. */
    onClose?: () => void
}

/**
 * El ticket de la venta, como una boleta: una línea por producto con cantidad y
 * total. Tocar una línea la despliega para cambiar la cantidad o quitarla.
 * Documento, cliente y pago no viven acá: se eligen en el paso de cobro.
 */
export default function Ticket({ onCobrar, onClose }: Props) {
    const { items, totalNeto, totalIva, totalFinal, tipoDte, removeItem, updateQuantity, clear, setTipoDte } = useCartStore()
    const [abierta, setAbierta] = useState<number | null>(null)
    const editable = !!onCobrar
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
                <div className="flex items-baseline gap-2">
                    <h2 className="text-base font-semibold text-foreground">Ticket</h2>
                    {unidades > 0 && (
                        <span className="text-sm text-muted-foreground font-tabular">
                            {unidades} {unidades === 1 ? 'producto' : 'productos'}
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
                    <ul className="divide-y divide-border">
                        {items.map((item) => {
                            const id = item.product.id
                            const desplegada = editable && abierta === id
                            return (
                                <li key={id} className={cn(desplegada && 'bg-accent/40')}>
                                    <button
                                        type="button"
                                        disabled={!editable}
                                        onClick={() => setAbierta(desplegada ? null : id)}
                                        aria-expanded={desplegada}
                                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left enabled:hover:bg-accent/40 enabled:cursor-pointer focus-visible:outline-none focus-visible:bg-accent/60"
                                    >
                                        <span className="w-9 shrink-0 text-sm font-semibold text-foreground font-tabular">{item.quantity}×</span>
                                        <span className="flex-1 truncate text-sm text-foreground">{item.product.full_name}</span>
                                        <span className="shrink-0 text-sm font-medium text-foreground font-tabular">
                                            {formatCLP(item.precio_bruto * item.quantity)}
                                        </span>
                                    </button>
                                    {desplegada && (
                                        <div className="flex items-center justify-between gap-2 px-4 pb-3">
                                            <span className="text-xs text-muted-foreground font-tabular">
                                                {formatCLP(item.precio_bruto)} c/u
                                                {item.price_source === 'price_list' && ' · precio de lista'}
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                <Button variant="outline" size="icon" className="h-10 w-10"
                                                    onClick={() => updateQuantity(id, item.quantity - 1)}
                                                    aria-label="Quitar una unidad">
                                                    <Minus className="h-4 w-4" />
                                                </Button>
                                                <span className="w-8 text-center text-base font-semibold font-tabular">{item.quantity}</span>
                                                <Button variant="outline" size="icon" className="h-10 w-10"
                                                    onClick={() => updateQuantity(id, item.quantity + 1)}
                                                    aria-label="Agregar una unidad">
                                                    <Plus className="h-4 w-4" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="ml-1 h-10 w-10 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                    onClick={() => { removeItem(id); setAbierta(null) }}
                                                    aria-label={`Quitar ${item.product.full_name}`}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
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
