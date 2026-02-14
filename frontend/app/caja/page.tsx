'use client'

import { useState } from 'react'
import { useSessionStore } from '@/lib/store/sessionStore'
import { openSession, closeSession, getSessionStatus } from '@/services/cash'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import {
    Landmark,
    DoorOpen,
    DoorClosed,
    Clock,
    DollarSign,
    ArrowUpDown,
    Loader2,
    CheckCircle,
    XCircle,
} from 'lucide-react'

function formatCLP(value: number | string): string {
    return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        minimumFractionDigits: 0,
    }).format(typeof value === 'string' ? parseFloat(value) : value)
}

export default function CajaPage() {
    const { status, sessionId, startAmount, startTime, setSession, closeSession: closeStore, setStatus } =
        useSessionStore()
    const [openAmount, setOpenAmount] = useState('')
    const [closeAmount, setCloseAmount] = useState('')
    const [loading, setLoading] = useState(false)
    const [closeResult, setCloseResult] = useState<{
        final_cash_system: string
        final_cash_declared: string
        difference: string
    } | null>(null)

    const handleOpen = async () => {
        const amount = parseInt(openAmount)
        if (!amount || amount < 0) {
            toast.error('Ingresa un monto inicial válido')
            return
        }
        setLoading(true)
        try {
            const session = await openSession(amount)
            setSession(session.id, amount, session.start_time)
            toast.success('¡Caja abierta correctamente!')
            setOpenAmount('')
        } catch (err: unknown) {
            const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            toast.error(detail || 'Error al abrir caja')
        } finally {
            setLoading(false)
        }
    }

    const handleClose = async () => {
        const declared = parseInt(closeAmount)
        if (declared === undefined || declared < 0) {
            toast.error('Ingresa el monto contado en caja')
            return
        }
        setLoading(true)
        try {
            const result = await closeSession(declared)
            closeStore()
            setCloseResult({
                final_cash_system: result.final_cash_system,
                final_cash_declared: result.final_cash_declared,
                difference: result.difference,
            })
            toast.success('Caja cerrada correctamente')
            setCloseAmount('')
        } catch (err: unknown) {
            const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            toast.error(detail || 'Error al cerrar caja')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="p-6 max-w-2xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
                    <Landmark className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Gestión de Caja</h1>
                    <p className="text-sm text-slate-500">Abre y cierra turnos de caja</p>
                </div>
            </div>

            {/* Current Status */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-base">Estado Actual</CardTitle>
                        <Badge
                            variant={status === 'OPEN' ? 'default' : 'secondary'}
                            className={status === 'OPEN' ? 'bg-emerald-600' : ''}
                        >
                            {status === 'OPEN' ? '● Abierta' : '○ Cerrada'}
                        </Badge>
                    </div>
                </CardHeader>
                {status === 'OPEN' && (
                    <CardContent className="space-y-2 text-sm">
                        <div className="flex items-center gap-2 text-slate-500">
                            <Clock className="h-4 w-4" />
                            <span>Apertura: {startTime ? new Date(startTime).toLocaleString('es-CL') : '-'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-500">
                            <DollarSign className="h-4 w-4" />
                            <span>Fondo inicial: {formatCLP(startAmount)}</span>
                        </div>
                    </CardContent>
                )}
            </Card>

            {/* Open / Close Forms */}
            {status !== 'OPEN' ? (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <DoorOpen className="h-5 w-5 text-emerald-600" />
                            Abrir Turno
                        </CardTitle>
                        <CardDescription>
                            Ingresa el fondo de caja (billetes y monedas iniciales).
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="openAmount">Monto Inicial ($)</Label>
                            <Input
                                id="openAmount"
                                type="number"
                                placeholder="50000"
                                value={openAmount}
                                onChange={(e) => setOpenAmount(e.target.value)}
                                className="text-lg font-tabular"
                                min={0}
                            />
                        </div>
                        <Button
                            size="lg"
                            className="w-full bg-emerald-600 hover:bg-emerald-700 gap-2"
                            onClick={handleOpen}
                            disabled={loading}
                        >
                            {loading ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                                <DoorOpen className="h-5 w-5" />
                            )}
                            Abrir Caja
                        </Button>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <DoorClosed className="h-5 w-5 text-red-500" />
                            Cerrar Turno (Arqueo Ciego)
                        </CardTitle>
                        <CardDescription>
                            Cuenta el efectivo en caja e ingresa el total. El sistema comparará con lo esperado.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="closeAmount">Efectivo Contado ($)</Label>
                            <Input
                                id="closeAmount"
                                type="number"
                                placeholder="Cuánto hay en la caja..."
                                value={closeAmount}
                                onChange={(e) => setCloseAmount(e.target.value)}
                                className="text-lg font-tabular"
                                min={0}
                            />
                        </div>
                        <Button
                            size="lg"
                            variant="destructive"
                            className="w-full gap-2"
                            onClick={handleClose}
                            disabled={loading}
                        >
                            {loading ? (
                                <Loader2 className="h-5 w-5 animate-spin" />
                            ) : (
                                <DoorClosed className="h-5 w-5" />
                            )}
                            Cerrar Caja
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Close Result */}
            {closeResult && (
                <Card className="border-blue-200 dark:border-blue-800">
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <ArrowUpDown className="h-5 w-5 text-blue-600" />
                            Resultado del Arqueo
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Efectivo esperado (sistema)</span>
                            <span className="font-semibold font-tabular">
                                {formatCLP(closeResult.final_cash_system)}
                            </span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Efectivo declarado</span>
                            <span className="font-semibold font-tabular">
                                {formatCLP(closeResult.final_cash_declared)}
                            </span>
                        </div>
                        <Separator />
                        <div className="flex justify-between items-center">
                            <span className="font-medium">Diferencia</span>
                            {parseFloat(closeResult.difference) === 0 ? (
                                <Badge className="bg-emerald-600 gap-1">
                                    <CheckCircle className="h-3 w-3" /> Cuadra
                                </Badge>
                            ) : (
                                <Badge variant="destructive" className="gap-1 font-tabular">
                                    <XCircle className="h-3 w-3" /> {formatCLP(closeResult.difference)}
                                </Badge>
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
