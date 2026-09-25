'use client'

import { useEffect, useState } from 'react'
import { Plus, Search, Edit2, Trash2, Truck } from 'lucide-react'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { formatRut } from '@/lib/rut'
import { getProviders, deleteProvider, type Provider } from '@/services/providers'
import { getApiErrorMessage } from '@/services/api'
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
            toast.error(getApiErrorMessage(error, 'Error al cargar proveedores'))
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

    const handleDelete = async (id: number) => {
        if (!confirm('¿Estás seguro de desactivar este proveedor?')) return
        try {
            await deleteProvider(id)
            toast.success('Proveedor desactivado')
            loadProviders()
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Error al desactivar proveedor'))
        }
    }

    return (
        <PageContainer>
            <PageHeader
                icon={Truck}
                title="Proveedores"
                description="Gestión de empresas y entidades suministradoras."
                actions={
                    <Button onClick={() => { setEditingProvider(null); setIsDialogOpen(true) }} className="gap-2">
                        <Plus className="h-4 w-4" /> Nuevo Proveedor
                    </Button>
                }
            />

            <Card data-section="proveedores.tabla">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-medium">Listado de Proveedores</CardTitle>
                        <div className="relative w-72">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar por Nombre o RUT..."
                                className="pl-9 h-9"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/60">
                                <TableRow className="border-b border-border hover:bg-transparent dark:hover:bg-transparent">
                                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground font-medium">RUT</TableHead>
                                    <TableHead className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Razón Social</TableHead>
                                    <TableHead className="hidden md:table-cell text-xs uppercase tracking-wider text-muted-foreground font-medium">Giro</TableHead>
                                    <TableHead className="hidden lg:table-cell text-xs uppercase tracking-wider text-muted-foreground font-medium">Email</TableHead>
                                    <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground font-medium">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    Array.from({ length: 5 }).map((_, i) => (
                                        <TableRow key={i}>
                                            <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                                            <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                                            <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-32" /></TableCell>
                                            <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-40" /></TableCell>
                                            <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto" /></TableCell>
                                        </TableRow>
                                    ))
                                ) : filtered.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                                            No se encontraron proveedores.
                                        </TableCell>
                                    </TableRow>
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
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleEdit(provider)}
                                                        className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                        title="Editar"
                                                    >
                                                        <Edit2 className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleDelete(provider.id)}
                                                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                        title="Desactivar"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <ProviderDialog
                open={isDialogOpen}
                onOpenChange={setIsDialogOpen}
                provider={editingProvider}
                onSuccess={loadProviders}
            />
        </PageContainer>
    )
}
