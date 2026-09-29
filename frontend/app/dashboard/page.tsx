'use client'

import { useEffect, useState } from 'react'
import { getDashboard, getPanel, type DashboardData, type PanelData } from '@/services/reports'
import { getDashboardSummary, getTopProducts, type DashboardSummary, type TopProductsResponse } from '@/services/stats'
import { getCertificado, getFoliosStatus, type FolioStockOut } from '@/services/sales'
import Link from 'next/link'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
    BarChart3,
    DollarSign,
    ShoppingCart,
    Receipt,
    TrendingUp,
    Wallet,
    ArrowUpRight,
    ArrowDownRight,
    AlertTriangle,
    CheckCircle2,
    FileWarning,
    HandCoins,
    Truck,
    ShieldCheck,
} from 'lucide-react'
import { avisar } from '@/lib/store/uiStore'
import { useSessionStore } from '@/lib/store/sessionStore'
import { formatCLP, formatDate } from '@/lib/format'
import dynamic from 'next/dynamic'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'

// Dynamic import with SSR disabled to prevent Recharts hydration issues
const DashboardCharts = dynamic(() => import('@/components/dashboard/DashboardCharts'), {
    ssr: false,
    loading: () => <div className="h-64 w-full bg-muted animate-pulse rounded-xl" />
})


