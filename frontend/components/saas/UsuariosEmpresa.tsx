'use client'

import { useCallback, useEffect, useState } from 'react'
import { Edit, Loader2, ShieldPlus, Trash2, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AccionFila } from '@/components/ui/accion-fila'
import { AlertaError } from '@/components/ui/alerta-error'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SelectOpciones } from '@/components/ui/select-opciones'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { addTenantUser, getTenantUsers, updateTenant, updateTenantUser, type Tenant, type TenantUser } from '@/services/saas'
import { getApiErrorDetail, getApiErrorMessage } from '@/services/api'
import { avisar } from '@/lib/store/uiStore'
import { usePermisoSaas } from '@/lib/store/sessionStore'

const ROLES = [
    { value: 'ADMINISTRADOR', label: 'Administrador' },
    { value: 'VENDEDOR', label: 'Vendedor' },
    { value: 'BODEGUERO', label: 'Bodeguero' },
]

export function UsuariosEmpresa({ empresa, onCambio }: { empresa: Tenant; onCambio: () => void }) {
    const puedeEditarCupo = usePermisoSaas('empresas.editar')
    const [usuarios, setUsuarios] = useState<TenantUser[]>([])
    const [cargando, setCargando] = useState(true)
    const [nuevo, setNuevo] = useState({ email: '', password: '', full_name: '', role_name: 'VENDEDOR' })
    const [enviando, setEnviando] = useState(false)
    const [errorNuevo, setErrorNuevo] = useState<string | null>(null)
    const [editando, setEditando] = useState<TenantUser | null>(null)
    const [edicion, setEdicion] = useState({ role_name: '', full_name: '', password: '' })
    const [errorEdicion, setErrorEdicion] = useState<string | null>(null)
    const [aDesactivar, setADesactivar] = useState<TenantUser | null>(null)
    const [cupo, setCupo] = useState(empresa.max_users_override?.toString() ?? '')

    const cargar = useCallback(() => {
        setCargando(true)
        getTenantUsers(empresa.id)
            .then(setUsuarios)
            .catch((e) => avisar(getApiErrorMessage(e, 'No se pudieron cargar los usuarios.'), { reintentar: cargar }))
            .finally(() => setCargando(false))
    }, [empresa.id])
    useEffect(cargar, [cargar])

    const limite = empresa.max_users_override ?? empresa.plan_max_users ?? 3
    const activos = usuarios.filter((u) => u.is_active).length
    const lleno = activos >= limite

    const agregar = async (e: React.FormEvent) => {
        e.preventDefault()
        setEnviando(true)
        setErrorNuevo(null)
        try {
            await addTenantUser(empresa.id, { ...nuevo, password: nuevo.password || undefined, full_name: nuevo.full_name || undefined })
            setNuevo({ email: '', password: '', full_name: '', role_name: 'VENDEDOR' })
            cargar()
        } catch (err) {
            setErrorNuevo(getApiErrorDetail(err, 'No se pudo agregar el usuario.'))
        } finally {
            setEnviando(false)
        }
    }

    const guardarEdicion = async () => {
        if (!editando) return
        setEnviando(true)
        setErrorEdicion(null)
        try {
            await updateTenantUser(empresa.id, editando.user_id, {
                role_name: edicion.role_name, full_name: edicion.full_name, ...(edicion.password && { password: edicion.password }),
            })
            setEditando(null)
            cargar()
        } catch (err) {
            setErrorEdicion(getApiErrorDetail(err, 'No se pudo modificar el usuario.'))
        } finally {
            setEnviando(false)
        }
    }

    const alternarActivo = async (u: TenantUser) => {
        try {
            await updateTenantUser(empresa.id, u.user_id, { is_active: !u.is_active })
            cargar()
        } catch (err) {
            avisar(getApiErrorDetail(err, 'No se pudo cambiar el estado del usuario.'))
        }
    }

    const guardarCupo = async () => {
        try {
            await updateTenant(empresa.id, { max_users_override: cupo ? Number(cupo) : null })
            onCambio()
        } catch (err) {
            avisar(getApiErrorDetail(err, 'No se pudo cambiar el cupo.'))
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-end gap-3">
                <p className={lleno ? 'text-sm font-medium text-destructive' : 'text-sm text-muted-foreground'} role="status">
                    {activos} de {limite} usuarios activos
                </p>
                {puedeEditarCupo && (
                    <div className="flex items-end gap-2 sm:ml-auto">
                        <div className="space-y-1">
                            <Label htmlFor="cupo" className="text-xs">Cupo de usuarios</Label>
                            <Input id="cupo" type="number" min={1} inputMode="numeric" className="h-9 w-24"
                                placeholder={String(empresa.plan_max_users ?? 3)} value={cupo} onChange={(e) => setCupo(e.target.value)} />
                        </div>
                        <Button size="sm" variant="outline" onClick={guardarCupo}>Guardar cupo</Button>
                    </div>
                )}
            </div>

            <form onSubmit={agregar} autoComplete="off" className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h3 className="font-semibold">Agregar usuario</h3>
                <fieldset disabled={enviando || lleno} className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_0.9fr_auto]">
                    <Input type="email" required aria-label="Correo" placeholder="Correo *" value={nuevo.email}
                        onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} />
                    <Input type="password" aria-label="Contraseña" placeholder="Contraseña (si es nuevo)" autoComplete="new-password"
                        value={nuevo.password} onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })} />
                    <Input aria-label="Nombre" placeholder="Nombre" value={nuevo.full_name}
                        onChange={(e) => setNuevo({ ...nuevo, full_name: e.target.value })} />
                    <SelectOpciones aria-label="Rol" value={nuevo.role_name} onChange={(v) => v && setNuevo({ ...nuevo, role_name: v })} opciones={ROLES} />
                    <Button type="submit">{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Agregar</Button>
                </fieldset>
                {lleno && <p className="text-sm text-destructive">Se llegó al cupo del plan. Desactive a alguien o suba el cupo.</p>}
                <AlertaError mensaje={errorNuevo} />
            </form>

            <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Correo</TableHead>
                            <TableHead>Nombre</TableHead>
                            <TableHead>Rol</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead className="text-right"><span className="sr-only">Acciones</span></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {cargando && <TableEmpty colSpan={5} loading />}
                        {!cargando && usuarios.length === 0 && <TableEmpty colSpan={5}>Sin usuarios.</TableEmpty>}
                        {!cargando && usuarios.map((u) => (
                            <TableRow key={u.user_id}>
                                <TableCell className="font-medium">
                                    {u.user.email}
                                    {u.user.is_superuser && <Badge variant="outline" className="ml-2 text-xs">Factureando</Badge>}
                                </TableCell>
                                <TableCell className="text-muted-foreground">{u.user.full_name || '-'}</TableCell>
                                <TableCell>{ROLES.find((r) => r.value === u.role_name)?.label ?? u.role_name}</TableCell>
                                <TableCell className={u.is_active ? '' : 'text-muted-foreground'}>{u.is_active ? 'Activo' : 'Inactivo'}</TableCell>
                                <TableCell className="text-right">
                                    {!u.user.is_superuser && (
                                        <div className="flex justify-end gap-1">
                                            <AccionFila icon={Edit} label="Editar" onClick={() => {
                                                setEditando(u)
                                                setEdicion({ role_name: u.role_name, full_name: u.user.full_name || '', password: '' })
                                                setErrorEdicion(null)
                                            }} />
                                            {u.is_active
                                                ? <AccionFila icon={Trash2} label="Desactivar" peligro onClick={() => setADesactivar(u)} />
                                                : <AccionFila icon={ShieldPlus} label="Reactivar" disabled={lleno} onClick={() => alternarActivo(u)} />}
                                        </div>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Editar usuario</DialogTitle>
                        <DialogDescription>{editando?.user.email}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="editar-rol">Rol</Label>
                            <SelectOpciones id="editar-rol" value={edicion.role_name} onChange={(v) => v && setEdicion({ ...edicion, role_name: v })} opciones={ROLES} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="editar-nombre">Nombre</Label>
                            <Input id="editar-nombre" value={edicion.full_name} onChange={(e) => setEdicion({ ...edicion, full_name: e.target.value })} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="editar-clave">Nueva contraseña (opcional)</Label>
                            <Input id="editar-clave" type="password" autoComplete="new-password" placeholder="En blanco: no cambia"
                                value={edicion.password} onChange={(e) => setEdicion({ ...edicion, password: e.target.value })} />
                            <p className="text-xs text-muted-foreground">Si olvidó su clave, escriba una nueva y entréguesela en persona o por un canal seguro.</p>
                        </div>
                        <AlertaError mensaje={errorEdicion} />
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
                            <Button onClick={guardarEdicion} disabled={enviando}>{enviando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={!!aDesactivar}
                onOpenChange={(o) => !o && setADesactivar(null)}
                title="¿Desactivar usuario?"
                description={`${aDesactivar?.user.email} ya no podrá entrar a esta empresa.`}
                confirmLabel="Desactivar"
                onConfirm={async () => { if (aDesactivar) await alternarActivo(aDesactivar) }}
            />
        </div>
    )
}
