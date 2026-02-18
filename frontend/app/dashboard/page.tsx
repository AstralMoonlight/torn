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
    AlertOctagon,
    CalendarDays,
    Wallet,
    Percent,
    ArrowUpRight,
    ArrowDownRight
} from 'lucide-react'
import { toast } from 'sonner'
import { formatCLP } from '@/lib/format'
import dynamic from 'next/dynamic'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// Dynamic import with SSR disabled to prevent Recharts hydration issues
const DashboardCharts = dynamic(() => import('@/components/dashboard/DashboardCharts'), {
    ssr: false,
    loading: () => <div className="h-64 w-full bg-slate-100 dark:bg-slate-800 animate-pulse rounded-xl" />
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
        blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
        green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
        amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
        red: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
        purple: 'bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400',
    }

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950 shadow-sm transition-all hover:shadow-md">
            <div className="flex items-start justify-between">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorMap[color]}`}>
                    <Icon className="h-5 w-5" />
                </div>
                {trend && (
                    <div className={cn(
                        "flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                        trend.positive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                    )}>
                        {trend.positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {trend.value}
                    </div>
                )}
            </div>
            <div className="mt-3">
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate font-medium uppercase tracking-wider">{title}</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white font-tabular mt-0.5 tracking-tight">{value}</p>
                {subtitle && <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">{subtitle}</p>}
            </div>
        </div>
    )
}


export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null)
    const [summary, setSummary] = useState<DashboardSummary | null>(null)
    const [topRanking, setTopRanking] = useState<TopProductsResponse | null>(null)
    const [loading, setLoading] = useState(true)
    const [selectedPeriod, setSelectedPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')

    useEffect(() => {
        setLoading(true)
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
            .catch(() => toast.error('Error cargando datos del dashboard'))
            .finally(() => setLoading(false))
    }, [])

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <BarChart3 className="h-10 w-10 text-blue-600 animate-bounce" />
                    <div className="text-slate-400 font-medium">Analizando datos...</div>
                </div>
            </div>
        )
    }

    if (!data || !summary) return null

    const currentStats = summary[selectedPeriod]

    return (
        <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
                        <BarChart3 className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Panel de Control</h1>
                        <p className="text-sm text-slate-500">Resumen operativo y financiero</p>
                    </div>
                </div>

                <Tabs value={selectedPeriod} onValueChange={(v) => setSelectedPeriod(v as any)} className="w-full sm:w-auto">
                    <TabsList className="bg-slate-100 dark:bg-slate-800 p-1">
                        <TabsTrigger value="daily" className="text-xs">Diario</TabsTrigger>
                        <TabsTrigger value="weekly" className="text-xs">Semanal</TabsTrigger>
                        <TabsTrigger value="monthly" className="text-xs">Mensual</TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            {/* main KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
                    title="Ticket Promedio"
                    value={formatCLP(currentStats.sales_count > 0 ? currentStats.sales_total / currentStats.sales_count : 0)}
                    icon={TrendingUp}
                    color="purple"
                />
                <KPICard
                    title="IVA Por Pagar"
                    value={formatCLP(currentStats.sales_total * 0.19)}
                    subtitle="Estimado 19%"
                    icon={Receipt}
                    color="amber"
                />
            </div>

            {/* Charts Row */}
            <DashboardCharts salesData={data.ventas_por_hora} paymentData={data.medios_pago} />

            {/* Rankings Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Top by Quantity */}
                <Card className="shadow-sm">
                    <CardHeader className="pb-3 border-b">
                        <CardTitle className="text-sm font-bold flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <ShoppingCart className="h-4 w-4 text-blue-600" />
                                Más Vendidos (Cantidad)
                            </span>
                            <Badge variant="outline" className="text-[10px] uppercase">Últimos 30 días</Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                        {topRanking?.by_quantity.map((p, i) => (
                            <div key={p.product_id} className="flex items-center mb-4 last:mb-0 gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-500">
                                    {i + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{p.full_name || p.nombre}</p>
                                    <p className="text-[10px] text-slate-400 font-tabular">{p.total_qty} unidades vendidas</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs font-bold text-slate-900 dark:text-white">{formatCLP(p.total_sales)}</p>
                                    <Progress value={Math.min(100, (p.total_qty / (topRanking.by_quantity[0]?.total_qty || 1)) * 100)} className="h-1 mt-1" />
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>

                {/* Top by Margin */}
                <Card className="shadow-sm border-emerald-100 dark:border-emerald-900/30">
                    <CardHeader className="pb-3 border-b bg-emerald-50/50 dark:bg-emerald-950/20">
                        <CardTitle className="text-sm font-bold flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <TrendingUp className="h-4 w-4 text-emerald-600" />
                                Más Rentables (Ranking Utilidad)
                            </span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                        {topRanking?.by_margin.map((p, i) => (
                            <div key={p.product_id} className="flex items-center mb-4 last:mb-0 gap-3">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-xs font-bold text-emerald-600">
                                    {i + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{p.full_name || p.nombre}</p>
                                    <p className="text-[10px] text-slate-500 font-medium">Margen: {p.total_sales > 0 ? ((p.total_margin / p.total_sales) * 100).toFixed(1) : 0}%</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs font-bold text-emerald-600">{formatCLP(p.total_margin)}</p>
                                    <p className="text-[9px] text-slate-400">Utilidad Total</p>
                                </div>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
