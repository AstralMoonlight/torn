'use client'

import { useState, useEffect } from 'react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableEmpty,
} from '@/components/ui/table'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { getCustomers, createCustomer, updateCustomer, deleteCustomer, Customer, CustomerCreate } from '@/services/customers'
import { getApiErrorMessage, getApiErrorDetail } from '@/services/api'
import { toast } from 'sonner'
import { Pencil, Trash2, Plus, Loader2, Globe } from 'lucide-react'
import CustomerForm from '@/components/customers/CustomerForm'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'

// Basic RUT validator
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
        } catch (error) {
            console.error(error)
            const msg = getApiErrorDetail(error, 'Error al guardar cliente')
            toast.error(msg)
        } finally {
            setSaving(false)
        }
    }

    const [toDelete, setToDelete] = useState<Customer | null>(null)

    const handleDelete = async (customer: Customer) => {
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
        <PageContainer>
            <PageHeader
                icon={Globe}
                title="Clientes"
                description="Gestiona tus clientes y contribuyentes."
                actions={
                    <Button onClick={handleOpenCreate}>
                        <Plus className="mr-2 h-4 w-4" /> Nuevo Cliente
                    </Button>
                }
            />

            <SearchInput data-section="clientes.buscador" className="max-w-sm" placeholder="Buscar por RUT o Nombre..." value={filter} onChange={(e) => setFilter(e.target.value)} />

            <div data-section="clientes.tabla" className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
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
                            <TableEmpty colSpan={5} loading />
                        ) : filteredCustomers.length === 0 ? (
                            <TableEmpty colSpan={5}>No se encontraron clientes.</TableEmpty>
                        ) : (
                            filteredCustomers.map((customer) => (
                                <TableRow key={customer.id} className="hover:bg-accent/50 transition-colors">
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
                                        <div className="flex justify-end gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleOpenEdit(customer)}
                                                className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                title="Editar"
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => setToDelete(customer)}
                                                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                                title="Eliminar"
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

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent data-section="clientes.formulario" className="sm:max-w-lg">
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
                            } catch (error) {
                                console.error(error)
                                const msg = getApiErrorDetail(error, 'Error al guardar cliente')
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
                        <Button onClick={handleSave} disabled={saving} className="">
                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Guardar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <ConfirmDialog
                open={!!toDelete}
                onOpenChange={(o) => !o && setToDelete(null)}
                title="¿Eliminar cliente?"
                description={toDelete?.razon_social}
                onConfirm={async () => { if (toDelete) await handleDelete(toDelete) }}
            />
        </PageContainer>
    )
}