function KPICard({
    title,
    value,
    subtitle,
    icon: Icon,
    color = 'blue',
    trend,
}: {
    title: string
    value: string
    subtitle?: string
    icon: React.ElementType
    color?: string
    trend?: { value: string, positive: boolean, label: string }
}) {
    const colorMap: Record<string, string> = {
        blue: 'bg-primary/10 text-primary',
        green: 'bg-muted text-foreground',
        amber: 'bg-muted text-foreground',
        red: 'bg-destructive/10 text-destructive',
    }

    return (
        <div className="rounded-xl border border-border bg-card p-4 dark:bg-card shadow-sm transition-all hover:shadow-md">
            <div className="flex items-start justify-between">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorMap[color]}`}>
                    <Icon className="h-5 w-5" />
                </div>
                {trend && (
                    <div className="flex flex-col items-end gap-0.5">
                        <div className={cn(
                            "flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded-full",
                            trend.positive ? "bg-muted text-foreground" : "bg-destructive/10 text-destructive"
                        )}>
                            {trend.positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {trend.value}
                        </div>
                        <span className="text-[11px] text-muted-foreground">{trend.label}</span>
                    </div>
                )}
            </div>
            <div className="mt-3">
                <p className="text-xs text-muted-foreground truncate font-medium uppercase tracking-wider">{title}</p>
                <p className="text-2xl font-bold text-foreground font-tabular mt-0.5 tracking-tight">{value}</p>
                {subtitle && <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">{subtitle}</p>}
            </div>
        </div>
    )
}


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
            <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
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

const TEXTO_PERIODO: Record<Period, { titulo: string; comparado: string }> = {
    daily: { titulo: 'de hoy', comparado: 'vs. ayer a esta hora' },
    weekly: { titulo: 'de 7 días', comparado: 'vs. 7 días antes' },
    monthly: { titulo: 'de 30 días', comparado: 'vs. 30 días antes' },
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

export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null)
    const [summary, setSummary] = useState<DashboardSummary | null>(null)
    const [panel, setPanel] = useState<PanelData | null>(null)
    const [topRanking, setTopRanking] = useState<TopProductsResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [selectedPeriod, setSelectedPeriod] = useState<Period>('daily')
    const [folios, setFolios] = useState<FolioStockOut[]>([])
    const [diasCertificado, setDiasCertificado] = useState<number | null>(null)
    const ambiente = useSessionStore((s) => s.availableTenants.find((t) => t.id === s.selectedTenantId)?.sii_ambiente)

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

    // ── Alertas ──────────────────────────────────────────────────────
    // En modo Desarrollador los CAF y el certificado son de prueba: no se avisa su vencimiento.
    const real = ambiente !== 'DEV'
    const avisosEmision = [
        ...folios.filter((f) => f.alerta).map((f) =>
            `${NOMBRE_DTE[f.dte_type] ?? `Documento ${f.dte_type}`}: quedan ${f.available} folios.`),
        ...folios.filter((f) => real && f.available > 0 && f.fecha_vencimiento && diasHasta(f.fecha_vencimiento) <= DIAS_AVISO)
            .map((f) => `Los folios de ${NOMBRE_DTE[f.dte_type] ?? f.dte_type} vencen el ${formatDate(f.fecha_vencimiento)}.`),
        ...(real && diasCertificado !== null && diasCertificado <= DIAS_AVISO
            ? [diasCertificado < 0 ? 'El certificado digital está vencido.' : `El certificado digital vence en ${diasCertificado} días.`]
            : []),
    ]
    const { sii, cobranza, guias, iva } = panel
    const hayAlertas = sii.num_problemas > 0 || avisosEmision.length > 0 || cobranza.vencido > 0 || guias.pendientes > 0

    // ── Estado SII y cobranza ────────────────────────────────────────
    const partesSii = GRUPOS_SII.map((g) => {
        const valor = Object.entries(sii.estados)
            .filter(([estado]) => g.estados ? g.estados.includes(estado) : !ESTADOS_AGRUPADOS.has(estado))
            .reduce((a, [, n]) => a + n, 0)
        return { etiqueta: g.etiqueta, valor, texto: String(valor), clase: g.clase }
    })
    const foliosEnUso = folios.filter((f) => f.total > 0)
    const partesCobranza = [
        { etiqueta: 'Al día', valor: cobranza.tramos.al_dia, clase: 'bg-primary/30' },
        { etiqueta: '1 a 30 días vencido', valor: cobranza.tramos['1_30'], clase: 'bg-primary/60' },
        { etiqueta: '31 a 60 días vencido', valor: cobranza.tramos['31_60'], clase: 'bg-primary' },
        { etiqueta: 'Más de 60 días vencido', valor: cobranza.tramos['61_mas'], clase: 'bg-destructive' },
    ].map((p) => ({ ...p, texto: formatCLP(p.valor) }))

    return (
        <PageContainer>
            <PageHeader
                icon={BarChart3}
                title="Panel de control"
                description="Resumen operativo y financiero de tu empresa."
                actions={
                    <Tabs value={selectedPeriod} onValueChange={(v) => { if (isPeriod(v)) setSelectedPeriod(v) }} className="w-full sm:w-auto">
                        <TabsList className="bg-muted p-1">
                            <TabsTrigger value="daily" className="text-xs">Diario</TabsTrigger>
                            <TabsTrigger value="weekly" className="text-xs">Semanal</TabsTrigger>
                            <TabsTrigger value="monthly" className="text-xs">Mensual</TabsTrigger>
                        </TabsList>
                    </Tabs>
                }
            />

            <div data-section="dashboard.alertas" className="space-y-3">
                {sii.num_problemas > 0 && (
                    <Alert variant="destructive">
                        <FileWarning className="h-4 w-4" />
                        <AlertTitle>
                            {sii.num_problemas === 1 ? 'Un documento necesita atención' : `${sii.num_problemas} documentos necesitan atención`}
                        </AlertTitle>
                        <AlertDescription>
                            <ul className="space-y-0.5">
                                {sii.problemas.slice(0, 3).map((p) => (
                                    <li key={p.id}>
                                        {NOMBRE_DTE[p.tipo_dte] ?? `Documento ${p.tipo_dte}`} {p.folio ?? ''} del {formatDate(p.fecha)}:{' '}
                                        {ESTADO_PROBLEMA[p.estado]}{p.glosa ? `. ${p.glosa}` : ''}
                                    </li>
                                ))}
                                {sii.num_problemas > 3 && <li>y {sii.num_problemas - 3} más.</li>}
                            </ul>
                            <p className="mt-1">
                                Un documento rechazado no tiene validez: hay que volver a emitirlo. Revíselos en{' '}
                                <Link href="/historial" className="font-medium underline">Historial</Link>.
                            </p>
                        </AlertDescription>
                    </Alert>
                )}

                {avisosEmision.length > 0 && (
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>La emisión se puede detener</AlertTitle>
                        <AlertDescription>
                            <ul className="space-y-0.5">
                                {avisosEmision.map((a) => <li key={a}>{a}</li>)}
                            </ul>
                            <p className="mt-1">
                                Sin folios ni certificado vigente no se puede vender con ese documento. Cárguelos en{' '}
                                <Link href="/configuracion?tab=folios" className="font-medium underline">Configuración, Folios</Link>.
                            </p>
                        </AlertDescription>
                    </Alert>
                )}

                {cobranza.vencido > 0 && (
                    <Alert>
                        <HandCoins className="h-4 w-4" />
                        <AlertTitle>
                            {formatCLP(cobranza.vencido)} en cuentas vencidas
                        </AlertTitle>
                        <AlertDescription>
                            {cobranza.num_vencidos === 1 ? 'Un cliente' : `${cobranza.num_vencidos} clientes`} con deuda pasada de su plazo.
                            {' '}La mayor: {cobranza.deudores[0]?.razon_social}, {formatCLP(cobranza.deudores[0]?.vencido)} con {cobranza.deudores[0]?.dias} días de atraso.{' '}
                            <Link href="/clientes" className="font-medium underline">Ver clientes</Link>.
                        </AlertDescription>
                    </Alert>
                )}

                {guias.pendientes > 0 && (
                    <Alert>
                        <Truck className="h-4 w-4" />
                        <AlertTitle>
                            {guias.pendientes === 1 ? 'Una guía de despacho por facturar' : `${guias.pendientes} guías de despacho por facturar`}
                        </AlertTitle>
                        <AlertDescription>
                            La más antigua es del {formatDate(guias.desde)}. La factura de una guía se emite a más tardar el día 10
                            del mes siguiente. Facture desde el <Link href="/pos" className="font-medium underline">Punto de venta</Link>.
                        </AlertDescription>
                    </Alert>
                )}

                {!hayAlertas && (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        Todo en orden: sin documentos con problemas ni cuentas vencidas.
                    </p>
                )}
            </div>

            <div data-section="dashboard.indicadores" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                    title={`Ventas ${periodo.titulo}`}
                    value={formatCLP(currentStats.sales_total)}
                    subtitle={`${currentStats.sales_count} ventas · ticket promedio ${formatCLP(currentStats.sales_count > 0 ? currentStats.sales_total / currentStats.sales_count : 0)}`}
                    icon={DollarSign}
                    color="blue"
                    trend={variacion === null ? undefined : {
                        value: `${variacion >= 0 ? '+' : ''}${variacion.toFixed(0)}%`,
                        positive: variacion >= 0,
                        label: periodo.comparado,
                    }}
                />
                <KPICard
                    title={`Utilidad ${periodo.titulo}`}
                    value={formatCLP(currentStats.margin_total)}
                    subtitle={`Margen: ${currentStats.sales_total > 0 ? ((currentStats.margin_total / currentStats.sales_total) * 100).toFixed(1) : 0}%`}
                    icon={Wallet}
                    color="green"
                />
                <KPICard
                    title="IVA del mes"
                    value={formatCLP(iva.a_pagar)}
                    subtitle={`Estimado: ventas ${formatCLP(iva.debito)} - compras ${formatCLP(iva.credito)}. El F29 vence el ${formatDate(iva.vence)}`}
                    icon={Receipt}
                    color="amber"
                />
                <KPICard
                    title="Por cobrar"
                    value={formatCLP(cobranza.total)}
                    subtitle={cobranza.vencido > 0 ? `${formatCLP(cobranza.vencido)} vencido` : 'Nada vencido'}
                    icon={HandCoins}
                    color={cobranza.vencido > 0 ? 'red' : 'green'}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card data-section="dashboard.estado-sii" className="shadow-sm">
                    <CardHeader className="pb-3 border-b">
                        <CardTitle className="text-sm font-bold flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <ShieldCheck className="h-4 w-4 text-primary" />
                                Documentos ante el SII
                            </span>
                            <Badge variant="outline" className="text-xs uppercase">Este mes</Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 space-y-5">
                        {partesSii.some((p) => p.valor > 0)
                            ? <BarraApilada partes={partesSii} />
                            : <p className="text-sm text-muted-foreground">Todavía no hay documentos emitidos este mes.</p>}
                        {foliosEnUso.length > 0 && (
                            <div className="space-y-2">
                                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Folios disponibles</p>
                                {foliosEnUso.map((f) => (
                                    <div key={f.dte_type} className="flex items-center gap-3 text-xs">
                                        <span className="w-28 shrink-0 text-foreground">{NOMBRE_DTE[f.dte_type] ?? f.dte_type}</span>
                                        <Progress value={(f.available / f.total) * 100} className="h-1.5 flex-1" />
                                        <span className={cn('w-20 text-right font-tabular', f.alerta ? 'font-bold text-destructive' : 'text-foreground')}>
                                            {f.available} de {f.total}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card data-section="dashboard.cobranza" className="shadow-sm">
                    <CardHeader className="pb-3 border-b">
                        <CardTitle className="text-sm font-bold flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <HandCoins className="h-4 w-4 text-primary" />
                                Cuentas por cobrar
                            </span>
                            <span className="font-tabular">{formatCLP(cobranza.total)}</span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4 space-y-5">
                        {cobranza.total > 0
                            ? <BarraApilada partes={partesCobranza} />
                            : <p className="text-sm text-muted-foreground">Ningún cliente tiene deuda de crédito interno.</p>}
                        {cobranza.deudores.length > 0 && (
                            <div>
                                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Mayor deuda vencida</p>
                                <ul className="divide-y divide-border text-xs">
                                    {cobranza.deudores.map((d) => (
                                        <li key={d.rut} className="flex items-center gap-3 py-2">
                                            <span className="flex-1 truncate text-foreground">{d.razon_social}</span>
                                            <span className="text-muted-foreground">{d.dias} días</span>
                                            <span className="w-24 text-right font-semibold font-tabular text-foreground">{formatCLP(d.vencido)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <DashboardCharts salesData={panel.ventas_30_dias} paymentData={data.medios_pago} />

            {/* Rankings Section */}
            <div data-section="dashboard.rankings" className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top by Quantity */}
                <Card className="shadow-sm">
                    <CardHeader className="pb-3 border-b">
                        <CardTitle className="text-sm font-bold flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <ShoppingCart className="h-4 w-4 text-primary" />
                                Más vendidos (cantidad)
                            </span>
                            <Badge variant="outline" className="text-xs uppercase">Últimos 30 días</Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                        {topRanking?.by_quantity.map((p, i) => (
                            <div key={p.product_id} className="flex items-center mb-4 last:mb-0 gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                                    {i + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-foreground truncate">{p.full_name || p.nombre}</p>
                                    <p className="text-xs text-muted-foreground font-tabular">{p.total_qty} unidades vendidas</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs font-bold text-foreground">{formatCLP(p.total_sales)}</p>
                                    <Progress value={Math.min(100, (p.total_qty / (topRanking.by_quantity[0]?.total_qty || 1)) * 100)} className="h-1 mt-1" />
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>

                {/* Top by Margin */}
                <Card className="shadow-sm border-primary/20">
                    <CardHeader className="pb-3 border-b bg-primary/5">
                        <CardTitle className="text-sm font-bold flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <TrendingUp className="h-4 w-4 text-primary" />
                                Más rentables (ranking de utilidad)
                            </span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                        {topRanking?.by_margin.map((p, i) => (
                            <div key={p.product_id} className="flex items-center mb-4 last:mb-0 gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                                    {i + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-foreground truncate">{p.full_name || p.nombre}</p>
                                    <p className="text-xs text-muted-foreground font-medium">Margen: {p.total_sales > 0 ? ((p.total_margin / p.total_sales) * 100).toFixed(1) : 0}%</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs font-bold text-primary">{formatCLP(p.total_margin)}</p>
                                    <p className="text-xs text-muted-foreground">Utilidad total</p>
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </PageContainer>
    )
}
