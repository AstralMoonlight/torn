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
import { getCustomers, createCustomer, updateCustomer, deleteCustomer, Customer, CustomerCreate } from '@/services/customers'
import { getApiErrorMessage } from '@/services/api'
import { toast } from 'sonner'
import { Pencil, Trash2, Plus, Search, Loader2 } from 'lucide-react'
import CustomerForm from '@/components/customers/CustomerForm'

// Basic RUT formatter and validator
const formatRut = (rut: string): string => {
    // Remove non-alphanumeric
    const clean = rut.replace(/[^0-9kK]/g, '').toUpperCase()
    if (clean.length < 2) return clean

    const body = clean.slice(0, -1)
    const dv = clean.slice(-1)

    // Format body with dots
    let formattedBody = ''
    for (let i = body.length - 1, j = 0; i >= 0; i--, j++) {
        formattedBody = body.charAt(i) + formattedBody
        if (j % 3 === 2 && i > 0) {
            formattedBody = '.' + formattedBody
        }
    }

    return `${formattedBody}-${dv}`
}

const validateRut = (rut: string): boolean => {
    const clean = rut.replace(/[^0-9kK]/g, '').toUpperCase()
    if (clean.length < 2) return false

    const body = clean.slice(0, -1)
    const dv = clean.slice(-1)

    if (!/^\d+$/.test(body)) return false

    let sum = 0
    let multiplier = 2

    for (let i = body.length - 1; i >= 0; i--) {
        sum += parseInt(body.charAt(i)) * multiplier
        multiplier = multiplier < 7 ? multiplier + 1 : 2
    }

    const remainder = 11 - (sum % 11)
    const calculatedDv = remainder === 11 ? '0' : remainder === 10 ? 'K' : remainder.toString()

    return dv === calculatedDv
}

