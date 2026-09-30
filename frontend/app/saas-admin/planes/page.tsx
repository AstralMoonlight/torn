'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Package, Pencil, Plus } from 'lucide-react'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { AccionFila } from '@/components/ui/accion-fila'
import { AlertaError } from '@/components/ui/alerta-error'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { createPlan, getAjustes, getPlanes, putAjustes, updatePlan, type AjustesCobranza, type Plan, type PlanIn } from '@/services/saas'
import { getApiErrorDetail, getApiErrorMessage } from '@/services/api'
import { avisar } from '@/lib/store/uiStore'
import { usePermisoSaas } from '@/lib/store/sessionStore'
import { formatCLP } from '@/lib/format'

const PLAN_VACIO: PlanIn = {
    name: '', description: '', precio: 0, meses: 1, max_users: 3, cuotas_sin_interes: false, incluye_impresora: '', is_active: true,
}

const duracion = (meses: number) => (meses === 0 ? 'No vence' : meses === 1 ? '1 mes' : `${meses} meses`)

export default function PlanesPage() {
    const puedeEditar = usePermisoSaas('planes.editar')
    const [planes, setPlanes] = useState<Plan[]>([])
    const [cargando, setCargando] = useState(true)
    const [ajustes, setAjustes] = useState<AjustesCobranza | null>(null)
    const [editando, setEditando] = useState<{ id: number | null; plan: PlanIn } | null>(null)
    const [guardando, setGuardando] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [errorAjustes, setErrorAjustes] = useState<string | null>(null)

    const cargar = useCallback(() => {
        setCargando(true)
        Promise.all([getPlanes(), getAjustes()])
            .then(([p, a]) => { setPlanes(p); setAjustes(a) })
            .catch((e) => avisar(getApiErrorMessage(e, 'No se pudieron cargar los planes.'), { reintentar: cargar }))
            .finally(() => setCargando(false))
    }, [])
    useEffect(cargar, [cargar])

    const guardarPlan = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editando) return
        setGuardando(true)
        setError(null)
        const datos = { ...editando.plan, incluye_impresora: editando.plan.incluye_impresora || null, description: editando.plan.description || null }
        try {
            if (editando.id) await updatePlan(editando.id, datos)
            else await createPlan(datos)
            setEditando(null)
            cargar()
        } catch (err) {
            setError(getApiErrorDetail(err, 'No se pudo guardar el plan.'))
        } finally {
            setGuardando(false)
        }
    }

    const guardarAjustes = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!ajustes) return
        setErrorAjustes(null)
        try {
            setAjustes(await putAjustes(ajustes))
        } catch (err) {
            setErrorAjustes(getApiErrorDetail(err, 'No se pudieron guardar las reglas.'))
        }
    }

    const p = editando?.plan
    const setP = (cambio: Partial<PlanIn>) => editando && setEditando({ ...editando, plan: { ...editando.plan, ...cambio } })
    const numero = (v: string) => (v === '' ? 0 : Math.max(0, Math.trunc(Number(v))))

    return (
        <PageContainer>
            <PageHeader
                icon={Package}
                title="Planes y cobranza"
                description="Precios con IVA. Cambiar un precio rige desde el próximo pago."
                actions={puedeEditar && (
                    <Button onClick={() => { setError(null); setEditando({ id: null, plan: PLAN_VACIO }) }}><Plus className="h-4 w-4" /> Nuevo plan</Button>
                )}
            />

            <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Plan</TableHead>
                            <TableHead>Duración</TableHead>
                            <TableHead className="text-right">Precio</TableHead>
                            <TableHead className="hidden md:table-cell">Incluye</TableHead>
                            <TableHead className="hidden md:table-cell">Usuarios</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead><span className="sr-only">Acciones</span></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {cargando && <TableEmpty colSpan={7} loading />}
                        {!cargando && planes.length === 0 && <TableEmpty colSpan={7}>No hay planes.</TableEmpty>}
                        {!cargando && planes.map((pl) => (
                            <TableRow key={pl.id}>
                                <TableCell>
                                    <p className="font-medium">{pl.name}</p>
                                    {pl.description && <p className="text-xs text-muted-foreground">{pl.description}</p>}
                                </TableCell>
                                <TableCell>{duracion(pl.meses)}</TableCell>
                                <TableCell className="text-right font-tabular">
                                    {formatCLP(pl.precio)}
                                    {pl.meses > 1 && <p className="text-xs text-muted-foreground">{formatCLP(Math.round(pl.precio / pl.meses))} al mes</p>}
                                </TableCell>
                                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                                    {[pl.incluye_impresora && `Impresora ${pl.incluye_impresora}`, pl.cuotas_sin_interes && 'Cuotas sin interés'].filter(Boolean).join(' · ') || '-'}
                                </TableCell>
                                <TableCell className="hidden md:table-cell font-tabular">{pl.max_users}</TableCell>
                                <TableCell className={pl.is_active ? '' : 'text-muted-foreground'}>{pl.is_active ? 'A la venta' : 'Retirado'}</TableCell>
                                <TableCell className="text-right">
                                    {puedeEditar && <AccionFila icon={Pencil} label="Editar plan" onClick={() => {
                                        setError(null)
                                        setEditando({ id: pl.id, plan: { ...pl, description: pl.description ?? '', incluye_impresora: pl.incluye_impresora ?? '' } })
                                    }} />}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {ajustes && (
                <form onSubmit={guardarAjustes} className="space-y-4 rounded-xl border border-border bg-card p-4">
                    <div>
                        <h2 className="font-semibold">Reglas de cobranza</h2>
                        <p className="text-sm text-muted-foreground">
                            Cuándo se avisa, cuántos días sigue funcionando una empresa vencida y cuánto dura una prórroga. Suspendida, la empresa solo puede consultar.
                        </p>
                    </div>
                    <fieldset disabled={!puedeEditar} className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-2">
                            <Label htmlFor="dias-aviso">Avisar antes de vencer (días)</Label>
                            <Input id="dias-aviso" type="number" min={0} max={60} value={ajustes.dias_aviso}
                                onChange={(e) => setAjustes({ ...ajustes, dias_aviso: numero(e.target.value) })} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="dias-gracia">Días de gracia tras vencer</Label>
                            <Input id="dias-gracia" type="number" min={0} max={60} value={ajustes.dias_gracia}
                                onChange={(e) => setAjustes({ ...ajustes, dias_gracia: numero(e.target.value) })} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="horas-prorroga">Prórroga propuesta (horas)</Label>
                            <Input id="horas-prorroga" type="number" min={1} max={720} value={ajustes.horas_prorroga}
                                onChange={(e) => setAjustes({ ...ajustes, horas_prorroga: numero(e.target.value) })} />
                        </div>
                    </fieldset>
                    <AlertaError mensaje={errorAjustes} />
                    {puedeEditar && (
                        <div className="flex items-center justify-end gap-3">
                            <Button type="submit">Guardar reglas</Button>
                        </div>
                    )}
                </form>
            )}

            <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
                <DialogContent className="sm:max-w-lg">
                    {p && (
                        <form onSubmit={guardarPlan} className="space-y-4">
                            <DialogHeader>
                                <DialogTitle>{editando?.id ? 'Editar plan' : 'Nuevo plan'}</DialogTitle>
                                <DialogDescription>Precio de todo el período, con IVA. 0 meses = Cortesía (no vence).</DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-2 sm:col-span-2">
                                    <Label htmlFor="plan-nombre">Nombre</Label>
                                    <Input id="plan-nombre" required maxLength={100} value={p.name} onChange={(e) => setP({ name: e.target.value })} />
                                </div>
                                <div className="space-y-2 sm:col-span-2">
                                    <Label htmlFor="plan-descripcion">Descripción</Label>
                                    <Input id="plan-descripcion" value={p.description ?? ''} onChange={(e) => setP({ description: e.target.value })} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="plan-precio">Precio (con IVA)</Label>
                                    <Input id="plan-precio" type="number" min={0} inputMode="numeric" value={p.precio} onChange={(e) => setP({ precio: numero(e.target.value) })} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="plan-meses">Meses</Label>
                                    <Input id="plan-meses" type="number" min={0} max={36} value={p.meses} onChange={(e) => setP({ meses: numero(e.target.value) })} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="plan-usuarios">Usuarios</Label>
                                    <Input id="plan-usuarios" type="number" min={1} value={p.max_users} onChange={(e) => setP({ max_users: Math.max(1, numero(e.target.value)) })} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="plan-impresora">Impresora incluida</Label>
                                    <Input id="plan-impresora" maxLength={40} placeholder="Ej. Térmica 80 mm" value={p.incluye_impresora ?? ''} onChange={(e) => setP({ incluye_impresora: e.target.value })} />
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Switch id="plan-cuotas" checked={p.cuotas_sin_interes} onCheckedChange={(v) => setP({ cuotas_sin_interes: v })} />
                                <Label htmlFor="plan-cuotas">Cuotas sin interés en Flow (la comisión la paga Factureando)</Label>
                            </div>
                            <div className="flex items-center gap-3">
                                <Switch id="plan-activo" checked={p.is_active} onCheckedChange={(v) => setP({ is_active: v })} />
                                <Label htmlFor="plan-activo">A la venta</Label>
                            </div>
                            <AlertaError mensaje={error} />
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
                                <Button type="submit" disabled={guardando}>{guardando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            </Dialog>
        </PageContainer>
    )
}
