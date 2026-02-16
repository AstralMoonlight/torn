'use client'

import { useEffect, useState } from 'react'
import { getDashboard, type DashboardData } from '@/services/reports'
import {
    BarChart3,
    DollarSign,
    ShoppingCart,
    Receipt,
    TrendingUp,
    AlertOctagon,
    CalendarDays,
} from 'lucide-react'
import { toast } from 'sonner'
import dynamic from 'next/dynamic'

// Dynamic import with SSR disabled to prevent Recharts hydration issues
const DashboardCharts = dynamic(() => import('@/components/dashboard/DashboardCharts'), {
    ssr: false,
    loading: () => <div className="h-64 w-full bg-slate-100 dark:bg-slate-800 animate-pulse rounded-xl" />
})

function formatCLP(value: number): string {
    return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        minimumFractionDigits: 0,
    }).format(value)
}

function KPICard({
    title,
    value,
    subtitle,
    icon: Icon,
    color = 'blue',
}: {
    title: string
    value: string
    subtitle?: string
    icon: React.ElementType
    color?: string
}) {
    const colorMap: Record<string, string> = {
        blue: 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
        green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
        amber: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
        red: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    }

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorMap[color]}`}>
                    <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{title}</p>
                    <p className="text-xl font-bold text-slate-900 dark:text-white font-tabular">{value}</p>
                    {subtitle && <p className="text-[10px] text-slate-400">{subtitle}</p>}
                </div>
            </div>
        </div>
    )
}

export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        getDashboard()
            .then(setData)
            .catch(() => toast.error('Error cargando dashboard'))
            .finally(() => setLoading(false))
    }, [])

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center">
                <div className="animate-pulse text-slate-400">Cargando dashboard...</div>
            </div>
        )
    }

    if (!data) return null

    const { kpis, ventas_por_hora, top_productos, medios_pago } = data

    return (
        <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <BarChart3 className="h-6 w-6 text-blue-600" />
                    <div>
                        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
                        <p className="text-xs text-slate-500">Resumen del día</p>
                    </div>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-lg">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {new Date(data.fecha).toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KPICard
                    title="Ventas del Día"
                    value={formatCLP(kpis.total_ventas)}
                    subtitle={`${kpis.num_ventas} transacciones`}
                    icon={DollarSign}
                    color="green"
                />
                <KPICard
                    title="Ticket Promedio"
                    value={formatCLP(kpis.ticket_promedio)}
                    icon={TrendingUp}
                    color="blue"
                />
                <KPICard
                    title="IVA Recaudado"
                    value={formatCLP(kpis.total_iva)}
                    subtitle="19%"
                    icon={Receipt}
                    color="amber"
                />
                <KPICard
                    title="Notas de Crédito"
                    value={kpis.num_notas_credito.toString()}
                    subtitle={kpis.total_notas_credito > 0 ? formatCLP(kpis.total_notas_credito) : 'Ninguna'}
                    icon={AlertOctagon}
                    color="red"
                />
            </div>

            {/* Charts Row */}
            <DashboardCharts salesData={ventas_por_hora} paymentData={medios_pago} />

            {/* Top Products */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2">
                    <ShoppingCart className="h-4 w-4 text-blue-600" />
                    Top Productos
                </h3>
                {top_productos.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800">
                                    <th className="text-left text-[10px] uppercase tracking-wider text-slate-400 pb-2 font-medium">#</th>
                                    <th className="text-left text-[10px] uppercase tracking-wider text-slate-400 pb-2 font-medium">Producto</th>
                                    <th className="text-right text-[10px] uppercase tracking-wider text-slate-400 pb-2 font-medium">Uds.</th>
                                    <th className="text-right text-[10px] uppercase tracking-wider text-slate-400 pb-2 font-medium">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {top_productos.map((p, i) => (
                                    <tr key={p.sku}>
                                        <td className="py-2 text-slate-400 font-tabular">{i + 1}</td>
                                        <td className="py-2">
                                            <p className="font-medium text-slate-900 dark:text-white text-xs">{p.nombre}</p>
                                            <p className="text-[10px] text-slate-400 font-mono">{p.sku}</p>
                                        </td>
                                        <td className="py-2 text-right font-tabular text-xs">{p.cantidad}</td>
                                        <td className="py-2 text-right font-tabular text-xs font-semibold">{formatCLP(p.total)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="py-8 text-center text-slate-400 text-sm">
                        Sin ventas registradas hoy
                    </div>
                )}
            </div>
        </div>
    )
}
