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
import { AlertaError } from '@/components/ui/alerta-error'
import { Loader2, Plus, Pencil, AlertTriangle } from 'lucide-react'
import { getApiErrorDetail } from '@/services/api'
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
    const [error, setError] = useState<string | null>(null)

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
            setError(null)
        }
    }, [open, user])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        if (!user && !canActivateMore) {
            setError('Límite de usuarios alcanzado: desactiva alguno o sube de plan para crear más.')
            return
        }

        if (!isOwner && !roleId) {
            setError('Debes seleccionar un rol.')
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
            } else {
                await createUser({
                    full_name: name,
                    email,
                    role_id: parseInt(roleId),
                    password
                })
            }
            onSuccess()
            onClose()
        } catch (error) {
            setError(getApiErrorDetail(error, 'No se pudo guardar el usuario.'))
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent data-section="personal.formulario" className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {user ? (
                            <>
                                <Pencil className="h-5 w-5 text-primary" />
                                {isOwner ? 'Editar mi perfil (admin)' : 'Editar personal'}
                            </>
                        ) : (
                            <>
                                <Plus className="h-5 w-5 text-primary" />
                                Nuevo personal
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
                        <Label htmlFor="name">Nombre completo</Label>
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
                            {user ? 'Nueva contraseña (déjala en blanco para no cambiarla)' : 'Contraseña'}
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
                        <div className="p-3 bg-muted border border-border rounded-lg flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                            <div className="text-[10px] text-muted-foreground leading-tight">
                                <p className="font-bold">Límite alcanzado</p>
                                <p>No puedes agregar personal activo. Desactiva a alguien primero.</p>
                            </div>
                        </div>
                    )}

                    <AlertaError mensaje={error} />
                    <DialogFooter className="pt-4">
                        <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={loading} className="">
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            {user ? 'Guardar cambios' : 'Crear personal'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
