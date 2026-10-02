'use client'

import { useEffect, useState } from 'react'
import { useSessionStore, useEsAdmin } from '@/lib/store/sessionStore'
import { openSession, closeSession, closeOtherSession, sincronizarCaja, getAllSessions, type CashSessionWithUser } from '@/services/cash'
import { getApiErrorDetail, getApiErrorStatus } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertaError } from '@/components/ui/alerta-error'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { avisar } from '@/lib/store/uiStore'
import { useControlCaja } from '@/lib/store/settingsStore'
import { diaEnPalabras, formatCLP, hora } from '@/lib/format'
import { Loader2, Minus, Plus } from 'lucide-react'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import Estado, { type TonoEstado } from '@/components/layout/Estado'

/** Billetes chilenos que se cuentan uno por uno; las monedas van como un solo monto. */
const BILLETES = [20000, 10000, 5000, 2000, 1000]

/** Cuánto lleva abierto un turno, en palabras. */
function duracion(desde: string): string {
    const min = Math.max(0, Math.round((Date.now() - new Date(desde).getTime()) / 60_000))
    const h = Math.floor(min / 60)
    const m = min % 60
    if (h === 0) return `hace ${m} ${m === 1 ? 'minuto' : 'minutos'}`
    return `hace ${h} ${h === 1 ? 'hora' : 'horas'}${m ? ` y ${m} ${m === 1 ? 'minuto' : 'minutos'}` : ''}`
}

/** Diferencia del arqueo en palabras: lo que la cajera entiende sin restar. */
function resultado(diferencia: number): { texto: string; tono: TonoEstado } {
    if (diferencia === 0) return { texto: 'Cuadró justo', tono: 'neutro' }
    if (diferencia < 0) return { texto: `Faltaron ${formatCLP(-diferencia)}`, tono: 'mal' }
    return { texto: `Sobraron ${formatCLP(diferencia)}`, tono: 'alerta' }
}

const nombre = (s: CashSessionWithUser) => s.user.full_name || s.user.name || s.user.email

