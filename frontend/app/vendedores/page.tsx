'use client'

import { useEffect, useState } from 'react'
import { getSellers, deleteUser, type User } from '@/services/users'
import { Button } from '@/components/ui/button'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
    Users,
    Plus,
    Pencil,
    Trash2,
    Loader2,
    Mail,
    CreditCard
} from 'lucide-react'
import { toast } from 'sonner'
import UserDialog from '@/components/users/UserDialog'

export default function SellersPage() {
    const [sellers, setSellers] = useState<User[]>([])
    const [loading, setLoading] = useState(true)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [selectedUser, setSelectedUser] = useState<User | null>(null)

    const fetchSellers = async () => {
        try {
            setLoading(true)
            const data = await getSellers()
            setSellers(data)
        } catch (error) {
            console.error(error)
            toast.error('Error al cargar vendedores')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchSellers()
    }, [])

    const handleEdit = (user: User) => {
        setSelectedUser(user)
        setDialogOpen(true)
    }

    const handleCreate = () => {
        setSelectedUser(null)
        setDialogOpen(true)
    }

    const handleDelete = async (id: number) => {
        if (!confirm('¿Estás seguro de desactivar este vendedor?')) return
        try {
            await deleteUser(id)
            toast.success('Vendedor desactivado')
            fetchSellers()
        } catch (error) {
            console.error(error)
            toast.error('Error al desactivar vendedor')
        }
    }

    return (
        <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight">Vendedores</h2>
                    <p className="text-muted-foreground">
                        Gestiona el personal responsable de las ventas y turnos de caja.
                    </p>
                </div>
                <Button onClick={handleCreate} className="gap-2">
                    <Plus className="h-4 w-4" /> Nuevo Vendedor
                </Button>
            </div>

            <div className="rounded-md border bg-white dark:bg-slate-900 shadow-sm">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nombre / Razón Social</TableHead>
                            <TableHead>RUT</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center">
                                    <div className="flex items-center justify-center gap-2">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Cargando vendedores...
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : sellers.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                    No se encontraron vendedores.
                                </TableCell>
                            </TableRow>
                        ) : (
                            sellers.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell>
                                        <div className="flex items-center gap-2">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                                                <Users className="h-4 w-4" />
                                            </div>
                                            <span className="font-medium">{user.razon_social}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1.5 text-muted-foreground">
                                            <CreditCard className="h-3.5 w-3.5" />
                                            {user.rut}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        {user.email ? (
                                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                                <Mail className="h-3.5 w-3.5" />
                                                {user.email}
                                            </div>
                                        ) : (
                                            <span className="text-slate-300 italic">-</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={user.is_active ? 'default' : 'secondary'} className={user.is_active ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400' : ''}>
                                            {user.is_active ? 'Activo' : 'Inactivo'}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="icon" onClick={() => handleEdit(user)}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(user.id)}>
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

            <UserDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                onSuccess={fetchSellers}
                user={selectedUser}
            />
        </div>
    )
}
