'use client'

import { useEffect, useState } from 'react'
import { getDashboard, getPanel, type DashboardData, type PanelData } from '@/services/reports'
import { getDashboardSummary, getTopProducts, type DashboardSummary, type TopProductsResponse } from '@/services/stats'
import { getCertificado, getFoliosStatus, getSales, type FolioStockOut, type SaleOut } from '@/services/sales'
import Link from 'next/link'
import { BarChart3, CheckCircle2 } from 'lucide-react'
import { avisar } from '@/lib/store/uiStore'
import { useSessionStore } from '@/lib/store/sessionStore'
import { CHILE_TIMEZONE, formatCLP, formatDate, getTodayChile } from '@/lib/format'
import dynamic from 'next/dynamic'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'

// Dynamic import with SSR disabled to prevent Recharts hydration issues
const DashboardCharts = dynamic(() => import('@/components/dashboard/DashboardCharts'), {
    ssr: false,
    loading: () => <div className="h-64 w-full bg-muted animate-pulse rounded-xl" />
})


/** Barra horizontal partida en tramos, con la leyenda y el valor de cada uno abajo. */
function BarraApilada({ partes }: { partes: { etiqueta: string; valor: number; texto: string; clase: string }[] }) {
    const total = partes.reduce((a, p) => a + p.valor, 0)
    return (
        <div>
            <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
                {total > 0 && partes.filter((p) => p.valor > 0).map((p) => (
                    <div key={p.etiqueta} className={p.clase} style={{ width: `${(p.valor / total) * 100}%` }}
                        title={`${p.etiqueta}: ${p.texto}`} />
                ))}
            </div>
            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                {partes.map((p) => (
                    <li key={p.etiqueta} className="flex items-center gap-2">
                        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', p.clase)} />
                        <span className="text-muted-foreground">{p.etiqueta}</span>
                        <span className="ml-auto font-semibold font-tabular text-foreground">{p.texto}</span>
                    </li>
                ))}
            </ul>
        </div>
    )
}


type Period = 'daily' | 'weekly' | 'monthly'

const PERIODS: readonly Period[] = ['daily', 'weekly', 'monthly'] as const

/** Tabs entrega un string; sólo se acepta si es un periodo conocido. */
function isPeriod(value: string): value is Period {
    return (PERIODS as readonly string[]).includes(value)
}

const TEXTO_PERIODO: Record<Period, { vendiste: string; utilidad: string; comparado: string }> = {
    daily: { vendiste: 'Hoy vendiste', utilidad: 'Utilidad de hoy', comparado: 'que ayer a esta hora' },
    weekly: { vendiste: 'En 7 días vendiste', utilidad: 'Utilidad de 7 días', comparado: 'que los 7 días anteriores' },
    monthly: { vendiste: 'En 30 días vendiste', utilidad: 'Utilidad de 30 días', comparado: 'que los 30 días anteriores' },
}

const NOMBRE_DTE: Record<number, string> = {
    33: 'Factura', 34: 'Factura exenta', 39: 'Boleta', 41: 'Boleta exenta',
    52: 'Guía de despacho', 56: 'Nota de débito', 61: 'Nota de crédito',
}

const ESTADO_PROBLEMA: Record<string, string> = {
    RECHAZADO: 'rechazado por el SII',
    REPAROS: 'aceptado con reparos',
    ERROR_VALIDACION: 'con error de validación',
    SIN_RESPUESTA: 'sin respuesta del SII hace más de un día',
}

/** Estados de dte-torn agrupados como los entiende el usuario. ANULADO no se muestra. */
const GRUPOS_SII = [
    { etiqueta: 'Aceptados', estados: ['ACEPTADO', 'SIMULADO'], clase: 'bg-primary' },
    { etiqueta: 'En proceso', estados: null, clase: 'bg-muted-foreground/40' },
    { etiqueta: 'Con reparos', estados: ['REPAROS'], clase: 'bg-amber-500' },
    { etiqueta: 'Rechazados', estados: ['RECHAZADO', 'ERROR_VALIDACION'], clase: 'bg-destructive' },
]
const ESTADOS_AGRUPADOS = new Set(['ANULADO', ...GRUPOS_SII.flatMap((g) => g.estados ?? [])])

const DIAS_AVISO = 30

