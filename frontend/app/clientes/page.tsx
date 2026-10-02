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
import { AccionFila } from '@/components/ui/accion-fila'
import { getCustomers, createCustomer, updateCustomer, deleteCustomer, Customer, CustomerCreate } from '@/services/customers'
import { getPriceLists } from '@/services/price_lists'
import { getPanel, type Deudor } from '@/services/reports'
import { getApiErrorMessage, getApiErrorDetail } from '@/services/api'
import { avisar } from '@/lib/store/uiStore'
import { useEsAdmin } from '@/lib/store/sessionStore'
import { Trash2, Plus, Wallet } from 'lucide-react'
import CustomerForm from '@/components/customers/CustomerForm'
import CuentaClienteDialog from '@/components/customers/CuentaClienteDialog'
import { formatCLP } from '@/lib/format'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import ListToolbar from '@/components/layout/ListToolbar'
import Resumen from '@/components/layout/Resumen'
import FiltrosRapidos from '@/components/layout/FiltrosRapidos'
import Estado from '@/components/layout/Estado'

type Filtro = 'todos' | 'deuda' | 'vencida' | 'lista'

export default function CustomersPage() {
    const [customers, setCustomers] = useState<Customer[]>([])
    const [listas, setListas] = useState<Map<number, string>>(new Map())
    // Deuda vencida de cada cliente (por RUT). Viene del panel, que pide permiso de Dashboard:
    // sin él, la pantalla funciona igual pero sin distinguir lo vencido.
    const [vencidos, setVencidos] = useState<Map<string, Deudor>>(new Map())
    const [totalVencido, setTotalVencido] = useState<number | null>(null)
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('')
    const [filtro, setFiltro] = useState<Filtro>('todos')
    const [cuentaDe, setCuentaDe] = useState<Customer | null>(null)
    // Eliminar lo pide el personal a administración; editar y crear, no.
    const esAdmin = useEsAdmin()

    const [open, setOpen] = useState(false)
    const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
    const initialData = useMemo<CustomerCreate | undefined>(() => editingCustomer ? {
        rut: editingCustomer.rut,
        razon_social: editingCustomer.razon_social,
        giro: editingCustomer.giro || '',
        direccion: editingCustomer.direccion || '',
        comuna: editingCustomer.comuna || '',
        ciudad: editingCustomer.ciudad || '',
        email: editingCustomer.email || '',
        dias_credito: editingCustomer.dias_credito,
    } : undefined, [editingCustomer])

    const loadCustomers = async () => {
        setLoading(true)
        try {
            setCustomers(await getCustomers())
        } catch (error) {
            console.error(error)
            avisar(getApiErrorMessage(error, 'Error al cargar clientes'), { reintentar: loadCustomers })
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        loadCustomers()
        getPriceLists().then((ls) => setListas(new Map(ls.map((l) => [l.id, l.name])))).catch(() => null)
        getPanel()
            .then(({ cobranza }) => {
                setVencidos(new Map(cobranza.deudores.filter((d) => d.vencido > 0).map((d) => [d.rut, d])))
                setTotalVencido(cobranza.vencido)
            })
            .catch(() => null)
    }, [])

    const deuda = (c: Customer) => Number(c.current_balance)
    const conDeuda = customers.filter((c) => deuda(c) > 0)
    const conVencida = customers.filter((c) => vencidos.has(c.rut))
    const conLista = customers.filter((c) => c.price_list_id)
    const totalDeuda = conDeuda.reduce((t, c) => t + deuda(c), 0)

    const base = { todos: customers, deuda: conDeuda, vencida: conVencida, lista: conLista }[filtro]
    const q = filter.trim().toLowerCase()
    const filteredCustomers = q
        ? base.filter((c) => c.razon_social.toLowerCase().includes(q) || c.rut.includes(filter.trim()))
        : base

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

    const mayorVencido = [...vencidos.values()].sort((a, b) => b.vencido - a.vencido)[0]

    return (
        <PageContainer>
            <PageHeader
                title="Clientes"
                description="Personas y empresas a las que les facturas o les vendes a crédito."
                actions={
                    <Button onClick={handleOpenCreate} className="h-11 text-base">
                        <Plus className="h-4 w-4" /> Agregar cliente
                    </Button>
                }
            />

            {!loading && (
                <Resumen datos={[
                    {
                        etiqueta: 'Te deben',
                        valor: formatCLP(totalDeuda),
                        nota: conDeuda.length ? `Entre ${conDeuda.length} ${conDeuda.length === 1 ? 'cliente' : 'clientes'}` : 'Nadie te debe',
                    },
                    ...(totalVencido !== null ? [{
                        etiqueta: 'Ya pasó su plazo',
                        valor: formatCLP(totalVencido),
                        nota: mayorVencido ? `La mayor: ${mayorVencido.razon_social}, con ${mayorVencido.dias} días de atraso` : 'Nadie está atrasado',
                        tono: totalVencido > 0 ? 'mal' as const : undefined,
                    }] : []),
                    {
                        etiqueta: 'Clientes',
                        valor: customers.length,
                        nota: `${conLista.length} con lista de precios`,
                    },
                ]} />
            )}

            <ListToolbar
                busqueda={filter}
                onBusqueda={setFilter}
                placeholder="Nombre o RUT"
                visibles={filteredCustomers.length}
                total={base.length}
                unidad="clientes"
                filtros={
                    <FiltrosRapidos
                        etiqueta="Filtrar clientes"
                        valor={filtro}
                        onChange={setFiltro}
                        opciones={[
                            { valor: 'todos', etiqueta: 'Todos', n: customers.length },
                            { valor: 'deuda', etiqueta: 'Con deuda', n: conDeuda.length },
                            ...(totalVencido !== null ? [{ valor: 'vencida' as const, etiqueta: 'Deuda vencida', n: conVencida.length, peligro: conVencida.length > 0 }] : []),
                            { valor: 'lista', etiqueta: 'Con lista de precios', n: conLista.length },
                        ]}
                    />
                }
            />

            <div data-section="clientes.tabla" className="bg-card rounded-xl border border-border overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Cliente</TableHead>
                            <TableHead className="hidden lg:table-cell">Lista de precios</TableHead>
                            <TableHead className="text-right">Deuda</TableHead>
                            <TableHead><span className="sr-only">Acciones</span></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableEmpty colSpan={4} loading />
                        ) : filteredCustomers.length === 0 ? (
                            <TableEmpty colSpan={4}>
                                {q ? 'Ningún cliente coincide con la búsqueda.' : customers.length === 0 ? 'Todavía no hay clientes. Agrega el primero.' : 'No hay clientes en este filtro.'}
                            </TableEmpty>
                        ) : (
                            filteredCustomers.map((customer) => {
                                const debe = deuda(customer)
                                const vencido = vencidos.get(customer.rut)
                                return (
                                    <TableRow key={customer.id}>
                                        <TableCell className="text-[15px]">
                                            <p className="font-medium text-foreground">{customer.razon_social}</p>
                                            <p className="text-sm text-muted-foreground">{[customer.rut, customer.giro].filter(Boolean).join(', ')}</p>
                                        </TableCell>
                                        <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                                            {customer.price_list_id ? listas.get(customer.price_list_id) ?? 'Lista asignada' : 'Sin lista'}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {debe > 0 ? (
                                                <>
                                                    <p className="text-[15px] font-semibold text-foreground font-tabular">{formatCLP(debe)}</p>
                                                    {vencido
                                                        ? <Estado tono="mal" className="mt-0.5">Lleva {vencido.dias} días de atraso</Estado>
                                                        : customer.dias_credito ? <p className="text-sm text-muted-foreground">Plazo de {customer.dias_credito} días</p> : null}
                                                </>
                                            ) : (
                                                <Estado tono="bien">Al día</Estado>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center justify-end gap-1">
                                                {debe > 0
                                                    ? <Button variant="outline" size="sm" onClick={() => setCuentaDe(customer)}>Registrar pago</Button>
                                                    : <AccionFila icon={Wallet} label="Cuenta y pagos" onClick={() => setCuentaDe(customer)} />}
                                                <Button variant="outline" size="sm" onClick={() => handleOpenEdit(customer)}>Editar</Button>
                                                {esAdmin && <AccionFila icon={Trash2} label="Eliminar" onClick={() => setToDelete(customer)} peligro />}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent data-section="clientes.formulario" className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingCustomer ? 'Editar cliente' : 'Agregar cliente'}</DialogTitle>
                    </DialogHeader>
                    <CustomerForm
                        initialData={initialData}
                        onSubmit={handleSave}
                        onCancel={() => setOpen(false)}
                        isEditing={!!editingCustomer}
                    />
                </DialogContent>
            </Dialog>
            <CuentaClienteDialog
                customer={cuentaDe}
                onClose={(actualizado) => {
                    setCuentaDe(null)
                    if (actualizado) setCustomers(customers.map(c => c.id === actualizado.id ? actualizado : c))
                }}
            />
            <ConfirmDialog
                open={!!toDelete}
                onOpenChange={(o) => !o && setToDelete(null)}
                title="¿Eliminar cliente?"
                description={toDelete ? `${toDelete.razon_social}. Deja de aparecer en la lista; sus ventas se conservan.` : undefined}
                onConfirm={async () => { if (toDelete) await handleDelete(toDelete) }}
            />
        </PageContainer>
    )
}
