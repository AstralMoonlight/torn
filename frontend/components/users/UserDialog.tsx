'use client'

import { useEffect, useState } from 'react'
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
import { type User, createUser, updateUser } from '@/services/users'
import { formatRut, validateRut } from '@/lib/rut'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

interface Props {
    open: boolean
    onClose: () => void
    onSuccess: () => void
    user?: User | null
}

export default function UserDialog({ open, onClose, onSuccess, user }: Props) {
    const [rut, setRut] = useState('')
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        if (open) {
            if (user) {
                setRut(user.rut)
                setName(user.razon_social)
                setEmail(user.email || '')
            } else {
                setRut('')
                setName('')
                setEmail('')
            }
        }
    }, [open, user])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!rut || !name) {
            toast.error('RUT y Nombre son requeridos')
            return
        }

        if (!user && !validateRut(rut)) {
            toast.error('RUT inválido', {
                description: 'Verifique el formato y el dígito verificador.'
            })
            return
        }

        setSubmitting(true)
        try {
            if (user) {
                await updateUser(user.id, {
                    razon_social: name,
                    email: email || undefined,
                })
                toast.success('Vendedor actualizado')
            } else {
                await createUser({
                    rut,
                    razon_social: name,
                    email: email || undefined,
                    role: 'SELLER'
                })
                toast.success('Vendedor creado')
            }
            onSuccess()
            onClose()
        } catch (error) {
            console.error(error)
            toast.error('Error al guardar vendedor')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{user ? 'Editar Vendedor' : 'Nuevo Vendedor'}</DialogTitle>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="rut">RUT</Label>
                        <Input
                            id="rut"
                            placeholder="12.345.678-9"
                            disabled={!!user}
                            value={rut}
                            onChange={(e) => setRut(formatRut(e.target.value))}
                            maxLength={12}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="name">Nombre Completo</Label>
                        <Input
                            id="name"
                            placeholder="Ej: Juan Pérez"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="email">Email (Opcional)</Label>
                        <Input
                            id="email"
                            type="email"
                            placeholder="juan@ejemplo.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                    </div>

                    <DialogFooter className="pt-4">
                        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
                            Cancelar
                        </Button>
                        <Button type="submit" disabled={submitting}>
                            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {user ? 'Actualizar' : 'Crear'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
