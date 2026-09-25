'use client'

import { useEffect, useState } from 'react'
import { useSessionStore } from '@/lib/store/sessionStore'
import { openSession, closeSession, getSessionStatus, getAllSessions, type CashSessionWithUser } from '@/services/cash'
import { getApiErrorDetail, getApiErrorStatus } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableEmpty } from '@/components/ui/table'
import { AlertaError } from '@/components/ui/alerta-error'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { avisar } from '@/lib/store/uiStore'
import { useControlCaja } from '@/lib/store/settingsStore'
import { formatCLP } from '@/lib/format'
import {
    Landmark,
    DoorOpen,
    DoorClosed,
    Clock,
    DollarSign,
    Loader2,
    AlertTriangle,
    CheckCircle2,
    History,
} from 'lucide-react'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'


export default function CajaPage() {
    const { status, user, startAmount, startTime, setSession, setStatus, closeSession: clearSession } = useSessionStore()
    const [montoInicial, setMontoInicial] = useState('')
    const [efectivoContado, setEfectivoContado] = useState('')
    const [opening, setOpening] = useState(false)
    const [closing, setClosing] = useState(false)
    const [errorApertura, setErrorApertura] = useState<string | null>(null)
    const [errorCierre, setErrorCierre] = useState<string | null>(null)
    const [forzar, setForzar] = useState<number | null>(null)
    const controlCaja = useControlCaja()
    const [closeResult, setCloseResult] = useState<{
        final_cash_system: number
        final_cash_declared: number
        difference: number
    } | null>(null)

    // History state
    const [historySessions, setHistorySessions] = useState<CashSessionWithUser[]>([])
    const [loadingHistory, setLoadingHistory] = useState(false)

    const loadHistory = async () => {
        setLoadingHistory(true)
        try {
            const data = await getAllSessions()
            setHistorySessions(data)
        } catch {
            avisar('No se pudo cargar el historial de turnos.', { reintentar: loadHistory })
        } finally {
            setLoadingHistory(false)
        }
    }

    // Sync on mount
    useEffect(() => {
        if (!user?.id) return

        getSessionStatus(user.id)
            .then((s) => {
                if (s.status === 'OPEN') {
                    setSession(s.id, parseFloat(s.start_amount), s.start_time, s.user_id)
                } else {
                    setStatus('CLOSED')
                }
            })
            .catch(() => setStatus('CLOSED'))
    }, [setSession, setStatus, user?.id])

    const handleOpen = async () => {
        const monto = parseFloat(montoInicial)
        setErrorApertura(null)

        if (!user?.id) {
            setErrorApertura('No hay usuario identificado.')
            return
        }

        if (!monto || monto < 0) {
            setErrorApertura('Ingresa un monto válido.')
            return
        }
        setOpening(true)
        try {
            const session = await openSession(monto, user.id, false)
            setSession(session.id, monto, session.start_time, user.id)
            setMontoInicial('')
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
        } catch (err) {
            setErrorApertura(getApiErrorDetail(err, 'No se pudo forzar la apertura de caja.'))
        }
    }

    const handleClose = async () => {
        const declared = parseFloat(efectivoContado)
        setErrorCierre(null)
        if (isNaN(declared) || declared < 0) {
            setErrorCierre('Ingresa el efectivo contado.')
            return
        }
        setClosing(true)
        try {
            const result = await closeSession(declared)
            setCloseResult({
                final_cash_system: parseFloat(result.final_cash_system),
                final_cash_declared: parseFloat(result.final_cash_declared),
                difference: parseFloat(result.difference),
            })
            clearSession()
            setEfectivoContado('')
        } catch (err: unknown) {
            setErrorCierre(getApiErrorDetail(err, 'No se pudo cerrar la caja.'))
        } finally {
            setClosing(false)
        }
    }

    // Sin control de caja, AppShell saca al usuario de esta página.
    if (!controlCaja) return null

    return (
        <PageContainer className="max-w-4xl">
            <PageHeader
                icon={Landmark}
                title="Gestión de caja"
                description="Abre y cierra turnos de caja, y audita el historial."
            />

            <Tabs defaultValue="gestion" className="space-y-6">
                <TabsList>
                    <TabsTrigger value="gestion" className="gap-2">
                        <Landmark className="h-4 w-4" /> Gestión diaria
                    </TabsTrigger>
                    <TabsTrigger value="historial" className="gap-2" onClick={loadHistory}>
                        <History className="h-4 w-4" /> Historial de turnos
                    </TabsTrigger>
                </TabsList>

                <TabsContent data-section="caja.gestion" value="gestion" className="space-y-4">
                    {/* User Info Card */}
                    <div className="rounded-xl border border-border bg-card p-4 flex shadow-sm items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-lg">
                            {(user?.full_name || user?.email || '?')[0].toUpperCase()}
                        </div>
                        <div>
                            <p className="text-sm font-bold text-foreground">
                                {user?.full_name || user?.email || 'Usuario'}
                            </p>
                            <p className="text-[10px] text-muted-foreground font-mono">
                                {user?.email || ''}
                            </p>
                        </div>
                    </div>

                    {/* Status Card */}
                    <div className="rounded-xl border border-border bg-card p-4">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-foreground">Estado actual</span>
                            <Badge
                                variant={status === 'OPEN' ? 'default' : 'destructive'}
                                className={''}
                            >
                                {status === 'OPEN' ? '● Abierta' : '○ Cerrada'}
                            </Badge>
                        </div>
                        {status === 'OPEN' && startTime && (
                            <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                                <p className="flex items-center gap-1.5">
                                    <Clock className="h-3 w-3" />
                                    Apertura: {new Date(startTime).toLocaleString('es-CL')}
                                </p>
                                <p className="flex items-center gap-1.5">
                                    <DollarSign className="h-3 w-3" />
                                    Fondo inicial: {formatCLP(startAmount)}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Open / Close Form */}
                    {status !== 'OPEN' ? (
                        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                            <div className="flex items-center gap-2">
                                <DoorOpen className="h-5 w-5 text-primary" />
                                <h2 className="text-base font-bold text-foreground">Abrir turno</h2>
                            </div>
                            <p className="text-xs text-muted-foreground">Ingresa el fondo de caja (billetes y monedas iniciales).</p>

                            <div className="space-y-1.5">
                                <Label className="text-xs">Monto inicial ($)</Label>
                                <Input
                                    type="number"
                                    placeholder="50000"
                                    value={montoInicial}
                                    onChange={(e) => setMontoInicial(e.target.value)}
                                    className="font-tabular h-10 text-sm"
                                    min={0}
                                />
                            </div>

                            <AlertaError mensaje={errorApertura} />

                            <Button
                                size="lg"
                                className="w-full gap-2 text-sm"
                                onClick={handleOpen}
                                disabled={opening}
                            >
                                {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorOpen className="h-4 w-4" />}
                                Abrir caja
                            </Button>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                            <div className="flex items-center gap-2">
                                <DoorClosed className="h-5 w-5 text-destructive" />
                                <h2 className="text-base font-bold text-foreground">Cerrar turno (arqueo ciego)</h2>
                            </div>
                            <p className="text-xs text-muted-foreground">Cuenta el efectivo en caja e ingresa el total. El sistema comparará con lo esperado.</p>

                            <div className="space-y-1.5">
                                <Label className="text-xs">Efectivo contado ($)</Label>
                                <Input
                                    type="number"
                                    placeholder="Cuánto hay en la caja..."
                                    value={efectivoContado}
                                    onChange={(e) => setEfectivoContado(e.target.value)}
                                    className="font-tabular h-10 text-sm"
                                    min={0}
                                />
                            </div>

                            <AlertaError mensaje={errorCierre} />

                            <Button
                                size="lg"
                                variant="destructive"
                                className="w-full gap-2 text-sm"
                                onClick={handleClose}
                                disabled={closing}
                            >
                                {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorClosed className="h-4 w-4" />}
                                Cerrar caja
                            </Button>
                        </div>
                    )}

                    {/* Close Results */}
                    {closeResult && (
                        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                            <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
                                <CheckCircle2 className="h-4 w-4 text-primary" />
                                Resultado del arqueo
                            </h3>
                            <Separator />
                            <div className="space-y-1.5 text-sm font-tabular">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Sistema</span>
                                    <span className="font-semibold text-foreground">{formatCLP(closeResult.final_cash_system)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Declarado</span>
                                    <span className="font-semibold text-foreground">{formatCLP(closeResult.final_cash_declared)}</span>
                                </div>
                                <Separator />
                                <div className="flex justify-between">
                                    <span className="font-medium text-foreground">Diferencia</span>
                                    <span className={`font-bold text-base ${closeResult.difference === 0 ? 'text-foreground' : closeResult.difference > 0 ? 'text-primary' : 'text-destructive'}`}>
                                        {closeResult.difference > 0 ? '+' : ''}{formatCLP(closeResult.difference)}
                                    </span>
                                </div>
                            </div>
                            {closeResult.difference !== 0 && (
                                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                    {closeResult.difference > 0 ? 'Sobrante en caja' : 'Faltante en caja'}
                                </div>
                            )}
                        </div>
                    )}
                </TabsContent>

                {/* Historial Tab */}
                <TabsContent data-section="caja.historial" value="historial" className="space-y-4">
                    <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Fecha/hora de apertura</TableHead>
                                        <TableHead>Cajero</TableHead>
                                        <TableHead className="text-right">Fondo inicial</TableHead>
                                        <TableHead className="text-right">Al cierre (sistema)</TableHead>
                                        <TableHead className="text-right">Diferencia</TableHead>
                                        <TableHead className="text-center">Estado</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loadingHistory ? (
                                        <TableEmpty colSpan={6} loading />
                                    ) : historySessions.length === 0 ? (
                                        <TableEmpty colSpan={6}>No hay turnos registrados</TableEmpty>
                                    ) : (
                                        historySessions.map((session) => (
                                            <TableRow key={session.id}>
                                                <TableCell className="text-xs">
                                                    {new Date(session.start_time).toLocaleString('es-CL')}
                                                    {session.end_time && (
                                                        <div className="text-[10px] text-muted-foreground mt-1">
                                                            Cierre: {new Date(session.end_time).toLocaleString('es-CL')}
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                    <div className="font-medium text-foreground">
                                                        {session.user.full_name || session.user.name || session.user.email}
                                                    </div>
                                                    <div className="text-[10px] text-muted-foreground font-mono">
                                                        {session.user.rut || ''}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right text-xs font-tabular font-medium">
                                                    {formatCLP(parseFloat(session.start_amount))}
                                                </TableCell>
                                                <TableCell className="text-right text-xs font-tabular">
                                                    {session.status === 'OPEN' ? (
                                                        <span className="text-muted-foreground italic">—</span>
                                                    ) : (
                                                        <span>{formatCLP(parseFloat(session.final_cash_system))}</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right text-xs font-tabular">
                                                    {session.status === 'OPEN' ? (
                                                        <span className="text-muted-foreground italic">—</span>
                                                    ) : (
                                                        <span className={`font-semibold ${parseFloat(session.difference) === 0 ? 'text-foreground' : parseFloat(session.difference) > 0 ? 'text-primary' : 'text-destructive'}`}>
                                                            {parseFloat(session.difference) > 0 ? '+' : ''}{formatCLP(parseFloat(session.difference))}
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Badge
                                                        variant={session.status === 'OPEN' ? 'default' : 'secondary'}
                                                        className={'text-[10px]'}
                                                    >
                                                        {session.status === 'OPEN' ? 'ABIERTA' : 'CERRADA'}
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>
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

