'use client'

import { useEffect, useState } from 'react'
import { getProducts, type Product } from '@/services/products'
import { getApiErrorMessage } from '@/services/api'
import {
    Package,
    Search,
    AlertTriangle,
    XCircle,
    MoreHorizontal,
    Pencil,
    Trash2,
    Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import ProductWizard from '@/components/inventory/ProductWizard'
import ProductEditDialog from '@/components/inventory/ProductEditDialog'
import { deleteProduct } from '@/services/products'
import { toast } from 'sonner'

function formatCLP(value: number): string {
    return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        minimumFractionDigits: 0,
    }).format(value)
}

function StockBadge({ product }: { product: Product }) {
    const stock = parseFloat(product.stock_actual)
    const min = parseFloat(product.stock_minimo)

    if (!product.controla_stock) {
        return <Badge variant="secondary" className="text-[10px]">Sin control</Badge>
    }
    if (stock <= 0) {
        return <Badge variant="destructive" className="text-[10px] gap-0.5"><XCircle className="h-2.5 w-2.5" /> Agotado</Badge>
    }
    if (stock <= min) {
        return <Badge className="bg-amber-500 text-[10px] gap-0.5"><AlertTriangle className="h-2.5 w-2.5" /> Bajo ({stock})</Badge>
    }
    return <Badge className="bg-emerald-600 text-[10px]">{stock}</Badge>
}

export default function InventarioPage() {
    const [products, setProducts] = useState<Product[]>([])
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(true)
    const [wizardOpen, setWizardOpen] = useState(false)
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

    const loadProducts = () => {
        setLoading(true)
        getProducts()
            .then(setProducts)
            .catch((error) => {
                console.error(error)
                toast.error(getApiErrorMessage(error, 'Error al cargar productos'))
            })
            .finally(() => setLoading(false))
    }

    const handleDelete = async (product: Product) => {
        if (!confirm(`¿Estás seguro de eliminar "${product.nombre}"? Esto no se puede deshacer.`)) return

        try {
            await deleteProduct(product.id)
            toast.success('Producto eliminado')
            loadProducts()
        } catch (error) {
            console.error(error)
            toast.error('Error al eliminar producto')
        }
    }

    const handleEdit = (product: Product) => {
        setSelectedProduct(product)
        setEditDialogOpen(true)
    }

    useEffect(() => { loadProducts() }, [])

    // Filter only root products (parents or standalone) to avoid duplicates
    // Filter only root products (parents or standalone) to avoid duplicates
    // We want to show PARENTS in the table, effectively grouping variants.
    // Standalone products are their own parents (parent_id === null and empty variants usually, or just treat as root).
    const rawProducts = products.filter(p => p.parent_id === null)

    // Deduplicate by ID just in case
    const allProducts = Array.from(new Map(rawProducts.map(p => [p.id, p])).values())

    const filtered = search.trim()
        ? allProducts.filter(
            (p) =>
                p.full_name.toLowerCase().includes(search.toLowerCase()) ||
                p.codigo_interno.toLowerCase().includes(search.toLowerCase()) ||
                p.codigo_barras?.includes(search) ||
                p.variants.some(v => v.full_name.toLowerCase().includes(search.toLowerCase()))
        )
        : allProducts

    return (
        <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Package className="h-6 w-6 text-blue-600" />
                    <div>
                        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Inventario</h1>
                        <p className="text-xs text-slate-500">{allProducts.length} productos</p>
                    </div>
                </div>
                <Button onClick={() => setWizardOpen(true)} className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700">
                    <Plus className="h-4 w-4" /> Nuevo Producto
                </Button>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                    placeholder="Buscar por nombre, SKU o código de barras..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 h-10 text-sm"
                />
            </div>

            {/* Table */}
            <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
                                <th className="text-left text-[10px] uppercase tracking-wider text-slate-400 px-4 py-2.5 font-medium">SKU</th>
                                <th className="text-left text-[10px] uppercase tracking-wider text-slate-400 px-4 py-2.5 font-medium">Producto</th>
                                <th className="text-right text-[10px] uppercase tracking-wider text-slate-400 px-4 py-2.5 font-medium hidden sm:table-cell">Precio Neto</th>
                                <th className="text-center text-[10px] uppercase tracking-wider text-slate-400 px-4 py-2.5 font-medium">Stock Total</th>
                                <th className="text-center text-[10px] uppercase tracking-wider text-slate-400 px-4 py-2.5 font-medium hidden lg:table-cell">Variantes</th>
                                <th className="w-[50px]"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="text-center py-12 text-slate-400">Cargando...</td>
                                </tr>
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="text-center py-12 text-slate-400">Sin resultados</td>
                                </tr>
                            ) : (
                                filtered.map((p) => (
                                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                                        <td className="px-4 py-2.5 font-mono text-[11px] text-slate-500">{p.codigo_interno}</td>
                                        <td className="px-4 py-2.5">
                                            <p className="text-xs font-medium text-slate-900 dark:text-white">{p.full_name}</p>
                                            {p.codigo_barras && (
                                                <p className="text-[10px] text-slate-400 font-mono">{p.codigo_barras}</p>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-right font-tabular text-xs hidden sm:table-cell">
                                            {formatCLP(parseFloat(p.precio_neto))}
                                        </td>
                                        <td className="px-4 py-2.5 text-center">
                                            {p.variants.length > 0 ? (
                                                <Badge className="bg-slate-100 text-slate-600 hover:bg-slate-200">
                                                    {p.variants.reduce((acc, v) => acc + parseFloat(v.stock_actual), 0)} u.
                                                </Badge>
                                            ) : (
                                                <StockBadge product={p} />
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-center text-xs text-slate-400 font-tabular hidden lg:table-cell">
                                            {p.variants.length > 0 ? (
                                                <Badge variant="outline" className="text-[10px]">{p.variants.length} vars</Badge>
                                            ) : (
                                                <span className="text-[10px]">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-center">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" className="h-8 w-8 p-0">
                                                        <span className="sr-only">Open menu</span>
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                                                    <DropdownMenuItem onClick={() => handleEdit(p)}>
                                                        <Pencil className="mr-2 h-4 w-4" />
                                                        Editar
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem onClick={() => handleDelete(p)} className="text-red-600 focus:text-red-600">
                                                        <Trash2 className="mr-2 h-4 w-4" />
                                                        Eliminar
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Product Wizard */}
            <ProductWizard
                open={wizardOpen}
                onClose={(refresh) => {
                    setWizardOpen(false)
                    if (refresh) loadProducts()
                }}
            />

            <ProductEditDialog
                open={editDialogOpen}
                product={selectedProduct}
                onClose={(refresh) => {
                    setEditDialogOpen(false)
                    if (refresh) loadProducts()
                }}
            />
        </div>
    )
}
