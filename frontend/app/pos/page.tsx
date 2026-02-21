'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSessionStore } from '@/lib/store/sessionStore'
import { useCartStore } from '@/lib/store/cartStore'
import { useUIStore } from '@/lib/store/uiStore'
import { useBarcodeScanner } from '@/lib/hooks/useBarcodeScanner'
import ProductSearch from '@/components/pos/ProductSearch'
import ProductGrid from '@/components/pos/ProductGrid'
import CartPanel from '@/components/pos/CartPanel'
import { getProducts, getProductBySku, type Product } from '@/services/products'
import { getApiErrorMessage } from '@/services/api'
import { Landmark, AlertTriangle, ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'
import { toast } from 'sonner'

export default function POSPage() {
    const sessionStatus = useSessionStore((s) => s.status)
    const addItem = useCartStore((s) => s.addItem)
    const cartCount = useCartStore((s) => s.items.length)
    const posVariantDisplay = useUIStore((s) => s.posVariantDisplay)
    const [products, setProducts] = useState<Product[]>([])
    const [filtered, setFiltered] = useState<Product[]>([])
    const [loading, setLoading] = useState(true)
    const [showMobileCart, setShowMobileCart] = useState(false)

    useEffect(() => {
        getProducts()
            .then((data) => {
                // Exclude child variants only in 'grouped' mode
                const sellable = data.filter(
                    (p) => (posVariantDisplay === 'grouped' ? !p.parent_id : true) &&
                        (parseFloat(p.precio_neto) > 0 || p.variants.length === 0)
                )
                setProducts(data)
                setFiltered(sellable)
            })
            .catch((error) => {
                console.error(error)
                toast.error(getApiErrorMessage(error, 'Error al cargar productos'))
            })
            .finally(() => setLoading(false))
    }, [posVariantDisplay])

    const handleSearch = (query: string) => {
        const baseFilter = (p: Product) =>
            (posVariantDisplay === 'grouped' ? !p.parent_id : true) &&
            (parseFloat(p.precio_neto) > 0 || p.variants.length === 0)

        if (!query.trim()) {
            setFiltered(products.filter(baseFilter))
            return
        }
        const q = query.toLowerCase()
        const results = products.filter(
            (p) =>
                baseFilter(p) &&
                (p.nombre.toLowerCase().includes(q) ||
                    p.codigo_interno.toLowerCase().includes(q) ||
                    p.codigo_barras?.includes(q) ||
                    p.variants.some((v) => v.nombre.toLowerCase().includes(q) || v.codigo_interno.toLowerCase().includes(q)))
        )
        setFiltered(results)
    }

    // Invisible barcode scanner
    const handleBarcodeScan = useCallback(
        async (barcode: string) => {
            try {
                // Try by barcode first, then by SKU
                const allProducts = products.flatMap((p) =>
                    p.variants.length > 0 ? p.variants : [p]
                )
                const found = allProducts.find(
                    (p) => p.codigo_barras === barcode || p.codigo_interno === barcode
                )

                if (found) {
                    if (found.controla_stock && parseFloat(found.stock_actual) <= 0) {
                        toast.error(`Sin stock: ${found.nombre}`)
                        return
                    }
                    addItem(found)
                    toast.success(`🔫 ${found.nombre}`, { duration: 1500 })
                } else {
                    // Try API lookup
                    try {
                        const product = await getProductBySku(barcode)
                        addItem(product)
                        toast.success(`🔫 ${product.nombre}`, { duration: 1500 })
                    } catch {
                        toast.error(`Producto no encontrado: ${barcode}`)
                    }
                }
            } catch {
                toast.error('Error al buscar producto')
            }
        },
        [products, addItem]
    )

    useBarcodeScanner(handleBarcodeScan)

    // Gate: If cash session is not open
    if (sessionStatus !== 'OPEN') {
        return (
            <div className="flex h-full items-center justify-center p-6">
                <div className="text-center space-y-4 max-w-md mx-auto">
                    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                        <AlertTriangle className="h-10 w-10 text-amber-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-neutral-900 dark:text-white">Caja Cerrada</h2>
                    <p className="text-neutral-500 dark:text-neutral-400">Debes abrir un turno de caja antes de poder vender.</p>
                    <Link href="/caja">
                        <Button size="lg" className="gap-2 bg-blue-600 hover:bg-blue-700">
                            <Landmark className="h-5 w-5" /> Ir a Abrir Caja
                        </Button>
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-full flex-col lg:flex-row">
            {/* Left Panel: Search + Products */}
            <div className="flex flex-1 flex-col p-3 md:p-4 gap-3 min-h-0">
                <ProductSearch onSearch={handleSearch} />
                <ProductGrid products={filtered} loading={loading} variantDisplay={posVariantDisplay} />
            </div>

            {/* Mobile: Cart Toggle FAB */}
            <button
                onClick={() => setShowMobileCart(true)}
                className="lg:hidden fixed bottom-20 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/30 active:scale-95 transition-transform"
            >
                <ShoppingBag className="h-6 w-6" />
                {cartCount > 0 && (
                    <Badge className="absolute -top-1 -right-1 h-5 min-w-[20px] rounded-full bg-red-500 text-[10px] px-1">
                        {cartCount}
                    </Badge>
                )}
            </button>

            {/* Desktop: Cart Panel */}
            <div className="hidden lg:block w-[380px] xl:w-[420px] border-l border-neutral-200 dark:border-neutral-800">
                <CartPanel />
            </div>

            {/* Mobile: Cart Sheet */}
            {showMobileCart && (
                <div className="lg:hidden fixed inset-0 z-50">
                    <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileCart(false)} />
                    <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] rounded-t-2xl bg-white dark:bg-neutral-950 shadow-xl animate-in slide-in-from-bottom">
                        <div className="flex justify-center py-2">
                            <div className="h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" />
                        </div>
                        <CartPanel onClose={() => setShowMobileCart(false)} />
                    </div>
                </div>
            )}
        </div>
    )
}
