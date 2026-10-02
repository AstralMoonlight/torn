'use client'

import { useEffect, useState } from 'react'
import { getProducts, type Product } from '@/services/products'
import { getApiErrorMessage, getApiErrorDetail } from '@/services/api'
import { Trash2, Plus, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AccionFila } from '@/components/ui/accion-fila'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableEmpty,
} from '@/components/ui/table'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import ListToolbar from '@/components/layout/ListToolbar'
import Resumen from '@/components/layout/Resumen'
import FiltrosRapidos from '@/components/layout/FiltrosRapidos'
import Estado from '@/components/layout/Estado'
import ProductWizard from '@/components/inventory/ProductWizard'
import ProductEditDialog from '@/components/inventory/ProductEditDialog'
import AjusteStockDialog from '@/components/inventory/AjusteStockDialog'
import { deleteProduct } from '@/services/products'
import { avisar } from '@/lib/store/uiStore'
import { formatCLP } from '@/lib/format'

type EstadoStock = 'sin-control' | 'agotado' | 'poco' | 'ok'
type Filtro = 'todos' | 'poco' | 'agotados' | 'desactivados'

/** Estado del stock de un producto; con variantes, manda la peor de ellas. */
function estadoStock(p: Product): EstadoStock {
    const unidades = p.variants.length > 0 ? p.variants : [p]
    const controladas = unidades.filter((u) => u.controla_stock)
    if (controladas.length === 0) return 'sin-control'
    if (controladas.every((u) => parseFloat(u.stock_actual) <= 0)) return 'agotado'
    if (controladas.some((u) => parseFloat(u.stock_actual) <= parseFloat(u.stock_minimo))) return 'poco'
    return 'ok'
}

function StockEstado({ product }: { product: Product }) {
    const estado = estadoStock(product)
    const stock = product.variants.length > 0
        ? product.variants.reduce((acc, v) => acc + parseFloat(v.stock_actual), 0)
        : parseFloat(product.stock_actual)
    if (estado === 'sin-control') return <Estado>Sin control</Estado>
    if (estado === 'agotado') return <Estado tono="mal">Agotado</Estado>
    if (estado === 'poco') return <Estado tono="alerta">{product.variants.length > 0 ? 'Poco stock' : `Quedan ${stock}`}</Estado>
    return <Estado>{stock} {stock === 1 ? 'unidad' : 'unidades'}</Estado>
}

