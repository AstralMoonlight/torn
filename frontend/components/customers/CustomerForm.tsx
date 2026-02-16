import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DialogFooter } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { CustomerCreate, Customer } from '@/services/customers'

interface CustomerFormProps {
    initialData?: CustomerCreate
    onSubmit: (data: CustomerCreate) => Promise<void>
    onCancel: () => void
    isEditing?: boolean
}

// Basic RUT formatter
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

export default function CustomerForm({ initialData, onSubmit, onCancel, isEditing }: CustomerFormProps) {
    const [formData, setFormData] = useState<CustomerCreate>({
        rut: '',
        razon_social: '',
        giro: '',
        direccion: '',
        comuna: '',
        ciudad: '',
        email: ''
    })
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (initialData) {
            setFormData(initialData)
        }
    }, [initialData])

    const handleSubmit = async () => {
        setSaving(true)
        try {
            await onSubmit(formData)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>RUT *</Label>
                    <Input
                        value={formData.rut}
                        onChange={(e) => setFormData({ ...formData, rut: formatRut(e.target.value) })}
                        placeholder="12.345.678-9"
                        disabled={!!isEditing}
                        maxLength={12}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="cliente@email.com"
                    />
                </div>
            </div>
            <div className="space-y-2">
                <Label>Razón Social *</Label>
                <Input
                    value={formData.razon_social}
                    onChange={(e) => setFormData({ ...formData, razon_social: e.target.value })}
                    placeholder="Nombre o empresa"
                />
            </div>
            <div className="space-y-2">
                <Label>Giro</Label>
                <Input
                    value={formData.giro}
                    onChange={(e) => setFormData({ ...formData, giro: e.target.value })}
                    placeholder="Rubro o actividad económica"
                />
            </div>
            <div className="space-y-2">
                <Label>Dirección</Label>
                <Input
                    value={formData.direccion}
                    onChange={(e) => setFormData({ ...formData, direccion: e.target.value })}
                    placeholder="Calle y número"
                />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Comuna</Label>
                    <Input
                        value={formData.comuna}
                        onChange={(e) => setFormData({ ...formData, comuna: e.target.value })}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Ciudad</Label>
                    <Input
                        value={formData.ciudad}
                        onChange={(e) => setFormData({ ...formData, ciudad: e.target.value })}
                    />
                </div>
            </div>

            <DialogFooter>
                <Button variant="outline" onClick={onCancel} disabled={saving}>
                    Cancelar
                </Button>
                <Button onClick={handleSubmit} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Guardar
                </Button>
            </DialogFooter>
        </div>
    )
}
