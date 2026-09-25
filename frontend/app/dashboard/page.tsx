'use client'

import { useEffect, useState } from 'react'
import { getDashboard, type DashboardData } from '@/services/reports'
import { getDashboardSummary, getTopProducts, type DashboardSummary, type TopProductsResponse } from '@/services/stats'
import {
    BarChart3,
    DollarSign,
    ShoppingCart,
    Receipt,
    TrendingUp,
    Wallet,
    ArrowUpRight,
    ArrowDownRight
} from 'lucide-react'
import { avisar } from '@/lib/store/uiStore'
import { formatCLP } from '@/lib/format'
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
    trend?: { value: string, positive: boolean }
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
                    <div className={cn(
                        "flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded-full",
                        trend.positive ? "bg-muted text-foreground" : "bg-destructive/10 text-destructive"
                    )}>
                        {trend.positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {trend.value}
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


type Period = 'daily' | 'weekly' | 'monthly'

const PERIODS: readonly Period[] = ['daily', 'weekly', 'monthly'] as const

/** Tabs entrega un string; sólo se acepta si es un periodo conocido. */
function isPeriod(value: string): value is Period {
    return (PERIODS as readonly string[]).includes(value)
}

export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null)
    const [summary, setSummary] = useState<DashboardSummary | null>(null)
    const [topRanking, setTopRanking] = useState<TopProductsResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [selectedPeriod, setSelectedPeriod] = useState<Period>('daily')

    useEffect(() => {
        // loading ya arranca en `true` (useState(true) arriba); no hace falta
        // volver a fijarlo aquí, y hacerlo disparaba
        // react-hooks/set-state-in-effect.
        Promise.all([
            getDashboard(),
            getDashboardSummary(),
            getTopProducts(30, 5)
        ])
            .then(([dash, summ, top]) => {
                setData(dash)
                setSummary(summ)
                setTopRanking(top)
            })
            .catch(() => avisar('No se pudieron cargar los datos del dashboard.', { reintentar: () => window.location.reload() }))
            .finally(() => setLoading(false))
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

    if (!data || !summary) return null

    const currentStats = summary[selectedPeriod]

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

            {/* main KPIs */}
            <div data-section="dashboard.indicadores" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                    title={`Ventas ${currentStats.period}`}
                    value={formatCLP(currentStats.sales_total)}
                    subtitle={`${currentStats.sales_count} transacciones`}
                    icon={DollarSign}
                    color="blue"
                />
                <KPICard
                    title={`Utilidad ${currentStats.period}`}
                    value={formatCLP(currentStats.margin_total)}
                    subtitle={`Margen: ${currentStats.sales_total > 0 ? ((currentStats.margin_total / currentStats.sales_total) * 100).toFixed(1) : 0}%`}
                    icon={Wallet}
                    color="green"
                />
                <KPICard
                    title="Ticket promedio"
                    value={formatCLP(currentStats.sales_count > 0 ? currentStats.sales_total / currentStats.sales_count : 0)}
                    icon={TrendingUp}
                    color="blue"
                />
                <KPICard
                    title="IVA por pagar"
                    value={formatCLP(currentStats.sales_tax)}
                    subtitle="Registrado en las ventas"
                    icon={Receipt}
                    color="amber"
                />
            </div>

            {/* Charts Row */}
            <DashboardCharts salesData={data.ventas_por_hora} paymentData={data.medios_pago} />

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
