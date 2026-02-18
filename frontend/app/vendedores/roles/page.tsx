'use client'

import { useState, useEffect } from 'react'
import {
    Users,
    ShieldCheck,
    Save,
    RefreshCw,
    CheckCircle2,
    XCircle,
    Search,
    UserCircle,
    Check
} from 'lucide-react'
import { roleService, Role } from '@/services/roles'
import { userService, User } from '@/services/users'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { useToast } from '@/components/ui/use-toast'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

// Estos deben coincidir con las etiquetas en Sidebar.tsx
const MENU_ITEMS = [
    'Dashboard',
    'Terminal POS',
    'Caja',
    'Productos',
    'Marcas',
    'Compras',
    'Clientes',
    'Proveedores',
    'Vendedores',
    'Historial',
    'Reportes de Ventas',
    'Configuración'
]

export default function RolesManagementPage() {
    const [roles, setRoles] = useState<Role[]>([])
    const [users, setUsers] = useState<User[]>([])
    const [filteredUsers, setFilteredUsers] = useState<User[]>([])
    const [searchTerm, setSearchTerm] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [updatingUserId, setUpdatingUserId] = useState<number | null>(null)
    const { toast } = useToast()

    useEffect(() => {
        init()
    }, [])

    useEffect(() => {
        const filtered = users.filter(u =>
            (u.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            u.rut.toLowerCase().includes(searchTerm.toLowerCase())
        )
        setFilteredUsers(filtered)
    }, [searchTerm, users])

    const init = async () => {
        try {
            setLoading(true)
            const [rolesData, usersData] = await Promise.all([
                roleService.getRoles(),
                userService.getUsers()
            ])
            // Filtrar cliente de la matriz
            setRoles(rolesData.filter(r => r.name !== 'CLIENTE'))
            setUsers(usersData)
        } catch (error) {
            toast({
                title: 'Error',
                description: 'No se pudieron cargar los datos.',
                variant: 'destructive'
            })
        } finally {
            setLoading(false)
        }
    }

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

    const saveChanges = async () => {
        try {
            setSaving(true)
            await Promise.all(
                roles.map(role =>
                    roleService.updateRole(role.id, { permissions: role.permissions })
                )
            )
            toast({
                title: 'Éxito',
                description: 'Permisos actualizados correctamente.',
            })
        } catch (error) {
            toast({
                title: 'Error',
                description: 'Hubo un problema al guardar los cambios.',
                variant: 'destructive'
            })
        } finally {
            setSaving(false)
        }
    }

    const handleRoleChange = async (userId: number, roleId: string) => {
        try {
            setUpdatingUserId(userId)
            await userService.updateUser(userId, { role_id: parseInt(roleId) })

            // Actualizar estado local
            setUsers(prev => prev.map(u => {
                if (u.id !== userId) return u
                const newRole = roles.find(r => r.id === parseInt(roleId))
                return {
                    ...u,
                    role_id: parseInt(roleId),
                    role_obj: { ...u.role_obj!, name: newRole?.name || '' }
                }
            }))

            toast({
                title: 'Usuario Actualizado',
                description: 'El rol del usuario ha sido modificado exitosamente.',
            })
        } catch (error) {
            toast({
                title: 'Error',
                description: 'No se pudo actualizar el rol del usuario.',
                variant: 'destructive'
            })
        } finally {
            setUpdatingUserId(null)
        }
    }

    if (loading) {
        return (
            <div className="p-8 space-y-6">
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-[400px] w-full" />
            </div>
        )
    }

    return (
        <div className="p-8 space-y-10 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-3">
                        <ShieldCheck className="h-8 w-8 text-blue-600" />
                        Gestión de Accesos y Seguridad
                    </h1>
                    <p className="text-slate-500 mt-2">
                        Controla quién puede ver qué en el sistema y asigna roles a tus usuarios.
                    </p>
                </div>
                <div className="flex gap-3">
                    <Button variant="outline" onClick={init} disabled={saving}>
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Recargar Todo
                    </Button>
                    <Button onClick={saveChanges} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                        <Save className="mr-2 h-4 w-4" />
                        {saving ? 'Guardando...' : 'Guardar Permisos'}
                    </Button>
                </div>
            </div>

            {/* Matriz de Permisos */}
            <Card className="border-slate-200 dark:border-slate-800">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-blue-500" />
                        Matriz de Visibilidad (Menú)
                    </CardTitle>
                    <CardDescription>
                        Define qué opciones del sidebar ve cada perfil. El rol CLIENTE está oculto por seguridad.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800">
                                    <th className="py-4 px-6 text-left font-semibold text-slate-700 dark:text-slate-300">Menú / Sección</th>
                                    {roles.map(role => (
                                        <th key={role.id} className="py-4 px-6 text-center font-semibold text-slate-700 dark:text-slate-300">
                                            <div className="flex flex-col items-center">
                                                <Users className="h-5 w-5 mb-1 text-slate-400" />
                                                {role.name}
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {MENU_ITEMS.map((item, idx) => (
                                    <tr
                                        key={item}
                                        className={cn(
                                            "border-b border-slate-100 dark:border-slate-900 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/50",
                                            idx === MENU_ITEMS.length - 1 && "border-0"
                                        )}
                                    >
                                        <td className="py-4 px-6 font-medium text-slate-600 dark:text-slate-400">
                                            {item}
                                        </td>
                                        {roles.map(role => {
                                            const isChecked = role.permissions?.[item] ?? false;
                                            const isAdmin = role.name === 'ADMINISTRADOR';

                                            return (
                                                <td key={role.id} className="py-4 px-6 text-center">
                                                    <div className="flex justify-center">
                                                        <Checkbox
                                                            checked={isChecked}
                                                            onCheckedChange={() => togglePermission(role.id, item)}
                                                            disabled={isAdmin && (item === 'Configuración' || item === 'Vendedores')}
                                                            className="h-5 w-5 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
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

            {/* Asignación de Usuarios */}
            <Card className="border-slate-200 dark:border-slate-800">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-blue-500" />
                        Asignación de Roles a Usuarios
                    </CardTitle>
                    <CardDescription>
                        Busca usuarios por nombre o RUT y cámbiales el rol asignado.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    {/* Buscador */}
                    <div className="relative max-w-sm">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder="Buscar por RUT o Nombre..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10"
                        />
                    </div>

                    <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                        <table className="w-full border-collapse text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-900/50">
                                <tr>
                                    <th className="py-3 px-4 text-left font-semibold text-slate-700 dark:text-slate-300">Usuario</th>
                                    <th className="py-3 px-4 text-left font-semibold text-slate-700 dark:text-slate-300">RUT</th>
                                    <th className="py-3 px-4 text-left font-semibold text-slate-700 dark:text-slate-300 w-[240px]">Rol Asignado</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredUsers.length > 0 ? (
                                    filteredUsers.slice(0, 50).map((user) => (
                                        <tr key={user.id} className="border-t border-slate-100 dark:border-slate-900">
                                            <td className="py-3 px-4 flex items-center gap-3 text-slate-900 dark:text-white">
                                                <UserCircle className="h-5 w-5 text-slate-400 shrink-0" />
                                                <span className="truncate">{user.name}</span>
                                            </td>
                                            <td className="py-3 px-4 text-slate-500">{user.rut}</td>
                                            <td className="py-3 px-4">
                                                <Select
                                                    value={user.role_id?.toString() || ""}
                                                    onValueChange={(val) => handleRoleChange(user.id, val)}
                                                    disabled={updatingUserId === user.id}
                                                >
                                                    <SelectTrigger className="h-9">
                                                        <SelectValue placeholder="Sin Rol" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {roles.map(r => (
                                                            <SelectItem key={r.id} value={r.id.toString()}>
                                                                {r.name}
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </td>
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={3} className="py-10 text-center text-slate-500">
                                            {searchTerm ? 'No se encontraron usuarios.' : 'Ingresa un término de búsqueda.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>

            {/* Avisos */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-10">
                <Card className="bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-bold flex items-center gap-2 text-blue-700 dark:text-blue-400">
                            <CheckCircle2 className="h-4 w-4" />
                            Nota de Administrador
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-xs text-blue-600 dark:text-blue-400 leading-relaxed">
                            La asignación de roles es inmediata. El usuario verá sus nuevos permisos tan pronto como navegue a una nueva sección o refresque la página.
                        </p>
                    </CardContent>
                </Card>
                <Card className="bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-bold flex items-center gap-2 text-amber-700 dark:text-amber-400">
                            <XCircle className="h-4 w-4" />
                            Acceso Directo
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                            Los Roles definen tanto lo que se VE (Menú) como lo que se PUEDE HACER (Acciones). Asegúrate de que los permisos granulares en el backend coincidan.
                        </p>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

// Utility function duplicated for simplicity in this component
function cn(...classes: any[]) {
    return classes.filter(Boolean).join(' ');
}
