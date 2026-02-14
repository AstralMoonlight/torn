'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Product } from '@/services/products'

export interface CartItem {
    product: Product
    quantity: number
    precio_neto: number
    subtotal: number
}

interface CartState {
    items: CartItem[]
    addItem: (product: Product, qty?: number) => void
    removeItem: (productId: number) => void
    updateQuantity: (productId: number, qty: number) => void
    clear: () => void

    // Computed (cached)
    totalNeto: number
    totalIva: number
    totalFinal: number
}

function recalcTotals(items: CartItem[]) {
    const totalNeto = items.reduce((acc, i) => acc + i.subtotal, 0)
    const totalIva = Math.round(totalNeto * 0.19)
    const totalFinal = totalNeto + totalIva
    return { totalNeto, totalIva, totalFinal }
}

export const useCartStore = create<CartState>()(
    persist(
        (set) => ({
            items: [],
            totalNeto: 0,
            totalIva: 0,
            totalFinal: 0,

            addItem: (product, qty = 1) =>
                set((state) => {
                    const existing = state.items.find((i) => i.product.id === product.id)
                    let newItems: CartItem[]

                    if (existing) {
                        newItems = state.items.map((i) =>
                            i.product.id === product.id
                                ? {
                                    ...i,
                                    quantity: i.quantity + qty,
                                    subtotal: (i.quantity + qty) * i.precio_neto,
                                }
                                : i
                        )
                    } else {
                        const precio = parseFloat(product.precio_neto)
                        newItems = [
                            ...state.items,
                            {
                                product,
                                quantity: qty,
                                precio_neto: precio,
                                subtotal: precio * qty,
                            },
                        ]
                    }

                    return { items: newItems, ...recalcTotals(newItems) }
                }),

            removeItem: (productId) =>
                set((state) => {
                    const newItems = state.items.filter((i) => i.product.id !== productId)
                    return { items: newItems, ...recalcTotals(newItems) }
                }),

            updateQuantity: (productId, qty) =>
                set((state) => {
                    if (qty <= 0) {
                        const newItems = state.items.filter((i) => i.product.id !== productId)
                        return { items: newItems, ...recalcTotals(newItems) }
                    }
                    const newItems = state.items.map((i) =>
                        i.product.id === productId
                            ? { ...i, quantity: qty, subtotal: qty * i.precio_neto }
                            : i
                    )
                    return { items: newItems, ...recalcTotals(newItems) }
                }),

            clear: () =>
                set({ items: [], totalNeto: 0, totalIva: 0, totalFinal: 0 }),
        }),
        {
            name: 'torn-cart',
        }
    )
)