export default function CajaPage() {
    const { status, user, sessionId, startAmount, startTime, setSession, closeSession: clearSession } = useSessionStore()
    const esAdmin = useEsAdmin()
    const [montoInicial, setMontoInicial] = useState('')
    const [billetes, setBilletes] = useState<number[]>(BILLETES.map(() => 0))
    const [monedas, setMonedas] = useState('')
    const [opening, setOpening] = useState(false)
    const [closing, setClosing] = useState(false)
    const [errorApertura, setErrorApertura] = useState<string | null>(null)
    const [errorCierre, setErrorCierre] = useState<string | null>(null)
    const [forzar, setForzar] = useState<number | null>(null)
    const [confirmarCierre, setConfirmarCierre] = useState(false)
    const controlCaja = useControlCaja()
    const [closeResult, setCloseResult] = useState<{
        final_cash_system: number
        final_cash_declared: number
        difference: number
    } | null>(null)

    const [historySessions, setHistorySessions] = useState<CashSessionWithUser[]>([])
    const [loadingHistory, setLoadingHistory] = useState(true)
    // Turno de otro usuario que el administrador va a cerrar.
    const [turnoAjeno, setTurnoAjeno] = useState<CashSessionWithUser | null>(null)
    const [contadoAjeno, setContadoAjeno] = useState('')

    const contado = BILLETES.reduce((s, b, i) => s + b * billetes[i], 0) + (parseFloat(monedas) || 0)

    const loadHistory = async () => {
        setLoadingHistory(true)
        try {
            setHistorySessions(await getAllSessions())
        } catch {
            avisar('No se pudo cargar el historial de turnos.', { reintentar: loadHistory })
        } finally {
            setLoadingHistory(false)
        }
    }

    useEffect(() => {
        sincronizarCaja()
        getAllSessions()
            .then(setHistorySessions)
            .catch(() => avisar('No se pudo cargar el historial de turnos.'))
            .finally(() => setLoadingHistory(false))
    }, [])

    const handleOpen = async () => {
        const monto = parseFloat(montoInicial)
        setErrorApertura(null)

        if (!user?.id) {
            setErrorApertura('No hay usuario identificado.')
            return
        }

        if (!monto || monto < 0) {
            setErrorApertura('Escribe con cuánto dinero empieza la caja.')
            return
        }
        setOpening(true)
        try {
            const session = await openSession(monto, user.id, false)
            setSession(session.id, monto, session.start_time, user.id)
            setMontoInicial('')
            setCloseResult(null)
        } catch (err) {
            if (getApiErrorStatus(err) === 409) setForzar(monto)
            else setErrorApertura(getApiErrorDetail(err, 'No se pudo abrir la caja.'))
        } finally {
            setOpening(false)
        }
    }

    // Ya había un turno abierto en otro dispositivo: se cierra y se abre uno aquí.
    const forceOpenSession = async (monto: number) => {
        if (!user?.id) return
        try {
            const session = await openSession(monto, user.id, true)
            setSession(session.id, monto, session.start_time, user.id)
            setMontoInicial('')
            setCloseResult(null)
        } catch (err) {
            setErrorApertura(getApiErrorDetail(err, 'No se pudo forzar la apertura de caja.'))
        }
    }

    // Cerrar no se deshace: primero se confirma el monto contado.
    const pedirCierre = () => {
        setErrorCierre(null)
        if (contado <= 0) {
            setErrorCierre('Cuenta los billetes y monedas del cajón antes de cerrar.')
            return
        }
        setConfirmarCierre(true)
    }

    const handleClose = async () => {
        setClosing(true)
        try {
            const result = await closeSession(contado)
            setCloseResult({
                final_cash_system: parseFloat(result.final_cash_system),
                final_cash_declared: parseFloat(result.final_cash_declared),
                difference: parseFloat(result.difference),
            })
            clearSession()
            setBilletes(BILLETES.map(() => 0))
            setMonedas('')
            await loadHistory()
        } catch (err: unknown) {
            setErrorCierre(getApiErrorDetail(err, 'No se pudo cerrar la caja.'))
        } finally {
            setClosing(false)
        }
    }

    const cerrarTurnoAjeno = async () => {
        if (!turnoAjeno) return
        try {
            await closeOtherSession(turnoAjeno.id, parseFloat(contadoAjeno) || 0)
            setContadoAjeno('')
            await loadHistory()
        } catch (err) {
            avisar(getApiErrorDetail(err, 'No se pudo cerrar el turno.'))
        }
    }

    const cambiarBillete = (i: number, delta: number) =>
        setBilletes((b) => b.map((n, j) => (j === i ? Math.max(0, n + delta) : n)))

    // Sin control de caja, AppShell saca al usuario de esta página.
    if (!controlCaja) return null

    const quien = user?.full_name || user?.email || 'Tú'
    const anteriores = historySessions.filter((s) => s.id !== sessionId)

    return (
        <PageContainer>
            <PageHeader
                title="Caja"
                description="Abre el turno al empezar el día y ciérralo contando el efectivo que hay en el cajón."
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
                <div className="space-y-6 min-w-0">
                    <section data-section="caja.estado" className="rounded-xl border border-border bg-card p-5 space-y-2">
                        {status === 'OPEN' && startTime ? (
                            <>
                                <div className="flex items-center gap-2">
                                    <Estado tono="bien">Caja abierta</Estado>
                                    <span className="text-sm text-muted-foreground">{duracion(startTime)}</span>
                                </div>
                                <p className="text-lg font-semibold leading-snug text-foreground">
                                    {quien} abrió la caja {diaEnPalabras(startTime)} a las {hora(startTime)} con {formatCLP(startAmount)} de fondo.
                                </p>
                            </>
                        ) : (
                            <>
                                <Estado>Caja cerrada</Estado>
                                <p className="text-lg font-semibold leading-snug text-foreground">
                                    Para vender, abre la caja con el dinero que tienes para dar vuelto.
                                </p>
                            </>
                        )}
                    </section>

                    {closeResult && (() => {
                        const r = resultado(closeResult.difference)
                        return (
                            <section data-section="caja.resultado" className="rounded-xl border border-border bg-card p-5 space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <h2 className="text-base font-semibold text-foreground">Resultado del cierre</h2>
                                    <Estado tono={r.tono}>{r.texto}</Estado>
                                </div>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div className="rounded-lg bg-muted/60 px-3 py-2">
                                        <p className="text-muted-foreground">Contaste</p>
                                        <p className="text-lg font-semibold font-tabular text-foreground">{formatCLP(closeResult.final_cash_declared)}</p>
                                    </div>
                                    <div className="rounded-lg bg-muted/60 px-3 py-2">
                                        <p className="text-muted-foreground">Debía haber</p>
                                        <p className="text-lg font-semibold font-tabular text-foreground">{formatCLP(closeResult.final_cash_system)}</p>
                                    </div>
                                </div>
                            </section>
                        )
                    })()}

                    <section data-section="caja.historial" className="space-y-3">
                        <h2 className="text-base font-semibold text-foreground">Turnos anteriores</h2>
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                            {loadingHistory ? (
                                <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Cargando turnos...
                                </p>
                            ) : anteriores.length === 0 ? (
                                <p className="px-5 py-6 text-sm text-muted-foreground">Todavía no hay turnos cerrados.</p>
                            ) : (
                                <ul className="divide-y divide-border">
                                    {anteriores.map((s) => {
                                        const abierto = s.status === 'OPEN'
                                        const r = resultado(parseFloat(s.difference))
                                        return (
                                            <li key={s.id} className="grid grid-cols-2 gap-x-4 gap-y-1 px-5 py-3 text-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_7rem_7rem_minmax(0,1.2fr)] sm:items-center">
                                                <span className="text-foreground first-letter:uppercase">
                                                    {diaEnPalabras(s.start_time)}
                                                    <span className="block text-muted-foreground">
                                                        {hora(s.start_time)}{s.end_time ? ` a ${hora(s.end_time)}` : ', sigue abierto'}
                                                    </span>
                                                </span>
                                                <span className="truncate text-foreground">{nombre(s)}</span>
                                                <span className="font-tabular text-muted-foreground sm:text-right">
                                                    <span className="sm:hidden">Fondo </span>{formatCLP(parseFloat(s.start_amount))}
                                                </span>
                                                <span className="font-tabular text-foreground sm:text-right">
                                                    {abierto ? '' : <><span className="sm:hidden">Contado </span>{formatCLP(parseFloat(s.final_cash_declared))}</>}
                                                </span>
                                                <span className="flex items-center gap-2 sm:justify-end">
                                                    {abierto ? (
                                                        <>
                                                            <Estado tono="bien">Abierto</Estado>
                                                            {esAdmin && (
                                                                <Button size="sm" variant="outline" onClick={() => setTurnoAjeno(s)}>Cerrar turno</Button>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <Estado tono={r.tono}>{r.texto}</Estado>
                                                    )}
                                                </span>
                                            </li>
                                        )
                                    })}
                                </ul>
                            )}
                        </div>
                    </section>
                </div>

                {status !== 'OPEN' ? (
                    <section data-section="caja.abrir" className="rounded-xl border border-border bg-card p-5 space-y-4 self-start">
                        <div>
                            <h2 className="text-lg font-semibold text-foreground">Abrir caja</h2>
                            <p className="mt-1 text-sm text-muted-foreground">Escribe cuánto dinero hay en el cajón para dar vuelto.</p>
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="monto-inicial">Fondo inicial</Label>
                            <Input
                                id="monto-inicial"
                                type="number"
                                inputMode="numeric"
                                placeholder="20000"
                                value={montoInicial}
                                onChange={(e) => setMontoInicial(e.target.value)}
                                className="h-11 text-base font-tabular"
                                min={0}
                            />
                        </div>
                        <AlertaError mensaje={errorApertura} />
                        <Button size="lg" className="h-12 w-full text-base" onClick={handleOpen} disabled={opening}>
                            {opening && <Loader2 className="h-4 w-4 animate-spin" />}
                            Abrir caja
                        </Button>
                    </section>
                ) : (
                    <section data-section="caja.cerrar" className="rounded-xl border border-border bg-card p-5 space-y-4 self-start">
                        <div>
                            <h2 className="text-lg font-semibold text-foreground">Cerrar caja</h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Cuenta los billetes y monedas del cajón. Lo que debería haber se muestra después de cerrar, para que el conteo sea honesto.
                            </p>
                        </div>
                        <div className="space-y-1.5">
                            {BILLETES.map((b, i) => (
                                <div key={b} className="grid grid-cols-[5.5rem_1fr_6.5rem] items-center gap-2 text-sm">
                                    <span className="font-medium text-foreground font-tabular">{formatCLP(b)}</span>
                                    <span className="flex items-center gap-1.5">
                                        <Button type="button" variant="outline" size="icon" className="h-9 w-9"
                                            onClick={() => cambiarBillete(i, -1)} aria-label={`Un billete de ${formatCLP(b)} menos`}>
                                            <Minus className="h-4 w-4" />
                                        </Button>
                                        <Input
                                            type="number"
                                            inputMode="numeric"
                                            min={0}
                                            value={billetes[i] || ''}
                                            placeholder="0"
                                            onChange={(e) => {
                                                const n = Math.max(0, parseInt(e.target.value) || 0)
                                                setBilletes((bs) => bs.map((v, j) => (j === i ? n : v)))
                                            }}
                                            className="h-9 w-14 px-1 text-center font-semibold font-tabular"
                                            aria-label={`Billetes de ${formatCLP(b)}`}
                                        />
                                        <Button type="button" variant="outline" size="icon" className="h-9 w-9"
                                            onClick={() => cambiarBillete(i, 1)} aria-label={`Un billete de ${formatCLP(b)} más`}>
                                            <Plus className="h-4 w-4" />
                                        </Button>
                                    </span>
                                    <span className="text-right text-muted-foreground font-tabular">{formatCLP(b * billetes[i])}</span>
                                </div>
                            ))}
                            <div className="grid grid-cols-[5.5rem_1fr] items-center gap-2 pt-1">
                                <Label htmlFor="monedas" className="text-sm">Monedas</Label>
                                <Input
                                    id="monedas"
                                    type="number"
                                    inputMode="numeric"
                                    min={0}
                                    placeholder="Total en monedas"
                                    value={monedas}
                                    onChange={(e) => setMonedas(e.target.value)}
                                    className="h-9 font-tabular"
                                />
                            </div>
                        </div>
                        <div className="flex items-baseline justify-between rounded-lg bg-muted/60 px-4 py-3">
                            <span className="text-sm text-muted-foreground">Contaste</span>
                            <span className="text-2xl font-bold tracking-tight font-tabular text-foreground">{formatCLP(contado)}</span>
                        </div>
                        <AlertaError mensaje={errorCierre} />
                        <Button size="lg" className="h-12 w-full text-base" onClick={pedirCierre} disabled={closing}>
                            {closing && <Loader2 className="h-4 w-4 animate-spin" />}
                            Cerrar caja con {formatCLP(contado)}
                        </Button>
                    </section>
                )}
            </div>

            <ConfirmDialog
                open={confirmarCierre}
                onOpenChange={setConfirmarCierre}
                title={`¿Cerrar la caja con ${formatCLP(contado)} contados?`}
                description="Revisa el monto. Una vez cerrada, la caja no se puede reabrir ni corregir."
                confirmLabel="Sí, cerrar caja"
                onConfirm={handleClose}
            />
            <ConfirmDialog
                open={turnoAjeno !== null}
                onOpenChange={(o) => !o && setTurnoAjeno(null)}
                title={`¿Cerrar el turno de ${turnoAjeno ? nombre(turnoAjeno) : ''}?`}
                description={
                    <>
                        Escribe el efectivo contado en esa caja (abierta {turnoAjeno && `${diaEnPalabras(turnoAjeno.start_time)} a las ${hora(turnoAjeno.start_time)}`}).
                        Una vez cerrado, el turno no se puede reabrir.
                        <Input
                            type="number"
                            placeholder="Efectivo contado"
                            value={contadoAjeno}
                            onChange={(e) => setContadoAjeno(e.target.value)}
                            className="font-tabular h-10 text-sm mt-3"
                            min={0}
                        />
                    </>
                }
                confirmLabel="Sí, cerrar turno"
                onConfirm={cerrarTurnoAjeno}
            />
            <ConfirmDialog
                open={forzar !== null}
                onOpenChange={(o) => !o && setForzar(null)}
                title="Ya tienes una caja abierta"
                description="Hay un turno abierto a tu nombre en otro dispositivo. ¿Lo cierras y abres uno nuevo aquí?"
                confirmLabel="Cerrar anterior y abrir"
                onConfirm={async () => { if (forzar !== null) await forceOpenSession(forzar) }}
            />
        </PageContainer>
    )
}
