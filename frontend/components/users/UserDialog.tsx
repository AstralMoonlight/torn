'use client'

import { useEffect, useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type User, createUser, updateUser } from '@/services/users'
import { type Role } from '@/services/roles'
import { formatRut, validateRut } from '@/lib/rut'
import { toast } from 'sonner'
import { Loader2, Plus, Pencil, AlertTriangle } from 'lucide-react'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

interface Props {
    open: boolean
    onClose: () => void
    onSuccess: () => void
    user?: User | null
    roles: Role[]
    canActivateMore: boolean
}

export default function UserDialog({ open, onClose, onSuccess, user, roles, canActivateMore }: Props) {
    const [loading, setLoading] = useState(false)
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [roleId, setRoleId] = useState<string>('')

    const isOwner = user?.is_owner ?? false

    useEffect(() => {
        if (open) {
            if (user) {
                setName(user.name || '')
                setEmail(user.email || '')
                setRoleId(user.role_id?.toString() || '')
            } else {
                setName('')
                setEmail('')
                setRoleId('')
            }
            setPassword('')
        }
    }, [open, user])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!user && !canActivateMore) {
            toast.error('Límite de usuarios alcanzado', {
                description: 'No puedes crear más usuarios activos. Desactiva alguno primero o sube de plan.'
            })
            return
        }

        if (!isOwner && !roleId) {
            toast.error('Debes seleccionar un rol')
            return
        }

        try {
            setLoading(true)
            if (user) {
                await updateUser(user.id, {
                    full_name: name,
                    email,
                    role_id: isOwner ? undefined : parseInt(roleId),
                    password: password || undefined
                })
                toast.success('Usuario actualizado')
            } else {
                await createUser({
                    full_name: name,
                    email,
                    role_id: parseInt(roleId),
                    password
                })
                toast.success('Usuario creado')
            }
            onSuccess()
            onClose()
        } catch (error: any) {
            toast.error(error.response?.data?.detail || 'Error al guardar usuario')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {user ? (
                            <>
                                <Pencil className="h-5 w-5 text-blue-500" />
                                {isOwner ? 'Editar Mi Perfil (Admin)' : 'Editar Personal'}
                            </>
                        ) : (
                            <>
                                <Plus className="h-5 w-5 text-blue-500" />
                                Nuevo Personal
                            </>
                        )}
                    </DialogTitle>
                    <DialogDescription>
                        {isOwner
                            ? 'Solo puedes actualizar tu nombre y contraseña desde aquí.'
                            : 'Ingresa los datos del trabajador. El email será su identificador principal.'}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">Nombre Completo</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ej. Juan Pérez"
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="juan@empresa.com"
                            required
                            disabled={isOwner}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="password">
                            {user ? 'Nueva Contraseña (dejar en blanco para no cambiar)' : 'Contraseña'}
                        </Label>
                        <Input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required={!user}
                        />
                    </div>

                    {!isOwner && (
                        <div className="space-y-2">
                            <Label>Rol en la empresa</Label>
                            <Select value={roleId} onValueChange={setRoleId}>
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Seleccionar un rol" />
                                </SelectTrigger>
                                <SelectContent>
                                    {roles.map((role) => (
                                        <SelectItem key={role.id} value={role.id.toString()}>
                                            {role.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {!user && !canActivateMore && (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                            <div className="text-[10px] text-amber-700 leading-tight">
                                <p className="font-bold">Límite alcanzado</p>
                                <p>No puedes agregar personal activo. Desactiva a alguien primero.</p>
                            </div>
                        </div>
                    )}

                    <DialogFooter className="pt-4">
                        <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={loading} className="bg-blue-600 hover:bg-blue-700">
                            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {user ? 'Guardar Cambios' : 'Crear Personal'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
