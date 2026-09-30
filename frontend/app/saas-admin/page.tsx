'use client'

import { useCallback, useEffect, useState } from 'react'
import { LayoutDashboard, RotateCw } from 'lucide-react'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ListaProblemas } from '@/components/saas/ListaProblemas'
import { getResumen, type Resumen } from '@/services/saas'
import { getApiErrorMessage } from '@/services/api'
import { avisar } from '@/lib/store/uiStore'
import { usePermisoSaas } from '@/lib/store/sessionStore'
import { formatCLP } from '@/lib/format'
import { cn } from '@/lib/utils'

function Cifra({ titulo, valor, detalle, tono }: { titulo: string; valor: string | number; detalle?: string; tono?: 'aviso' | 'critico' }) {
    return (
        <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm text-muted-foreground">{titulo}</p>
            <p className={cn(
                'mt-1 text-2xl font-bold font-tabular text-foreground',
                // Un cero no alarma: el color solo cuando hay algo que ver.
                valor !== 0 && tono === 'aviso' && 'text-amber-700 dark:text-amber-400',
                valor !== 0 && tono === 'critico' && 'text-destructive',
            )}>{valor}</p>
            {detalle && <p className="text-xs text-muted-foreground mt-0.5">{detalle}</p>}
        </div>
    )
}

export default function ResumenPage() {
    const puedeVer = usePermisoSaas('empresas.ver')
    const [datos, setDatos] = useState<Resumen | null>(null)
    const [cargando, setCargando] = useState(true)
    const [nivel, setNivel] = useState<'todos' | 'critico' | 'aviso'>('todos')

    const pedir = useCallback(() => getResumen()
        .then(setDatos)
        .catch((e) => avisar(getApiErrorMessage(e, 'No se pudo cargar el resumen. Pruebe con Actualizar.')))
        .finally(() => setCargando(false)), [])
    const cargar = () => { setCargando(true); pedir() }

    useEffect(() => { if (puedeVer) pedir() }, [puedeVer, pedir])

    if (!puedeVer) {
        return (
            <PageContainer>
                <PageHeader icon={LayoutDashboard} title="Resumen" description="Su cargo no incluye ver las empresas. Use el menú de arriba." />
            </PageContainer>
        )
    }

    const e = datos?.por_estado ?? {}
    const problemas = (datos?.problemas ?? []).filter((p) => nivel === 'todos' || p.nivel === nivel)
    const cuenta = (n: 'critico' | 'aviso') => datos?.problemas.filter((p) => p.nivel === n).length ?? 0

    return (
        <PageContainer>
            <PageHeader
                icon={LayoutDashboard}
                title="Resumen"
                description="Quién debe, qué empresa tiene un problema y qué hacer."
                actions={
                    <Button variant="outline" onClick={cargar} disabled={cargando}>
                        <RotateCw className={cn('h-4 w-4', cargando && 'animate-spin')} /> Actualizar
                    </Button>
                }
            />

            {!datos ? (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3" aria-busy="true">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
                </div>
            ) : (
                <div data-section="saas-admin.cifras" className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                    <Cifra titulo="Cobrado este mes" valor={formatCLP(datos.cobrado_mes)} detalle={`${datos.pagos_mes} pagos`} />
                    <Cifra titulo="Empresas activas" valor={datos.empresas_activas}
                        detalle={`${(e.AL_DIA ?? 0) + (e.CORTESIA ?? 0)} al día o en cortesía`} />
                    <Cifra titulo="Por vencer" valor={(e.POR_VENCER ?? 0) + (e.SIN_PAGO ?? 0)}
                        detalle={e.SIN_PAGO ? `${e.SIN_PAGO} sin primer pago` : 'en los próximos días'} tono="aviso" />
                    <Cifra titulo="Vencidas" valor={(e.EN_GRACIA ?? 0) + (e.PRORROGA ?? 0)}
                        detalle="en gracia o con prórroga" tono="aviso" />
                    <Cifra titulo="Suspendidas" valor={e.SUSPENDIDA ?? 0} detalle="solo pueden consultar" tono="critico" />
                </div>
            )}

            <section data-section="saas-admin.atencion" aria-labelledby="titulo-atencion" className="rounded-xl border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                    <h2 id="titulo-atencion" className="font-semibold text-foreground">Requiere atención</h2>
                    <div className="flex gap-1" role="group" aria-label="Filtrar por urgencia">
                        {([['todos', 'Todo'], ['critico', `Urgente (${cuenta('critico')})`], ['aviso', `Revisar (${cuenta('aviso')})`]] as const).map(([valor, texto]) => (
                            <Button key={valor} size="sm" variant={nivel === valor ? 'secondary' : 'ghost'}
                                aria-pressed={nivel === valor} onClick={() => setNivel(valor)}>
                                {texto}
                            </Button>
                        ))}
                    </div>
                </div>
                <div className="px-4">
                    {!datos ? (
                        <div className="space-y-2 py-4" aria-busy="true">
                            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5" />)}
                        </div>
                    ) : (
                        <ListaProblemas problemas={problemas} conEmpresa />
                    )}
                </div>
            </section>
        </PageContainer>
    )
}
