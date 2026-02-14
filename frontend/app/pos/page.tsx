'use client'

import { useEffect, useState } from 'react'
import { useSessionStore } from '@/lib/store/sessionStore'
import ProductSearch from '@/components/pos/ProductSearch'
import ProductGrid from '@/components/pos/ProductGrid'
import CartPanel from '@/components/pos/CartPanel'
import { getProducts, type Product } from '@/services/products'
import { Landmark, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default function POSPage() {
    const sessionStatus = useSessionStore((s) => s.status)
    const [products, setProducts] = useState<Product[]>([])
    const [filtered, setFiltered] = useState<Product[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        getProducts()
            .then((data) => {
                // Filter out parent products with no price (variants container)
                const sellable = data.filter(
                    (p) => parseFloat(p.precio_neto) > 0 || p.variants.length === 0
                )
                setProducts(data)
                setFiltered(sellable)
            })
            .catch(console.error)
            .finally(() => setLoading(false))
    }, [])

    const handleSearch = (query: string) => {
        if (!query.trim()) {
            setFiltered(
                products.filter(
                    (p) => parseFloat(p.precio_neto) > 0 || p.variants.length === 0
                )
            )
            return
        }
        const q = query.toLowerCase()
        const results = products.filter(
            (p) =>
                (parseFloat(p.precio_neto) > 0 || p.variants.length === 0) &&
                (p.nombre.toLowerCase().includes(q) ||
                    p.codigo_interno.toLowerCase().includes(q) ||
                    p.codigo_barras?.includes(q) ||
                    p.variants.some((v) =>
                        v.nombre.toLowerCase().includes(q) ||
                        v.codigo_interno.toLowerCase().includes(q)
                    ))
        )
        setFiltered(results)
    }

    // Gate: If cash session is not open, show blocking message
    if (sessionStatus !== 'OPEN') {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="text-center space-y-4 max-w-md mx-auto">
                    <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                        <AlertTriangle className="h-10 w-10 text-amber-600" />
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
                        Caja Cerrada
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400">
                        Debes abrir un turno de caja antes de poder vender.
                    </p>
                    <Link href="/caja">
                        <Button size="lg" className="gap-2 bg-blue-600 hover:bg-blue-700">
                            <Landmark className="h-5 w-5" />
                            Ir a Abrir Caja
                        </Button>
                    </Link>
                </div>
            </div>
        )
    }

    return (
        <div className="flex h-full">
            {/* Left Panel: Search + Products */}
            <div className="flex flex-1 flex-col p-4 gap-4">
                <ProductSearch onSearch={handleSearch} />
                <ProductGrid products={filtered} loading={loading} />
            </div>

            {/* Right Panel: Cart */}
            <div className="w-[420px] border-l border-slate-200 dark:border-slate-800">
                <CartPanel />
            </div>
        </div>
    )
}
