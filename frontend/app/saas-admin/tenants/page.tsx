'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { getTenants, createTenant, updateTenant, deleteTenant, searchActecos, type Tenant, type ActecoItem, type EconomicActivity } from '@/services/saas'
import { getApiErrorDetail, getApiErrorMessage } from '@/services/api'
import { Badge } from '@/components/ui/badge'
import { Building2, Plus, Loader2, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { SearchInput } from '@/components/ui/search-input'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import ListToolbar from '@/components/layout/ListToolbar'
import { Button } from '@/components/ui/button'
import { AccionFila } from '@/components/ui/accion-fila'
import { AlertaError } from '@/components/ui/alerta-error'
import { avisar } from '@/lib/store/uiStore'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Info, X as CloseIcon, AlertTriangle } from 'lucide-react'
import { validateRut, formatRut } from '@/lib/rut'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Switch } from '@/components/ui/switch'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableEmpty,
} from '@/components/ui/table'

/** Datos del SII que se copian a dte-torn. Una empresa nueva parte en certificación. */
const SII_VACIO = {
    sii_ambiente: 'CERT' as 'CERT' | 'PROD',
    sii_resolucion_numero: 0,
    sii_resolucion_fecha: '',
    sii_oficina: '',
}

export default function TenantsListPage() {
    const [tenants, setTenants] = useState<Tenant[]>([])
    const [loading, setLoading] = useState(true)
    const [isCreating, setIsCreating] = useState(false)
    const [errorModal, setErrorModal] = useState<string | null>(null)
    const [openModal, setOpenModal] = useState(false)
    const [editingTenantId, setEditingTenantId] = useState<number | null>(null)
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
        economic_activities: [] as EconomicActivity[],
        ...SII_VACIO,
    })
    const [actecoSearch, setActecoSearch] = useState('')
    const [actecoResults, setActecoResults] = useState<ActecoItem[]>([])
    const [actecoSearchLoading, setActecoSearchLoading] = useState(false)

    const filteredTenants = tenants.filter(t =>
        t.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
        (t.rut && t.rut.toLowerCase().includes(tenantSearch.toLowerCase())) ||
        t.schema_name.toLowerCase().includes(tenantSearch.toLowerCase())
    )

    const toggleActeco = (acteco: EconomicActivity) => {
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

    // RUT: true when empty (no error yet) or when the entered value is mathematically valid
    const isRutValid = formData.rut === '' || validateRut(formData.rut)

    const handleRutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.toUpperCase()
        // Strip all forbidden characters; keep digits, dots, dashes and K
        const sanitized = raw.replace(/[^0-9.\-K]/g, '')
        // If the user is typing (length > 1 after clean), apply live formatting
        const clean = sanitized.replace(/[^0-9K]/g, '')
        const formatted = clean.length > 1 ? formatRut(clean) : clean
        setFormData({ ...formData, rut: formatted })
    }

    useEffect(() => {
        fetchTenants()
    }, [])

    // Búsqueda ACTECO con debounce
    useEffect(() => {
        if (!openModal) return
        const t = setTimeout(() => {
            setActecoSearchLoading(true)
            searchActecos(actecoSearch || undefined, 50)
                .then(setActecoResults)
                .catch((err) => {
                    setActecoResults([])
                    setErrorModal(getApiErrorMessage(err, 'Error al buscar actividades económicas'))
                })
                .finally(() => setActecoSearchLoading(false))
        }, 300)
        return () => clearTimeout(t)
    }, [openModal, actecoSearch])

    const fetchTenants = () => {
        setLoading(true)
        getTenants()
            .then(setTenants)
            .catch(err => avisar(getApiErrorMessage(err, 'Error cargando las empresas'), { reintentar: fetchTenants }))
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
            economic_activities: [],
            ...SII_VACIO,
        })
        setErrorModal(null)
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
            economic_activities: tenant.economic_activities || [],
            sii_ambiente: tenant.sii_ambiente,
            sii_resolucion_numero: tenant.sii_resolucion_numero,
            sii_resolucion_fecha: tenant.sii_resolucion_fecha || '',
            sii_oficina: tenant.sii_oficina || '',
        })
        setErrorModal(null)
        setOpenModal(true)
    }

    const handleSaveTenant = async (e: React.FormEvent) => {
        e.preventDefault()
        setErrorModal(null)
        if (!formData.name || !formData.rut) {
            setErrorModal("El nombre y el RUT son obligatorios.")
            return
        }

        if (!validateRut(formData.rut)) {
            setErrorModal("El RUT ingresado no es válido.")
            return
        }

        setIsCreating(true)
        try {
            const payload = {
                ...formData,
                rut: formatRut(formData.rut),
                sii_resolucion_fecha: formData.sii_resolucion_fecha || null,
                sii_oficina: formData.sii_oficina || null,
            }

            if (editingTenantId) {
                await updateTenant(editingTenantId, payload)
            } else {
                await createTenant(payload)
            }

            setOpenModal(false)
            fetchTenants()
        } catch (error) {
            setErrorModal(getApiErrorDetail(error, editingTenantId ? 'No se pudo actualizar la empresa.' : 'No se pudo provisionar la empresa.'))
        } finally {
            setIsCreating(false)
        }
    }

    const handleDeleteTenant = async () => {
        if (!tenantToDelete) return

        try {
            await deleteTenant(tenantToDelete)
            fetchTenants()
        } catch (error) {
            avisar(getApiErrorDetail(error, 'No se pudo desactivar la empresa.'))
        }
    }

    const handleToggleStatus = async (tenant: Tenant, newStatus: boolean) => {
        try {
            await updateTenant(tenant.id, { is_active: newStatus })
            setTenants(prev => prev.map(t => t.id === tenant.id ? { ...t, is_active: newStatus } : t))
        } catch (error) {
            avisar(getApiErrorDetail(error, 'No se pudo cambiar el estado de la empresa.'))
        }
    }

    return (
        <PageContainer>
                <PageHeader
                    icon={Building2}
                    title="Gestión de empresas"
                    volver={{ href: '/saas-admin', label: 'Volver al panel' }}
                    actions={
                        <Button onClick={openCreateModal} className="shadow-sm shadow-primary/20">
                            <Plus className="h-4 w-4" /> Crear nuevo tenant
                        </Button>
                    }
                />

                    <Dialog open={openModal} onOpenChange={setOpenModal}>
                        <DialogContent className="sm:max-w-2xl bg-card border-border max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle className="text-xl">
                                    {editingTenantId ? 'Editar empresa' : 'Crear nuevo tenant'}
                                </DialogTitle>
                                <DialogDescription className="text-muted-foreground">
                                    {editingTenantId ? 'Actualiza los datos de facturación y configuración de la empresa.' : 'Ingresa los datos para provisionar una nueva instancia separada para tu cliente.'}
                                </DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleSaveTenant} className="space-y-6 py-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Nombre de la empresa</Label>
                                        <Input
                                            placeholder="Ej. Comercializadora SpA"
                                            value={formData.name}
                                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            required
                                            autoFocus
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>RUT de la empresa</Label>
                                        <Input
                                            placeholder="Ej. 76.543.210-K"
                                            value={formData.rut}
                                            onChange={handleRutChange}
                                            required
                                            className={`font-mono ${!isRutValid ? 'border-destructive focus-visible:ring-destructive' : ''
                                                }`}
                                        />
                                        {!isRutValid && (
                                            <p className="text-xs text-destructive mt-1">RUT inválido. Verifica el dígito verificador.</p>
                                        )}
                                    </div>
                                    <div className="space-y-2 md:col-span-2">
                                        <Label>Giro comercial</Label>
                                        <Input
                                            placeholder="Ej. VENTA AL POR MENOR DE PRODUCTOS FARMACEUTICOS..."
                                            value={formData.giro}
                                            onChange={e => setFormData({ ...formData, giro: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Dirección casa matriz</Label>
                                        <Input
                                            placeholder="Ej. Av. Principal 123"
                                            value={formData.address}
                                            onChange={e => setFormData({ ...formData, address: e.target.value })}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="space-y-2">
                                            <Label>Comuna</Label>
                                            <Input
                                                placeholder="Santiago"
                                                value={formData.commune}
                                                onChange={e => setFormData({ ...formData, commune: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Ciudad</Label>
                                            <Input
                                                placeholder="Santiago"
                                                value={formData.city}
                                                onChange={e => setFormData({ ...formData, city: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Día de pago mensual</Label>
                                        <Select
                                            value={formData.billing_day.toString()}
                                            onValueChange={v => setFormData({ ...formData, billing_day: parseInt(v) })}
                                        >
                                            <SelectTrigger>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="bg-card border-border">
                                                {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                                                    <SelectItem key={day} value={day.toString()} className="cursor-pointer">
                                                        Día {day}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <p className="text-xs text-muted-foreground">Día en que se genera la facturación del servicio SaaS.</p>
                                    </div>

                                    {editingTenantId && (
                                        <div className="space-y-4 p-4 bg-muted rounded-lg border border-border">
                                            <div>
                                                <Label>Facturación electrónica (SII)</Label>
                                                <p className="text-xs text-muted-foreground mt-1">
                                                    Resolución y ambiente con que el SII autorizó a la empresa. Van impresos bajo el timbre.
                                                </p>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label>Ambiente</Label>
                                                    <Select
                                                        value={formData.sii_ambiente}
                                                        onValueChange={v => setFormData({ ...formData, sii_ambiente: v as 'CERT' | 'PROD' })}
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent className="bg-card border-border">
                                                            <SelectItem value="CERT">Certificación</SelectItem>
                                                            <SelectItem value="PROD">Producción</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Unidad del SII</Label>
                                                    <Input
                                                        placeholder="S.I.I. - CONCEPCION"
                                                        maxLength={60}
                                                        value={formData.sii_oficina}
                                                        onChange={e => setFormData({ ...formData, sii_oficina: e.target.value })}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>N° de resolución</Label>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        value={formData.sii_resolucion_numero}
                                                        onChange={e => setFormData({ ...formData, sii_resolucion_numero: parseInt(e.target.value) || 0 })}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label>Fecha de resolución</Label>
                                                    <Input
                                                        type="date"
                                                        value={formData.sii_resolucion_fecha}
                                                        onChange={e => setFormData({ ...formData, sii_resolucion_fecha: e.target.value })}
                                                    />
                                                </div>
                                            </div>
                                            {formData.sii_ambiente === 'PROD' && (
                                                <p className="text-xs text-destructive flex items-center gap-1">
                                                    <AlertTriangle className="h-3.5 w-3.5" /> En producción cada documento emitido es tributariamente válido.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-3 p-4 bg-muted rounded-lg border border-border">
                                    <div className="flex items-center justify-between">
                                        <Label className="flex items-center gap-2">
                                            Actividades económicas (ACTECO)
                                            <Info className="h-3 w-3 text-muted-foreground" />
                                        </Label>
                                        <Badge variant="outline" className="text-xs">{formData.economic_activities.length} seleccionadas</Badge>
                                    </div>

                                    <SearchInput placeholder="Buscar por código o nombre..." value={actecoSearch} onChange={e => setActecoSearch(e.target.value)} />

                                    <div className="h-32 rounded border border-border bg-card overflow-y-auto">
                                        <div className="p-2 space-y-1">
                                            {actecoSearchLoading ? (
                                                <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
                                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                                    Buscando...
                                                </div>
                                            ) : actecoResults.length === 0 ? (
                                                <div className="py-6 text-center text-muted-foreground text-sm">
                                                    {actecoSearch.trim() ? 'Sin resultados. Escribe código o nombre.' : 'Escribe para buscar por código o nombre (ACTECO SII).'}
                                                </div>
                                            ) : (
                                                actecoResults.map(acteco => {
                                                    const isSelected = formData.economic_activities.some((a) => a.code === acteco.code)
                                                    return (
                                                        <div
                                                            key={acteco.code}
                                                            onClick={() => toggleActeco(acteco)}
                                                            className={`flex items-center justify-between p-2 rounded text-xs cursor-pointer transition-colors ${isSelected
                                                                ? 'bg-primary/10 text-primary'
                                                                : 'hover:bg-accent text-muted-foreground dark:text-muted-foreground'
                                                                }`}
                                                        >
                                                            <div className="flex flex-col">
                                                                <span className="font-bold">{acteco.code}</span>
                                                                <span className="truncate max-w-[300px]">{acteco.name}</span>
                                                            </div>
                                                            {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                                                        </div>
                                                    )
                                                })
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        {formData.economic_activities.map(acteco => (
                                            <Badge key={acteco.code} className="bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1">
                                                {acteco.code}
                                                <CloseIcon className="h-3 w-3 cursor-pointer" onClick={() => toggleActeco(acteco)} />
                                            </Badge>
                                        ))}
                                    </div>
                                </div>

                                <AlertaError mensaje={errorModal} />

                                <div className="pt-2 flex justify-end gap-3">
                                    <Button type="button" variant="outline" onClick={() => setOpenModal(false)}>
                                        Cancelar
                                    </Button>
                                    <Button type="submit" disabled={isCreating || !isRutValid} className="cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                                        {isCreating && <Loader2 className="h-4 w-4 animate-spin" />}
                                        {isCreating
                                            ? (editingTenantId ? 'Guardando...' : 'Provisionando...')
                                            : (editingTenantId ? 'Guardar cambios' : 'Crear e inicializar')
                                        }
                                    </Button>
                                </div>
                            </form>
                        </DialogContent>
                    </Dialog>

                <ListToolbar
                    busqueda={tenantSearch}
                    onBusqueda={setTenantSearch}
                    placeholder="Buscar por nombre, RUT o esquema..."
                    visibles={filteredTenants.length}
                    total={tenants.length}
                    unidad="empresas"
                />

                {/* Table */}
                <div data-section="saas-admin.empresas.tabla" className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Empresa</TableHead>
                                <TableHead>RUT</TableHead>
                                <TableHead>Esquema BD</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading && (
                                <TableEmpty colSpan={5} loading />
                            )}

                            {!loading && filteredTenants.length === 0 && (
                                <TableEmpty colSpan={5}>{tenantSearch ? 'No se encontraron empresas que coincidan con la búsqueda' : 'No hay empresas registradas'}</TableEmpty>
                            )}

                            {!loading && filteredTenants.map((tenant) => (
                                <TableRow key={tenant.id} className="border-b border-border/50 hover:bg-accent/50 transition-colors">
                                    <TableCell className="font-medium text-foreground">
                                        {tenant.name}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground font-mono">
                                        {tenant.rut || '-'}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground font-mono text-xs">
                                        {tenant.schema_name}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-3">
                                            <Switch
                                                checked={tenant.is_active}
                                                onCheckedChange={(checked: boolean) => handleToggleStatus(tenant, checked)}
                                            />
                                            <span className={cn(
                                                "text-xs font-bold uppercase tracking-wider",
                                                tenant.is_active ? "text-foreground font-semibold" : "text-muted-foreground"
                                            )}>
                                                {tenant.is_active ? 'Activo' : 'Inactivo'}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <AccionFila icon={Pencil} label="Editar datos" onClick={() => openEditModal(tenant)} />

                                            <AccionFila icon={Trash2} label="Desactivar" onClick={() => setTenantToDelete(tenant.id)} peligro disabled={!tenant.is_active} />

                                            <div className="w-px h-4 bg-border mx-1" />

                                            <Link href={`/saas-admin/tenants/${tenant.id}`}>
                                                <Button variant="ghost" size="sm" className="text-primary hover:bg-primary/10 cursor-pointer">
                                                    Gestionar
                                                </Button>
                                            </Link>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
                <ConfirmDialog
                    open={!!tenantToDelete}
                    onOpenChange={o => !o && setTenantToDelete(null)}
                    title="¿Desactivar empresa?"
                    description="Esta acción marcará a la empresa como inactiva. Los usuarios no podrán iniciar sesión en este tenant hasta que sea reactivado."
                    confirmLabel="Desactivar"
                    onConfirm={handleDeleteTenant}
                />

        </PageContainer>
    )
}