export default function InventarioPage() {
    const [products, setProducts] = useState<Product[]>([])
    const [search, setSearch] = useState('')
    const [filtro, setFiltro] = useState<Filtro>('todos')
    const [loading, setLoading] = useState(true)
    const [wizardOpen, setWizardOpen] = useState(false)
    const [editDialogOpen, setEditDialogOpen] = useState(false)
    const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
    const [ajustando, setAjustando] = useState<Product | null>(null)

    const fetchProducts = () => {
        getProducts()
            .then(setProducts)
            .catch((error) => {
                console.error(error)
                avisar(getApiErrorMessage(error, 'Error al cargar productos'), { reintentar: loadProducts })
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
            loadProducts()
        } catch (error) {
            console.error(error)
            avisar(getApiErrorDetail(error, 'No se pudo eliminar el producto.'))
        }
    }

    const handleEdit = (product: Product) => {
        setSelectedProduct(product)
        setEditDialogOpen(true)
    }

    useEffect(() => { fetchProducts() }, [])

    // Solo productos raíz: las variantes se ven dentro de su producto.
    const raices = Array.from(new Map(products.filter((p) => p.parent_id === null).map((p) => [p.id, p])).values())
    const activos = raices.filter((p) => p.is_active)
    const desactivados = raices.filter((p) => !p.is_active)
    const pocos = activos.filter((p) => estadoStock(p) === 'poco')
    const agotados = activos.filter((p) => estadoStock(p) === 'agotado')

    const base = { todos: activos, poco: pocos, agotados, desactivados }[filtro]
    const q = search.trim().toLowerCase()
    const filtered = q
        ? base.filter(
            (p) =>
                p.full_name.toLowerCase().includes(q) ||
                p.codigo_interno.toLowerCase().includes(q) ||
                p.codigo_barras?.includes(search.trim()) ||
                p.variants.some(v => v.full_name.toLowerCase().includes(q)))
        : base

    return (
        <PageContainer>
            <PageHeader
                title="Productos"
                description="Lo que vendes: precios, stock y códigos."
                actions={
                    <Button onClick={() => setWizardOpen(true)} className="h-11 gap-1.5 text-base">
                        <Plus className="h-4 w-4" /> Agregar producto
                    </Button>
                }
            />

            {!loading && (
                <Resumen datos={[
                    { etiqueta: 'Productos a la venta', valor: activos.length, nota: desactivados.length === 0 ? 'Ninguno desactivado' : desactivados.length === 1 ? '1 desactivado' : `${desactivados.length} desactivados` },
                    { etiqueta: 'Con poco stock', valor: pocos.length, nota: 'Quedan menos de los que pediste avisar' },
                    { etiqueta: 'Agotados', valor: agotados.length, nota: 'No se pueden vender hasta reponer', tono: agotados.length ? 'mal' : undefined },
                ]} />
            )}

            <ListToolbar
                busqueda={search}
                onBusqueda={setSearch}
                placeholder="Nombre, código o código de barras"
                visibles={filtered.length}
                total={base.length}
                unidad="productos"
                filtros={
                    <FiltrosRapidos
                        etiqueta="Filtrar productos"
                        valor={filtro}
                        onChange={setFiltro}
                        opciones={[
                            { valor: 'todos', etiqueta: 'Todos', n: activos.length },
                            { valor: 'poco', etiqueta: 'Poco stock', n: pocos.length },
                            { valor: 'agotados', etiqueta: 'Agotados', n: agotados.length, peligro: agotados.length > 0 },
                            { valor: 'desactivados', etiqueta: 'Desactivados', n: desactivados.length },
                        ]}
                    />
                }
            />

            <div data-section="inventario.tabla" className="bg-card rounded-xl border border-border overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Producto</TableHead>
                            <TableHead className="text-right">Precio</TableHead>
                            <TableHead>Stock</TableHead>
                            <TableHead className="w-[180px]"><span className="sr-only">Acciones</span></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableEmpty colSpan={4} loading />
                        ) : filtered.length === 0 ? (
                            <TableEmpty colSpan={4}>
                                {q ? 'Ningún producto coincide con la búsqueda.' : filtro === 'todos' ? 'Todavía no hay productos. Agrega el primero.' : 'No hay productos en este filtro.'}
                            </TableEmpty>
                        ) : (
                            filtered.map((p) => (
                                <TableRow key={p.id}>
                                    <TableCell className="text-[15px]">
                                        <p className="font-medium text-foreground">{p.full_name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {[p.codigo_interno, p.variants.length > 0 ? `${p.variants.length} variantes` : p.brand?.name].filter(Boolean).join(', ')}
                                        </p>
                                    </TableCell>
                                    <TableCell className="text-right text-[15px] font-tabular">
                                        {p.variants.length > 0 ? (
                                            <span className="text-muted-foreground">Según variante</span>
                                        ) : (
                                            <>
                                                <p className="font-medium text-foreground">{formatCLP(parseFloat(p.precio_bruto))}</p>
                                                <p className="text-sm text-muted-foreground">neto {formatCLP(parseFloat(p.precio_neto))}</p>
                                            </>
                                        )}
                                    </TableCell>
                                    <TableCell><StockEstado product={p} /></TableCell>
                                    <TableCell>
                                        <div className="flex items-center justify-end gap-1">
                                            <Button variant="outline" size="sm" onClick={() => handleEdit(p)}>Editar</Button>
                                            {p.controla_stock && p.variants.length === 0 && (
                                                <AccionFila icon={ClipboardList} label="Ajustar stock" onClick={() => setAjustando(p)} />
                                            )}
                                            <AccionFila icon={Trash2} label="Eliminar" onClick={() => setToDelete(p)} peligro />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

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
                onAjustarStock={setAjustando}
            />
            <ConfirmDialog
                open={!!toDelete}
                onOpenChange={(o) => !o && setToDelete(null)}
                title="¿Eliminar producto?"
                description={<>&quot;{toDelete?.full_name}&quot; se eliminará. Esta acción no se puede deshacer.</>}
                onConfirm={async () => { if (toDelete) await handleDelete(toDelete) }}
            />
            <AjusteStockDialog
                product={ajustando}
                onClose={(cambio) => {
                    setAjustando(null)
                    if (cambio) loadProducts()
                }}
            />
        </PageContainer>
    )
}
