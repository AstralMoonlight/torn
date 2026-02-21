'use client'

import { useState } from 'react'
import type { Product } from '@/services/products'
import { useCartStore } from '@/lib/store/cartStore'
import { Package, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { formatCLP } from '@/lib/format'


interface Props {
    products: Product[]
    loading: boolean
}

export default function ProductGrid({ products, loading }: Props) {
    const addItem = useCartStore((s) => s.addItem)
    const [variantsOf, setVariantsOf] = useState<Product | null>(null)

    const handleClick = (product: Product) => {
        // If product has variants, show variant picker
        if (product.variants && product.variants.length > 0) {
            setVariantsOf(product)
            return
        }

        // Stock check
        if (product.controla_stock && parseFloat(product.stock_actual) <= 0) {
            toast.error(`Sin stock: ${product.full_name}`)
            return
        }

        addItem(product)
        toast.success(`${product.full_name} agregado`, { duration: 1500 })
    }

    if (loading) {
        return (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 flex-1 overflow-auto">
                {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-32 rounded-xl" />
                ))}
            </div>
        )
    }

    if (products.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center text-neutral-400">
                <div className="text-center space-y-2">
                    <Package className="h-12 w-12 mx-auto opacity-50" />
                    <p>No se encontraron productos</p>
                </div>
            </div>
        )
    }

    return (
        <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 flex-1 overflow-auto content-start">
                {products.map((product) => {
                    const hasVariants = product.variants && product.variants.length > 0
                    const price = parseFloat(product.precio_bruto)
                    const stock = parseFloat(product.stock_actual)
                    const lowStock = product.controla_stock && stock <= parseFloat(product.stock_minimo)
                    const outOfStock = product.controla_stock && stock <= 0

                    return (
                        <button
                            key={product.id}
                            onClick={() => handleClick(product)}
                            disabled={outOfStock && !hasVariants}
                            className="group relative flex flex-col items-start justify-between rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition-all hover:shadow-md hover:border-blue-300 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-blue-600"
                        >
                            {hasVariants && (
                                <div className="absolute right-2 top-2">
                                    <ChevronRight className="h-4 w-4 text-neutral-400" />
                                </div>
                            )}

                            <div className="w-full">
                                <p className="font-semibold text-sm text-neutral-900 dark:text-white leading-tight line-clamp-2">
                                    {product.full_name}
                                </p>
                                <p className="text-[11px] text-neutral-400 mt-1 font-mono">
                                    {product.codigo_interno}
                                </p>
                            </div>

                            <div className="mt-3 flex w-full items-end justify-between">
                                {hasVariants ? (
                                    <Badge variant="outline" className="text-[10px]">
                                        {product.variants.length} variantes
                                    </Badge>
                                ) : (
                                    <span className="text-lg font-bold text-blue-600 dark:text-blue-400 font-tabular">
                                        {formatCLP(price)}
                                    </span>
                                )}

                                {product.controla_stock && !hasVariants && (
                                    <Badge
                                        variant={outOfStock ? 'destructive' : lowStock ? 'outline' : 'secondary'}
                                        className="text-[10px]"
                                    >
                                        {outOfStock ? 'Agotado' : `${stock}`}
                                    </Badge>
                                )}
                            </div>
                        </button>
                    )
                })}
            </div>

            {/* Variants Dialog */}
            <Dialog open={!!variantsOf} onOpenChange={() => setVariantsOf(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{variantsOf?.full_name}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-2 py-2">
                        {variantsOf?.variants.map((variant) => {
                            const stock = parseFloat(variant.stock_actual)
                            const outOfStock = variant.controla_stock && stock <= 0
                            return (
                                <button
                                    key={variant.id}
                                    disabled={outOfStock}
                                    onClick={() => {
                                        addItem(variant)
                                        toast.success(`${variant.nombre} agregado`, { duration: 1500 })
                                        setVariantsOf(null)
                                    }}
                                    className="flex items-center justify-between rounded-lg border border-neutral-200 p-3 hover:bg-neutral-50 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed dark:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:border-blue-600 transition"
                                >
                                    <div className="text-left">
                                        <p className="font-medium text-sm">{variant.full_name}</p>
                                        <p className="text-xs text-neutral-400 font-mono">{variant.codigo_interno}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-bold text-blue-600 dark:text-blue-400">
                                            {formatCLP(variant.precio_bruto)}
                                        </p>
                                        {variant.controla_stock && (
                                            <p className="text-[10px] text-neutral-400">
                                                {outOfStock ? 'Agotado' : `Stock: ${stock}`}
                                            </p>
                                        )}
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
