'use client'

import { useEffect, useState } from 'react'
import { Truck, Plus, Search, Edit2, Trash2, MoreHorizontal } from 'lucide-react'
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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
        <div className="p-6 space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Proveedores</h1>
                    <p className="text-muted-foreground pt-1">
                        Gestión de empresas y entidades suministradoras.
                    </p>
                </div>
                <Button onClick={() => { setEditingProvider(null); setIsDialogOpen(true) }} className="gap-2">
                    <Plus className="h-4 w-4" /> Nuevo Proveedor
                </Button>
            </div>

            <Card>
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
                    <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden">
                        <Table>
                            <TableHeader className="bg-neutral-50 dark:bg-neutral-900/60">
                                <TableRow className="border-b border-neutral-200 dark:border-neutral-800 hover:bg-transparent dark:hover:bg-transparent">
                                    <TableHead className="text-xs uppercase tracking-wider text-neutral-400 font-medium">RUT</TableHead>
                                    <TableHead className="text-xs uppercase tracking-wider text-neutral-400 font-medium">Razón Social</TableHead>
                                    <TableHead className="hidden md:table-cell text-xs uppercase tracking-wider text-neutral-400 font-medium">Giro</TableHead>
                                    <TableHead className="hidden lg:table-cell text-xs uppercase tracking-wider text-neutral-400 font-medium">Email</TableHead>
                                    <TableHead className="text-right text-xs uppercase tracking-wider text-neutral-400 font-medium">Acciones</TableHead>
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
                                        <TableRow key={provider.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30 transition-colors">
                                            <TableCell className="font-mono text-xs">{formatRut(provider.rut)}</TableCell>
                                            <TableCell className="font-medium">{provider.razon_social}</TableCell>
                                            <TableCell className="hidden md:table-cell text-sm text-neutral-500 dark:text-neutral-400">
                                                {provider.giro}
                                            </TableCell>
                                            <TableCell className="hidden lg:table-cell text-sm text-neutral-500 dark:text-neutral-400">
                                                {provider.email}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleEdit(provider)}
                                                        className="h-8 w-8 text-neutral-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                                                        title="Editar"
                                                    >
                                                        <Edit2 className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => handleDelete(provider.id)}
                                                        className="h-8 w-8 text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
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
        </div>
    )
}
