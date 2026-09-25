'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSessionStore } from '@/lib/store/sessionStore'
import { useCartStore } from '@/lib/store/cartStore'
import { avisar, useUIStore } from '@/lib/store/uiStore'
import { useBarcodeScanner } from '@/lib/hooks/useBarcodeScanner'
import ProductSearch, { enfocarBusqueda } from '@/components/pos/ProductSearch'
import ProductGrid from '@/components/pos/ProductGrid'
import Ticket from '@/components/pos/Ticket'
import CobroPanel from '@/components/pos/CobroPanel'
import { getProducts, getProductBySku, type Product } from '@/services/products'
import { getApiErrorMessage } from '@/services/api'
import { Landmark, AlertTriangle, ShoppingBag, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCLP } from '@/lib/format'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import Aviso from '@/components/layout/Aviso'
import { useControlCaja } from '@/lib/store/settingsStore'

export default function POSPage() {
    const sessionStatus = useSessionStore((s) => s.status)
    const controlCaja = useControlCaja()
    const addItem = useCartStore((s) => s.addItem)
    const cartItems = useCartStore((s) => s.items)
    const totalFinal = useCartStore((s) => s.totalFinal)
    const posVariantDisplay = useUIStore((s) => s.posVariantDisplay)
    const [products, setProducts] = useState<Product[]>([])
    const [loading, setLoading] = useState(true)
    const [query, setQuery] = useState('')
    const [brandId, setBrandId] = useState<number | null>(null)
    const [showMobileCart, setShowMobileCart] = useState(false)
    // Dos pasos: armar el ticket y cobrarlo. El cobro reemplaza la zona de productos.
    const [etapa, setEtapa] = useState<'vender' | 'cobrar'>('vender')
    const irACobrar = () => { setShowMobileCart(false); setEtapa('cobrar') }

    useEffect(() => {
        getProducts()
            .then(setProducts)
            .catch((error) => {
                console.error(error)
                avisar(getApiErrorMessage(error, 'Error al cargar productos'))
            })
            .finally(() => setLoading(false))
    }, [])

    // En modo 'grouped' las variantes se eligen desde su producto padre.
    const sellable = useMemo(
        () => products.filter((p) =>
            (posVariantDisplay === 'grouped' ? !p.parent_id : true) &&
            (parseFloat(p.precio_neto) > 0 || p.variants.length === 0)),
        [products, posVariantDisplay],
    )

    const brands = useMemo(() => {
        const porId = new Map<number, string>()
        sellable.forEach((p) => p.brand && porId.set(p.brand.id, p.brand.name))
        return [...porId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
    }, [sellable])

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        return sellable.filter((p) =>
            (brandId === null || p.brand_id === brandId) &&
            (!q ||
                p.nombre.toLowerCase().includes(q) ||
                p.codigo_interno.toLowerCase().includes(q) ||
                !!p.codigo_barras?.includes(q) ||
                p.variants.some((v) => v.nombre.toLowerCase().includes(q) || v.codigo_interno.toLowerCase().includes(q))))
    }, [sellable, query, brandId])

    // Enter en el buscador: si queda un solo producto simple, se agrega y se limpia.
    const agregarUnico = () => {
        const [unico, ...resto] = filtered
        if (!unico || resto.length > 0 || (posVariantDisplay === 'grouped' && unico.variants.length > 0)) return
        if (unico.controla_stock && parseFloat(unico.stock_actual) <= 0) {
            avisar(`Sin stock: ${unico.full_name}`)
            return
        }
        addItem(unico)
        setQuery('')
    }

    // F2: volver al buscador desde cualquier parte del POS.
    useEffect(() => {
        const alTeclear = (e: KeyboardEvent) => {
            if (e.key !== 'F2' || etapa !== 'vender') return
            e.preventDefault()
            enfocarBusqueda()
        }
        window.addEventListener('keydown', alTeclear)
        return () => window.removeEventListener('keydown', alTeclear)
    }, [etapa])

    // Lector de código de barras (teclado "invisible").
    const handleBarcodeScan = useCallback(
        async (barcode: string) => {
            if (etapa !== 'vender') return
            try {
                const allProducts = products.flatMap((p) => (p.variants.length > 0 ? p.variants : [p]))
                const found = allProducts.find((p) => p.codigo_barras === barcode || p.codigo_interno === barcode)

                if (found) {
                    if (found.controla_stock && parseFloat(found.stock_actual) <= 0) {
                        avisar(`Sin stock: ${found.nombre}`)
                        return
                    }
                    addItem(found)
                } else {
                    try {
                        const product = await getProductBySku(barcode)
                        addItem(product)
                    } catch {
                        avisar(`Producto no encontrado: ${barcode}`)
                    }
                }
            } catch {
                avisar('Error al buscar producto')
            }
        },
        [products, addItem, etapa]
    )

    useBarcodeScanner(handleBarcodeScan)

    // Un aviso del POS ("Sin stock", "no encontrado") deja de importar al cambiar el ticket.
    useEffect(() => { useUIStore.getState().cerrarAviso() }, [cartItems.length])

    const unidades = cartItems.reduce((s, i) => s + i.quantity, 0)

    if (controlCaja && sessionStatus !== 'OPEN') {
        return (
            <div data-section="pos.caja-cerrada" className="flex h-full items-center justify-center p-6">
                <div className="text-center space-y-4 max-w-md mx-auto">
                    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
                        <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden />
                    </div>
                    <h2 className="text-2xl font-bold text-foreground">Caja cerrada</h2>
                    <p className="text-muted-foreground">Debes abrir un turno de caja antes de poder vender.</p>
                    <Link href="/caja">
                        <Button size="lg" className="gap-2">
                            <Landmark className="h-5 w-5" aria-hidden /> Ir a abrir caja
                        </Button>
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-full flex-col lg:flex-row bg-muted/40">
            {etapa === 'cobrar' ? (
                <section className="flex flex-1 flex-col min-h-0 bg-card lg:bg-background">
                    <Aviso className="m-3 mb-0 w-auto md:mx-6" />
                    <CobroPanel onVolver={() => setEtapa('vender')} onTerminado={() => { setEtapa('vender'); setQuery('') }} />
                </section>
            ) : (
                <section data-section="pos.productos" className="flex flex-1 flex-col gap-3 p-3 md:p-4 min-h-0">
                <Aviso />
                <ProductSearch
                    value={query}
                    onChange={setQuery}
                    onEnter={agregarUnico}
                    resultados={query.trim() ? filtered.length : null}
                />

                {brands.length > 1 && (
                    <div data-section="pos.marcas" className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filtrar por marca">
                        {[{ id: null, name: 'Todas' }, ...brands].map((b) => (
                            <button
                                key={b.id ?? 'todas'}
                                type="button"
                                onClick={() => setBrandId(b.id)}
                                aria-pressed={brandId === b.id}
                                className={cn(
                                    'h-9 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors cursor-pointer',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    brandId === b.id
                                        ? 'border-primary bg-primary text-primary-foreground'
                                        : 'border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40',
                                )}
                            >
                                {b.name}
                            </button>
                        ))}
                    </div>
                )}

                <ProductGrid products={filtered} loading={loading} variantDisplay={posVariantDisplay} />
            </section>
            )}

            {/* Escritorio: el carrito siempre visible a la derecha */}
            <aside data-section="pos.carrito" className="hidden lg:flex w-[320px] xl:w-[350px] border-l border-border bg-card">
                <Ticket onCobrar={etapa === 'vender' ? irACobrar : undefined} />
            </aside>

            {/* Móvil: barra con el total que abre el carrito */}
            {etapa === 'vender' && cartItems.length > 0 && !showMobileCart && (
                <button
                    type="button"
                    data-section="pos.barra-movil"
                    onClick={() => setShowMobileCart(true)}
                    className="lg:hidden fixed inset-x-3 bottom-[4.5rem] z-30 flex h-14 items-center justify-between rounded-xl bg-primary px-4 text-primary-foreground shadow-lg shadow-primary/30 active:scale-[0.99] transition-transform cursor-pointer"
                >
                    <span className="flex items-center gap-2 text-sm font-medium">
                        <ShoppingBag className="h-5 w-5" aria-hidden />
                        {unidades} {unidades === 1 ? 'producto' : 'productos'}
                    </span>
                    <span className="flex items-center gap-2 text-lg font-bold font-tabular">
                        {formatCLP(totalFinal)}
                        <ChevronUp className="h-5 w-5" aria-hidden />
                    </span>
                </button>
            )}

            {showMobileCart && (
                <div data-section="pos.carrito-movil" className="lg:hidden fixed inset-0 z-50">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileCart(false)} />
                    <div className="absolute bottom-0 left-0 right-0 max-h-[90vh] flex flex-col rounded-t-2xl bg-card shadow-xl animate-in slide-in-from-bottom">
                        <div className="flex justify-center py-2">
                            <div className="h-1 w-10 rounded-full bg-border" />
                        </div>
                        <Ticket onCobrar={irACobrar} onClose={() => setShowMobileCart(false)} />
                    </div>
                </div>
            )}
        </div>
    )
}
