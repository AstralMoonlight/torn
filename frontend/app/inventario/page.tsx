'use client'

import { useEffect, useState } from 'react'
import { getProducts, type Product } from '@/services/products'
import { getApiErrorMessage } from '@/services/api'
import {
    Package,
    AlertTriangle,
    XCircle,
    MoreHorizontal,
    Pencil,
    Trash2,
    Plus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { Badge } from '@/components/ui/badge'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableEmpty,
} from '@/components/ui/table'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import ProductWizard from '@/components/inventory/ProductWizard'
import ProductEditDialog from '@/components/inventory/ProductEditDialog'
import { deleteProduct } from '@/services/products'
import { toast } from 'sonner'
import { formatCLP } from '@/lib/format'


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
        return <Badge variant="outline" className="text-[10px] gap-0.5"><AlertTriangle className="h-2.5 w-2.5" /> Bajo ({stock})</Badge>
    }
    return <Badge variant="secondary" className="text-[10px]">{stock}</Badge>
}

export default function InventarioPage() {
    const [products, setProducts] = useState<Product[]>([])
    const [search, setSearch] = useState('')
    const [loading, setLoading] = useState(true)
    const [wizardOpen, setWizardOpen] = useState(false)
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)

    const fetchProducts = () => {
        getProducts()
            .then(setProducts)
            .catch((error) => {
                console.error(error)
                toast.error(getApiErrorMessage(error, 'Error al cargar productos'))
            })
            .finally(() => setLoading(false))
    }

    // Usado fuera del efecto de montaje (ej. tras eliminar), donde `loading`
    // ya pudo haber vuelto a `false` y sí hay que reactivarlo.
    const loadProducts = () => {
        setLoading(true)
        fetchProducts()
    }

    const [toDelete, setToDelete] = useState<Product | null>(null)

    const handleDelete = async (product: Product) => {
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

    // `loading` ya arranca en `true` (useState(true) arriba), así que el
    // montaje inicial no necesita el setLoading(true) síncrono de
    // loadProducts(): llama directo a fetchProducts().
    useEffect(() => { fetchProducts() }, [])

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
        <PageContainer>
            <PageHeader
                icon={Package}
                title="Inventario"
                description={`${allProducts.length} productos`}
                actions={
                    <Button onClick={() => setWizardOpen(true)} className="gap-1.5 text-xs">
                        <Plus className="h-4 w-4" /> Nuevo Producto
                    </Button>
                }
            />

            {/* Search */}
            <SearchInput data-section="inventario.buscador" placeholder="Buscar por nombre, SKU o código de barras..." value={search} onChange={(e) => setSearch(e.target.value)} />

            {/* Table */}
            <div data-section="inventario.tabla" className="rounded-xl border border-border bg-card overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="border-b border-border">
                            <TableHead>SKU</TableHead>
                            <TableHead>Producto</TableHead>
                            <TableHead className="text-right hidden sm:table-cell">Precio Neto</TableHead>
                            <TableHead className="text-center">Stock Total</TableHead>
                            <TableHead className="text-center hidden lg:table-cell">Variantes</TableHead>
                            <TableHead className="w-[50px] text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-border">
                        {loading ? (
                            <TableEmpty colSpan={6} loading />
                        ) : filtered.length === 0 ? (
                            <TableEmpty colSpan={6}>Sin resultados</TableEmpty>
                        ) : (
                            filtered.map((p) => (
                                <TableRow key={p.id} className="hover:bg-accent/50 transition-colors">
                                    <TableCell className="font-mono text-xs text-muted-foreground">{p.codigo_interno}</TableCell>
                                    <TableCell>
                                        <p className="text-sm font-medium text-foreground">{p.full_name}</p>
                                        {p.codigo_barras && (
                                            <p className="text-xs text-muted-foreground font-mono">{p.codigo_barras}</p>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right font-tabular text-sm hidden sm:table-cell">
                                        {formatCLP(parseFloat(p.precio_neto))}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {p.variants.length > 0 ? (
                                            <Badge className="bg-muted text-muted-foreground hover:bg-accent">
                                                {p.variants.reduce((acc, v) => acc + parseFloat(v.stock_actual), 0)} u.
                                            </Badge>
                                        ) : (
                                            <StockBadge product={p} />
                                        )}
                                    </TableCell>
                                    <TableCell className="text-center text-xs text-muted-foreground font-tabular hidden lg:table-cell">
                                        {p.variants.length > 0 ? (
                                            <Badge variant="outline" className="text-[10px]">{p.variants.length} vars</Badge>
                                        ) : (
                                            <span className="text-[10px]">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                                    <span className="sr-only">Abrir menu</span>
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
                                                <DropdownMenuItem onClick={() => setToDelete(p)} className="text-destructive focus:text-destructive">
                                                    <Trash2 className="mr-2 h-4 w-4" />
                                                    Eliminar
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
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
            <ConfirmDialog
                open={!!toDelete}
                onOpenChange={(o) => !o && setToDelete(null)}
                title="¿Eliminar producto?"
                description={<>&quot;{toDelete?.full_name}&quot; se eliminará. Esta acción no se puede deshacer.</>}
                onConfirm={async () => { if (toDelete) await handleDelete(toDelete) }}
            />
        </PageContainer>
    )
}
