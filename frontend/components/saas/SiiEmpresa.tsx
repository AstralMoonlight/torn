'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertaError } from '@/components/ui/alerta-error'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SelectOpciones } from '@/components/ui/select-opciones'
import { ListaProblemas } from './ListaProblemas'
import { getProblemas, updateTenant, type Problema, type Tenant } from '@/services/saas'
import { getApiErrorDetail } from '@/services/api'
import { usePermisoSaas } from '@/lib/store/sessionStore'
import { cn } from '@/lib/utils'

type Ambiente = Tenant['sii_ambiente']

const AMBIENTES: { value: Ambiente; label: string }[] = [
    { value: 'DEV', label: 'Desarrollador' },
    { value: 'CERT', label: 'Certificación' },
    { value: 'PROD', label: 'Producción' },
]

/** Ambiente y resolución del SII (se copian a dte-torn) y lo que está fallando. */
export function SiiEmpresa({ empresa, onCambio }: { empresa: Tenant; onCambio: () => void }) {
    const puedeEditar = usePermisoSaas('empresas.sii')
    const [form, setForm] = useState({
        sii_ambiente: empresa.sii_ambiente,
        sii_resolucion_numero: String(empresa.sii_resolucion_numero),
        sii_resolucion_fecha: empresa.sii_resolucion_fecha ?? '',
        sii_oficina: empresa.sii_oficina ?? '',
    })
    const [guardando, setGuardando] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [confirmarProd, setConfirmarProd] = useState(false)
    const [problemas, setProblemas] = useState<Problema[] | null>(null)
    const [errorProblemas, setErrorProblemas] = useState<string | null>(null)

    const revisar = useCallback(() => {
        setProblemas(null)
        setErrorProblemas(null)
        getProblemas(empresa.id)
            .then(setProblemas)
            .catch((e) => { setProblemas([]); setErrorProblemas(getApiErrorDetail(e, 'No se pudo revisar la empresa.')) })
    }, [empresa.id])
    useEffect(revisar, [revisar])

    const guardar = async () => {
        setGuardando(true)
        setError(null)
        try {
            await updateTenant(empresa.id, {
                sii_ambiente: form.sii_ambiente,
                sii_resolucion_numero: Number(form.sii_resolucion_numero) || 0,
                sii_resolucion_fecha: form.sii_resolucion_fecha || null,
                sii_oficina: form.sii_oficina || null,
            })
            onCambio()
            revisar()
        } catch (e) {
            setError(getApiErrorDetail(e, 'No se pudieron guardar los datos del SII.'))
        } finally {
            setGuardando(false)
        }
    }

    return (
        <div className="grid gap-6 lg:grid-cols-2">
            <form className="space-y-4 rounded-xl border border-border bg-card p-4" onSubmit={(e) => {
                e.preventDefault()
                if (form.sii_ambiente === 'PROD' && empresa.sii_ambiente !== 'PROD') setConfirmarProd(true)
                else guardar()
            }}>
                <div>
                    <h3 className="font-semibold">Facturación electrónica</h3>
                    <p className="text-sm text-muted-foreground">Resolución y ambiente con que el SII autorizó a la empresa. Van impresos bajo el timbre.</p>
                </div>
                <fieldset disabled={!puedeEditar} className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="sii-ambiente">Ambiente</Label>
                        <SelectOpciones id="sii-ambiente" value={form.sii_ambiente}
                            onChange={(v) => v && setForm({ ...form, sii_ambiente: v })} opciones={AMBIENTES} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="sii-oficina">Unidad del SII</Label>
                        <Input id="sii-oficina" placeholder="S.I.I. - CONCEPCION" maxLength={60}
                            value={form.sii_oficina} onChange={(e) => setForm({ ...form, sii_oficina: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="sii-resolucion">N° de resolución</Label>
                        <Input id="sii-resolucion" type="number" min={0} inputMode="numeric"
                            value={form.sii_resolucion_numero} onChange={(e) => setForm({ ...form, sii_resolucion_numero: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="sii-fecha">Fecha de resolución</Label>
                        <Input id="sii-fecha" type="date"
                            value={form.sii_resolucion_fecha} onChange={(e) => setForm({ ...form, sii_resolucion_fecha: e.target.value })} />
                    </div>
                </fieldset>
                {form.sii_ambiente === 'DEV' && (
                    <p className="text-xs text-muted-foreground">Desarrollador: emite con folios de prueba y no envía nada al SII. Cada modo ve solo sus propias ventas.</p>
                )}
                {form.sii_ambiente === 'PROD' && (
                    <p className="flex items-center gap-1 text-xs text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> En producción cada documento emitido es tributariamente válido.
                    </p>
                )}
                {!puedeEditar && <p className="text-xs text-muted-foreground">Su cargo no permite cambiar estos datos.</p>}
                <AlertaError mensaje={error} />
                {puedeEditar && (
                    <div className="flex justify-end">
                        <Button type="submit" disabled={guardando}>{guardando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar</Button>
                    </div>
                )}
            </form>

            <section aria-labelledby="titulo-problemas-empresa" className="rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <h3 id="titulo-problemas-empresa" className="font-semibold">Qué revisar</h3>
                    <Button size="sm" variant="ghost" onClick={revisar} disabled={problemas === null} aria-label="Revisar de nuevo">
                        <RotateCw className={cn('h-4 w-4', problemas === null && 'animate-spin')} />
                    </Button>
                </div>
                <div className="px-4">
                    {problemas === null ? (
                        <div className="space-y-2 py-4" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-5" />)}</div>
                    ) : errorProblemas ? (
                        <AlertaError mensaje={errorProblemas} className="my-4" />
                    ) : (
                        <ListaProblemas problemas={problemas} />
                    )}
                </div>
            </section>

            <ConfirmDialog
                open={confirmarProd}
                onOpenChange={setConfirmarProd}
                title="¿Pasar la empresa a producción?"
                description="Desde ahora cada documento que emita se envía al SII real y es tributariamente válido. Las ventas de los otros modos dejan de verse (no se borran)."
                confirmLabel="Pasar a producción"
                onConfirm={guardar}
            />
        </div>
    )
}
