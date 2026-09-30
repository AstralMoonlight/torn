'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Pencil, Plus, ShieldPlus, Trash2, Users } from 'lucide-react'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AccionFila } from '@/components/ui/accion-fila'
import { AlertaError } from '@/components/ui/alerta-error'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SelectOpciones } from '@/components/ui/select-opciones'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
    createCargo, createMiembro, deleteCargo, getCargos, getEquipo, getPermisos, updateCargo, updateMiembro,
    type Cargo, type Miembro, type Permiso,
} from '@/services/saas'
import { getApiErrorDetail, getApiErrorMessage } from '@/services/api'
import { avisar } from '@/lib/store/uiStore'
import { useSessionStore } from '@/lib/store/sessionStore'

type EdicionMiembro = { id: number | null; email: string; full_name: string; password: string; cargo_id: number | '' }

export default function EquipoPage() {
    const esDueno = useSessionStore((s) => s.user?.es_dueno === true)
    const [equipo, setEquipo] = useState<Miembro[]>([])
    const [cargos, setCargos] = useState<Cargo[]>([])
    const [permisos, setPermisos] = useState<Permiso[]>([])
    const [cargando, setCargando] = useState(true)
    const [cargo, setCargo] = useState<{ id: number | null; nombre: string; permisos: string[] } | null>(null)
    const [miembro, setMiembro] = useState<EdicionMiembro | null>(null)
    const [aDesactivar, setADesactivar] = useState<Miembro | null>(null)
    const [aBorrar, setABorrar] = useState<Cargo | null>(null)
    const [guardando, setGuardando] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const cargar = useCallback(() => {
        setCargando(true)
        Promise.all([getEquipo(), getCargos(), getPermisos()])
            .then(([e, c, p]) => { setEquipo(e); setCargos(c); setPermisos(p) })
            .catch((err) => avisar(getApiErrorMessage(err, 'No se pudo cargar el equipo.'), { reintentar: cargar }))
            .finally(() => setCargando(false))
    }, [])
    useEffect(() => { if (esDueno) cargar() }, [esDueno, cargar])

    if (!esDueno) {
        return <PageContainer><PageHeader icon={Users} title="Equipo" description="Solo el dueño administra el equipo." /></PageContainer>
    }

    const guardar = async (accion: () => Promise<unknown>, fallo: string, cerrar: () => void) => {
        setGuardando(true)
        setError(null)
        try {
            await accion()
            cerrar()
            cargar()
        } catch (err) {
            setError(getApiErrorDetail(err, fallo))
        } finally {
            setGuardando(false)
        }
    }

    const nombreCargo = (id: number | null) => (id === null ? 'Dueño' : cargos.find((c) => c.id === id)?.nombre ?? '-')
    const opcionesCargo = cargos.map((c) => ({ value: c.id, label: c.nombre }))

    return (
        <PageContainer>
            <PageHeader
                icon={Users}
                title="Equipo de Factureando"
                description="Superusuarios que le ayudan a administrar. Cada uno puede solo lo que incluye su cargo."
            />

            <section aria-labelledby="titulo-personas" className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 id="titulo-personas" className="text-lg font-semibold">Personas</h2>
                    <Button disabled={cargos.length === 0} aria-describedby={cargos.length === 0 ? 'sin-cargos' : undefined}
                        onClick={() => { setError(null); setMiembro({ id: null, email: '', full_name: '', password: '', cargo_id: cargos[0]?.id ?? '' }) }}>
                        <Plus className="h-4 w-4" /> Agregar persona
                    </Button>
                </div>
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Persona</TableHead>
                                <TableHead>Cargo</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead><span className="sr-only">Acciones</span></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {cargando && <TableEmpty colSpan={4} loading />}
                            {!cargando && equipo.map((m) => (
                                <TableRow key={m.id}>
                                    <TableCell>
                                        <p className="font-medium">{m.full_name || m.email}</p>
                                        {m.full_name && <p className="text-xs text-muted-foreground">{m.email}</p>}
                                    </TableCell>
                                    <TableCell>{nombreCargo(m.cargo_id)}</TableCell>
                                    <TableCell className={m.is_active ? '' : 'text-muted-foreground'}>{m.is_active ? 'Activo' : 'Desactivado'}</TableCell>
                                    <TableCell className="text-right">
                                        {!m.es_dueno && (
                                            <div className="flex justify-end gap-1">
                                                <AccionFila icon={Pencil} label="Editar" onClick={() => {
                                                    setError(null)
                                                    setMiembro({ id: m.id, email: m.email, full_name: m.full_name ?? '', password: '', cargo_id: m.cargo_id ?? '' })
                                                }} />
                                                {m.is_active
                                                    ? <AccionFila icon={Trash2} label="Desactivar" peligro onClick={() => setADesactivar(m)} />
                                                    : <AccionFila icon={ShieldPlus} label="Reactivar" onClick={() =>
                                                        updateMiembro(m.id, { is_active: true }).then(cargar)
                                                            .catch((err) => avisar(getApiErrorDetail(err, 'No se pudo reactivar.')))} />}
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </section>

            <section aria-labelledby="titulo-cargos" className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 id="titulo-cargos" className="text-lg font-semibold">Cargos</h2>
                    <Button variant="outline" onClick={() => { setError(null); setCargo({ id: null, nombre: '', permisos: [] }) }}>
                        <Plus className="h-4 w-4" /> Nuevo cargo
                    </Button>
                </div>
                {!cargando && cargos.length === 0 && (
                    <p id="sin-cargos" className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                        Aún no hay cargos. Cree uno (por ejemplo, Soporte o Cobranza) y elija qué puede hacer.
                    </p>
                )}
                <div className="grid gap-3 md:grid-cols-2">
                    {cargos.map((c) => (
                        <article key={c.id} className="rounded-xl border border-border bg-card p-4">
                            <div className="flex items-start justify-between gap-2">
                                <h3 className="font-semibold">{c.nombre}</h3>
                                <div className="flex gap-1">
                                    <AccionFila icon={Pencil} label={`Editar ${c.nombre}`} onClick={() => { setError(null); setCargo({ ...c }) }} />
                                    <AccionFila icon={Trash2} label={`Borrar ${c.nombre}`} peligro onClick={() => setABorrar(c)} />
                                </div>
                            </div>
                            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                                {c.permisos.length === 0 && <li>Sin permisos</li>}
                                {permisos.filter((p) => c.permisos.includes(p.clave)).map((p) => <li key={p.clave}>{p.nombre}</li>)}
                            </ul>
                        </article>
                    ))}
                </div>
            </section>

            <Dialog open={!!cargo} onOpenChange={(o) => !o && setCargo(null)}>
                <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
                    {cargo && (
                        <form className="space-y-4" onSubmit={(e) => {
                            e.preventDefault()
                            const datos = { nombre: cargo.nombre, permisos: cargo.permisos }
                            guardar(() => (cargo.id ? updateCargo(cargo.id, datos) : createCargo(datos)), 'No se pudo guardar el cargo.', () => setCargo(null))
                        }}>
                            <DialogHeader>
                                <DialogTitle>{cargo.id ? 'Editar cargo' : 'Nuevo cargo'}</DialogTitle>
                                <DialogDescription>Los cambios rigen desde la próxima acción de quien tenga el cargo.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-2">
                                <Label htmlFor="cargo-nombre">Nombre</Label>
                                <Input id="cargo-nombre" required maxLength={60} placeholder="Ej. Soporte" value={cargo.nombre}
                                    onChange={(e) => setCargo({ ...cargo, nombre: e.target.value })} />
                            </div>
                            <fieldset className="space-y-2">
                                <legend className="text-sm font-medium mb-2">Puede</legend>
                                {permisos.map((p) => (
                                    <div key={p.clave} className="flex items-start gap-2">
                                        <Checkbox
                                            id={`permiso-${p.clave}`}
                                            checked={cargo.permisos.includes(p.clave)}
                                            onCheckedChange={(v) => setCargo({
                                                ...cargo,
                                                permisos: v === true ? [...cargo.permisos, p.clave] : cargo.permisos.filter((x) => x !== p.clave),
                                            })}
                                        />
                                        <Label htmlFor={`permiso-${p.clave}`} className="font-normal leading-snug">{p.nombre}</Label>
                                    </div>
                                ))}
                            </fieldset>
                            <AlertaError mensaje={error} />
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setCargo(null)}>Cancelar</Button>
                                <Button type="submit" disabled={guardando}>{guardando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={!!miembro} onOpenChange={(o) => !o && setMiembro(null)}>
                <DialogContent className="sm:max-w-md">
                    {miembro && (
                        <form className="space-y-4" autoComplete="off" onSubmit={(e) => {
                            e.preventDefault()
                            if (!miembro.cargo_id) return
                            const cargoId = miembro.cargo_id
                            guardar(
                                () => miembro.id
                                    ? updateMiembro(miembro.id, { full_name: miembro.full_name, cargo_id: cargoId, ...(miembro.password && { password: miembro.password }) })
                                    : createMiembro({ email: miembro.email, full_name: miembro.full_name || undefined, password: miembro.password, cargo_id: cargoId }),
                                'No se pudo guardar la persona.',
                                () => setMiembro(null),
                            )
                        }}>
                            <DialogHeader>
                                <DialogTitle>{miembro.id ? 'Editar persona' : 'Agregar persona al equipo'}</DialogTitle>
                                <DialogDescription>Entra con este correo y contraseña, y va directo al panel de administración.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-2">
                                <Label htmlFor="miembro-email">Correo</Label>
                                <Input id="miembro-email" type="email" required disabled={!!miembro.id} value={miembro.email}
                                    onChange={(e) => setMiembro({ ...miembro, email: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="miembro-nombre">Nombre</Label>
                                <Input id="miembro-nombre" value={miembro.full_name} onChange={(e) => setMiembro({ ...miembro, full_name: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="miembro-clave">{miembro.id ? 'Nueva contraseña (opcional)' : 'Contraseña'}</Label>
                                <Input id="miembro-clave" type="password" autoComplete="new-password" minLength={8} required={!miembro.id}
                                    placeholder="Mínimo 8 caracteres" value={miembro.password} onChange={(e) => setMiembro({ ...miembro, password: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="miembro-cargo">Cargo</Label>
                                <SelectOpciones id="miembro-cargo" value={miembro.cargo_id} onChange={(v) => setMiembro({ ...miembro, cargo_id: v })} opciones={opcionesCargo} />
                            </div>
                            <AlertaError mensaje={error} />
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setMiembro(null)}>Cancelar</Button>
                                <Button type="submit" disabled={guardando || !miembro.cargo_id}>{guardando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={!!aDesactivar}
                onOpenChange={(o) => !o && setADesactivar(null)}
                title="¿Desactivar a esta persona?"
                description={`${aDesactivar?.email} deja de poder entrar, incluso si tiene la sesión abierta.`}
                confirmLabel="Desactivar"
                onConfirm={async () => {
                    if (!aDesactivar) return
                    try { await updateMiembro(aDesactivar.id, { is_active: false }); cargar() }
                    catch (err) { avisar(getApiErrorDetail(err, 'No se pudo desactivar.')) }
                }}
            />
            <ConfirmDialog
                open={!!aBorrar}
                onOpenChange={(o) => !o && setABorrar(null)}
                title={`¿Borrar el cargo ${aBorrar?.nombre ?? ''}?`}
                description="Solo se puede borrar si nadie lo tiene."
                confirmLabel="Borrar"
                onConfirm={async () => {
                    if (!aBorrar) return
                    try { await deleteCargo(aBorrar.id); cargar() }
                    catch (err) { avisar(getApiErrorDetail(err, 'No se pudo borrar el cargo.')) }
                }}
            />
        </PageContainer>
    )
}
