'use client'

import { useEffect, useState, useMemo } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
    Users,
    ShieldCheck,
    Plus,
    Pencil,
    Trash2,
    Loader2,
    Mail,
    CreditCard,
    Search,
    RefreshCw,
    Save,
    CheckCircle2,
    XCircle,
    UserCircle
} from 'lucide-react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"
import { toast } from 'sonner'
import { useSessionStore } from '@/lib/store/sessionStore'
import { getUsers, deleteUser, updateUser, type User } from '@/services/users'
import { roleService, type Role } from '@/services/roles'
import UserDialog from '@/components/users/UserDialog'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const MENU_ITEMS = [
    'Dashboard',
    'Terminal POS',
    'Caja',
    'Productos',
    'Marcas',
    'Compras',
    'Clientes',
    'Proveedores',
    'Personal',
    'Historial',
    'Reportes de Ventas',
    'Configuración'
]

export default function PersonalPage() {
    // Shared State
    const [loading, setLoading] = useState(true)
    const availableTenants = useSessionStore((s) => s.availableTenants)
    const selectedTenantId = useSessionStore((s) => s.selectedTenantId)
    const currentTenant = availableTenants.find(t => t.id === selectedTenantId)
    const maxUsers = currentTenant?.max_users || 1

    // Staff List State
    const [staff, setStaff] = useState<User[]>([])
    const [staffLoading, setStaffLoading] = useState(false)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [selectedUser, setSelectedUser] = useState<User | null>(null)

    // Roles State
    const [roles, setRoles] = useState<Role[]>([])
    const [savingRoles, setSavingRoles] = useState(false)
    const [updatingUserId, setUpdatingUserId] = useState<number | null>(null)
    const [rolesSearchTerm, setRolesSearchTerm] = useState('')

    const activeStaffCount = staff.filter(u => u.is_active).length
    const canActivateMore = activeStaffCount < maxUsers

    useEffect(() => {
        loadAll()
    }, [selectedTenantId])

    const loadAll = async () => {
        try {
            setLoading(true)
            await Promise.all([fetchStaff(), fetchRoles()])
        } finally {
            setLoading(false)
        }
    }

    const fetchStaff = async () => {
        try {
            setStaffLoading(true)
            const data = await getUsers()
            // In a real multi-tenant app, the API already filters by tenant
            setStaff(data)
        } catch (error) {
            toast.error('Error al cargar personal')
        } finally {
            setStaffLoading(false)
        }
    }

    const fetchRoles = async () => {
        try {
            const rolesData = await roleService.getRoles()
            setRoles(rolesData.filter(r => r.name !== 'CLIENTE'))
        } catch (error) {
            toast.error('Error al cargar roles')
        }
    }

    const handleCreate = () => {
        setSelectedUser(null)
        setDialogOpen(true)
    }

    const handleEdit = (user: User) => {
        setSelectedUser(user)
        setDialogOpen(true)
    }

    const handleToggleStatus = async (user: User) => {
        if (!user.is_active && !canActivateMore) {
            toast.error('Límite de usuarios alcanzado', {
                description: `Tu plan permite hasta ${maxUsers} usuarios activos (incluyendo al administrador principal).`
            })
            return
        }

        try {
            await updateUser(user.id, { is_active: !user.is_active })
            toast.success(user.is_active ? 'Usuario desactivado' : 'Usuario activado')
            fetchStaff()
        } catch (error) {
            toast.error('No se pudo cambiar el estado del usuario')
        }
    }

    // Roles Logic
    const togglePermission = (roleId: number, menu: string) => {
        setRoles(prev => prev.map(r => {
            if (r.id !== roleId) return r
            const currentPermissions = r.permissions || {}
            return {
                ...r,
                permissions: {
                    ...currentPermissions,
                    [menu]: !currentPermissions[menu]
                }
            }
        }))
    }

    const saveRoles = async () => {
        try {
            setSavingRoles(true)
            await Promise.all(
                roles.map(role =>
                    roleService.updateRole(role.id, { permissions: role.permissions })
                )
            )
            toast.success('Permisos actualizados correctamente')
        } catch (error) {
            toast.error('Error al guardar permisos')
        } finally {
            setSavingRoles(false)
        }
    }

    const handleRoleChange = async (userId: number, roleId: string) => {
        try {
            setUpdatingUserId(userId)
            await updateUser(userId, { role_id: parseInt(roleId) })

            setStaff(prev => prev.map(u => {
                if (u.id !== userId) return u
                const newRole = roles.find(r => r.id === parseInt(roleId))
                return {
                    ...u,
                    role_id: parseInt(roleId),
                    role_obj: { ...u.role_obj!, name: newRole?.name || '' }
                }
            }))
            toast.success('Rol actualizado')
        } catch (error) {
            toast.error('Error al actualizar rol')
        } finally {
            setUpdatingUserId(null)
        }
    }

    const filteredRolesUsers = staff.filter(u =>
        (u.name || '').toLowerCase().includes(rolesSearchTerm.toLowerCase()) ||
        (u.rut || '').toLowerCase().includes(rolesSearchTerm.toLowerCase())
    )

    if (loading) {
        return (
            <div className="flex h-[400px] flex-col items-center justify-center gap-4">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                <p className="text-sm text-neutral-500 animate-pulse">Cargando personal y roles...</p>
            </div>
        )
    }

    return (
        <div className="flex-1 space-y-6 p-4 md:p-8 pt-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-white flex items-center gap-3">
                        <Users className="h-8 w-8 text-blue-600" />
                        Gestión de Personal
                    </h2>
                    <p className="text-neutral-500 mt-1">
                        Controla el acceso, roles y cupos de los trabajadores de tu empresa.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Badge variant="outline" className="h-9 px-3 gap-1.5 border-neutral-200 dark:border-neutral-800">
                        <UserCircle className="h-3.5 w-3.5 text-blue-500" />
                        Cupos: <span className={cn("font-bold", activeStaffCount >= maxUsers ? "text-red-500" : "text-emerald-600")}>
                            {activeStaffCount} / {maxUsers}
                        </span>
                    </Badge>
                </div>
            </div>

            <Tabs defaultValue="list" className="space-y-6">
                <TabsList className="bg-neutral-100 dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800">
                    <TabsTrigger value="list" className="gap-2">
                        <Users className="h-4 w-4" /> Personal
                    </TabsTrigger>
                    <TabsTrigger value="roles" className="gap-2">
                        <ShieldCheck className="h-4 w-4" /> Roles y Permisos
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="list" className="space-y-4">
                    <div className="flex justify-end">
                        <Button onClick={handleCreate} disabled={!canActivateMore} className="bg-blue-600 hover:bg-blue-700 gap-2 shadow-lg shadow-blue-600/20">
                            <Plus className="h-4 w-4" /> Nuevo Personal
                        </Button>
                    </div>

                    <Card className="border-neutral-200 dark:border-neutral-800 shadow-sm overflow-hidden">
                        <Table>
                            <TableHeader className="bg-neutral-50 dark:bg-neutral-900/50">
                                <TableRow>
                                    <TableHead className="w-[300px]">Nombre / Rol</TableHead>
                                    <TableHead>Email (Identificador)</TableHead>
                                    <TableHead>Identificación (RUT)</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead className="text-right">Acciones</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {staff.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-32 text-center text-neutral-500 italic">
                                            No hay personal registrado. Comienza agregando uno nuevo.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    staff.map((user) => (
                                        <TableRow key={user.id} className="hover:bg-neutral-50/50 dark:hover:bg-neutral-900/50 transition-colors">
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 shrink-0">
                                                        <UserCircle className="h-5 w-5" />
                                                    </div>
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="font-semibold text-neutral-900 dark:text-white truncate flex items-center gap-2">
                                                            {user.name}
                                                            {user.is_owner && (
                                                                <Badge className="bg-blue-600 h-4 text-[8px] px-1 font-black">ADMIN</Badge>
                                                            )}
                                                        </span>
                                                        <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium">
                                                            {user.role_obj?.name || user.role || 'Vendedor'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400 truncate max-w-[180px]">
                                                    <Mail className="h-3.5 w-3.5 text-neutral-400" />
                                                    {user.email || <span className="text-neutral-300 italic">Sin email</span>}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <Switch
                                                        checked={user.is_active}
                                                        onCheckedChange={() => handleToggleStatus(user)}
                                                        disabled={user.is_owner}
                                                    />
                                                    <span className={cn(
                                                        "text-[10px] font-bold uppercase tracking-wider",
                                                        user.is_active ? "text-emerald-600" : "text-neutral-400"
                                                    )}>
                                                        {user.is_active ? 'Activo' : 'Inactivo'}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-neutral-400 hover:text-blue-600" onClick={() => handleEdit(user)}>
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </Card>
                </TabsContent>

                <TabsContent value="roles" className="space-y-6">
                    <div className="flex items-center justify-between">
                        <div className="relative max-w-xs w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                            <Input
                                placeholder="Buscar usuario..."
                                value={rolesSearchTerm}
                                onChange={(e) => setRolesSearchTerm(e.target.value)}
                                className="pl-9 h-9"
                            />
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={loadAll} disabled={savingRoles}>
                                <RefreshCw className={cn("h-4 w-4 mr-2", staffLoading && "animate-spin")} /> Recargar
                            </Button>
                            <Button size="sm" onClick={saveRoles} disabled={savingRoles} className="bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/20">
                                <Save className="h-4 w-4 mr-2" /> {savingRoles ? 'Guardando...' : 'Guardar Permisos'}
                            </Button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        {/* Matrix Table */}
                        <div className="lg:col-span-8 space-y-4">
                            <Card className="border-neutral-200 dark:border-neutral-800">
                                <CardHeader className="py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="h-8 w-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
                                            <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                        </div>
                                        <div>
                                            <CardTitle className="text-lg">Configuración de Accesos</CardTitle>
                                            <CardDescription className="text-xs">Define la visibilidad del menú por rol.</CardDescription>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="overflow-x-auto">
                                        <table className="w-full border-collapse">
                                            <thead>
                                                <tr className="bg-neutral-50 dark:bg-neutral-900/50 border-y border-neutral-100 dark:border-neutral-800">
                                                    <th className="py-3 px-6 text-left text-xs font-bold uppercase tracking-wider text-neutral-500">Menú / Sección</th>
                                                    {roles.map(role => (
                                                        <th key={role.id} className="py-3 px-6 text-center text-xs font-bold uppercase tracking-wider text-neutral-500">
                                                            {role.name}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {MENU_ITEMS.map((item, idx) => (
                                                    <tr key={item} className="border-b border-neutral-100 dark:border-neutral-900 last:border-0 hover:bg-neutral-50/50 dark:hover:bg-neutral-900/30">
                                                        <td className="py-3 px-6 text-sm font-medium text-neutral-700 dark:text-neutral-300">
                                                            {item}
                                                        </td>
                                                        {roles.map(role => {
                                                            const isChecked = role.permissions?.[item] ?? false;
                                                            const isAdmin = role.name === 'ADMINISTRADOR';
                                                            return (
                                                                <td key={role.id} className="py-3 px-6 text-center text-sm">
                                                                    <div className="flex justify-center">
                                                                        <Checkbox
                                                                            checked={isChecked}
                                                                            onCheckedChange={() => togglePermission(role.id, item)}
                                                                            disabled={isAdmin}
                                                                            className="h-4.5 w-4.5 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                                                                        />
                                                                    </div>
                                                                </td>
                                                            )
                                                        })}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* User Role Assignment */}
                        <div className="lg:col-span-4 space-y-4">
                            <Card className="border-neutral-200 dark:border-neutral-800 sticky top-20">
                                <CardHeader className="py-4">
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <Users className="h-5 w-5 text-blue-500" /> Asignación Rápida
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="px-2 space-y-1">
                                    {filteredRolesUsers.length === 0 ? (
                                        <p className="text-center py-10 text-xs text-neutral-400 italic">No hay resultados</p>
                                    ) : (
                                        filteredRolesUsers.slice(0, 8).map(user => (
                                            <div key={user.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
                                                <div className="flex flex-col min-w-0 pr-2">
                                                    <span className="text-sm font-medium truncate">{user.name}</span>
                                                    <span className="text-[10px] text-neutral-400">{user.rut}</span>
                                                </div>
                                                <Select
                                                    value={user.role_id?.toString() || ""}
                                                    onValueChange={(val) => handleRoleChange(user.id, val)}
                                                    disabled={updatingUserId === user.id}
                                                >
                                                    <SelectTrigger className="h-8 w-[120px] text-xs">
                                                        <SelectValue placeholder="Sin Rol" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {roles.map(r => (
                                                            <SelectItem key={r.id} value={r.id.toString()} className="text-xs">
                                                                {r.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        ))
                                    )}
                                    {filteredRolesUsers.length > 8 && (
                                        <p className="text-center pt-2 text-[10px] text-neutral-400">Carga más resultados usando el buscador</p>
                                    )}
                                </CardContent>
                            </Card>

                            <div className="grid grid-cols-1 gap-2">
                                <div className="p-3 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/50 rounded-xl">
                                    <div className="flex items-center gap-1.5 mb-1 text-blue-700 dark:text-blue-400">
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        <span className="text-[10px] font-bold uppercase tracking-wider">Info: Admin</span>
                                    </div>
                                    <p className="text-[10px] text-blue-600 dark:text-blue-400 leading-relaxed">
                                        El rol ADMINISTRADOR tiene todos los permisos activos por defecto y no se puede limitar.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>

            {/* Dialogs */}
            <UserDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                onSuccess={fetchStaff}
                user={selectedUser}
                roles={roles}
                canActivateMore={canActivateMore}
            />
        </div>
    )
}
