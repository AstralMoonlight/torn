'use client'

import { useState } from 'react'
import { useCartStore } from '@/lib/store/cartStore'
import { Trash2, Minus, Plus, ShoppingBag, CreditCard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import CheckoutModal from '@/components/pos/CheckoutModal'

function formatCLP(value: number): string {
    return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        minimumFractionDigits: 0,
    }).format(value)
}

export default function CartPanel() {
    const { items, totalNeto, totalIva, totalFinal, removeItem, updateQuantity, clear } =
        useCartStore()
    const [checkoutOpen, setCheckoutOpen] = useState(false)

    return (
        <div className="flex h-full flex-col bg-white dark:bg-slate-950">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                    <ShoppingBag className="h-5 w-5 text-blue-600" />
                    <h2 className="font-semibold text-slate-900 dark:text-white">Ticket</h2>
                    {items.length > 0 && (
                        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                            {items.length}
                        </span>
                    )}
                </div>
                {items.length > 0 && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={clear}
                        className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                        Limpiar
                    </Button>
                )}
            </div>

            {/* Items */}
            <div className="flex-1 overflow-auto px-4 py-2">
                {items.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center text-slate-400">
                        <ShoppingBag className="h-16 w-16 opacity-20" />
                        <p className="mt-2 text-sm">Carrito vacío</p>
                        <p className="text-xs">Selecciona productos para comenzar</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {items.map((item) => (
                            <div
                                key={item.product.id}
                                className="group rounded-lg border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                            {item.product.nombre}
                                        </p>
                                        <p className="text-xs text-slate-400 font-mono">
                                            {item.product.codigo_interno}
                                        </p>
                                        <p className="text-xs text-slate-500 mt-0.5 font-tabular">
                                            {formatCLP(item.precio_neto)} × {item.quantity}
                                        </p>
                                    </div>
                                    <p className="font-bold text-sm text-slate-900 dark:text-white font-tabular whitespace-nowrap ml-2">
                                        {formatCLP(item.subtotal)}
                                    </p>
                                </div>

                                {/* Qty controls */}
                                <div className="mt-2 flex items-center justify-between">
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                                            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 transition"
                                        >
                                            <Minus className="h-3 w-3" />
                                        </button>
                                        <span className="flex h-7 min-w-[32px] items-center justify-center text-sm font-semibold font-tabular">
                                            {item.quantity}
                                        </span>
                                        <button
                                            onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                                            className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 transition"
                                        >
                                            <Plus className="h-3 w-3" />
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => removeItem(item.product.id)}
                                        className="flex h-7 w-7 items-center justify-center rounded-md text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 transition opacity-0 group-hover:opacity-100"
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Totals + Checkout */}
            {items.length > 0 && (
                <div className="border-t border-slate-200 dark:border-slate-800">
                    <div className="space-y-1 px-4 py-3 font-tabular">
                        <div className="flex justify-between text-sm text-slate-500">
                            <span>Neto</span>
                            <span>{formatCLP(totalNeto)}</span>
                        </div>
                        <div className="flex justify-between text-sm text-slate-500">
                            <span>IVA (19%)</span>
                            <span>{formatCLP(totalIva)}</span>
                        </div>
                        <Separator className="my-2" />
                        <div className="flex justify-between text-lg font-bold text-slate-900 dark:text-white">
                            <span>Total</span>
                            <span>{formatCLP(totalFinal)}</span>
                        </div>
                    </div>

                    <div className="px-4 pb-4">
                        <Button
                            size="lg"
                            className="w-full h-14 text-lg font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-600/25 gap-2"
                            onClick={() => setCheckoutOpen(true)}
                        >
                            <CreditCard className="h-6 w-6" />
                            Cobrar {formatCLP(totalFinal)}
                        </Button>
                    </div>
                </div>
            )}

            <CheckoutModal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />
        </div>
    )
}
