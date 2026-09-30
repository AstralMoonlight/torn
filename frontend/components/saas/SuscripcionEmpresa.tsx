'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Clock, Copy, CreditCard, Link2, Loader2, Package } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertaError } from '@/components/ui/alerta-error'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SelectOpciones } from '@/components/ui/select-opciones'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EstadoSuscripcionBadge } from './EstadoSuscripcion'
import {
    anularPago, cambiarSuscripcion, crearLinkPago, darProrroga, getAjustes, getPagos, registrarPago,
    type Pago, type Plan, type Tenant,
} from '@/services/saas'
import { getApiErrorDetail, getApiErrorMessage } from '@/services/api'
import { usePermisoSaas } from '@/lib/store/sessionStore'
import { avisar } from '@/lib/store/uiStore'
import { fechaHora, formatCLP, formatDate } from '@/lib/format'

type Dialogo = null | 'pago' | 'link' | 'prorroga' | 'plan'

const MEDIOS = { PASARELA: 'Flow', TRANSFERENCIA: 'Transferencia', EFECTIVO: 'Efectivo' } as const
const ESTADOS_PAGO = { PENDIENTE: 'Pendiente', PAGADO: 'Pagado', FALLIDO: 'Fallido', ANULADO: 'Anulado' } as const

export function SuscripcionEmpresa({ empresa, planes, onCambio }: {
    empresa: Tenant
    planes: Plan[]
    /** Algo cambió: la ficha vuelve a pedir la empresa. */
    onCambio: () => void
}) {
    const puedeCobrar = usePermisoSaas('cobros.registrar')
    const puedeProrrogar = usePermisoSaas('cobros.prorroga')
    const puedeVerPagos = usePermisoSaas('cobros.ver')
    const [pagos, setPagos] = useState<Pago[]>([])
    const [dialogo, setDialogo] = useState<Dialogo>(null)
    const [error, setError] = useState<string | null>(null)
    const [ocupado, setOcupado] = useState(false)
    const [aAnular, setAAnular] = useState<Pago | null>(null)

    const pagables = planes.filter((p) => p.is_active && p.meses > 0)
    const plan = planes.find((p) => p.id === empresa.plan_id)
    const [planId, setPlanId] = useState<number | ''>('')
    const [medio, setMedio] = useState<'TRANSFERENCIA' | 'EFECTIVO'>('TRANSFERENCIA')
    const [monto, setMonto] = useState('')
    const [nota, setNota] = useState('')
    const [email, setEmail] = useState('')
    const [link, setLink] = useState('')
    const [copiado, setCopiado] = useState(false)
    const [horas, setHoras] = useState('12')
    const [vence, setVence] = useState('')

    const cargarPagos = useCallback(() => {
        if (!puedeVerPagos) return
        getPagos({ tenant_id: empresa.id })
            .then(setPagos)
            .catch((e) => avisar(getApiErrorMessage(e, 'No se pudieron cargar los pagos.'), { reintentar: cargarPagos }))
    }, [empresa.id, puedeVerPagos])
    useEffect(cargarPagos, [cargarPagos])

    const abrir = (d: Dialogo) => {
        setError(null)
        setLink('')
        setCopiado(false)
        const propuesto = plan && plan.meses > 0 ? plan.id : pagables[0]?.id ?? ''
        setPlanId(d === 'plan' ? empresa.plan_id ?? '' : propuesto)
        setMonto('')
        setNota('')
        setEmail('')
        setVence(empresa.suscripcion_vence ?? '')
        if (d === 'prorroga') getAjustes().then((a) => setHoras(String(a.horas_prorroga))).catch(() => setHoras('12'))
        setDialogo(d)
    }

    const ejecutar = async (accion: () => Promise<void>, fallo: string) => {
        setOcupado(true)
        setError(null)
        try {
            await accion()
        } catch (e) {
            setError(getApiErrorDetail(e, fallo))
        } finally {
            setOcupado(false)
        }
    }

    const planElegido = pagables.find((p) => p.id === planId)
    const opcionesPlan = (lista: Plan[]) => lista.map((p) => ({ value: p.id, label: `${p.name} - ${formatCLP(p.precio)}` }))

    return (
        <div className="space-y-6">
            <dl className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-4">
                <div><dt className="text-xs text-muted-foreground">Estado</dt><dd className="mt-1"><EstadoSuscripcionBadge estado={empresa.suscripcion_estado} /></dd></div>
                <div><dt className="text-xs text-muted-foreground">Plan</dt><dd className="mt-1 font-medium">{plan?.name ?? 'Sin plan'}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Pagado hasta</dt><dd className="mt-1 font-medium font-tabular">{formatDate(empresa.suscripcion_vence) || (plan?.meses === 0 ? 'No vence' : '-')}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Prórroga</dt><dd className="mt-1 font-medium">{empresa.prorroga_hasta ? `Hasta ${fechaHora(empresa.prorroga_hasta)}` : '-'}</dd></div>
            </dl>

            <div className="flex flex-wrap gap-2">
                {puedeCobrar && <Button onClick={() => abrir('pago')}><CreditCard className="h-4 w-4" /> Registrar pago</Button>}
                {puedeCobrar && <Button variant="outline" onClick={() => abrir('link')}><Link2 className="h-4 w-4" /> Link de pago</Button>}
                {puedeProrrogar && ['SUSPENDIDA', 'PRORROGA'].includes(empresa.suscripcion_estado) && (
                    <Button variant="outline" onClick={() => abrir('prorroga')}><Clock className="h-4 w-4" /> Dar prórroga</Button>
                )}
                {puedeCobrar && <Button variant="ghost" onClick={() => abrir('plan')}><Package className="h-4 w-4" /> Cambiar plan o fecha</Button>}
            </div>

            {puedeVerPagos && (
                <section aria-labelledby="titulo-pagos" className="space-y-2">
                    <h3 id="titulo-pagos" className="font-semibold">Pagos</h3>
                    <div className="overflow-x-auto rounded-xl border border-border bg-card">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Plan</TableHead>
                                    <TableHead>Medio</TableHead>
                                    <TableHead className="text-right">Monto</TableHead>
                                    <TableHead>Período</TableHead>
                                    <TableHead>Estado</TableHead>
                                    <TableHead><span className="sr-only">Acciones</span></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pagos.length === 0 && <TableEmpty colSpan={7}>Sin pagos registrados.</TableEmpty>}
                                {pagos.map((p) => {
                                    const anulable = puedeCobrar && (p.estado === 'PENDIENTE' ||
                                        (p.estado === 'PAGADO' && p.periodo_hasta === empresa.suscripcion_vence))
                                    return (
                                        <TableRow key={p.id}>
                                            <TableCell className="font-tabular whitespace-nowrap">{formatDate(p.pagado_at ?? p.created_at)}</TableCell>
                                            <TableCell>{p.plan}</TableCell>
                                            <TableCell>{MEDIOS[p.medio]}</TableCell>
                                            <TableCell className="text-right font-tabular">{formatCLP(p.monto)}</TableCell>
                                            <TableCell className="font-tabular whitespace-nowrap text-muted-foreground">
                                                {p.periodo_desde ? `${formatDate(p.periodo_desde)} a ${formatDate(p.periodo_hasta)}` : '-'}
                                            </TableCell>
                                            <TableCell>{ESTADOS_PAGO[p.estado]}</TableCell>
                                            <TableCell className="text-right">
                                                {anulable && (
                                                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setAAnular(p)}>Anular</Button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </section>
            )}

            <Dialog open={dialogo !== null} onOpenChange={(o) => !o && setDialogo(null)}>
                <DialogContent className="sm:max-w-md">
                    {dialogo === 'pago' && (
                        <form className="space-y-4" onSubmit={(e) => {
                            e.preventDefault()
                            if (!planId) return
                            ejecutar(async () => {
                                await registrarPago(empresa.id, { plan_id: planId, medio, monto: monto ? Number(monto) : undefined, nota: nota || undefined })
                                onCambio()
                                cargarPagos()
                                setDialogo(null)
                            }, 'No se pudo registrar el pago.')
                        }}>
                            <DialogHeader>
                                <DialogTitle>Registrar pago</DialogTitle>
                                <DialogDescription>Pago recibido fuera de Flow. Extiende el vencimiento en los meses del plan.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-2">
                                <Label htmlFor="pago-plan">Plan pagado</Label>
                                <SelectOpciones id="pago-plan" value={planId} onChange={setPlanId} opciones={opcionesPlan(pagables)} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <Label htmlFor="pago-medio">Medio</Label>
                                    <SelectOpciones id="pago-medio" value={medio} onChange={(v) => v && setMedio(v)}
                                        opciones={[{ value: 'TRANSFERENCIA', label: 'Transferencia' }, { value: 'EFECTIVO', label: 'Efectivo' }]} />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="pago-monto">Monto</Label>
                                    <Input id="pago-monto" type="number" min={0} inputMode="numeric" value={monto}
                                        placeholder={planElegido ? String(planElegido.precio) : ''} onChange={(e) => setMonto(e.target.value)} />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="pago-nota">Nota (opcional)</Label>
                                <Input id="pago-nota" maxLength={300} placeholder="Ej. N° de transferencia" value={nota} onChange={(e) => setNota(e.target.value)} />
                            </div>
                            <AlertaError mensaje={error} />
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setDialogo(null)}>Cancelar</Button>
                                <Button type="submit" disabled={ocupado || !planId}>{ocupado && <Loader2 className="h-4 w-4 animate-spin" />} Registrar</Button>
                            </div>
                        </form>
                    )}

                    {dialogo === 'link' && (
                        <form className="space-y-4" onSubmit={(e) => {
                            e.preventDefault()
                            if (!planId) return
                            ejecutar(async () => { setLink(await crearLinkPago(empresa.id, planId, email)); cargarPagos() }, 'No se pudo crear el link.')
                        }}>
                            <DialogHeader>
                                <DialogTitle>Link de pago</DialogTitle>
                                <DialogDescription>Link de Flow para enviarle al cliente. Al pagar, la empresa se renueva sola.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-2">
                                <Label htmlFor="link-plan">Plan</Label>
                                <SelectOpciones id="link-plan" value={planId} onChange={setPlanId} opciones={opcionesPlan(pagables)} />
                                {planElegido?.cuotas_sin_interes && <p className="text-xs text-muted-foreground">Con cuotas sin interés: la comisión la paga Factureando.</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="link-email">Correo del que paga (opcional)</Label>
                                <Input id="link-email" type="email" placeholder="Por defecto, el del administrador" value={email} onChange={(e) => setEmail(e.target.value)} />
                            </div>
                            {link && (
                                <div className="flex gap-2">
                                    <Input readOnly value={link} aria-label="Link de pago" className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                                    <Button type="button" variant="outline" aria-label="Copiar link" onClick={() => {
                                        navigator.clipboard.writeText(link).then(() => setCopiado(true)).catch(() => setCopiado(false))
                                    }}>
                                        {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                    </Button>
                                </div>
                            )}
                            <AlertaError mensaje={error} />
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setDialogo(null)}>Cerrar</Button>
                                {!link && <Button type="submit" disabled={ocupado || !planId}>{ocupado && <Loader2 className="h-4 w-4 animate-spin" />} Crear link</Button>}
                            </div>
                        </form>
                    )}

                    {dialogo === 'prorroga' && (
                        <form className="space-y-4" onSubmit={(e) => {
                            e.preventDefault()
                            ejecutar(async () => { await darProrroga(empresa.id, Number(horas)); onCambio(); setDialogo(null) }, 'No se pudo dar la prórroga.')
                        }}>
                            <DialogHeader>
                                <DialogTitle>Dar prórroga</DialogTitle>
                                <DialogDescription>La empresa vuelve a funcionar por estas horas, contadas desde ahora. Si paga antes, la prórroga se quita sola.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-2">
                                <Label htmlFor="prorroga-horas">Horas</Label>
                                <Input id="prorroga-horas" type="number" min={1} max={720} inputMode="numeric" required
                                    value={horas} onChange={(e) => setHoras(e.target.value)} className="max-w-[8rem]" />
                            </div>
                            <AlertaError mensaje={error} />
                            <div className="flex flex-wrap justify-end gap-2">
                                {empresa.prorroga_hasta && (
                                    <Button type="button" variant="ghost" className="text-destructive mr-auto" disabled={ocupado} onClick={() =>
                                        ejecutar(async () => { await darProrroga(empresa.id, 0); onCambio(); setDialogo(null) }, 'No se pudo quitar la prórroga.')
                                    }>Quitar prórroga</Button>
                                )}
                                <Button type="button" variant="outline" onClick={() => setDialogo(null)}>Cancelar</Button>
                                <Button type="submit" disabled={ocupado || !(Number(horas) >= 1)}>{ocupado && <Loader2 className="h-4 w-4 animate-spin" />} Dar {horas} horas</Button>
                            </div>
                        </form>
                    )}

                    {dialogo === 'plan' && (
                        <form className="space-y-4" onSubmit={(e) => {
                            e.preventDefault()
                            if (!planId) return
                            ejecutar(async () => { await cambiarSuscripcion(empresa.id, planId, vence || null); onCambio(); setDialogo(null) }, 'No se pudo cambiar el plan.')
                        }}>
                            <DialogHeader>
                                <DialogTitle>Cambiar plan o fecha</DialogTitle>
                                <DialogDescription>Corrección a mano, sin pago. Cortesía no vence nunca.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-2">
                                <Label htmlFor="cambio-plan">Plan</Label>
                                <SelectOpciones id="cambio-plan" value={planId} onChange={setPlanId}
                                    opciones={planes.map((p) => ({ value: p.id, label: p.name }))} />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="cambio-vence">Pagado hasta</Label>
                                <Input id="cambio-vence" type="date" value={vence} onChange={(e) => setVence(e.target.value)} className="max-w-[12rem]" />
                                <p className="text-xs text-muted-foreground">Vacío: sin pagos todavía.</p>
                            </div>
                            <AlertaError mensaje={error} />
                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => setDialogo(null)}>Cancelar</Button>
                                <Button type="submit" disabled={ocupado || !planId}>{ocupado && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</Button>
                            </div>
                        </form>
                    )}
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={!!aAnular}
                onOpenChange={(o) => !o && setAAnular(null)}
                title="¿Anular este pago?"
                description={aAnular?.estado === 'PAGADO'
                    ? 'El vencimiento vuelve a la fecha que tenía antes de este pago. Si el cliente pagó por Flow, la devolución se hace en Flow.'
                    : 'El link de pago deja de contar.'}
                confirmLabel="Anular"
                onConfirm={async () => {
                    if (!aAnular) return
                    try {
                        await anularPago(aAnular.id)
                        onCambio()
                        cargarPagos()
                    } catch (e) {
                        avisar(getApiErrorDetail(e, 'No se pudo anular el pago.'))
                    }
                }}
            />
        </div>
    )
}
