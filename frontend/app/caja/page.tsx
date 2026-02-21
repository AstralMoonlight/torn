'use client'

import { useEffect, useState } from 'react'
import { useSessionStore } from '@/lib/store/sessionStore'
import { openSession, closeSession, getSessionStatus } from '@/services/cash'
import { getSellers, User } from '@/services/users'
import { getApiErrorMessage } from '@/services/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
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
} from 'lucide-react'


export default function CajaPage() {
    const { status, sessionId, user, startAmount, startTime, setSession, setStatus, closeSession: clearSession } = useSessionStore()
    const [montoInicial, setMontoInicial] = useState('')
    const [efectivoContado, setEfectivoContado] = useState('')
    const [opening, setOpening] = useState(false)
    const [closing, setClosing] = useState(false)
    const [closeResult, setCloseResult] = useState<{
        final_cash_system: number
        final_cash_declared: number
        difference: number
    } | null>(null)

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

        if (!user?.id) {
            toast.error('No hay usuario identificado')
            return
        }

        if (!monto || monto < 0) {
            toast.error('Ingresa un monto válido')
            return
        }
        setOpening(true)
        try {
            const session = await openSession(monto, user.id, false)
            setSession(session.id, monto, session.start_time, user.id)
            setMontoInicial('')
            toast.success('¡Caja abierta correctamente!')
        } catch (err: any) {
            if (err.response?.status === 409) {
                toast.custom((t) => (
                    <div className="bg-white dark:bg-neutral-900 p-4 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-800 max-w-sm">
                        <h3 className="font-bold text-neutral-900 dark:text-white mb-2">¡Caja ya abierta!</h3>
                        <p className="text-sm text-neutral-600 dark:text-neutral-400 mb-4">
                            Ya tienes una caja abierta en otro dispositivo.
                            ¿Deseas cerrarla forzosamente y abrir una nueva aquí?
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toast.dismiss(t)}
                            >
                                Cancelar
                            </Button>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => {
                                    toast.dismiss(t)
                                    forceOpenSession(monto, user.id)
                                }}
                            >
                                Cerrar anterior y Abrir
                            </Button>
                        </div>
                    </div>
                ), { duration: Infinity })
            } else {
                const detail = err.response?.data?.detail
                toast.error(detail || 'Error al abrir caja')
            }
        } finally {
            setOpening(false)
        }
    }

    const forceOpenSession = async (monto: number, sellerId: number) => {
        setOpening(true)
        try {
            const session = await openSession(monto, sellerId, true)
            setSession(session.id, monto, session.start_time, sellerId)
            setMontoInicial('')
            toast.success('Sesión anterior cerrada y nueva caja abierta')
        } catch (error) {
            toast.error('Error al forzar apertura de caja')
        } finally {
            setOpening(false)
        }
    }

    const handleClose = async () => {
        const declared = parseFloat(efectivoContado)
        if (isNaN(declared) || declared < 0) {
            toast.error('Ingresa el efectivo contado')
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
            toast.success('Caja cerrada correctamente')
        } catch (err: unknown) {
            const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            toast.error(detail || 'Error al cerrar caja')
        } finally {
            setClosing(false)
        }
    }

    return (
        <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-2">
                <Landmark className="h-6 w-6 text-blue-600" />
                <div>
                    <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Gestión de Caja</h1>
                    <p className="text-xs text-neutral-500">Abre y cierra turnos de caja</p>
                </div>
            </div>

            {/* User Info Card */}
            <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950 flex shadow-sm items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 flex items-center justify-center font-bold text-lg">
                    {user?.name?.[0].toUpperCase()}
                </div>
                <div>
                    <p className="text-sm font-bold text-neutral-900 dark:text-white">{user?.name}</p>
                    <p className="text-[10px] text-neutral-500 font-mono">{user?.rut}</p>
                </div>
            </div>

            {/* Status Card */}
            <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-neutral-900 dark:text-white">Estado Actual</span>
                    <Badge
                        variant={status === 'OPEN' ? 'default' : 'destructive'}
                        className={status === 'OPEN' ? 'bg-emerald-600' : ''}
                    >
                        {status === 'OPEN' ? '● Abierta' : '○ Cerrada'}
                    </Badge>
                </div>
                {status === 'OPEN' && startTime && (
                    <div className="mt-2 space-y-0.5 text-xs text-neutral-500">
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
                <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950 space-y-3">
                    <div className="flex items-center gap-2">
                        <DoorOpen className="h-5 w-5 text-emerald-600" />
                        <h2 className="text-base font-bold text-neutral-900 dark:text-white">Abrir Turno</h2>
                    </div>
                    <p className="text-xs text-neutral-500">Ingresa el fondo de caja (billetes y monedas iniciales).</p>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Monto Inicial ($)</Label>
                        <Input
                            type="number"
                            placeholder="50000"
                            value={montoInicial}
                            onChange={(e) => setMontoInicial(e.target.value)}
                            className="font-tabular h-10 text-sm"
                            min={0}
                        />
                    </div>

                    <Button
                        size="lg"
                        className="w-full bg-emerald-600 hover:bg-emerald-700 gap-2 text-sm"
                        onClick={handleOpen}
                        disabled={opening}
                    >
                        {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorOpen className="h-4 w-4" />}
                        Abrir Caja
                    </Button>
                </div>
            ) : (
                <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950 space-y-3">
                    <div className="flex items-center gap-2">
                        <DoorClosed className="h-5 w-5 text-red-500" />
                        <h2 className="text-base font-bold text-neutral-900 dark:text-white">Cerrar Turno (Arqueo Ciego)</h2>
                    </div>
                    <p className="text-xs text-neutral-500">Cuenta el efectivo en caja e ingresa el total. El sistema comparará con lo esperado.</p>

                    <div className="space-y-1.5">
                        <Label className="text-xs">Efectivo Contado ($)</Label>
                        <Input
                            type="number"
                            placeholder="Cuánto hay en la caja..."
                            value={efectivoContado}
                            onChange={(e) => setEfectivoContado(e.target.value)}
                            className="font-tabular h-10 text-sm"
                            min={0}
                        />
                    </div>

                    <Button
                        size="lg"
                        variant="destructive"
                        className="w-full gap-2 text-sm"
                        onClick={handleClose}
                        disabled={closing}
                    >
                        {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorClosed className="h-4 w-4" />}
                        Cerrar Caja
                    </Button>
                </div>
            )}

            {/* Close Results */}
            {closeResult && (
                <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950 space-y-3">
                    <h3 className="text-sm font-bold flex items-center gap-2 text-neutral-900 dark:text-white">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        Resultado del Arqueo
                    </h3>
                    <Separator />
                    <div className="space-y-1.5 text-sm font-tabular">
                        <div className="flex justify-between">
                            <span className="text-neutral-500">Sistema</span>
                            <span className="font-semibold text-neutral-900 dark:text-white">{formatCLP(closeResult.final_cash_system)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-neutral-500">Declarado</span>
                            <span className="font-semibold text-neutral-900 dark:text-white">{formatCLP(closeResult.final_cash_declared)}</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between">
                            <span className="font-medium text-neutral-700 dark:text-neutral-300">Diferencia</span>
                            <span className={`font-bold text-base ${closeResult.difference === 0 ? 'text-emerald-600' : closeResult.difference > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                {closeResult.difference > 0 ? '+' : ''}{formatCLP(closeResult.difference)}
                            </span>
                        </div>
                    </div>
                    {closeResult.difference !== 0 && (
                        <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            {closeResult.difference > 0 ? 'Sobrante en caja' : 'Faltante en caja'}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
