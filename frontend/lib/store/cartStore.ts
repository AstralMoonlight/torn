'use client'

import { create, type StoreApi } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Product } from '@/services/products'
import type { Customer } from '@/services/customers'
import type { DocumentReference } from '@/services/sales'
import { resolvePrice, type PriceListRead } from '@/services/price_lists'
import { DEFAULT_TAX_RATE, precioBruto, productTaxRate, totalesDte, type LineaDte } from '@/lib/taxes'
import { avisar } from './uiStore'

/** Descuento tal como lo escribe quien vende: % o pesos del precio que ve (bruto). */
export interface Descuento {
    tipo: 'pct' | 'monto'
    valor: number
}

export interface CartItem {
    product: Product
    quantity: number
    precio_neto: number
    precio_bruto: number
    subtotal: number
    price_source: 'base_price' | 'price_list'
    descuento?: Descuento | null
}

interface CartState {
    items: CartItem[]
    customer: Customer | null
    priceList: PriceListRead | null
    isRecalculating: boolean
    /** Tipo de DTE en curso; define si el carro lleva IVA o no. */
    tipoDte: number
    /** Referencias a documentos previos (OC, Guía, etc.), sólo aplica a Factura. */
    referencias: DocumentReference[]
    /** Solo guía (52): IndTraslado y TipoDespacho del SII. */
    guia: { indTraslado: number; tipoDespacho: number | null }

    setCustomer: (customer: Customer | null, autoSwitchList?: PriceListRead | null) => void
    setTipoDte: (tipoDte: number) => void
    setPriceList: (list: PriceListRead | null) => void
    setReferencias: (referencias: DocumentReference[]) => void
    setGuia: (guia: { indTraslado: number; tipoDespacho: number | null }) => void
    /** Descuento al total de la venta. */
    descuentoGlobal: Descuento | null
    setDescuentoItem: (productId: number, descuento: Descuento | null) => void
    setDescuentoGlobal: (descuento: Descuento | null) => void
    addItem: (product: Product, qty?: number) => Promise<void>
    removeItem: (productId: number) => void
    updateQuantity: (productId: number, qty: number) => void
    clear: () => void

    // Computed (cached)
    totalNeto: number
    totalIva: number
    totalFinal: number
    /** Total sin ningún descuento: la diferencia con `totalFinal` es lo descontado. */
    totalSinDescuento: number
}

/**
 * Tipos de DTE sin IVA: 34 Factura Exenta, 41 Boleta Exenta y los de
 * exportación. Debe mantenerse alineado con `EXEMPT_DTES` en
 * `app/utils/taxes.py`, que es lo que el backend cobra realmente.
 */
export const EXEMPT_DTES = [34, 41, 110, 111, 112]

export function isExemptDte(tipoDte: number): boolean {
    return EXEMPT_DTES.includes(tipoDte)
}

/** Pesos brutos (los que ve quien vende) a netos, como los recibe el backend. */
function aNeto(bruto: number, rate: number): number {
    return Math.round(bruto / (1 + rate) * 100) / 100
}

/** Líneas y descuento al total como los recibe el backend (y `totalesDte`). */
export function descuentosParaVenta(items: CartItem[], tipoDte: number, global: Descuento | null) {
    const lineas: LineaDte[] = items.map((i) => {
        const rate = isExemptDte(tipoDte) ? 0 : productTaxRate(i.product)
        const d = i.descuento
        return {
            precioNeto: i.precio_neto,
            cantidad: i.quantity,
            rate,
            descuento: d?.tipo === 'monto' ? aNeto(d.valor, rate) : 0,
            descuentoPct: d?.tipo === 'pct' ? d.valor : undefined,
        }
    })
    const sobreExento = lineas.every((l) => l.rate === 0)
    const globales = global ? [{
        valor: global.tipo === 'pct' ? global.valor : aNeto(global.valor, sobreExento ? 0 : DEFAULT_TAX_RATE),
        porcentaje: global.tipo === 'pct',
    }] : []
    return { lineas, globales }
}

function recalcTotals(items: CartItem[], tipoDte: number, global: Descuento | null = null) {
    // Las reglas del DTE (lib/taxes.ts): en boletas el precio va bruto al peso
    // y el total es la suma de líneas; en facturas el IVA va sobre el neto.
    const { lineas, globales } = descuentosParaVenta(items, tipoDte, global)
    const { neto, iva, total } = totalesDte(tipoDte, lineas, globales)
    const sinDescuento = totalesDte(tipoDte, lineas.map((l) => ({ ...l, descuento: 0, descuentoPct: undefined }))).total
    return { totalNeto: neto, totalIva: iva, totalFinal: total, totalSinDescuento: sinDescuento }
}

