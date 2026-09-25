'use client'

import { useState, useEffect, useMemo } from 'react'
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
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/ui/search-input'
import { getCustomers, createCustomer, updateCustomer, deleteCustomer, Customer, CustomerCreate } from '@/services/customers'
import { getApiErrorMessage, getApiErrorDetail } from '@/services/api'
import { avisar } from '@/lib/store/uiStore'
import { Pencil, Trash2, Plus, Globe } from 'lucide-react'
import CustomerForm from '@/components/customers/CustomerForm'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'

export default function CustomersPage() {
    const [customers, setCustomers] = useState<Customer[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('')

    // Dialog state
    const [open, setOpen] = useState(false)
    const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
    const initialData = useMemo<CustomerCreate | undefined>(() => editingCustomer ? {
        rut: editingCustomer.rut,
        razon_social: editingCustomer.razon_social,
        giro: editingCustomer.giro || '',
        direccion: editingCustomer.direccion || '',
        comuna: editingCustomer.comuna || '',
        ciudad: editingCustomer.ciudad || '',
        email: editingCustomer.email || ''
    } : undefined, [editingCustomer])

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
            avisar(getApiErrorMessage(error, 'Error al cargar clientes'), { reintentar: loadCustomers })
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
        setOpen(true)
    }

    const handleOpenEdit = (customer: Customer) => {
        setEditingCustomer(customer)
        setOpen(true)
    }

    // Si falla, CustomerForm muestra el error dentro del diálogo.
    const handleSave = async (data: CustomerCreate) => {
        if (editingCustomer) {
            const updated = await updateCustomer(editingCustomer.rut, data)
            setCustomers(customers.map(c => c.id === updated.id ? updated : c))
        } else {
            const created = await createCustomer(data)
            setCustomers([...customers, created])
        }
        setOpen(false)
    }

    const [toDelete, setToDelete] = useState<Customer | null>(null)

    const handleDelete = async (customer: Customer) => {
        try {
            await deleteCustomer(customer.rut)
            setCustomers(customers.filter(c => c.id !== customer.id))
        } catch (error) {
            console.error(error)
            avisar(getApiErrorDetail(error, 'No se pudo eliminar el cliente.'))
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
                        <Plus className="h-4 w-4" /> Nuevo Cliente
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
                        initialData={initialData}
                        onSubmit={handleSave}
                        onCancel={() => setOpen(false)}
                        isEditing={!!editingCustomer}
                    />
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
