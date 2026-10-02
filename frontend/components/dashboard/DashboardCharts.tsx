'use client'

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from 'recharts'
import { formatCLP } from '@/lib/format'

interface SalesData {
    /** aaaa-mm-dd */
    fecha: string
    total: number
}

interface PaymentData {
    nombre: string
    total: number
}

interface Props {
    salesData: SalesData[]
    paymentData: PaymentData[]
}

const TOOLTIP_STYLE = {
    borderRadius: '0.5rem',
    border: '1px solid hsl(var(--border))',
    background: 'hsl(var(--popover))',
    color: 'hsl(var(--popover-foreground))',
    fontSize: '12px',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
}

/** aaaa-mm-dd a dd/mm, sin pasar por Date (que la leería en UTC). */
const diaMes = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`

const miles = (v: number) => `$${(v / 1000).toFixed(0)}k`


export default function DashboardCharts({ salesData, paymentData }: Props) {
    const hayVentas = salesData.some((d) => d.total !== 0)
    return (
        <div data-section="dashboard.graficos" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card p-4 ">
                <h3 className="text-sm font-semibold text-foreground mb-3">Ventas de los últimos 30 días</h3>
                {hayVentas ? (
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={salesData}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                                <XAxis dataKey="fecha" tickFormatter={diaMes} tick={{ fontSize: 10 }} minTickGap={12} />
                                <YAxis tickFormatter={miles} tick={{ fontSize: 10 }} width={48} />
                                <Tooltip
                                    labelFormatter={(f) => diaMes(String(f))}
                                    formatter={(v) => [formatCLP(Number(v)), 'Ventas']}
                                    contentStyle={TOOLTIP_STYLE}
                                    cursor={{ fill: 'hsl(var(--muted))' }}
                                />
                                <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                        Sin ventas en los últimos 30 días
                    </div>
                )}
            </div>

            <div className="rounded-xl border border-border bg-card p-4 ">
                <h3 className="text-sm font-semibold text-foreground mb-3">Cómo te pagan hoy</h3>
                {paymentData.length > 0 ? (
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={paymentData} layout="vertical" margin={{ left: 8, right: 16 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
                                <XAxis type="number" tickFormatter={miles} tick={{ fontSize: 10 }} />
                                <YAxis type="category" dataKey="nombre" tick={{ fontSize: 11 }} width={110} />
                                <Tooltip
                                    formatter={(v) => [formatCLP(Number(v)), 'Total']}
                                    contentStyle={TOOLTIP_STYLE}
                                    cursor={{ fill: 'hsl(var(--muted))' }}
                                />
                                <Bar dataKey="total" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} maxBarSize={28} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                        Sin pagos hoy
                    </div>
                )}
            </div>
        </div>
    )
}
