'use client'

import { useEffect, useState } from 'react'
import { Plus, Edit2, Trash2, Truck } from 'lucide-react'
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
import { getProviders, deleteProvider, type Provider } from '@/services/providers'
import { getApiErrorMessage, getApiErrorDetail } from '@/services/api'
import ProviderDialog from '@/components/providers/ProviderDialog'

export default function ProvidersPage() {
    const [providers, setProviders] = useState<Provider[]>([])
    const [filtered, setFiltered] = useState<Provider[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [editingProvider, setEditingProvider] = useState<Provider | null>(null)

    const loadProviders = async () => {
        try {
            setLoading(true)
            const data = await getProviders()
            setProviders(data)
            setFiltered(data)
        } catch (error) {
            avisar(getApiErrorMessage(error, 'Error al cargar proveedores'), { reintentar: loadProviders })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadProviders()
    }, [])

    useEffect(() => {
        const query = search.toLowerCase()
        setFiltered(
            providers.filter(
                (p) =>
                    p.razon_social.toLowerCase().includes(query) ||
                    p.rut.toLowerCase().includes(query)
            )
        )
    }, [search, providers])

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
                icon={Truck}
                title="Proveedores"
                description="Gestiona tus proveedores y sus datos de contacto."
                actions={
                    <Button onClick={() => { setEditingProvider(null); setIsDialogOpen(true) }} className="gap-2">
                        <Plus className="h-4 w-4" /> Nuevo proveedor
                    </Button>
                }
            />

            <ListToolbar
                busqueda={search}
                onBusqueda={setSearch}
                placeholder="Buscar por nombre o RUT..."
                visibles={filtered.length}
                total={providers.length}
                unidad="proveedores"
            />

            <div data-section="proveedores.tabla" className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>RUT</TableHead>
                            <TableHead>Razón social</TableHead>
                            <TableHead className="hidden md:table-cell">Giro</TableHead>
                            <TableHead className="hidden lg:table-cell">Email</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableEmpty colSpan={5} loading />
                        ) : filtered.length === 0 ? (
                            <TableEmpty colSpan={5}>No se encontraron proveedores.</TableEmpty>
                        ) : (
                            filtered.map((provider) => (
                                <TableRow key={provider.id} className="hover:bg-accent/50 transition-colors">
                                    <TableCell className="font-mono text-xs">{formatRut(provider.rut)}</TableCell>
                                    <TableCell className="font-medium">{provider.razon_social}</TableCell>
                                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                                        {provider.giro}
                                    </TableCell>
                                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                                        {provider.email}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <AccionFila icon={Edit2} label="Editar" onClick={() => handleEdit(provider)} />
                                            <AccionFila icon={Trash2} label="Desactivar" onClick={() => setToDelete(provider)} peligro />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
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
