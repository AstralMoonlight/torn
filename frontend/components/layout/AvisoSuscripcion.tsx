'use client'

import { useState } from 'react'
import { AlertCircle, CreditCard, Loader2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertaError } from '@/components/ui/alerta-error'
import { SelectOpciones } from '@/components/ui/select-opciones'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useEsAdmin, useSessionStore } from '@/lib/store/sessionStore'
import { getMiSuscripcion, pagarSuscripcion, type MiSuscripcion } from '@/services/saas'
import { getApiErrorDetail } from '@/services/api'
import { fechaHora, formatCLP, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Aviso fijo arriba del contenido cuando la suscripción de la empresa está por
 * vencer, vencida o suspendida (`backend/app/services/suscripciones.py`). No se
 * cierra: desaparece al pagar. Suspendida lo ve todo el personal (para entender
 * por qué no puede vender); lo demás, solo el administrador, que es quien paga.
 */
export default function AvisoSuscripcion() {
    const esAdmin = useEsAdmin()
    const empresa = useSessionStore((s) => s.availableTenants.find((t) => t.id === s.selectedTenantId))
    const [abierto, setAbierto] = useState(false)
    const [datos, setDatos] = useState<MiSuscripcion | null>(null)
    const [planId, setPlanId] = useState<number | ''>('')
    const [pagando, setPagando] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const estado = empresa?.suscripcion_estado
    const vence = formatDate(empresa?.suscripcion_vence)
    const textos: Partial<Record<NonNullable<typeof estado>, string>> = {
        POR_VENCER: `Su plan vence el ${vence}. Renueve para no interrumpir la emisión.`,
        EN_GRACIA: `Su plan venció el ${vence}. Sigue funcionando unos días más: pague para no quedar en solo consulta.`,
        PRORROGA: `Su plan venció el ${vence}. Tiene una prórroga hasta el ${empresa?.prorroga_hasta ? fechaHora(empresa.prorroga_hasta) : ''}: pague para no quedar en solo consulta.`,
        SUSPENDIDA: `Su plan venció el ${vence}. Puede consultar sus datos, pero no vender ni registrar cambios hasta pagar.`,
    }
    const texto = estado && textos[estado]
    if (!texto || (!esAdmin && estado !== 'SUSPENDIDA')) return null

    const abrir = () => {
        setError(null)
        setAbierto(true)
        getMiSuscripcion()
            .then((d) => { setDatos(d); setPlanId(d.planes[0]?.id ?? '') })
            .catch((e) => setError(getApiErrorDetail(e, 'No se pudieron cargar los planes.')))
    }

    const pagar = async () => {
        if (!planId) return
        setPagando(true)
        setError(null)
        try {
            window.location.href = await pagarSuscripcion(planId)
        } catch (e) {
            setError(getApiErrorDetail(e, 'No se pudo iniciar el pago.'))
            setPagando(false)
        }
    }

    const grave = estado === 'SUSPENDIDA' || estado === 'PRORROGA'
    return (
        <>
            <Alert
                data-section="aviso-suscripcion"
                variant={grave ? 'destructive' : 'default'}
                className={cn('flex flex-wrap items-center gap-3 bg-card [&>svg]:static [&>svg~*]:pl-0 shadow-sm',
                    !grave && 'border-amber-500/50 text-amber-700 dark:text-amber-400 [&>svg]:text-amber-600')}
            >
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                <AlertDescription className="flex-1 min-w-[12rem]">{texto}</AlertDescription>
                {esAdmin && (
                    <Button size="sm" variant={grave ? 'destructive' : 'outline'} className="h-8" onClick={abrir}>
                        <CreditCard className="h-4 w-4" aria-hidden /> Pagar
                    </Button>
                )}
            </Alert>

            <Dialog open={abierto} onOpenChange={setAbierto}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Renovar el plan</DialogTitle>
                        <DialogDescription>
                            {datos?.pasarela === false ? 'Elija cómo renovar.' : 'Se paga con Flow (tarjeta o transferencia). Al volver, el sistema queda renovado.'}
                        </DialogDescription>
                    </DialogHeader>
                    {!datos && !error && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" aria-label="Cargando" />}
                    {datos && !datos.pasarela && (
                        <p className="text-sm text-muted-foreground">El pago en línea no está disponible todavía. Escriba a Factureando para recibir el link de pago o los datos de transferencia.</p>
                    )}
                    {datos?.pasarela && (
                        <div className="space-y-2">
                            <SelectOpciones
                                aria-label="Plan"
                                value={planId}
                                onChange={setPlanId}
                                opciones={datos.planes.map((p) => ({
                                    value: p.id,
                                    label: `${p.name} - ${formatCLP(p.precio)}${p.cuotas_sin_interes ? ' (cuotas sin interés)' : ''}`,
                                }))}
                            />
                            {datos.planes.find((p) => p.id === planId)?.incluye_impresora && (
                                <p className="text-xs text-muted-foreground">Incluye impresora {datos.planes.find((p) => p.id === planId)?.incluye_impresora}.</p>
                            )}
                        </div>
                    )}
                    <AlertaError mensaje={error} />
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setAbierto(false)}>Cerrar</Button>
                        {datos?.pasarela && (
                            <Button onClick={pagar} disabled={pagando || !planId}>{pagando && <Loader2 className="h-4 w-4 animate-spin" />} Ir a pagar</Button>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </>
    )
}
