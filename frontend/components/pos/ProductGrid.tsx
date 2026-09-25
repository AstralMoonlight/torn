'use client'

import { useMemo, useState } from 'react'
import type { Product } from '@/services/products'
import { useCartStore } from '@/lib/store/cartStore'
import { type PosVariantDisplay } from '@/lib/store/uiStore'
import { Package, ChevronRight } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { formatCLP } from '@/lib/format'
import { cn } from '@/lib/utils'


interface Props {
    products: Product[]
    loading: boolean
    variantDisplay: PosVariantDisplay
}

const SEARCH_THRESHOLD = 8

export default function ProductGrid({ products, loading, variantDisplay }: Props) {
    const addItem = useCartStore((s) => s.addItem)
    const items = useCartStore((s) => s.items)
    // Cantidad de cada producto ya en el carrito, para mostrarla en su tarjeta.
    const enCarrito = useMemo(() => new Map(items.map((i) => [i.product.id, i.quantity])), [items])
    const [variantsOf, setVariantsOf] = useState<Product | null>(null)
    const [variantSearch, setVariantSearch] = useState('')

    const handleClick = (product: Product) => {
        // In 'grouped' mode, products with variants open the modal
        if (variantDisplay === 'grouped' && product.variants && product.variants.length > 0) {
            setVariantsOf(product)
            setVariantSearch('')
            return
        }
        if (product.controla_stock && parseFloat(product.stock_actual) <= 0) {
            toast.error(`Sin stock: ${product.full_name}`)
            return
        }
        addItem(product)
    }

    if (loading) {
        return (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5 flex-1 overflow-auto content-start" aria-busy>
                {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-[112px] rounded-xl" />
                ))}
            </div>
        )
    }

    if (products.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
                <div className="text-center space-y-2">
                    <Package className="h-12 w-12 mx-auto opacity-50" />
                    <p>No se encontraron productos</p>
                </div>
            </div>
        )
    }

    const manyVariants = (variantsOf?.variants.length ?? 0) > SEARCH_THRESHOLD
    const filteredVariants = manyVariants
        ? (variantsOf?.variants ?? []).filter((v) => {
            const q = variantSearch.toLowerCase()
            return (
                !q ||
                v.nombre.toLowerCase().includes(q) ||
                v.codigo_interno.toLowerCase().includes(q)
            )
        })
        : (variantsOf?.variants ?? [])

    return (
        <>
            <div data-section="pos.grilla" className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5 flex-1 overflow-auto content-start pb-24 lg:pb-1">
                {products.map((product) => {
                    const hasVariants = variantDisplay === 'grouped' && product.variants && product.variants.length > 0
                    const price = parseFloat(product.precio_bruto)
                    const stock = parseFloat(product.stock_actual)
                    const lowStock = product.controla_stock && stock <= parseFloat(product.stock_minimo)
                    const outOfStock = product.controla_stock && stock <= 0
                    const enCarro = hasVariants
                        ? product.variants.reduce((s, v) => s + (enCarrito.get(v.id) ?? 0), 0)
                        : enCarrito.get(product.id) ?? 0

                    return (
                        <button
                            key={product.id}
                            type="button"
                            onClick={() => handleClick(product)}
                            disabled={outOfStock && !hasVariants}
                            aria-label={`${product.full_name}, ${hasVariants ? `${product.variants.length} variantes` : formatCLP(price)}${enCarro ? `, ${enCarro} en el carrito` : ''}`}
                            className={cn(
                                'group relative flex min-h-[112px] flex-col justify-between rounded-xl border bg-card p-3 text-left shadow-sm cursor-pointer',
                                'transition-colors duration-150 hover:border-primary/50 hover:bg-accent/40 active:scale-[0.98]',
                                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
                                enCarro > 0 ? 'border-primary/60' : 'border-border',
                            )}
                        >
                            {enCarro > 0 && (
                                <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground font-tabular" aria-hidden>
                                    {enCarro}
                                </span>
                            )}

                            <div className="w-full pr-7">
                                <p className="text-sm font-medium leading-snug text-foreground line-clamp-2">
                                    {product.full_name}
                                </p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {product.brand?.name ? `${product.brand.name} · ` : ''}{product.codigo_interno}
                                </p>
                            </div>

                            <div className="mt-2 flex w-full items-end justify-between gap-2">
                                {hasVariants ? (
                                    <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                                        {product.variants.length} variantes <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                                    </span>
                                ) : (
                                    <span className="text-base font-semibold text-foreground font-tabular">
                                        {formatCLP(price)}
                                    </span>
                                )}

                                {product.controla_stock && !hasVariants && (
                                    <span className={cn(
                                        'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium font-tabular',
                                        outOfStock ? 'bg-destructive/10 text-destructive'
                                            : lowStock ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                                                : 'bg-muted text-muted-foreground',
                                    )}>
                                        {outOfStock ? 'Agotado' : `Stock ${stock}`}
                                    </span>
                                )}
                            </div>
                        </button>
                    )
                })}
            </div>

            {/* Variants Dialog — only used in 'grouped' mode */}
            <Dialog
                open={!!variantsOf}
                onOpenChange={() => { setVariantsOf(null); setVariantSearch('') }}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{variantsOf?.full_name}</DialogTitle>
                    </DialogHeader>

                    {/* Search — only appears when variants > SEARCH_THRESHOLD */}
                    {manyVariants && (
                        <input
                            autoFocus
                            type="text"
                            value={variantSearch}
                            onChange={(e) => setVariantSearch(e.target.value)}
                            placeholder={`Buscar entre ${variantsOf?.variants.length} variantes…`}
                            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                        />
                    )}

                    <div className="grid gap-2 py-2 max-h-[60vh] overflow-y-auto pr-1">
                        {filteredVariants.length === 0 ? (
                            <p className="text-center text-sm text-muted-foreground py-4">
                                Sin resultados para &ldquo;{variantSearch}&rdquo;
                            </p>
                        ) : (
                            filteredVariants.map((variant) => {
                                const stock = parseFloat(variant.stock_actual)
                                const outOfStock = variant.controla_stock && stock <= 0
                                return (
                                    <button
                                        key={variant.id}
                                        disabled={outOfStock}
                                        onClick={() => {
                                            addItem(variant)
                                            setVariantsOf(null)
                                            setVariantSearch('')
                                        }}
                                        className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-accent hover:border-primary/40 disabled:opacity-50 disabled:cursor-not-allowed transition"
                                    >
                                        <div className="text-left">
                                            <p className="font-medium text-sm">{variant.full_name}</p>
                                            <p className="text-xs text-muted-foreground font-mono">{variant.codigo_interno}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-bold text-foreground">
                                                {formatCLP(variant.precio_bruto)}
                                            </p>
                                            {variant.controla_stock && (
                                                <p className="text-[10px] text-muted-foreground">
                                                    {outOfStock ? 'Agotado' : `Stock: ${stock}`}
                                                </p>
                                            )}
                                        </div>
                                    </button>
                                )
                            })
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
