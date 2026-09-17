'use client'

import { useState } from 'react'
import { useCartStore, isExemptDte } from '@/lib/store/cartStore'
import { Trash2, Minus, Plus, ShoppingBag, CreditCard, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import CheckoutModal from '@/components/pos/CheckoutModal'
import { formatCLP } from '@/lib/format'
import PriceListSelector from '@/components/pos/PriceListSelector'
import { Badge } from '@/components/ui/badge'


interface Props {
    onClose?: () => void // Mobile close handler
}

export default function CartPanel({ onClose }: Props) {
    const { items, totalNeto, totalIva, totalFinal, tipoDte, removeItem, updateQuantity, clear } = useCartStore()
    const [checkoutOpen, setCheckoutOpen] = useState(false)

    return (
        <div className="flex h-full max-h-[85vh] lg:max-h-full flex-col bg-card">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5  shrink-0">
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
                                        className="flex h-7 w-7 items-center justify-center rounded-md text-destructive/70 hover:bg-destructive/10 hover:text-destructive transition md:opacity-0 md:group-hover:opacity-100"
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Totals + Checkout */}
            {items.length > 0 && (
                <div className="border-t border-border shrink-0">
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

                    <div className="px-4 pb-3">
                        <Button
                            size="lg"
                            className="w-full h-12 text-sm font-bold shadow-lg shadow-primary/25 gap-2 active:scale-[0.98] transition-transform"
                            onClick={() => setCheckoutOpen(true)}
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
