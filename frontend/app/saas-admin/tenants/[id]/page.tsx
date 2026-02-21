'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getTenantUsers, addTenantUser, getTenants, updateTenant, updateTenantUser, type TenantUser, type TenantUserCreate, type Tenant, type TenantUpdate, type TenantUserUpdate } from '@/services/saas'
import { getApiErrorMessage } from '@/services/api'
import { Badge } from '@/components/ui/badge'
import { Store, ArrowLeft, UserPlus, ShieldPlus, Mail, User as UserIcon, Edit, Settings, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { useSessionStore } from '@/lib/store/sessionStore'

export default function TenantDetailsPage() {
    const router = useRouter()
    const { id } = useParams()
    const tenantId = Number(id)
    const selectTenant = useSessionStore(s => s.selectTenant)

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

    useEffect(() => {
        if (!tenantId) return
        loadData()
    }, [tenantId])

    const loadData = async () => {
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
    }

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

    const handleToggleUserStatus = async (tu: TenantUser) => {
        if (!confirm(`¿Estás seguro de ${tu.is_active ? 'desactivar' : 'reactivar'} a este usuario de la empresa?`)) return

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
        selectTenant(tenantId)
        router.push('/pos')
    }

    if (loading) {
        return <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 p-6 flex flex-col items-center justify-center"><Skeleton className="h-8 w-64 mb-4" /><Skeleton className="h-4 w-32" /></div>
    }

    if (!tenant) {
        return <div className="min-h-screen flex items-center justify-center text-neutral-500 bg-neutral-50 dark:bg-neutral-950">Empresa no encontrada</div>
    }

    return (
        <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 p-6 md:p-12">
            <div className="max-w-5xl mx-auto space-y-6">

                {/* Header */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <Link href="/saas-admin/tenants" className="inline-flex items-center text-sm font-medium text-neutral-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Volver a Empresas
                        </Link>
                        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-white flex items-center gap-3">
                            <Store className="h-8 w-8 text-blue-600" />
                            {tenant.name}
                        </h1>
                        <div className="flex items-center gap-3 text-sm text-neutral-500">
                            <span>RUT: {tenant.rut || '-'}</span>
                            &bull;
                            <span>Esquema: <code className="bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 py-0.5 rounded border border-blue-100 dark:border-blue-800">{tenant.schema_name}</code></span>
                            {tenant.max_users_override && <span>&bull; Máx Usr: {tenant.max_users_override}</span>}
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-3">
                        <Button
                            variant="outline"
                            className="bg-white hover:bg-neutral-50 border-neutral-200 text-neutral-700 dark:bg-neutral-900 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800 w-full sm:w-auto cursor-pointer"
                            onClick={handleImpersonate}
                        >
                            <Store className="mr-2 h-4 w-4" /> Entrar al POS
                        </Button>
                        <Dialog open={openSettings} onOpenChange={setOpenSettings}>
                            <DialogTrigger asChild>
                                <Button variant="outline" className="border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 cursor-pointer">
                                    <Settings className="mr-2 h-4 w-4" /> Límites de Usuarios
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 max-h-[90vh] overflow-y-auto">
                                <DialogHeader>
                                    <DialogTitle className="text-xl">Ajustar Cupos</DialogTitle>
                                    <DialogDescription className="text-neutral-500">
                                        Modifica el límite de usuarios permitidos para esta empresa.
                                    </DialogDescription>
                                </DialogHeader>
                                <form onSubmit={handleSaveSettings} className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Cupo Máximo de Usuarios (Override)</label>
                                        <Input
                                            type="number"
                                            min="1"
                                            placeholder={`Predeterminado del Plan (${tenant.plan_max_users || 3})`}
                                            value={tenantOverride}
                                            onChange={e => setTenantOverride(e.target.value)}
                                            className="border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500"
                                        />
                                        <p className="text-xs text-neutral-500">Deja vacío para usar el límite por defecto ({tenant.plan_max_users || 3}) del plan SaaS.</p>
                                    </div>
                                    <div className="pt-2 flex justify-end gap-3">
                                        <Button type="button" variant="outline" onClick={() => setOpenSettings(false)} className="border-neutral-200 dark:border-neutral-800 cursor-pointer">Cancelar</Button>
                                        <Button type="submit" disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700 cursor-pointer text-white">
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
                            <h2 className="text-xl font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
                                <ShieldPlus className="h-5 w-5 text-blue-600" />
                                Vincular Operador
                            </h2>
                            <div className={`text-sm ${isAtLimit ? 'text-red-500 font-medium' : 'text-neutral-500'}`}>
                                Cupos: {users.filter(u => u.is_active).length} / {maxUsersLimit}
                            </div>
                        </div>

                        <form onSubmit={handleAddUser} autoComplete="off" className={`bg-white dark:bg-neutral-900 p-6 rounded-xl border ${isAtLimit ? 'border-red-200 dark:border-red-900/50 opacity-80' : 'border-neutral-200 dark:border-neutral-800'} shadow-sm`}>
                            {isAtLimit && (
                                <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg">
                                    Se ha alcanzado el límite máximo de usuarios operativos activos permitidos por el plan de la empresa. Desactiva uno existente o aumenta el límite en la Configuración SaaS.
                                </div>
                            )}

                            <div className="flex flex-col md:flex-row gap-4">
                                <div className="flex-1 space-y-2">
                                    <div className="relative">
                                        <Mail className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
                                        <Input
                                            type="email"
                                            required
                                            placeholder="usuario@empresa.cl *"
                                            className="pl-9 h-10 border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500"
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
                                        className="h-10 border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500"
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
                                        className="h-10 border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500"
                                        value={fullName}
                                        onChange={e => setFullName(e.target.value)}
                                        disabled={isSubmitting || isAtLimit}
                                    />
                                </div>

                                <div className="flex-1 space-y-2">
                                    <Select value={role} onValueChange={setRole} disabled={isSubmitting || isAtLimit}>
                                        <SelectTrigger className="h-10 border-neutral-200 dark:border-neutral-800 focus:ring-blue-500 cursor-pointer">
                                            <SelectValue placeholder="Selecciona Rol" />
                                        </SelectTrigger>
                                        <SelectContent className="border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 cursor-pointer">
                                            <SelectItem value="ADMINISTRADOR">Administrador T. Local</SelectItem>
                                            <SelectItem value="VENDEDOR">Vendedor POS</SelectItem>
                                            <SelectItem value="BODEGUERO">Bodeguero</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="md:w-32">
                                    <Button type="submit" className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white cursor-pointer shadow-sm shadow-blue-600/20" disabled={isSubmitting || isAtLimit}>
                                        {isSubmitting ? '...' : <><UserPlus className="mr-2 h-4 w-4" /> Asignar</>}
                                    </Button>
                                </div>
                            </div>
                        </form>
                    </div>

                    {/* Lista de Usuarios */}
                    <div className="space-y-4">
                        <div className="bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden">
                            {users.length === 0 ? (
                                <div className="p-8 text-center text-neutral-500">Sin usuarios operativos registrados.</div>
                            ) : (
                                <table className="w-full text-sm text-left relative">
                                    <thead className="text-xs text-neutral-500 uppercase bg-neutral-50/50 dark:bg-neutral-900/50 border-b border-neutral-200 dark:border-neutral-800">
                                        <tr>
                                            <th className="px-6 py-4 font-medium">Global ID / Email</th>
                                            <th className="px-6 py-4 font-medium">Nombre</th>
                                            <th className="px-6 py-4 font-medium">Rol Local</th>
                                            <th className="px-6 py-4 font-medium">Estado</th>
                                            <th className="px-6 py-4 font-medium text-right">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.map(tu => (
                                            <tr key={tu.user_id} className="border-b border-neutral-100 dark:border-neutral-800/50 hover:bg-neutral-50/50 dark:hover:bg-neutral-800/30 transition-colors">
                                                <td className="px-6 py-4 font-medium text-neutral-900 dark:text-neutral-100">
                                                    {tu.user.email}
                                                    {tu.user.is_superuser && <Badge variant="outline" className="ml-2 text-xs border-neutral-200 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">Superadmin</Badge>}
                                                </td>
                                                <td className="px-6 py-4 text-neutral-500 dark:text-neutral-400">
                                                    {tu.user.full_name || '-'}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <Badge variant="secondary" className="font-mono text-xs bg-neutral-100 dark:bg-neutral-800">{tu.role_name}</Badge>
                                                </td>
                                                <td className="px-6 py-4">
                                                    {tu.is_active ?
                                                        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border-0">Activo</Badge>
                                                        :
                                                        <Badge variant="secondary" className="text-neutral-500">Inactivo</Badge>
                                                    }
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex items-center justify-end gap-2">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            title="Editar Rol"
                                                            className="h-8 w-8 text-neutral-500 hover:text-blue-600 cursor-pointer"
                                                            onClick={() => {
                                                                setEditingUser(tu)
                                                                setEditRole(tu.role_name)
                                                                setEditPassword('')
                                                                setEditFullName(tu.user.full_name || '')
                                                            }}
                                                        >
                                                            <Edit className="h-4 w-4" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" className={`h-8 w-8 cursor-pointer ${tu.is_active ? 'text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30' : 'text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30'}`} onClick={() => handleToggleUserStatus(tu)} title={tu.is_active ? "Desactivar" : "Reactivar"}>
                                                            {tu.is_active ? <Trash2 className="h-4 w-4" /> : <ShieldPlus className="h-4 w-4" />}
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
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
                    <DialogContent className="sm:max-w-md bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="text-xl">Editar Operador</DialogTitle>
                            <DialogDescription className="text-neutral-500">
                                Actualiza los permisos o la información del usuario vinculado.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Usuario Global</label>
                                <Input value={editingUser?.user.email || ''} disabled className="bg-neutral-100 dark:bg-neutral-800" autoComplete="none" name="operator-email-edit" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Nuevo Rol Interno</label>
                                <Select value={editRole} onValueChange={setEditRole} disabled={isSubmitting}>
                                    <SelectTrigger className="h-10 border-neutral-200 dark:border-neutral-800 focus:ring-blue-500 cursor-pointer">
                                        <SelectValue placeholder="Selecciona Rol" />
                                    </SelectTrigger>
                                    <SelectContent className="border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 cursor-pointer">
                                        <SelectItem value="ADMINISTRADOR">Administrador T. Local</SelectItem>
                                        <SelectItem value="VENDEDOR">Vendedor POS</SelectItem>
                                        <SelectItem value="BODEGUERO">Bodeguero</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Nombre del Operador</label>
                                <Input
                                    value={editFullName}
                                    onChange={e => setEditFullName(e.target.value)}
                                    placeholder="Nombre completo"
                                    className="border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500"
                                    autoComplete="none"
                                    name="operator-name-edit"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300 pointer-events-none">Cambiar Contraseña (Opcional)</label>
                                <Input
                                    type="password"
                                    name="operator-password-edit"
                                    placeholder="Dejar en blanco para mantener actual"
                                    value={editPassword}
                                    autoComplete="new-password"
                                    onChange={e => setEditPassword(e.target.value)}
                                    className="border-neutral-200 dark:border-neutral-800 focus-visible:ring-blue-500"
                                />
                                <p className="text-[10px] text-neutral-500">Si el operador olvidó su clave, ingresa una nueva aquí y compártela de forma segura.</p>
                            </div>
                            <div className="pt-2 flex justify-end gap-3">
                                <Button type="button" variant="outline" onClick={() => setEditingUser(null)} className="cursor-pointer">Cancelar</Button>
                                <Button type="button" onClick={handleSaveUserEdit} disabled={isSubmitting} className="bg-blue-600 hover:bg-blue-700 cursor-pointer text-white">
                                    Guardar Cambios
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    )
}
