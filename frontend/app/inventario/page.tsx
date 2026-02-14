'use client'

import { useEffect, useState } from 'react'
import { getProducts, type Product } from '@/services/products'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Package, Search, AlertTriangle, Box } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

function formatCLP(value: string | number): string {
    return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        minimumFractionDigits: 0,
    }).format(typeof value === 'string' ? parseFloat(value) : value)
}

export default function InventarioPage() {
    const [products, setProducts] = useState<Product[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')

    useEffect(() => {
        getProducts()
            .then(setProducts)
            .catch(console.error)
            .finally(() => setLoading(false))
    }, [])

    // Flatten all products (parents + variants)
    const allProducts = products.reduce<Product[]>((acc, p) => {
        if (p.variants && p.variants.length > 0) {
            return [...acc, ...p.variants]
        }
        if (parseFloat(p.precio_neto) > 0) {
            return [...acc, p]
        }
        return acc
    }, [])

    const filtered = search.trim()
        ? allProducts.filter(
            (p) =>
                p.nombre.toLowerCase().includes(search.toLowerCase()) ||
                p.codigo_interno.toLowerCase().includes(search.toLowerCase())
        )
        : allProducts

    const lowStockItems = allProducts.filter(
        (p) =>
            p.controla_stock &&
            parseFloat(p.stock_actual) <= parseFloat(p.stock_minimo) &&
            parseFloat(p.stock_actual) > 0
    )

    const outOfStockItems = allProducts.filter(
        (p) => p.controla_stock && parseFloat(p.stock_actual) <= 0
    )

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-900/30">
                    <Package className="h-6 w-6 text-purple-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Inventario</h1>
                    <p className="text-sm text-slate-500">Control de stock en tiempo real</p>
                </div>
            </div>

            {/* Alerts */}
            {(outOfStockItems.length > 0 || lowStockItems.length > 0) && (
                <div className="flex gap-4">
                    {outOfStockItems.length > 0 && (
                        <Card className="flex-1 border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
                            <CardContent className="flex items-center gap-3 py-4">
                                <AlertTriangle className="h-5 w-5 text-red-500" />
                                <div>
                                    <p className="text-sm font-medium text-red-700 dark:text-red-400">Sin Stock</p>
                                    <p className="text-xs text-red-500">{outOfStockItems.length} producto(s)</p>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                    {lowStockItems.length > 0 && (
                        <Card className="flex-1 border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
                            <CardContent className="flex items-center gap-3 py-4">
                                <Box className="h-5 w-5 text-amber-500" />
                                <div>
                                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Stock Bajo</p>
                                    <p className="text-xs text-amber-500">{lowStockItems.length} producto(s)</p>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>
            )}

            {/* Search */}
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                    placeholder="Buscar productos..."
                    className="pl-10"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>

            {/* Table */}
            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>SKU</TableHead>
                                <TableHead>Producto</TableHead>
                                <TableHead className="text-right">Precio Neto</TableHead>
                                <TableHead className="text-center">Ctrl. Stock</TableHead>
                                <TableHead className="text-right">Stock Actual</TableHead>
                                <TableHead className="text-right">Stock Mín.</TableHead>
                                <TableHead className="text-center">Estado</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        {Array.from({ length: 7 }).map((_, j) => (
                                            <TableCell key={j}>
                                                <Skeleton className="h-4 w-full" />
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))
                            ) : filtered.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="text-center py-8 text-slate-400">
                                        No se encontraron productos
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filtered.map((product) => {
                                    const stock = parseFloat(product.stock_actual)
                                    const minStock = parseFloat(product.stock_minimo)
                                    const outOfStock = product.controla_stock && stock <= 0
                                    const lowStock = product.controla_stock && stock > 0 && stock <= minStock

                                    return (
                                        <TableRow key={product.id} className={outOfStock ? 'bg-red-50/50 dark:bg-red-950/10' : ''}>
                                            <TableCell className="font-mono text-xs text-slate-500">
                                                {product.codigo_interno}
                                            </TableCell>
                                            <TableCell className="font-medium">{product.nombre}</TableCell>
                                            <TableCell className="text-right font-tabular">
                                                {formatCLP(product.precio_neto)}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {product.controla_stock ? (
                                                    <Badge variant="outline" className="text-[10px]">Sí</Badge>
                                                ) : (
                                                    <span className="text-slate-300">—</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-tabular font-semibold">
                                                {product.controla_stock ? stock : '—'}
                                            </TableCell>
                                            <TableCell className="text-right font-tabular text-slate-400">
                                                {product.controla_stock ? minStock : '—'}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                {outOfStock ? (
                                                    <Badge variant="destructive" className="text-[10px]">Agotado</Badge>
                                                ) : lowStock ? (
                                                    <Badge className="bg-amber-500 text-[10px]">Bajo</Badge>
                                                ) : product.controla_stock ? (
                                                    <Badge className="bg-emerald-600 text-[10px]">OK</Badge>
                                                ) : (
                                                    <span className="text-slate-300">—</span>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    )
                                })
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