export const useCartStore = create<CartState>()(
    persist(
        (set, get) => ({
            items: [],
            customer: null,
            priceList: null,
            isRecalculating: false,
            tipoDte: 39,
            referencias: [],
            guia: { indTraslado: 1, tipoDespacho: null },
            totalNeto: 0,
            totalIva: 0,
            totalFinal: 0,
            totalSinDescuento: 0,
            descuentoGlobal: null,

            setDescuentoItem: (productId, descuento) =>
                set((state) => {
                    const newItems = state.items.map((i) => (i.product.id === productId ? { ...i, descuento } : i))
                    return { items: newItems, ...recalcTotals(newItems, state.tipoDte, state.descuentoGlobal) }
                }),

            setDescuentoGlobal: (descuento) =>
                set((state) => ({ descuentoGlobal: descuento, ...recalcTotals(state.items, state.tipoDte, descuento) })),

            setCustomer: async (customer, autoSwitchList = null) => {
                set({ customer, priceList: autoSwitchList })
                if (get().items.length > 0) {
                    await recalculatePrices(set, get)
                }
            },

            setTipoDte: (tipoDte) =>
                set((state) => ({ tipoDte, ...recalcTotals(state.items, tipoDte, state.descuentoGlobal) })),

            setReferencias: (referencias) => set({ referencias }),
            setGuia: (guia) => set({ guia }),

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
                        } catch {
                            console.error('Backend resolution failed, using base price')
                        }
                    }

                    const precioNeto = resolved_price
                    const precioBrutoItem = precioBruto(precioNeto, productTaxRate(product))

                    newItems = [
                        ...items,
                        {
                            product,
                            quantity: qty,
                            precio_neto: precioNeto,
                            precio_bruto: precioBrutoItem,
                            subtotal: precioNeto * qty,
                            price_source: source,
                        },
                    ]
                }

                set({ items: newItems, ...recalcTotals(newItems, get().tipoDte, get().descuentoGlobal) })
            },

            removeItem: (productId) =>
                set((state) => {
                    const newItems = state.items.filter((i) => i.product.id !== productId)
                    return { items: newItems, ...recalcTotals(newItems, state.tipoDte, state.descuentoGlobal) }
                }),

            updateQuantity: (productId, qty) =>
                set((state) => {
                    if (qty <= 0) {
                        const newItems = state.items.filter((i) => i.product.id !== productId)
                        return { items: newItems, ...recalcTotals(newItems, state.tipoDte, state.descuentoGlobal) }
                    }
                    const newItems = state.items.map((i) =>
                        i.product.id === productId
                            ? { ...i, quantity: qty, subtotal: qty * i.precio_neto }
                            : i
                    )
                    return { items: newItems, ...recalcTotals(newItems, state.tipoDte, state.descuentoGlobal) }
                }),

            clear: () =>
                set({ items: [], customer: null, priceList: null, referencias: [], guia: { indTraslado: 1, tipoDespacho: null }, descuentoGlobal: null, totalNeto: 0, totalIva: 0, totalFinal: 0, totalSinDescuento: 0 }),
        }),
        {
            name: 'torn-cart',
            partialize: (state) => ({ items: state.items, customer: state.customer, priceList: state.priceList, descuentoGlobal: state.descuentoGlobal }),
        }
    )
)

async function recalculatePrices(
    set: StoreApi<CartState>['setState'],
    get: StoreApi<CartState>['getState'],
) {
    const state = get()
    if (state.items.length === 0) return

    set({ isRecalculating: true })
    try {
        const { getPriceList } = await import('@/services/price_lists')

        const customPrices = new Map<number, number>()

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

            const pBruto = precioBruto(pNeto, productTaxRate(i.product))
            return {
                ...i,
                precio_neto: pNeto,
                precio_bruto: pBruto,
                subtotal: pNeto * i.quantity,
                price_source: source
            }
        })

        set({ items: newItems, ...recalcTotals(newItems, state.tipoDte, state.descuentoGlobal) })
    } catch (err) {
        console.error('Failed to recalculate prices', err)
        avisar('No se pudieron recalcular los precios con la lista elegida.')
    } finally {
        set({ isRecalculating: false })
    }
}
