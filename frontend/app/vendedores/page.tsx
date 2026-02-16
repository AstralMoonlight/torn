'use client'

import { useState, useEffect } from 'react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getSellers, createUser, updateUser, deleteUser, User, UserCreate } from '@/services/users'
import { getApiErrorMessage } from '@/services/api'
import { toast } from 'sonner'
import { Pencil, Trash2, Plus, Loader2, User as UserIcon } from 'lucide-react'

// Reuse RUT formatter/validator logic if possible, or duplicate for now
// Duplicating for speed as per user request to just "get it done"
const formatRut = (rut: string): string => {
    const clean = rut.replace(/[^0-9kK]/g, '').toUpperCase()
    if (clean.length < 2) return clean
    const body = clean.slice(0, -1)
    const dv = clean.slice(-1)
    let formattedBody = ''
    for (let i = body.length - 1, j = 0; i >= 0; i--, j++) {
        formattedBody = body.charAt(i) + formattedBody
        if (j % 3 === 2 && i > 0) formattedBody = '.' + formattedBody
    }
    return `${formattedBody}-${dv}`
}

export default function SellersPage() {
    const [sellers, setSellers] = useState<User[]>([])
    const [loading, setLoading] = useState(true)

    // Dialog state
    const [open, setOpen] = useState(false)
    const [editingUser, setEditingUser] = useState<User | null>(null)
    const [formData, setFormData] = useState<UserCreate>({
        rut: '',
        razon_social: '',
        email: '',
        role: 'SELLER'
    })
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        loadSellers()
    }, [])

    const loadSellers = async () => {
        setLoading(true)
        try {
            const data = await getSellers()
            setSellers(data)
        } catch (error) {
            console.error(error)
            toast.error(getApiErrorMessage(error, 'Error al cargar vendedores'))
        } finally {
            setLoading(false)
        }
    }

    const handleOpenCreate = () => {
        setEditingUser(null)
        setFormData({
            rut: '',
            razon_social: '',
            email: '',
            role: 'SELLER'
        })
        setOpen(true)
    }

    const handleOpenEdit = (user: User) => {
        setEditingUser(user)
        setFormData({
            rut: user.rut,
            razon_social: user.razon_social,
            email: user.email || '',
            role: 'SELLER'
        })
        setOpen(true)
    }

    const handleSave = async () => {
        if (!formData.rut.trim() || !formData.razon_social.trim()) {
            toast.error('RUT y Nombre son obligatorios')
            return
        }

        setSaving(true)
        try {
            if (editingUser) {
                // Update
                const updated = await updateUser(editingUser.id, formData)
                setSellers(sellers.map(s => s.id === updated.id ? updated : s))
                toast.success('Vendedor actualizado')
            } else {
                // Create
                const created = await createUser(formData)
                setSellers([...sellers, created])
                toast.success('Vendedor creado')
            }
            setOpen(false)
        } catch (error: any) {
            console.error(error)
            const msg = error.response?.data?.detail || 'Error al guardar vendedor'
            toast.error(msg)
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (user: User) => {
        if (!confirm(`¿Desactivar vendedor ${user.razon_social}?`)) return
        try {
            await deleteUser(user.id)
            setSellers(sellers.filter(s => s.id !== user.id))
            toast.success('Vendedor desactivado')
        } catch (error) {
            console.error(error)
            toast.error('Error al eliminar vendedor')
        }
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Vendedores</h1>
                    <p className="text-muted-foreground">Gestiona el personal de ventas autorizado.</p>
                </div>
                <Button onClick={handleOpenCreate} className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="mr-2 h-4 w-4" /> Nuevo Vendedor
                </Button>
            </div>

            <div className="border rounded-lg bg-white dark:bg-slate-950 shadow-sm overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[120px]">RUT</TableHead>
                            <TableHead>Nombre / Razón Social</TableHead>
                            <TableHead className="hidden md:table-cell">Email</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={4} className="h-24 text-center">
                                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-400" />
                                </TableCell>
                            </TableRow>
                        ) : sellers.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                                    No se encontraron vendedores activos.
                                </TableCell>
                            </TableRow>
                        ) : (
                            sellers.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell className="font-mono text-xs font-medium">{user.rut}</TableCell>
                                    <TableCell className="font-medium flex items-center gap-2">
                                        <div className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                            <UserIcon className="h-4 w-4 text-slate-500" />
                                        </div>
                                        {user.razon_social}
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                                        {user.email || '-'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(user)} className="h-8 w-8 p-0">
                                                <Pencil className="h-4 w-4 text-blue-600" />
                                            </Button>
                                            <Button variant="ghost" size="sm" onClick={() => handleDelete(user)} className="h-8 w-8 p-0">
                                                <Trash2 className="h-4 w-4 text-red-500" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingUser ? 'Editar Vendedor' : 'Nuevo Vendedor'}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="space-y-2">
                            <Label>RUT *</Label>
                            <Input
                                value={formData.rut}
                                onChange={(e) => setFormData({ ...formData, rut: formatRut(e.target.value) })}
                                placeholder="12.345.678-9"
                                disabled={!!editingUser}
                                maxLength={12}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Nombre *</Label>
                            <Input
                                value={formData.razon_social}
                                onChange={(e) => setFormData({ ...formData, razon_social: e.target.value })}
                                placeholder="Nombre del vendedor"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Email</Label>
                            <Input
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                placeholder="vendedor@email.com"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Contraseña</Label>
                            <Input
                                type="password"
                                placeholder="••••••••"
                                disabled
                                className="bg-slate-100" // Disabled for now as per requirement
                            />
                            <p className="text-[10px] text-muted-foreground">Autenticación se habilitará próximamente.</p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Guardar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
