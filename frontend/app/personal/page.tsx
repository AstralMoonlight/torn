'use client'

import { useCallback, useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
    Users,
    ShieldCheck,
    Plus,
    Pencil,
    Loader2,
    Mail,
    RefreshCw,
    Save,
    CheckCircle2,
    UserCircle
} from 'lucide-react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableEmpty
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { SearchInput } from '@/components/ui/search-input'
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
import { getUsers, updateUser, type User } from '@/services/users'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
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

    const fetchStaff = useCallback(async () => {
        try {
            setStaffLoading(true)
            const data = await getUsers()
            // In a real multi-tenant app, the API already filters by tenant
            setStaff(data)
        } catch {
            toast.error('Error al cargar personal')
        } finally {
            setStaffLoading(false)
        }
    }, [])

    const fetchRoles = useCallback(async () => {
        try {
            const rolesData = await roleService.getRoles()
            setRoles(rolesData.filter(r => r.name !== 'CLIENTE'))
        } catch {
            toast.error('Error al cargar roles')
        }
    }, [])

    const loadAll = useCallback(async () => {
        try {
            setLoading(true)
            await Promise.all([fetchStaff(), fetchRoles()])
        } finally {
            setLoading(false)
        }
    }, [fetchStaff, fetchRoles])

    useEffect(() => {
        loadAll()
    }, [selectedTenantId, loadAll])

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
        } catch {
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
        } catch {
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
        } catch {
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
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground animate-pulse">Cargando personal y roles...</p>
            </div>
        )
    }

    return (
        <PageContainer>
            <PageHeader
                icon={Users}
                title="Gestión de Personal"
                description="Controla el acceso, roles y cupos de los trabajadores de tu empresa."
                actions={
                    <Badge variant="outline" className="h-9 px-3 gap-1.5">
                        <UserCircle className="h-3.5 w-3.5 text-muted-foreground" />
                        Cupos: <span className={cn("font-bold", activeStaffCount >= maxUsers && "text-destructive")}>
                            {activeStaffCount} / {maxUsers}
                        </span>
                    </Badge>
                }
            />

            <Tabs defaultValue="list" className="space-y-6">
                <TabsList>
                    <TabsTrigger value="list" className="gap-2">
                        <Users className="h-4 w-4" /> Personal
                    </TabsTrigger>
                    <TabsTrigger value="roles" className="gap-2">
                        <ShieldCheck className="h-4 w-4" /> Roles y Permisos
                    </TabsTrigger>
                </TabsList>

                <TabsContent data-section="personal.usuarios" value="list" className="space-y-4">
                    <div className="flex justify-end">
                        <Button onClick={handleCreate} disabled={!canActivateMore} className="gap-2 shadow-lg shadow-primary/20">
                            <Plus className="h-4 w-4" /> Nuevo Personal
                        </Button>
                    </div>

                    <Card className="border-border shadow-sm overflow-hidden">
                        <Table>
                            <TableHeader>
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
                                    <TableEmpty colSpan={5}>No hay personal registrado. Comienza agregando uno nuevo.</TableEmpty>
                                ) : (
                                    staff.map((user) => (
                                        <TableRow key={user.id} className="hover:bg-muted/50 transition-colors">
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
                                                        <UserCircle className="h-5 w-5" />
                                                    </div>
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="font-semibold text-foreground truncate flex items-center gap-2">
                                                            {user.name}
                                                            {user.is_owner && (
                                                                <Badge className="bg-primary h-4 text-[8px] px-1 font-black">ADMIN</Badge>
                                                            )}
                                                        </span>
                                                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                                                            {user.role_obj?.name || user.role || 'Vendedor'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1.5 text-muted-foreground dark:text-muted-foreground truncate max-w-[180px]">
                                                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                                                    {user.email || <span className="text-muted-foreground italic">Sin email</span>}
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
                                                        user.is_active ? "text-foreground font-semibold" : "text-muted-foreground"
                                                    )}>
                                                        {user.is_active ? 'Activo' : 'Inactivo'}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => handleEdit(user)} title="Editar">
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

                <TabsContent data-section="personal.roles" value="roles" className="space-y-6">
                    <div className="flex items-center justify-between">
                        <SearchInput className="max-w-xs w-full" placeholder="Buscar usuario..." value={rolesSearchTerm} onChange={(e) => setRolesSearchTerm(e.target.value)} />
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={loadAll} disabled={savingRoles}>
                                <RefreshCw className={cn("h-4 w-4 mr-2", staffLoading && "animate-spin")} /> Recargar
                            </Button>
                            <Button size="sm" onClick={saveRoles} disabled={savingRoles} className="shadow-lg shadow-primary/20">
                                <Save className="h-4 w-4 mr-2" /> {savingRoles ? 'Guardando...' : 'Guardar Permisos'}
                            </Button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                        {/* Matrix Table */}
                        <div className="lg:col-span-8 space-y-4">
                            <Card className="border-border">
                                <CardHeader className="py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                            <ShieldCheck className="h-5 w-5 text-primary" />
                                        </div>
                                        <div>
                                            <CardTitle className="text-lg">Configuración de Accesos</CardTitle>
                                            <CardDescription className="text-xs">Define la visibilidad del menú por rol.</CardDescription>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="p-0">
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="border-y border-border">
                                                    <TableHead>Menú / Sección</TableHead>
                                                    {roles.map(role => (
                                                        <TableHead key={role.id} className="text-center">
                                                            {role.name}
                                                        </TableHead>
                                                    ))}
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {MENU_ITEMS.map((item) => (
                                                    <TableRow key={item} className="border-b border-border last:border-0 hover:bg-accent/50">
                                                        <TableCell className="font-medium text-foreground">
                                                            {item}
                                                        </TableCell>
                                                        {roles.map(role => {
                                                            const isChecked = role.permissions?.[item] ?? false;
                                                            const isAdmin = role.name === 'ADMINISTRADOR';
                                                            return (
                                                                <TableCell key={role.id} className="text-center">
                                                                    <div className="flex justify-center">
                                                                        <Checkbox
                                                                            checked={isChecked}
                                                                            onCheckedChange={() => togglePermission(role.id, item)}
                                                                            disabled={isAdmin}
                                                                            className="h-4.5 w-4.5 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                                                                        />
                                                                    </div>
                                                                </TableCell>
                                                            )
                                                        })}
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {/* User Role Assignment */}
                        <div className="lg:col-span-4 space-y-4">
                            <Card className="border-border sticky top-20">
                                <CardHeader className="py-4">
                                    <CardTitle className="text-lg flex items-center gap-2">
                                        <Users className="h-5 w-5 text-primary" /> Asignación Rápida
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="px-2 space-y-1">
                                    {filteredRolesUsers.length === 0 ? (
                                        <p className="text-center py-10 text-xs text-muted-foreground italic">No hay resultados</p>
                                    ) : (
                                        filteredRolesUsers.slice(0, 8).map(user => (
                                            <div key={user.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-accent transition-colors">
                                                <div className="flex flex-col min-w-0 pr-2">
                                                    <span className="text-sm font-medium truncate">{user.name}</span>
                                                    <span className="text-[10px] text-muted-foreground">{user.rut}</span>
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
                                        <p className="text-center pt-2 text-[10px] text-muted-foreground">Carga más resultados usando el buscador</p>
                                    )}
                                </CardContent>
                            </Card>

                            <div className="grid grid-cols-1 gap-2">
                                <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl">
                                    <div className="flex items-center gap-1.5 mb-1 text-primary">
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                        <span className="text-[10px] font-bold uppercase tracking-wider">Info: Admin</span>
                                    </div>
                                    <p className="text-[10px] text-primary leading-relaxed">
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
        </PageContainer>
    )
}
