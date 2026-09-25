'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getTenantUsers, addTenantUser, getTenants, updateTenant, updateTenantUser, type TenantUser, type TenantUserCreate, type Tenant, type TenantUpdate, type TenantUserUpdate } from '@/services/saas'
import { getApiErrorMessage } from '@/services/api'
import { Badge } from '@/components/ui/badge'
import { Store, ArrowLeft, UserPlus, ShieldPlus, Mail, Edit, Settings, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
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
import { toast } from 'sonner'
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
            toast.error(getApiErrorMessage(err, 'Error cargando detalles del inquilino'))
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
        if (isAtLimit) return toast.error("Límite de usuarios alcanzado para esta empresa.")
        if (!email || !role) return toast.error("El email y rol son obligatorios")

        setIsSubmitting(true)
        const payload: TenantUserCreate = {
            email,
            password: password || undefined,
            full_name: fullName || undefined,
            role_name: role
        }

        try {
            const newUser = await addTenantUser(tenantId, payload)
            toast.success(`Usuario ${newUser.user.email} asignado exitosamente`)
            const currentUsers = await getTenantUsers(tenantId)
            setUsers(currentUsers)
            setEmail('')
            setPassword('')
            setFullName('')
            setRole('VENDEDOR')
        } catch (error) {
            toast.error(getApiErrorMessage(error, 'Error al asignar usuario (¿Límite excedido?)'))
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleSaveSettings = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!tenant) return

        setIsSubmitting(true)
        const updates: TenantUpdate = {
            max_users_override: tenantOverride ? parseInt(tenantOverride) : null
        }

        try {
            await updateTenant(tenantId, updates)
            toast.success("Empresa actualizada con éxito")
            setOpenSettings(false)
            loadData()
        } catch (error) {
            toast.error(getApiErrorMessage(error, "Error al actualizar la empresa"))
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleSaveUserEdit = async () => {
        if (!editingUser) return
        setIsSubmitting(true)
        try {
            const updates: TenantUserUpdate = {
                role_name: editRole,
                full_name: editFullName
            }
            if (editPassword) updates.password = editPassword

            await updateTenantUser(tenantId, editingUser.user_id, updates)
            toast.success("Usuario actualizado con éxito")
            setEditingUser(null)
            setEditPassword('')
            loadData()
        } catch (error) {
            toast.error(getApiErrorMessage(error, "Error modificando al usuario"))
        } finally {
            setIsSubmitting(false)
        }
    }

    // Desactivar pide confirmación; reactivar es inocuo y va directo.
    const [toDeactivate, setToDeactivate] = useState<TenantUser | null>(null)

    const handleToggleUserStatus = async (tu: TenantUser) => {
        // Check limit if reactivating
        if (!tu.is_active && isAtLimit) {
            toast.error("No se puede reactivar. Límite de usuarios alcanzado.")
            return
        }

        try {
            await updateTenantUser(tenantId, tu.user_id, { is_active: !tu.is_active })
            toast.success("Estado del usuario actualizado")
            loadData()
        } catch (error) {
            toast.error(getApiErrorMessage(error, "Error modificando estado"))
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
        <div className="min-h-screen bg-background p-6 md:p-12">
            <div className="max-w-5xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <Link href="/saas-admin/tenants" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Volver a Empresas
                        </Link>
                        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
                            <Store className="h-6 w-6 text-primary shrink-0" />
                            {tenant.name}
                        </h1>
                        <div className="flex items-center gap-3 text-sm text-muted-foreground">
                            <span>RUT: {tenant.rut || '-'}</span>
                            &bull;
                            <span>Esquema: <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded border border-primary/20">{tenant.schema_name}</code></span>
                            {tenant.max_users_override && <span>&bull; Máx Usr: {tenant.max_users_override}</span>}
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-3">
                        <Button
                            variant="outline"
                            className="bg-background hover:bg-accent border-border text-foreground w-full sm:w-auto cursor-pointer"
                            onClick={handleImpersonate}
                        >
                            <Store className="mr-2 h-4 w-4" /> Entrar al POS
                        </Button>
                        <Dialog open={openSettings} onOpenChange={setOpenSettings}>
                            <DialogTrigger asChild>
                                <Button variant="outline" className="border-border text-foreground hover:bg-accent hover:text-accent-foreground cursor-pointer">
                                    <Settings className="mr-2 h-4 w-4" /> Límites de Usuarios
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md bg-card border-border max-h-[90vh] overflow-y-auto">
                                <DialogHeader>
                                    <DialogTitle className="text-xl">Ajustar Cupos</DialogTitle>
                                    <DialogDescription className="text-muted-foreground">
                                        Modifica el límite de usuarios permitidos para esta empresa.
                                    </DialogDescription>
                                </DialogHeader>
                                <form onSubmit={handleSaveSettings} className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <Label>Cupo Máximo de Usuarios (Override)</Label>
                                        <Input
                                            type="number"
                                            min="1"
                                            placeholder={`Predeterminado del Plan (${tenant.plan_max_users || 3})`}
                                            value={tenantOverride}
                                            onChange={e => setTenantOverride(e.target.value)}
                                        />
                                        <p className="text-xs text-muted-foreground">Deja vacío para usar el límite por defecto ({tenant.plan_max_users || 3}) del plan SaaS.</p>
                                    </div>
                                    <div className="pt-2 flex justify-end gap-3">
                                        <Button type="button" variant="outline" onClick={() => setOpenSettings(false)} className="border-border cursor-pointer">Cancelar</Button>
                                        <Button type="submit" disabled={isSubmitting} className="cursor-pointer">
                                            Guardar Cambios
                                        </Button>
                                    </div>
                                </form>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-6">
                    {/* Formulario Asignación ARRIBA */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-semibold text-foreground flex items-center gap-2">
                                <ShieldPlus className="h-5 w-5 text-primary" />
                                Vincular Operador
                            </h2>
                            <div className={`text-sm ${isAtLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                                Cupos: {users.filter(u => u.is_active).length} / {maxUsersLimit}
                            </div>
                        </div>

                        <form onSubmit={handleAddUser} autoComplete="off" className={`bg-card p-6 rounded-xl border ${isAtLimit ? 'border-destructive/30 opacity-80' : 'border-border'} shadow-sm`}>
                            {isAtLimit && (
                                <div className="mb-4 p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
                                    Se ha alcanzado el límite máximo de usuarios operativos activos permitidos por el plan de la empresa. Desactiva uno existente o aumenta el límite en la Configuración SaaS.
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
                                            <SelectValue placeholder="Selecciona Rol" />
                                        </SelectTrigger>
                                        <SelectContent className="border-border bg-card cursor-pointer">
                                            <SelectItem value="ADMINISTRADOR">Administrador T. Local</SelectItem>
                                            <SelectItem value="VENDEDOR">Vendedor POS</SelectItem>
                                            <SelectItem value="BODEGUERO">Bodeguero</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="md:w-32">
                                    <Button type="submit" className="w-full h-10 cursor-pointer shadow-sm shadow-primary/20" disabled={isSubmitting || isAtLimit}>
                                        {isSubmitting ? '...' : <><UserPlus className="mr-2 h-4 w-4" /> Asignar</>}
                                    </Button>
                                </div>
                            </div>
                        </form>
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
                                            <TableHead>Global ID / Email</TableHead>
                                            <TableHead>Nombre</TableHead>
                                            <TableHead>Rol Local</TableHead>
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
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            title="Editar Rol"
                                                            className="h-8 w-8 text-muted-foreground hover:text-primary cursor-pointer"
                                                            onClick={() => {
                                                                setEditingUser(tu)
                                                                setEditRole(tu.role_name)
                                                                setEditPassword('')
                                                                setEditFullName(tu.user.full_name || '')
                                                            }}
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" className={`h-8 w-8 cursor-pointer ${tu.is_active ? 'text-destructive hover:text-destructive hover:bg-destructive/10' : 'text-primary hover:text-primary hover:bg-primary/10'}`} onClick={() => tu.is_active ? setToDeactivate(tu) : handleToggleUserStatus(tu)} title={tu.is_active ? "Desactivar" : "Reactivar"}>
                                                            {tu.is_active ? <Trash2 className="h-4 w-4" /> : <ShieldPlus className="h-4 w-4" />}
                                                        </Button>
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
                        setEditRole('');
                        setEditPassword('');
                        setEditFullName('');
                    }
                }}>
                    <DialogContent className="sm:max-w-md bg-card border-border max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="text-xl">Editar Operador</DialogTitle>
                            <DialogDescription className="text-muted-foreground">
                                Actualiza los permisos o la información del usuario vinculado.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Usuario Global</Label>
                                <Input value={editingUser?.user.email || ''} disabled className="bg-muted" autoComplete="none" name="operator-email-edit" />
                            </div>
                            <div className="space-y-2">
                                <Label>Nuevo Rol Interno</Label>
                                <Select value={editRole} onValueChange={setEditRole} disabled={isSubmitting}>
                                    <SelectTrigger className="h-10 border-border focus:ring-ring cursor-pointer">
                                        <SelectValue placeholder="Selecciona Rol" />
                                    </SelectTrigger>
                                    <SelectContent className="border-border bg-card cursor-pointer">
                                        <SelectItem value="ADMINISTRADOR">Administrador T. Local</SelectItem>
                                        <SelectItem value="VENDEDOR">Vendedor POS</SelectItem>
                                        <SelectItem value="BODEGUERO">Bodeguero</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Nombre del Operador</Label>
                                <Input
                                    value={editFullName}
                                    onChange={e => setEditFullName(e.target.value)}
                                    placeholder="Nombre completo"
                                   
                                    autoComplete="none"
                                    name="operator-name-edit"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Cambiar Contraseña (Opcional)</Label>
                                <Input
                                    type="password"
                                    name="operator-password-edit"
                                    placeholder="Dejar en blanco para mantener actual"
                                    value={editPassword}
                                    autoComplete="new-password"
                                    onChange={e => setEditPassword(e.target.value)}
                                />
                                <p className="text-[10px] text-muted-foreground">Si el operador olvidó su clave, ingresa una nueva aquí y compártela de forma segura.</p>
                            </div>
                            <div className="pt-2 flex justify-end gap-3">
                                <Button type="button" variant="outline" onClick={() => setEditingUser(null)} className="cursor-pointer">Cancelar</Button>
                                <Button type="button" onClick={handleSaveUserEdit} disabled={isSubmitting} className="cursor-pointer">
                                    Guardar Cambios
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
            </div>
        </div>
    )
}
