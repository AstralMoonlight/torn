'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import ListToolbar from '@/components/layout/ListToolbar'
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
import { avisar } from '@/lib/store/uiStore'
import { formatRut } from '@/lib/rut'
import { diaEnPalabras, formatCLP } from '@/lib/format'
import { getProviders, deleteProvider, type Provider } from '@/services/providers'
import { getPurchases, type Purchase } from '@/services/purchases'
import { getApiErrorMessage, getApiErrorDetail } from '@/services/api'
import ProviderDialog from '@/components/providers/ProviderDialog'

export default function ProvidersPage() {
    const [providers, setProviders] = useState<Provider[]>([])
    // Última compra de cada proveedor. Compras pide su propio permiso: sin él, la columna queda vacía.
    const [ultimas, setUltimas] = useState<Map<number, Purchase>>(new Map())
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingProvider, setEditingProvider] = useState<Provider | null>(null)

    const loadProviders = async () => {
        try {
            setLoading(true)
            setProviders(await getProviders())
        } catch (error) {
            avisar(getApiErrorMessage(error, 'Error al cargar proveedores'), { reintentar: loadProviders })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadProviders()
        getPurchases()
            .then((compras) => {
                const porProveedor = new Map<number, Purchase>()
                compras.forEach((c) => {
                    const actual = porProveedor.get(c.provider_id)
                    if (!actual || c.fecha_compra > actual.fecha_compra) porProveedor.set(c.provider_id, c)
                })
                setUltimas(porProveedor)
            })
            .catch(() => null)
    }, [])

    const q = search.trim().toLowerCase()
    const filtered = providers.filter((p) => p.razon_social.toLowerCase().includes(q) || p.rut.toLowerCase().includes(q))

    const handleEdit = (provider: Provider) => {
        setEditingProvider(provider)
        setIsDialogOpen(true)
    }

    const [toDelete, setToDelete] = useState<Provider | null>(null)

    const handleDelete = async (id: number) => {
        try {
            await deleteProvider(id)
            loadProviders()
        } catch (error) {
            avisar(getApiErrorDetail(error, 'No se pudo desactivar el proveedor.'))
        }
    }

    return (
        <PageContainer>
            <PageHeader
                title="Proveedores"
                description="A quién le compras, cómo contactarlos y cuándo les compraste por última vez."
                actions={
                    <Button onClick={() => { setEditingProvider(null); setIsDialogOpen(true) }} className="h-11 text-base">
                        <Plus className="h-4 w-4" /> Agregar proveedor
                    </Button>
                }
            />

            <ListToolbar
                busqueda={search}
                onBusqueda={setSearch}
                placeholder="Nombre o RUT"
                visibles={filtered.length}
                total={providers.length}
                unidad="proveedores"
            />

            <div data-section="proveedores.tabla" className="bg-card rounded-xl border border-border overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Proveedor</TableHead>
                            <TableHead className="hidden md:table-cell">Contacto</TableHead>
                            <TableHead className="hidden lg:table-cell">Última compra</TableHead>
                            <TableHead><span className="sr-only">Acciones</span></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableEmpty colSpan={4} loading />
                        ) : filtered.length === 0 ? (
                            <TableEmpty colSpan={4}>
                                {q ? 'Ningún proveedor coincide con la búsqueda.' : 'Todavía no hay proveedores. Agrega el primero.'}
                            </TableEmpty>
                        ) : (
                            filtered.map((provider) => {
                                const ultima = ultimas.get(provider.id)
                                return (
                                    <TableRow key={provider.id}>
                                        <TableCell className="text-[15px]">
                                            <p className="font-medium text-foreground">{provider.razon_social}</p>
                                            <p className="text-sm text-muted-foreground">{[formatRut(provider.rut), provider.giro].filter(Boolean).join(', ')}</p>
                                        </TableCell>
                                        <TableCell className="hidden md:table-cell text-sm">
                                            <p className="text-foreground">{provider.email || 'Sin correo'}</p>
                                            {provider.telefono && <p className="text-muted-foreground">{provider.telefono}</p>}
                                        </TableCell>
                                        <TableCell className="hidden lg:table-cell text-sm">
                                            {ultima ? (
                                                <>
                                                    <p className="text-foreground first-letter:uppercase">{diaEnPalabras(ultima.fecha_compra)}</p>
                                                    <p className="text-muted-foreground font-tabular">{formatCLP(ultima.monto_total)}</p>
                                                </>
                                            ) : (
                                                <span className="text-muted-foreground">Sin compras</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center justify-end gap-1">
                                                <Button variant="outline" size="sm" asChild>
                                                    <Link href={`/compras?registrar=${provider.id}`}>Registrar compra</Link>
                                                </Button>
                                                <Button variant="outline" size="sm" onClick={() => handleEdit(provider)}>Editar</Button>
                                                <AccionFila icon={Trash2} label="Desactivar" onClick={() => setToDelete(provider)} peligro />
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            <ProviderDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                provider={editingProvider}
                onSuccess={loadProviders}
            />
            <ConfirmDialog
                open={!!toDelete}
                onOpenChange={(o) => !o && setToDelete(null)}
                title="¿Desactivar proveedor?"
                description={toDelete?.razon_social}
                confirmLabel="Desactivar"
                onConfirm={async () => { if (toDelete) await handleDelete(toDelete.id) }}
            />
        </PageContainer>
    )
}