/** Días desde hoy hasta una fecha aaaa-mm-dd (negativo si ya pasó). */
function diasHasta(fecha: string): number {
    const [y, m, d] = fecha.slice(0, 10).split('-').map(Number)
    const hoy = new Date()
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 86_400_000)
}

const horaChile = new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: CHILE_TIMEZONE })
const fechaLarga = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: CHILE_TIMEZONE })

function saludo(nombre?: string): string {
    const hora = Number(new Intl.DateTimeFormat('es-CL', { hour: 'numeric', hourCycle: 'h23', timeZone: CHILE_TIMEZONE }).format(new Date()))
    const base = hora < 12 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches'
    const primero = nombre?.trim().split(/\s+/)[0]
    return primero ? `${base}, ${primero}` : base
}

/** Algo que el usuario tiene que resolver, con el botón que lo lleva a hacerlo. */
type Pendiente = { tono: 'grave' | 'aviso' | 'info'; titulo: string; detalle: string; accion: string; href: string }

const PUNTO: Record<Pendiente['tono'], string> = {
    grave: 'bg-destructive',
    aviso: 'bg-amber-500',
    info: 'bg-primary',
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : `${n} ${varios}`)

export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null)
    const [summary, setSummary] = useState<DashboardSummary | null>(null)
    const [panel, setPanel] = useState<PanelData | null>(null)
    const [topRanking, setTopRanking] = useState<TopProductsResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [selectedPeriod, setSelectedPeriod] = useState<Period>('daily')
    const [folios, setFolios] = useState<FolioStockOut[]>([])
    const [diasCertificado, setDiasCertificado] = useState<number | null>(null)
    const [ultimas, setUltimas] = useState<SaleOut[]>([])
    const ambiente = useSessionStore((s) => s.availableTenants.find((t) => t.id === s.selectedTenantId)?.sii_ambiente)
    const nombre = useSessionStore((s) => s.user?.full_name)

    useEffect(() => {
        // loading ya arranca en `true` (useState(true) arriba); no hace falta
        // volver a fijarlo aquí, y hacerlo disparaba
        // react-hooks/set-state-in-effect.
        Promise.all([
            getDashboard(),
            getDashboardSummary(),
            getTopProducts(30, 5),
            getPanel(),
        ])
            .then(([dash, summ, top, pan]) => {
                setData(dash)
                setSummary(summ)
                setTopRanking(top)
                setPanel(pan)
            })
            .catch(() => avisar('No se pudieron cargar los datos del dashboard.', { reintentar: () => window.location.reload() }))
            .finally(() => setLoading(false))
        // Aparte: si dte-torn no responde, el resto del panel se muestra igual.
        getFoliosStatus().then(setFolios).catch(() => null)
        getCertificado().then((c) => setDiasCertificado(c?.dias_restantes ?? null)).catch(() => null)
        const hoy = getTodayChile()
        getSales({ desde: hoy, hasta: hoy, limit: 8 }).then(setUltimas).catch(() => null)
    }, [])

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <BarChart3 className="h-10 w-10 text-primary animate-bounce" />
                    <div className="text-muted-foreground font-medium">Analizando datos...</div>
                </div>
            </div>
        )
    }

    if (!data || !summary || !panel) return null

    const currentStats = summary[selectedPeriod]
    const periodo = TEXTO_PERIODO[selectedPeriod]
    const variacion = currentStats.sales_total_prev > 0
        ? ((currentStats.sales_total - currentStats.sales_total_prev) / currentStats.sales_total_prev) * 100
        : null
    const { sii, cobranza, guias, iva } = panel

    // ── Para atender ─────────────────────────────────────────────────
    // En modo Desarrollador los CAF y el certificado son de prueba: no se avisa su vencimiento.
    const real = ambiente !== 'DEV'
    const pendientes: Pendiente[] = []
    if (sii.num_problemas > 0) {
        const p = sii.problemas[0]
        pendientes.push({
            tono: 'grave',
            titulo: `${plural(sii.num_problemas, 'Un documento', 'documentos')} con problemas en el SII`,
            detalle: `${NOMBRE_DTE[p.tipo_dte] ?? `Documento ${p.tipo_dte}`} ${p.folio ?? ''} del ${formatDate(p.fecha)}: ${ESTADO_PROBLEMA[p.estado]}`
                + `${sii.num_problemas > 1 ? `, y ${sii.num_problemas - 1} más` : ''}. Un rechazado no tiene validez: hay que emitirlo de nuevo.`,
            accion: 'Revisar',
            href: '/historial/rechazados',
        })
    }
    for (const f of folios.filter((f) => f.alerta)) {
        pendientes.push({
            tono: 'grave',
            titulo: `Quedan ${f.available} folios de ${NOMBRE_DTE[f.dte_type] ?? `documento ${f.dte_type}`}`,
            detalle: 'Cuando se acaben no se puede vender con ese documento.',
            accion: 'Cargar folios',
            href: '/configuracion?tab=folios',
        })
    }
    for (const f of folios.filter((f) => real && f.available > 0 && f.fecha_vencimiento && diasHasta(f.fecha_vencimiento) <= DIAS_AVISO)) {
        pendientes.push({
            tono: 'grave',
            titulo: `Los folios de ${NOMBRE_DTE[f.dte_type] ?? f.dte_type} vencen el ${formatDate(f.fecha_vencimiento)}`,
            detalle: 'Después de esa fecha no sirven: carga folios nuevos antes.',
            accion: 'Cargar folios',
            href: '/configuracion?tab=folios',
        })
    }
    if (real && diasCertificado !== null && diasCertificado <= DIAS_AVISO) {
        pendientes.push({
            tono: 'grave',
            titulo: diasCertificado < 0 ? 'El certificado digital está vencido' : `El certificado digital vence en ${diasCertificado} días`,
            detalle: 'Sin certificado vigente no se pueden emitir documentos.',
            accion: 'Renovar',
            href: '/configuracion?tab=folios',
        })
    }
    if (cobranza.vencido > 0) {
        const mayor = cobranza.deudores[0]
        pendientes.push({
            tono: 'aviso',
            titulo: cobranza.num_vencidos === 1 && mayor
                ? `${mayor.razon_social} debe ${formatCLP(mayor.vencido)}`
                : `${cobranza.num_vencidos} clientes deben ${formatCLP(cobranza.vencido)} vencido`,
            detalle: cobranza.num_vencidos === 1 && mayor
                ? `Lleva ${mayor.dias} días de atraso.`
                : `La mayor deuda: ${mayor?.razon_social}, ${formatCLP(mayor?.vencido)} con ${mayor?.dias} días de atraso.`,
            accion: cobranza.num_vencidos === 1 ? 'Ver cliente' : 'Ver clientes',
            href: '/clientes',
        })
    }
    if (guias.pendientes > 0) {
        pendientes.push({
            tono: 'info',
            titulo: `${plural(guias.pendientes, 'Una guía', 'guías')} de despacho sin facturar`,
            detalle: `La más antigua es del ${formatDate(guias.desde)}. Se factura a más tardar el día 10 del mes siguiente.`,
            accion: 'Facturar',
            href: '/pos',
        })
    }

    // ── Estado SII ───────────────────────────────────────────────────
    const partesSii = GRUPOS_SII.map((g) => {
        const valor = Object.entries(sii.estados)
            .filter(([estado]) => g.estados ? g.estados.includes(estado) : !ESTADOS_AGRUPADOS.has(estado))
            .reduce((a, [, n]) => a + n, 0)
        return { etiqueta: g.etiqueta, valor, texto: String(valor), clase: g.clase }
    })
    const foliosEnUso = folios.filter((f) => f.total > 0)
    const fecha = fechaLarga.format(new Date())

    return (
        <PageContainer>
            <PageHeader
                title={saludo(nombre)}
                description={fecha.charAt(0).toUpperCase() + fecha.slice(1)}
                actions={
                    <Tabs value={selectedPeriod} onValueChange={(v) => { if (isPeriod(v)) setSelectedPeriod(v) }} className="w-full sm:w-auto">
                        <TabsList className="bg-muted p-1">
                            <TabsTrigger value="daily">Hoy</TabsTrigger>
                            <TabsTrigger value="weekly">7 días</TabsTrigger>
                            <TabsTrigger value="monthly">30 días</TabsTrigger>
                        </TabsList>
                    </Tabs>
                }
            />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-6 min-w-0">
                    <Card data-section="dashboard.ventas">
                        <CardContent className="p-6">
                            <p className="text-base font-medium text-muted-foreground">{periodo.vendiste}</p>
                            <p className="mt-1 text-4xl sm:text-5xl font-bold tracking-tight font-tabular text-foreground">
                                {formatCLP(currentStats.sales_total)}
                            </p>
                            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                                {variacion !== null && (
                                    <span className="flex items-center gap-2">
                                        <span className={cn(
                                            'rounded-full px-2.5 py-0.5 font-semibold',
                                            variacion >= 0 ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'
                                        )}>
                                            {Math.abs(variacion).toFixed(0)}% {variacion >= 0 ? 'más' : 'menos'}
                                        </span>
                                        <span className="text-muted-foreground">{periodo.comparado}</span>
                                    </span>
                                )}
                                <span className="text-foreground">
                                    {plural(currentStats.sales_count, 'Una venta', 'ventas')}, ticket promedio{' '}
                                    {formatCLP(currentStats.sales_count > 0 ? currentStats.sales_total / currentStats.sales_count : 0)}
                                </span>
                            </div>
                        </CardContent>
                    </Card>

                    <Card data-section="dashboard.atender">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-base font-semibold flex items-center justify-between">
                                Para atender
                                {pendientes.length > 0 && (
                                    <span className="text-sm font-normal text-muted-foreground">
                                        {plural(pendientes.length, '1 pendiente', 'pendientes')}
                                    </span>
                                )}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {pendientes.length > 0 ? (
                                <ul className="divide-y divide-border">
                                    {pendientes.map((p) => (
                                        <li key={p.titulo} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                                            <span className={cn('hidden sm:block h-2.5 w-2.5 shrink-0 rounded-full', PUNTO[p.tono])} aria-hidden />
                                            <div className="min-w-0 flex-1">
                                                <p className="font-medium text-foreground flex items-center gap-2">
                                                    <span className={cn('sm:hidden h-2.5 w-2.5 shrink-0 rounded-full', PUNTO[p.tono])} aria-hidden />
                                                    {p.titulo}
                                                </p>
                                                <p className="text-sm text-muted-foreground">{p.detalle}</p>
                                            </div>
                                            <Button asChild variant="outline" className="self-start sm:self-auto">
                                                <Link href={p.href}>{p.accion}</Link>
                                            </Button>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <CheckCircle2 className="h-4 w-4 text-primary" />
                                    Todo en orden: sin documentos con problemas ni cuentas vencidas.
                                </p>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <Card data-section="dashboard.ultimas-ventas" className="self-start">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base font-semibold">Últimas ventas de hoy</CardTitle>
                        <p className="text-sm text-muted-foreground">
                            {plural(data.kpis.num_ventas, 'Una venta', 'ventas')} hoy
                            {data.caja && `, caja abierta a las ${horaChile.format(new Date(data.caja.inicio))}`}
                        </p>
                    </CardHeader>
                    <CardContent>
                        {ultimas.length > 0 ? (
                            <ul className="divide-y divide-border text-sm">
                                {ultimas.map((v) => (
                                    <li key={v.id} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-2 py-2">
                                        <span className="text-muted-foreground font-tabular">{horaChile.format(new Date(v.fecha_emision))}</span>
                                        <span className="min-w-0">
                                            <span className="block text-foreground">{NOMBRE_DTE[v.tipo_dte] ?? 'Documento'} {v.folio}</span>
                                            <span className="block truncate text-muted-foreground">{v.customer?.razon_social}</span>
                                        </span>
                                        <span className="font-semibold font-tabular text-foreground text-right">
                                            {formatCLP(v.tipo_dte === 61 ? -Number(v.monto_total) : v.monto_total)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-sm text-muted-foreground">Todavía no hay ventas hoy.</p>
                        )}
                        <Link href="/historial" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
                            Ver todo el historial
                        </Link>
                    </CardContent>
                </Card>
            </div>

            <Card data-section="dashboard.indicadores" className="grid grid-cols-1 md:grid-cols-3 md:divide-x divide-y md:divide-y-0 divide-border">
                <div className="p-6">
                    <p className="text-sm font-medium text-muted-foreground">{periodo.utilidad}</p>
                    <p className="mt-1 text-2xl font-bold tracking-tight font-tabular text-foreground">{formatCLP(currentStats.margin_total)}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Lo que te quedó después del costo:{' '}
                        {currentStats.sales_net > 0 ? ((currentStats.margin_total / currentStats.sales_net) * 100).toFixed(0) : 0}% de la venta sin IVA.
                    </p>
                </div>
                <div className="p-6">
                    <p className="text-sm font-medium text-muted-foreground">IVA a pagar del mes</p>
                    <p className="mt-1 text-2xl font-bold tracking-tight font-tabular text-foreground">{formatCLP(iva.a_pagar)}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Estimado: ventas {formatCLP(iva.debito)} menos compras {formatCLP(iva.credito)}. El F29 vence el {formatDate(iva.vence)}.
                    </p>
                </div>
                <div className="p-6">
                    <p className="text-sm font-medium text-muted-foreground">Te deben</p>
                    <p className="mt-1 text-2xl font-bold tracking-tight font-tabular text-foreground">{formatCLP(cobranza.total)}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {cobranza.vencido > 0 ? `${formatCLP(cobranza.vencido)} ya pasó su plazo. ` : 'Nada vencido. '}
                        <Link href="/clientes" className="font-medium text-primary hover:underline">Ver clientes</Link>
                    </p>
                </div>
            </Card>

            <DashboardCharts salesData={panel.ventas_30_dias} paymentData={data.medios_pago} />

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <Card data-section="dashboard.estado-sii">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base font-semibold flex items-center justify-between">
                            Tus documentos en el SII
                            <span className="text-sm font-normal text-muted-foreground">Este mes</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {partesSii.some((p) => p.valor > 0)
                            ? <BarraApilada partes={partesSii} />
                            : <p className="text-sm text-muted-foreground">Todavía no hay documentos emitidos este mes.</p>}
                        {foliosEnUso.length > 0 && (
                            <div className="space-y-2">
                                <h3 className="text-sm font-semibold text-foreground">Folios que te quedan</h3>
                                {foliosEnUso.map((f) => (
                                    <div key={f.dte_type} className="flex items-center gap-3 text-sm">
                                        <span className="w-28 shrink-0 text-foreground">{NOMBRE_DTE[f.dte_type] ?? f.dte_type}</span>
                                        <Progress value={(f.available / f.total) * 100} className="h-1.5 flex-1" />
                                        <span className={cn('w-24 text-right font-tabular', f.alerta ? 'font-bold text-destructive' : 'text-foreground')}>
                                            {f.available} de {f.total}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card data-section="dashboard.mas-vendidos">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base font-semibold flex items-center justify-between">
                            Lo que más se vende
                            <span className="text-sm font-normal text-muted-foreground">30 días</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ol className="divide-y divide-border text-sm">
                            {topRanking?.by_quantity.map((p, i) => (
                                <li key={p.product_id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-2 py-2">
                                    <span className="font-semibold text-muted-foreground">{i + 1}</span>
                                    <span className="min-w-0">
                                        <span className="block truncate text-foreground">{p.full_name || p.nombre}</span>
                                        <span className="block text-muted-foreground font-tabular">{p.total_qty} vendidos</span>
                                    </span>
                                    <span className="font-semibold font-tabular text-foreground">{formatCLP(p.total_sales)}</span>
                                </li>
                            ))}
                        </ol>
                    </CardContent>
                </Card>

                <Card data-section="dashboard.mas-rentables">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base font-semibold flex items-center justify-between">
                            Lo que más te deja
                            <span className="text-sm font-normal text-muted-foreground">30 días</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ol className="divide-y divide-border text-sm">
                            {topRanking?.by_margin.map((p, i) => (
                                <li key={p.product_id} className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-2 py-2">
                                    <span className="font-semibold text-muted-foreground">{i + 1}</span>
                                    <span className="min-w-0">
                                        <span className="block truncate text-foreground">{p.full_name || p.nombre}</span>
                                        <span className="block text-muted-foreground">
                                            Te deja el {p.total_sales > 0 ? ((p.total_margin / p.total_sales) * 100).toFixed(0) : 0}%
                                        </span>
                                    </span>
                                    <span className="font-semibold font-tabular text-primary">{formatCLP(p.total_margin)}</span>
                                </li>
                            ))}
                        </ol>
                    </CardContent>
                </Card>
            </div>
        </PageContainer>
    )
}