export default function CustomersPage() {
    const [customers, setCustomers] = useState<Customer[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('')

    // Dialog state
    const [open, setOpen] = useState(false)
    const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
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
        loadCustomers()
    }, [])

    const loadCustomers = async () => {
        setLoading(true)
        try {
            const data = await getCustomers()
            setCustomers(data)
        } catch (error) {
            console.error(error)
            toast.error(getApiErrorMessage(error, 'Error al cargar clientes'))
        } finally {
            setLoading(false)
        }
    }

    const filteredCustomers = customers.filter(c =>
        c.razon_social.toLowerCase().includes(filter.toLowerCase()) ||
        c.rut.includes(filter)
    )

    const handleOpenCreate = () => {
        setEditingCustomer(null)
        setFormData({
            rut: '',
            razon_social: '',
            giro: '',
            direccion: '',
            comuna: '',
            ciudad: '',
            email: ''
        })
        setOpen(true)
    }

    const handleOpenEdit = (customer: Customer) => {
        setEditingCustomer(customer)
        setFormData({
            rut: customer.rut,
            razon_social: customer.razon_social,
            giro: customer.giro || '',
            direccion: customer.direccion || '',
            comuna: customer.comuna || '',
            ciudad: customer.ciudad || '',
            email: customer.email || ''
        })
        setOpen(true)
    }

    const handleSave = async () => {
        if (!formData.rut.trim() || !formData.razon_social.trim()) {
            toast.error('RUT y Razón Social son obligatorios')
            return
        }

        if (!validateRut(formData.rut)) {
            toast.error('RUT inválido')
            return
        }

        setSaving(true)
        try {
            // Clean RUT before sending (standardize to XXXXXXXX-X, dots are fine but let's be safe)
            // Actually backend handles dots stripping, so we can send as is or clean. 
            // Let's send clean for consistency if needed, but display format is with dots.
            // The validator in backend strips dots, so formatted is OK.

            if (editingCustomer) {
                // Update
                const updated = await updateCustomer(editingCustomer.rut, formData)
                setCustomers(customers.map(c => c.id === updated.id ? updated : c))
                toast.success('Cliente actualizado')
            } else {
                // Create
                const created = await createCustomer(formData)
                setCustomers([...customers, created])
                toast.success('Cliente creado')
            }
            setOpen(false)
        } catch (error: any) {
            console.error(error)
            const msg = error.response?.data?.detail || 'Error al guardar cliente'
            toast.error(msg)
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async (customer: Customer) => {
        if (!confirm(`¿Eliminar cliente ${customer.razon_social}?`)) return

        try {
            await deleteCustomer(customer.rut)
            setCustomers(customers.filter(c => c.id !== customer.id))
            toast.success('Cliente eliminado')
        } catch (error) {
            console.error(error)
            toast.error('Error al eliminar cliente')
        }
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
                    <p className="text-muted-foreground">Gestiona tus clientes y contribuyentes.</p>
                </div>
                <Button onClick={handleOpenCreate} className="bg-blue-600 hover:bg-blue-700">
                    <Plus className="mr-2 h-4 w-4" /> Nuevo Cliente
                </Button>
            </div>

            <div className="flex items-center gap-2 max-w-sm">
                <Search className="h-4 w-4 text-slate-500" />
                <Input
                    placeholder="Buscar por RUT o Nombre..."
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="h-9"
                />
            </div>

            <div className="border rounded-lg bg-white dark:bg-slate-950 shadow-sm overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[120px]">RUT</TableHead>
                            <TableHead>Razón Social</TableHead>
                            <TableHead className="hidden md:table-cell">Giro</TableHead>
                            <TableHead className="hidden md:table-cell">Email</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center">
                                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-slate-400" />
                                </TableCell>
                            </TableRow>
                        ) : filteredCustomers.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                    No se encontraron clientes.
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredCustomers.map((customer) => (
                                <TableRow key={customer.id}>
                                    <TableCell className="font-mono text-xs font-medium">{customer.rut}</TableCell>
                                    <TableCell className="font-medium">
                                        <div className="flex flex-col">
                                            <span>{customer.razon_social}</span>
                                            <span className="md:hidden text-xs text-muted-foreground">{customer.giro}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground truncate max-w-[200px]" title={customer.giro || ''}>
                                        {customer.giro}
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                                        {customer.email}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleOpenEdit(customer)}
                                                className="h-8 w-8 p-0"
                                            >
                                                <Pencil className="h-4 w-4 text-blue-600" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleDelete(customer)}
                                                className="h-8 w-8 p-0"
                                            >
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
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingCustomer ? 'Editar Cliente' : 'Nuevo Cliente'}</DialogTitle>
                    </DialogHeader>
                    <CustomerForm
                        initialData={editingCustomer ? {
                            rut: editingCustomer.rut,
                            razon_social: editingCustomer.razon_social,
                            giro: editingCustomer.giro || '',
                            direccion: editingCustomer.direccion || '',
                            comuna: editingCustomer.comuna || '',
                            ciudad: editingCustomer.ciudad || '',
                            email: editingCustomer.email || ''
                        } : undefined}
                        onSubmit={async (data) => {
                            // Adapter for format mismatch if any
                            // Our handleSave uses state, let's adapt it or refactor handleSave to accept data
                            // Ideally refactor handleSave to accept data.
                            // For now, let's just update state and call handleSave, OR just call the logic here.

                            // Re-implement save logic here to avoid state coupling issues
                            try {
                                if (editingCustomer) {
                                    const updated = await updateCustomer(editingCustomer.rut, data)
                                    setCustomers(customers.map(c => c.id === updated.id ? updated : c))
                                    toast.success('Cliente actualizado')
                                } else {
                                    const created = await createCustomer(data)
                                    setCustomers([...customers, created])
                                    toast.success('Cliente creado')
                                }
                                setOpen(false)
                            } catch (error: any) {
                                console.error(error)
                                const msg = error.response?.data?.detail || 'Error al guardar cliente'
                                toast.error(msg)
                            }
                        }}
                        onCancel={() => setOpen(false)}
                        isEditing={!!editingCustomer}
                    />
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
