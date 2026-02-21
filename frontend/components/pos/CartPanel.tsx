'use client'

import { useState } from 'react'
import { useCartStore } from '@/lib/store/cartStore'
import { Trash2, Minus, Plus, ShoppingBag, CreditCard, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import CheckoutModal from '@/components/pos/CheckoutModal'
import { formatCLP } from '@/lib/format'


interface Props {
    onClose?: () => void // Mobile close handler
}

export default function CartPanel({ onClose }: Props) {
    const { items, totalNeto, totalIva, totalFinal, removeItem, updateQuantity, clear } = useCartStore()
    const [checkoutOpen, setCheckoutOpen] = useState(false)

    return (
        <div className="flex h-full max-h-[85vh] lg:max-h-full flex-col bg-white dark:bg-neutral-950">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-800 shrink-0">
                <div className="flex items-center gap-2">
                    <ShoppingBag className="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
                    <h2 className="font-semibold text-sm text-neutral-900 dark:text-white">Ticket</h2>
                    {items.length > 0 && (
                        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-neutral-800 px-1.5 text-[10px] font-bold text-white dark:bg-neutral-700">
                            {items.length}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {items.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={clear} className="text-[11px] text-red-500 hover:text-red-700 hover:bg-red-50 h-7 px-2">
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
                    <div className="flex h-full flex-col items-center justify-center text-neutral-400">
                        <ShoppingBag className="h-12 w-12 opacity-20" />
                        <p className="mt-2 text-xs">Carrito vacío</p>
                    </div>
                ) : (
                    <div className="space-y-1.5">
                        {items.map((item) => (
                            <div
                                key={item.product.id}
                                className="group rounded-lg border border-neutral-100 bg-neutral-50/50 p-2.5 dark:border-neutral-800 dark:bg-neutral-900"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-neutral-900 dark:text-white truncate">
                                            {item.product.full_name}
                                        </p>
                                        <p className="text-[10px] text-neutral-400 font-mono">{item.product.codigo_interno}</p>
                                        <p className="text-[10px] text-neutral-500 mt-0.5 font-tabular">
                                            <span className="text-neutral-400">Neto:</span> {formatCLP(item.precio_neto)} +
                                            <span className="text-neutral-400 ml-1">IVA:</span> {formatCLP(item.precio_bruto - item.precio_neto)} × {item.quantity}
                                        </p>
                                    </div>
                                    <p className="font-bold text-xs text-neutral-900 dark:text-white font-tabular whitespace-nowrap">
                                        {formatCLP(item.precio_bruto * item.quantity)}
                                    </p>
                                </div>

                                <div className="mt-1.5 flex items-center justify-between">
                                    <div className="flex items-center gap-0.5">
                                        <button
                                            onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                                            className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800 transition active:scale-90"
                                        >
                                            <Minus className="h-3 w-3" />
                                        </button>
                                        <span className="flex h-7 min-w-[28px] items-center justify-center text-xs font-semibold font-tabular">
                                            {item.quantity}
                                        </span>
                                        <button
                                            onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                                            className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800 transition active:scale-90"
                                        >
                                            <Plus className="h-3 w-3" />
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => removeItem(item.product.id)}
                                        className="flex h-7 w-7 items-center justify-center rounded-md text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 transition md:opacity-0 md:group-hover:opacity-100"
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
                <div className="border-t border-neutral-200 dark:border-neutral-800 shrink-0">
                    <div className="space-y-0.5 px-4 py-2.5 font-tabular">
                        <div className="flex justify-between text-xs text-neutral-500">
                            <span>Neto</span>
                            <span>{formatCLP(totalNeto)}</span>
                        </div>
                        <div className="flex justify-between text-xs text-neutral-500">
                            <span>IVA (19%)</span>
                            <span>{formatCLP(totalIva)}</span>
                        </div>
                        <Separator className="my-1.5" />
                        <div className="flex justify-between text-base font-bold text-neutral-900 dark:text-white">
                            <span>Total</span>
                            <span>{formatCLP(totalFinal)}</span>
                        </div>
                    </div>

                    <div className="px-4 pb-3">
                        <Button
                            size="lg"
                            className="w-full h-12 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/25 gap-2 active:scale-[0.98] transition-transform"
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
