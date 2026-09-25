'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getTenantUsers, addTenantUser, getTenants, updateTenant, updateTenantUser, type TenantUser, type TenantUserCreate, type Tenant, type TenantUpdate, type TenantUserUpdate } from '@/services/saas'
import { getApiErrorMessage, getApiErrorDetail } from '@/services/api'
import { Badge } from '@/components/ui/badge'
import { Store, UserPlus, ShieldPlus, Mail, Edit, Settings, Trash2 } from 'lucide-react'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { AccionFila } from '@/components/ui/accion-fila'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { AlertaError } from '@/components/ui/alerta-error'
import { avisar } from '@/lib/store/uiStore'
import { Skeleton } from '@/components/ui/skeleton'
import { useSessionStore } from '@/lib/store/sessionStore'

import { ConfirmDialog } from '@/components/ui/confirm-dialog'

export default function TenantDetailsPage() {
    const router = useRouter()
    const { id } = useParams()
    const tenantId = Number(id)
    const selectTenant = useSessionStore(s => s.selectTenant)
    const availableTenants = useSessionStore(s => s.availableTenants)

    const [tenant, setTenant] = useState<Tenant | null>(null)
    const [users, setUsers] = useState<TenantUser[]>([])
    const [loading, setLoading] = useState(true)

    // Form state - Add User
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [fullName, setFullName] = useState('')
    const [role, setRole] = useState('VENDEDOR')
    const [isSubmitting, setIsSubmitting] = useState(false)

    // Form state - Settings
    const [openSettings, setOpenSettings] = useState(false)
    const [errorAjustes, setErrorAjustes] = useState<string | null>(null)
    const [errorAsignar, setErrorAsignar] = useState<string | null>(null)
    const [errorEditar, setErrorEditar] = useState<string | null>(null)
    const [tenantOverride, setTenantOverride] = useState('')

    // Form state - Edit User
    const [editingUser, setEditingUser] = useState<TenantUser | null>(null)
    const [editRole, setEditRole] = useState('')
    const [editPassword, setEditPassword] = useState('')
    const [editFullName, setEditFullName] = useState('')

    const loadData = useCallback(async () => {
        setLoading(true)
        try {
            const list = await getTenants()
            const found = list.find(t => t.id === tenantId) || null
            setTenant(found)

            if (found) {
                setTenantOverride(found.max_users_override ? found.max_users_override.toString() : '')
                const uData = await getTenantUsers(tenantId)
                setUsers(uData)
            }
        } catch (err) {
            avisar(getApiErrorMessage(err, 'Error cargando detalles del inquilino'), { reintentar: loadData })
        } finally {
            setLoading(false)
        }
    }, [tenantId])

    useEffect(() => {
        if (!tenantId) return
        loadData()
    }, [tenantId, loadData])

    const maxUsersLimit = tenant?.max_users_override || 3 // By default testing
    const isAtLimit = users.filter(u => u.is_active).length >= maxUsersLimit

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault()
        setErrorAsignar(null)
        if (isAtLimit) return setErrorAsignar("Límite de usuarios alcanzado para esta empresa.")
        if (!email || !role) return setErrorAsignar("El email y el rol son obligatorios.")

        setIsSubmitting(true)
        const payload: TenantUserCreate = {
            email,
            password: password || undefined,
            full_name: fullName || undefined,
            role_name: role
        }

        try {
            await addTenantUser(tenantId, payload)
            const currentUsers = await getTenantUsers(tenantId)
            setUsers(currentUsers)
            setEmail('')
            setPassword('')
            setFullName('')
            setRole('VENDEDOR')
        } catch (error) {
            setErrorAsignar(getApiErrorDetail(error, 'No se pudo asignar el usuario (¿límite excedido?).'))
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleSaveSettings = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!tenant) return

        setErrorAjustes(null)
        setIsSubmitting(true)
        const updates: TenantUpdate = {
            max_users_override: tenantOverride ? parseInt(tenantOverride) : null
        }

        try {
            await updateTenant(tenantId, updates)
            setOpenSettings(false)
            loadData()
        } catch (error) {
            setErrorAjustes(getApiErrorDetail(error, "No se pudo actualizar la empresa."))
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleSaveUserEdit = async () => {
        if (!editingUser) return
        setErrorEditar(null)
        setIsSubmitting(true)
        try {
            const updates: TenantUserUpdate = {
                role_name: editRole,
                full_name: editFullName
            }
            if (editPassword) updates.password = editPassword

            await updateTenantUser(tenantId, editingUser.user_id, updates)
            setEditingUser(null)
            setEditPassword('')
            loadData()
        } catch (error) {
            setErrorEditar(getApiErrorDetail(error, "No se pudo modificar el usuario."))
        } finally {
            setIsSubmitting(false)
        }
    }

    // Desactivar pide confirmación; reactivar es inocuo y va directo.
    const [toDeactivate, setToDeactivate] = useState<TenantUser | null>(null)

    const handleToggleUserStatus = async (tu: TenantUser) => {
        // Check limit if reactivating
        if (!tu.is_active && isAtLimit) {
            avisar("No se puede reactivar: límite de usuarios alcanzado.")
            return
        }

        try {
            await updateTenantUser(tenantId, tu.user_id, { is_active: !tu.is_active })
            loadData()
        } catch (error) {
            avisar(getApiErrorDetail(error, "No se pudo cambiar el estado del usuario."))
        }
    }

    const handleImpersonate = () => {
        if (!tenant) return;

        const existing = availableTenants.find(t => t.id === tenantId)
        if (!existing) {
            useSessionStore.setState(state => ({
                availableTenants: [...state.availableTenants, {
                    id: tenant.id,
                    name: tenant.name,
                    rut: tenant.rut || '',
                    role_name: 'ADMINISTRADOR',
                    is_active: tenant.is_active,
                    max_users: tenant.max_users_override || tenant.plan_max_users || 1,
                    permissions: {
                        can_manage_users: true,
                        can_view_reports: true,
                        has_pos_access: true,
                        can_manage_inventory: true,
                        can_configure_pos: true
                    }
                }]
            }))
        }
        selectTenant(tenantId)
        router.push('/pos')
    }

    if (loading) {
        return <div className="min-h-screen bg-background p-6 flex flex-col items-center justify-center"><Skeleton className="h-8 w-64 mb-4" /><Skeleton className="h-4 w-32" /></div>
    }

    if (!tenant) {
        return <div className="min-h-screen flex items-center justify-center text-muted-foreground bg-background">Empresa no encontrada</div>
    }

    return (
        <PageContainer>
                <PageHeader
                    icon={Store}
                    title={tenant.name}
                    volver={{ href: '/saas-admin/tenants', label: 'Volver a empresas' }}
                    actions={<>
                        <Button
                            variant="outline"
                            className="bg-background hover:bg-accent border-border text-foreground w-full sm:w-auto cursor-pointer"
                            onClick={handleImpersonate}
                        >
                            <Store className="h-4 w-4" /> Entrar al POS
                        </Button>
                        <Dialog open={openSettings} onOpenChange={(o) => { setOpenSettings(o); setErrorAjustes(null) }}>
                            <DialogTrigger asChild>
                                <Button variant="outline" className="border-border text-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer">
                                    <Settings className="h-4 w-4" /> Límites de usuarios
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md bg-card border-border max-h-[90vh] overflow-y-auto">
                                <DialogHeader>
                                    <DialogTitle className="text-xl">Ajustar cupos</DialogTitle>
                                    <DialogDescription className="text-muted-foreground">
                                        Modifica el límite de usuarios permitidos para esta empresa.
                                    </DialogDescription>
                                </DialogHeader>
                                <form onSubmit={handleSaveSettings} className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <Label>Cupo máximo de usuarios (override)</Label>
                                        <Input
                                            type="number"
                                            min="1"
                                            placeholder={`Predeterminado del plan (${tenant.plan_max_users || 3})`}
                                            value={tenantOverride}
                                            onChange={e => setTenantOverride(e.target.value)}
                                        />
                                        <p className="text-xs text-muted-foreground">Deja vacío para usar el límite por defecto ({tenant.plan_max_users || 3}) del plan SaaS.</p>
                                    </div>
                                    <AlertaError mensaje={errorAjustes} />
                                    <div className="pt-2 flex justify-end gap-3">
                                        <Button type="button" variant="outline" onClick={() => setOpenSettings(false)} className="border-border cursor-pointer">Cancelar</Button>
                                        <Button type="submit" disabled={isSubmitting} className="cursor-pointer">
                                            Guardar cambios
                                        </Button>
                                    </div>
                                </form>
                            </DialogContent>
                        </Dialog>
                    </>}
                >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground mt-1">
                        <span>RUT: {tenant.rut || '-'}</span>
                        &bull;
                        <span>Esquema: <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">{tenant.schema_name}</code></span>
                        {tenant.max_users_override && <span>&bull; Máx. usuarios: {tenant.max_users_override}</span>}
                    </div>
                </PageHeader>

                <div className="grid grid-cols-1 gap-6">
                    {/* Formulario Asignación ARRIBA */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                                <ShieldPlus className="h-5 w-5 text-primary" />
                                Vincular operador
                            </h2>
                            <div className={`text-sm ${isAtLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                                Cupos: {users.filter(u => u.is_active).length} / {maxUsersLimit}
                            </div>
                        </div>

                        <form onSubmit={handleAddUser} autoComplete="off" className={`bg-card p-6 rounded-xl border ${isAtLimit ? 'border-destructive/30 opacity-80' : 'border-border'} shadow-sm`}>
                            {isAtLimit && (
                                <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
                                    Se ha alcanzado el límite máximo de usuarios operativos activos permitidos por el plan de la empresa. Desactiva uno existente o aumenta el límite en la configuración SaaS.
                                </div>
                            )}

                            <div className="flex flex-col md:flex-row gap-4">
                                <div className="flex-1 space-y-2">
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            type="email"
                                            required
                                            placeholder="usuario@empresa.cl *"
                                            className="pl-9 h-10"
                                            value={email}
                                            autoComplete="none"
                                            onChange={e => setEmail(e.target.value)}
                                            disabled={isSubmitting || isAtLimit}
                                        />
                                    </div>
                                </div>

                                <div className="flex-1 space-y-2">
                                    <Input
                                        type="password"
                                        placeholder="Contraseña (si es nueva cuenta)"
                                        className="h-10"
                                        value={password}
                                        autoComplete="new-password"
                                        onChange={e => setPassword(e.target.value)}
                                        disabled={isSubmitting || isAtLimit}
                                    />
                                </div>

                                <div className="flex-1 space-y-2">
                                    <Input
                                        type="text"
                                        placeholder="Nombre (opcional)"
                                        className="h-10"
                                        value={fullName}
                                        onChange={e => setFullName(e.target.value)}
                                        disabled={isSubmitting || isAtLimit}
                                    />
                                </div>

                                <div className="flex-1 space-y-2">
                                    <Select value={role} onValueChange={setRole} disabled={isSubmitting || isAtLimit}>
                                        <SelectTrigger className="h-10 border-border focus:ring-ring cursor-pointer">
                                            <SelectValue placeholder="Selecciona un rol" />
                                        </SelectTrigger>
                                        <SelectContent className="border-border bg-card cursor-pointer">
                                            <SelectItem value="ADMINISTRADOR">Administrador local</SelectItem>
                                            <SelectItem value="VENDEDOR">Vendedor POS</SelectItem>
                                            <SelectItem value="BODEGUERO">Bodeguero</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="md:w-32">
                                    <Button type="submit" className="w-full h-10 cursor-pointer shadow-sm shadow-primary/20" disabled={isSubmitting || isAtLimit}>
                                        {isSubmitting ? '...' : <><UserPlus className="h-4 w-4" /> Asignar</>}
                                    </Button>
                                </div>
                            </div>
                        </form>
                        <AlertaError mensaje={errorAsignar} />
                    </div>

                    {/* Lista de Usuarios */}
                    <div className="space-y-4">
                        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                            {users.length === 0 ? (
                                <div className="p-8 text-center text-muted-foreground">Sin usuarios operativos registrados.</div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>ID global / email</TableHead>
                                            <TableHead>Nombre</TableHead>
                                            <TableHead>Rol local</TableHead>
                                            <TableHead>Estado</TableHead>
                                            <TableHead className="text-right">Acciones</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {users.map(tu => (
                                            <TableRow key={tu.user_id} className="border-b border-border/50 hover:bg-accent/50 transition-colors">
                                                <TableCell className="font-medium text-foreground">
                                                    {tu.user.email}
                                                    {tu.user.is_superuser && <Badge variant="outline" className="ml-2 text-xs border-border text-muted-foreground dark:text-muted-foreground">Superadmin</Badge>}
                                                </TableCell>
                                                <TableCell className="text-muted-foreground">
                                                    {tu.user.full_name || '-'}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="secondary" className="font-mono text-xs bg-muted">{tu.role_name}</Badge>
                                                </TableCell>
                                                <TableCell>
                                                    {tu.is_active ?
                                                        <Badge className="bg-primary/10 text-primary border-0">Activo</Badge>
                                                        :
                                                        <Badge variant="secondary" className="text-muted-foreground">Inactivo</Badge>
                                                    }
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <AccionFila icon={Edit} label="Editar rol" onClick={() => {
                                                                setEditingUser(tu)
                                                                setEditRole(tu.role_name)
                                                                setEditPassword('')
                                                                setEditFullName(tu.user.full_name || '')
                                                            }} />
                                                        {tu.is_active
                                                            ? <AccionFila icon={Trash2} label="Desactivar" onClick={() => setToDeactivate(tu)} peligro />
                                                            : <AccionFila icon={ShieldPlus} label="Reactivar" onClick={() => handleToggleUserStatus(tu)} />}
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </div>
                    </div>
                </div>

                {/* Edit Role Modal */}
                <Dialog open={!!editingUser} onOpenChange={(open) => {
                    if (!open) {
                        setEditingUser(null);
                        setErrorEditar(null);
                        setEditRole('');
                        setEditPassword('');
                        setEditFullName('');
                    }
                }}>
                    <DialogContent className="sm:max-w-md bg-card border-border max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="text-xl">Editar operador</DialogTitle>
                            <DialogDescription className="text-muted-foreground">
                                Actualiza los permisos o la información del usuario vinculado.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Usuario global</Label>
                                <Input value={editingUser?.user.email || ''} disabled className="bg-muted" autoComplete="none" name="operator-email-edit" />
                            </div>
                            <div className="space-y-2">
                                <Label>Nuevo rol interno</Label>
                                <Select value={editRole} onValueChange={setEditRole} disabled={isSubmitting}>
                                    <SelectTrigger className="h-10 border-border focus:ring-ring cursor-pointer">
                                        <SelectValue placeholder="Selecciona un rol" />
                                    </SelectTrigger>
                                    <SelectContent className="border-border bg-card cursor-pointer">
                                        <SelectItem value="ADMINISTRADOR">Administrador local</SelectItem>
                                        <SelectItem value="VENDEDOR">Vendedor POS</SelectItem>
                                        <SelectItem value="BODEGUERO">Bodeguero</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Nombre del operador</Label>
                                <Input
                                    value={editFullName}
                                    onChange={e => setEditFullName(e.target.value)}
                                    placeholder="Nombre completo"
                                   
                                    autoComplete="none"
                                    name="operator-name-edit"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Cambiar contraseña (opcional)</Label>
                                <Input
                                    type="password"
                                    name="operator-password-edit"
                                    placeholder="Dejar en blanco para mantener actual"
                                    value={editPassword}
                                    autoComplete="new-password"
                                    onChange={e => setEditPassword(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">Si el operador olvidó su clave, ingresa una nueva aquí y compártela de forma segura.</p>
                            </div>
                            <AlertaError mensaje={errorEditar} />
                            <div className="pt-2 flex justify-end gap-3">
                                <Button type="button" variant="outline" onClick={() => setEditingUser(null)} className="cursor-pointer">Cancelar</Button>
                                <Button type="button" onClick={handleSaveUserEdit} disabled={isSubmitting} className="cursor-pointer">
                                    Guardar cambios
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
                <ConfirmDialog
                    open={!!toDeactivate}
                    onOpenChange={o => !o && setToDeactivate(null)}
                    title="¿Desactivar usuario?"
                    description={`${toDeactivate?.user.email} ya no podrá entrar a esta empresa.`}
                    confirmLabel="Desactivar"
                    onConfirm={async () => { if (toDeactivate) await handleToggleUserStatus(toDeactivate) }}
                />
        </PageContainer>
    )
}
