'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Product } from '@/services/products'
import type { Customer } from '@/services/customers'
import { resolvePrice, type PriceListRead } from '@/services/price_lists'
import { toast } from 'sonner'

export interface CartItem {
    product: Product
    quantity: number
    precio_neto: number
    precio_bruto: number
    subtotal: number
    price_source: 'base_price' | 'price_list'
}

interface CartState {
    items: CartItem[]
    customer: Customer | null
    priceList: PriceListRead | null
    isRecalculating: boolean

    setCustomer: (customer: Customer | null, autoSwitchList?: PriceListRead | null) => void
    setPriceList: (list: PriceListRead | null) => void
    addItem: (product: Product, qty?: number) => Promise<void>
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
        (set, get) => ({
            items: [],
            customer: null,
            priceList: null,
            isRecalculating: false,
            totalNeto: 0,
            totalIva: 0,
            totalFinal: 0,

            setCustomer: async (customer, autoSwitchList = null) => {
                set({ customer, priceList: autoSwitchList })
                if (get().items.length > 0) {
                    await recalculatePrices(set, get)
                }
            },

            setPriceList: async (list) => {
                set({ priceList: list })
                if (get().items.length > 0) {
                    await recalculatePrices(set, get)
                }
            },

            addItem: async (product, qty = 1) => {
                const { customer, priceList, items } = get()
                const existing = items.find((i) => i.product.id === product.id)
                let newItems: CartItem[]

                if (existing) {
                    // Update quantity
                    newItems = items.map((i) =>
                        i.product.id === product.id
                            ? {
                                ...i,
                                quantity: i.quantity + qty,
                                subtotal: (i.quantity + qty) * i.precio_neto,
                            }
                            : i
                    )
                } else {
                    // Fetch resolved price 
                    // To do this properly we simulate resolvePrice if no list is active
                    let resolved_price = parseFloat(product.precio_neto)
                    let source: 'base_price' | 'price_list' = 'base_price'

                    if (priceList) {
                        try {
                            // If they selected a list, fetch the specific price (we send customer id if we have one, otherwise just fallback logic or we adapt)
                            // The backend resolve-price uses customer_id to find the list. But if the user forces a list, we might need a different endpoint, 
                            // OR we just use resolvePrice passing the customer if it matches the current list.
                            // Actually, in our API, resolve-price ONLY takes product_id and customer_id.
                            // BUT if the user manually overrides the list? Our current API design only resolves based on the CUSTOMER'S assigned list.
                            // Since we want to let them select a list manually, we can just fetch the whole PriceList with items, and do the lookup client-side!
                        } catch (err) {
                            console.error('Failed to resolve price', err)
                        }
                    }

                    // For now, let's keep the backend logic standard. If there's a customer, we resolve with backend.
                    if (customer) {
                        try {
                            const resolution = await resolvePrice(product.id, customer.id)
                            resolved_price = parseFloat(resolution.resolved_price)
                            source = resolution.source
                        } catch (err) {
                            console.error('Backend resolution failed, using base price')
                        }
                    }

                    const precioNeto = resolved_price
                    const precioBruto = Math.round(precioNeto * 1.19)

                    newItems = [
                        ...items,
                        {
                            product,
                            quantity: qty,
                            precio_neto: precioNeto,
                            precio_bruto: precioBruto,
                            subtotal: precioNeto * qty,
                            price_source: source,
                        },
                    ]
                }

                set({ items: newItems, ...recalcTotals(newItems) })
            },

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
                set({ items: [], customer: null, priceList: null, totalNeto: 0, totalIva: 0, totalFinal: 0 }),
        }),
        {
            name: 'torn-cart',
            partialize: (state) => ({ items: state.items, customer: state.customer, priceList: state.priceList }),
        }
    )
)

async function recalculatePrices(set: any, get: any) {
    const state = get()
    if (state.items.length === 0) return

    set({ isRecalculating: true })
    try {
        const { getPriceList, getPriceLists } = await import('@/services/price_lists')

        let customPrices = new Map<number, number>()

        if (state.priceList) {
            // Load the full list to get the fixed prices
            const detail = await getPriceList(state.priceList.id)
            for (const item of detail.items) {
                customPrices.set(item.product_id, parseFloat(item.fixed_price as string))
            }
        }

        const newItems = state.items.map((i: CartItem) => {
            let pNeto = parseFloat(i.product.precio_neto)
            let source: 'base_price' | 'price_list' = 'base_price'

            if (state.priceList && customPrices.has(i.product.id)) {
                pNeto = customPrices.get(i.product.id)!
                source = 'price_list'
            }

            const pBruto = Math.round(pNeto * 1.19)
            return {
                ...i,
                precio_neto: pNeto,
                precio_bruto: pBruto,
                subtotal: pNeto * i.quantity,
                price_source: source
            }
        })

        set({ items: newItems, ...recalcTotals(newItems) })
    } catch (err) {
        console.error('Failed to recalculate prices', err)
        toast.error('Error al recalcular precios de la lista')
    } finally {
        set({ isRecalculating: false })
    }
}
