'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { getTenants, createTenant, updateTenant, deleteTenant, type Tenant } from '@/services/saas'
import { getApiErrorMessage } from '@/services/api'
import { Badge } from '@/components/ui/badge'
import { Building2, ArrowLeft, Plus, Loader2, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Search, Info, X as CloseIcon, AlertTriangle } from 'lucide-react'
import { validateRut, formatRut } from '@/lib/rut'
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Switch } from '@/components/ui/switch'

export default function TenantsListPage() {
    const router = useRouter()
    const [tenants, setTenants] = useState<Tenant[]>([])
    const [loading, setLoading] = useState(true)
    const [isCreating, setIsCreating] = useState(false)
    const [openModal, setOpenModal] = useState(false)
    const [editingTenantId, setEditingTenantId] = useState<number | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)
    const [tenantToDelete, setTenantToDelete] = useState<number | null>(null)
    const [tenantSearch, setTenantSearch] = useState('')

    const [formData, setFormData] = useState({
        name: '',
        rut: '',
        address: '',
        commune: '',
        city: '',
        giro: '',
        billing_day: 1,
        economic_activities: [] as any[]
    })
    const [actecoSearch, setActecoSearch] = useState('')

    // Lista de referencia ACTECO (SII)
    const ACTECO_LIST = [
        { code: "464903", name: "Venta al por mayor de artículos de perfumería, tocador y cosméticos", category: "1ra", taxable: true },
        { code: "465909", name: "Venta al por mayor de otros tipos de maquinaria y equipo n.c.p.", category: "1ra", taxable: true },
        { code: "477201", name: "Venta al por menor de productos farmacéuticos y medicinales", category: "1ra", taxable: true },
        { code: "477399", name: "Venta al por menor de otros productos n.c.p. en comercios especializados", category: "1ra", taxable: true },
        { code: "620100", name: "Actividades de programación informática", category: "2da", taxable: false },
        { code: "620200", name: "Consultoría de informática y de gestión de instalaciones", category: "2da", taxable: false },
        { code: "702000", name: "Actividades de consultoría de gestión", category: "2da", taxable: false },
        { code: "471110", name: "Venta al por menor en comercios de alimentos, bebidas o tabaco (Supermercados)", category: "1ra", taxable: true },
        { code: "471900", name: "Otras empresas de venta al por menor en comercios no especializados", category: "1ra", taxable: true },
    ]

    const filteredActecos = ACTECO_LIST.filter(a =>
        a.name.toLowerCase().includes(actecoSearch.toLowerCase()) ||
        a.code.includes(actecoSearch)
    )

    const filteredTenants = tenants.filter(t =>
        t.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
        (t.rut && t.rut.toLowerCase().includes(tenantSearch.toLowerCase())) ||
        t.schema_name.toLowerCase().includes(tenantSearch.toLowerCase())
    )

    const toggleActeco = (acteco: any) => {
        const exists = formData.economic_activities.find(a => a.code === acteco.code)
        if (exists) {
            setFormData({
                ...formData,
                economic_activities: formData.economic_activities.filter(a => a.code !== acteco.code)
            })
        } else {
            setFormData({
                ...formData,
                economic_activities: [...formData.economic_activities, acteco]
            })
        }
    }

    useEffect(() => {
        fetchTenants()
    }, [])

    const fetchTenants = () => {
        setLoading(true)
        getTenants()
            .then(setTenants)
            .catch(err => toast.error(getApiErrorMessage(err, 'Error cargando las empresas')))
            .finally(() => setLoading(false))
    }

    const openCreateModal = () => {
        setEditingTenantId(null)
        setFormData({
            name: '',
            rut: '',
            address: '',
            commune: '',
            city: '',
            giro: '',
            billing_day: 1,
            economic_activities: []
        })
        setOpenModal(true)
    }

    const openEditModal = (tenant: Tenant) => {
        setEditingTenantId(tenant.id)
        setFormData({
            name: tenant.name || '',
            rut: tenant.rut || '',
            address: tenant.address || '',
            commune: tenant.commune || '',
            city: tenant.city || '',
            giro: tenant.giro || '',
            billing_day: tenant.billing_day || 1,
            economic_activities: tenant.economic_activities || []
        })
        setOpenModal(true)
    }

    const handleSaveTenant = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!formData.name || !formData.rut) {
            toast.error("El nombre y RUT son requeridos")
            return
        }

        if (!validateRut(formData.rut)) {
            toast.error("El formato del RUT ingresado no es válido")
            return
        }

        setIsCreating(true)
        try {
            const payload = {
                ...formData,
                rut: formatRut(formData.rut)
            }

            if (editingTenantId) {
                await updateTenant(editingTenantId, payload)
                toast.success("Empresa actualizada con éxito")
            } else {
                await createTenant(payload)
                toast.success("Empresa creada con éxito")
            }

            setOpenModal(false)
            fetchTenants()
        } catch (error) {
            toast.error(getApiErrorMessage(error, editingTenantId ? 'Error al actualizar' : 'Error al provisionar'))
        } finally {
            setIsCreating(false)
        }
    }

    const handleDeleteTenant = async () => {
        if (!tenantToDelete) return

        setIsDeleting(true)
        try {
            await deleteTenant(tenantToDelete)
            toast.success("Empresa desactivada")
            setTenantToDelete(null)
            fetchTenants()
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Error al desactivar empresa'))
        } finally {
            setIsDeleting(false)
        }
    }

    const handleToggleStatus = async (tenant: Tenant, newStatus: boolean) => {
        try {
            await updateTenant(tenant.id, { is_active: newStatus })
            setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, is_active: newStatus } : t))
            toast.success(`Empresa ${newStatus ? 'activada' : 'desactivada'}`)
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Error al cambiar estado'))
        }
    }

    return (
        <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 p-6 md:p-12">
            <div className="max-w-5xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <Link href="/saas-admin" className="inline-flex items-center text-sm font-medium text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Volver al Panel
                        </Link>
                        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-white flex items-center gap-3">
                            <Building2 className="h-8 w-8 text-blue-600" />
                            Gestión de Empresas
                        </h1>
                    </div>

                    <Button
                        onClick={openCreateModal}
                        className="bg-blue-600 hover:bg-blue-700 text-white cursor-pointer shadow-sm shadow-blue-600/20"
                    >
                        <Plus className="mr-2 h-4 w-4" /> Crear nuevo Tenant
                    </Button>

                    <Dialog open={openModal} onOpenChange={setOpenModal}>
                        <DialogContent className="sm:max-w-2xl bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle className="text-xl">
                                    {editingTenantId ? 'Editar Empresa' : 'Crear nuevo Tenant'}
                                </DialogTitle>
                                <DialogDescription className="text-neutral-500">
                                    {editingTenantId ? 'Actualiza los datos de facturación y configuración de la empresa.' : 'Ingresa los datos para provisionar una nueva instancia separada para tu cliente.'}
                                </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleSaveTenant} className="space-y-6 py-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Nombre de la Empresa</Label>
                                        <Input
                                            placeholder="Ej. Comercializadora SpA"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            required
                                            autoFocus
                                            className="border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>RUT Empresa</Label>
                                        <Input
                                            placeholder="Ej. 76.543.210-K"
                                            value={formData.rut}
                                            onChange={e => setFormData({ ...formData, rut: e.target.value })}
                                            required
                                            className="border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500 font-mono"
                                        />
                                    </div>
                                    <div className="space-y-2 md:col-span-2">
                                        <Label>Giro Comercial</Label>
                                        <Input
                                            placeholder="Ej. VENTA AL POR MENOR DE PRODUCTOS FARMACEUTICOS..."
                                            value={formData.giro}
                                            onChange={e => setFormData({ ...formData, giro: e.target.value })}
                                            className="border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Dirección Casa Matriz</Label>
                                        <Input
                                            placeholder="Ej. Av. Principal 123"
                                            value={formData.address}
                                            onChange={e => setFormData({ ...formData, address: e.target.value })}
                                            className="border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-2">
                                            <Label>Comuna</Label>
                                            <Input
                                                placeholder="Santiago"
                                                value={formData.commune}
                                                onChange={e => setFormData({ ...formData, commune: e.target.value })}
                                                className="border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Ciudad</Label>
                                            <Input
                                                placeholder="Santiago"
                                                value={formData.city}
                                                onChange={e => setFormData({ ...formData, city: e.target.value })}
                                                className="border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Día de Pago Mensual</Label>
                                        <Select
                                            value={formData.billing_day.toString()}
                                            onValueChange={v => setFormData({ ...formData, billing_day: parseInt(v) })}
                                        >
                                            <SelectTrigger className="border-neutral-200 dark:border-neutral-800">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800">
                                                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                                                    <SelectItem key={day} value={day.toString()} className="cursor-pointer">
                                                        Día {day}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-[10px] text-neutral-500">Día en que se genera la facturación del servicio SaaS.</p>
                                    </div>
                                </div>

                                <div className="space-y-3 p-4 bg-neutral-50 dark:bg-neutral-800/50 rounded-lg border border-neutral-100 dark:border-neutral-800">
                                    <div className="flex items-center justify-between">
                                        <Label className="flex items-center gap-2">
                                            Actividades Económicas (ACTECO)
                                            <Info className="h-3 w-3 text-neutral-400" />
                                        </Label>
                                        <Badge variant="outline" className="text-[10px]">{formData.economic_activities.length} seleccionadas</Badge>
                                    </div>

                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -ms-4 -mt-2 h-4 w-4 text-neutral-400" />
                                        <Input
                                            placeholder="Buscar por código o nombre..."
                                            value={actecoSearch}
                                            onChange={e => setActecoSearch(e.target.value)}
                                            className="pl-9 bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-sm"
                                        />
                                    </div>

                                    <div className="h-32 rounded border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-y-auto">
                                        <div className="p-2 space-y-1">
                                            {filteredActecos.map(acteco => {
                                                const isSelected = formData.economic_activities.find(a => a.code === acteco.code)
                                                return (
                                                    <div
                                                        key={acteco.code}
                                                        onClick={() => toggleActeco(acteco)}
                                                        className={`flex items-center justify-between p-2 rounded text-xs cursor-pointer transition-colors ${isSelected
                                                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                                            : 'hover:bg-neutral-50 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
                                                            }`}
                                                    >
                                                        <div className="flex flex-col">
                                                            <span className="font-bold">{acteco.code}</span>
                                                            <span className="truncate max-w-[300px]">{acteco.name}</span>
                                                        </div>
                                                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        {formData.economic_activities.map(acteco => (
                                            <Badge key={acteco.code} className="bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 flex items-center gap-1">
                                                {acteco.code}
                                                <CloseIcon className="h-3 w-3 cursor-pointer" onClick={() => toggleActeco(acteco)} />
                                            </Badge>
                                        ))}
                                    </div>
                                </div>

                                <div className="pt-2 flex justify-end gap-3">
                                    <Button type="button" variant="outline" onClick={() => setOpenModal(false)} className="border-neutral-200 dark:border-neutral-800">
                                        Cancelar
                                    </Button>
                                    <Button type="submit" disabled={isCreating} className="bg-blue-600 hover:bg-blue-700 cursor-pointer text-white">
                                        {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                        {isCreating
                                            ? (editingTenantId ? 'Guardando...' : 'Provisionando...')
                                            : (editingTenantId ? 'Guardar Cambios' : 'Crear e Inicializar')
                                        }
                                    </Button>
                                </div>
                            </form>
                        </DialogContent>
                    </Dialog>
                </div>

                <div className="flex flex-col md:flex-row items-center gap-4 bg-white dark:bg-neutral-900 p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm">
                    <div className="relative flex-1 w-full">
                        <Search className="absolute left-3 top-1/2 -ms-4 -mt-2 h-4 w-4 text-neutral-400" />
                        <Input
                            placeholder="Buscar por nombre, RUT o esquema..."
                            value={tenantSearch}
                            onChange={e => setTenantSearch(e.target.value)}
                            className="pl-9 border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500 h-11"
                        />
                        {tenantSearch && (
                            <button
                                onClick={() => setTenantSearch('')}
                                className="absolute right-3 top-1/2 -mt-2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                            >
                                <CloseIcon className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                    <div className="text-sm text-neutral-500 font-medium">
                        {filteredTenants.length} de {tenants.length} empresas
                    </div>
                </div>

                {/* Table */}
                <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left relative">
                            <thead className="text-xs text-neutral-500 uppercase bg-neutral-50/50 dark:bg-neutral-900/50 dark:text-neutral-400 border-b border-neutral-200 dark:border-neutral-800">
                                <tr>
                                    <th className="px-6 py-4 font-medium">Empresa</th>
                                    <th className="px-6 py-4 font-medium">RUT</th>
                                    <th className="px-6 py-4 font-medium">Esquema BD</th>
                                    <th className="px-6 py-4 font-medium">Estado</th>
                                    <th className="px-6 py-4 font-medium text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && (
                                    Array(3).fill(0).map((_, i) => (
                                        <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800/50 bg-white dark:bg-neutral-900">
                                            <td className="px-6 py-4"><Skeleton className="h-4 w-[250px]" /></td>
                                            <td className="px-6 py-4"><Skeleton className="h-4 w-[100px]" /></td>
                                            <td className="px-6 py-4"><Skeleton className="h-4 w-[120px]" /></td>
                                            <td className="px-6 py-4"><Skeleton className="h-4 w-[60px]" /></td>
                                            <td className="px-6 py-4" />
                                        </tr>
                                    ))
                                )}

                                {!loading && filteredTenants.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-12 text-center text-neutral-500">
                                            {tenantSearch ? 'No se encontraron empresas que coincidan con la búsqueda' : 'No hay empresas registradas'}
                                        </td>
                                    </tr>
                                )}

                                {!loading && filteredTenants.map((tenant) => (
                                    <tr key={tenant.id} className="border-b border-neutral-100 dark:border-neutral-800/50 hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30 transition-colors">
                                        <td className="px-6 py-4 font-medium text-neutral-900 dark:text-neutral-100">
                                            {tenant.name}
                                        </td>
                                        <td className="px-6 py-4 text-neutral-500 dark:text-neutral-400 font-mono">
                                            {tenant.rut || '-'}
                                        </td>
                                        <td className="px-6 py-4 text-neutral-500 dark:text-neutral-400 font-mono text-xs">
                                            {tenant.schema_name}
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <Switch
                                                    checked={tenant.is_active}
                                                    onCheckedChange={(checked: boolean) => handleToggleStatus(tenant, checked)}
                                                />
                                                <span className={cn(
                                                    "text-[10px] font-bold uppercase tracking-wider",
                                                    tenant.is_active ? "text-emerald-600" : "text-neutral-400"
                                                )}>
                                                    {tenant.is_active ? 'Activo' : 'Inactivo'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => openEditModal(tenant)}
                                                    className="h-8 w-8 text-neutral-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer"
                                                    title="Editar datos"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>

                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => setTenantToDelete(tenant.id)}
                                                    className="h-8 w-8 text-neutral-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 cursor-pointer"
                                                    disabled={!tenant.is_active}
                                                    title="Desactivar"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>

                                                <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-800 mx-1" />

                                                <Link href={`/saas-admin/tenants/${tenant.id}`}>
                                                    <Button variant="ghost" size="sm" className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer">
                                                        Gestionar
                                                    </Button>
                                                </Link>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Confirm Delete Dialog */}
                <AlertDialog open={!!tenantToDelete} onOpenChange={(open: boolean) => !open && setTenantToDelete(null)}>
                    <AlertDialogContent className="bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800">
                        <AlertDialogHeader>
                            <AlertDialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
                                <AlertTriangle className="h-5 w-5" />
                                ¿Desactivar Empresa?
                            </AlertDialogTitle>
                            <AlertDialogDescription className="text-neutral-500 dark:text-neutral-400">
                                Esta acción marcará a la empresa como inactiva. Los usuarios no podrán iniciar sesión en este tenant hasta que sea reactivado.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel className="border-neutral-200 dark:border-neutral-800">Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={handleDeleteTenant}
                                className="bg-red-600 hover:bg-red-700 text-white"
                                disabled={isDeleting}
                            >
                                {isDeleting ? 'Desactivando...' : 'Sí, desactivar'}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

            </div>
        </div >
    )
}
