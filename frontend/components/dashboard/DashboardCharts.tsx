'use client'

import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
} from 'recharts'
import { formatCLP } from '@/lib/format'

interface SalesData {
    hora: string
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

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']


export default function DashboardCharts({ salesData, paymentData }: Props) {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Sales by Hour */}
            <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">Ventas por Hora</h3>
                {salesData.length > 0 ? (
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={salesData}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-neutral-200 dark:stroke-neutral-700" />
                                <XAxis dataKey="hora" tick={{ fontSize: 10 }} className="text-neutral-500" />
                                <YAxis
                                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                                    tick={{ fontSize: 10 }}
                                />
                                <Tooltip
                                    formatter={(v) => [formatCLP(Number(v)), 'Total']}
                                    contentStyle={{
                                        borderRadius: '0.5rem',
                                        border: '1px solid #e2e8f0',
                                        fontSize: '12px',
                                        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                                    }}
                                />
                                <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="h-64 flex items-center justify-center text-neutral-400 text-sm">
                        Sin datos de ventas hoy
                    </div>
                )}
            </div>

            {/* Payment Methods Pie */}
            <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
                <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">Medios de Pago</h3>
                {paymentData.length > 0 ? (
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={paymentData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={50}
                                    outerRadius={80}
                                    paddingAngle={4}
                                    dataKey="total"
                                    nameKey="nombre"
                                    label={((props: any) =>
                                        `${props.name ?? ''} ${((props.percent as number ?? 0) * 100).toFixed(0)}%`
                                    ) as any}
                                >
                                    {paymentData.map((_, i) => (
                                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    formatter={(v) => [formatCLP(Number(v)), 'Total']}
                                    contentStyle={{ borderRadius: '0.5rem', fontSize: '12px' }}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div className="h-64 flex items-center justify-center text-neutral-400 text-sm">
                        Sin datos de pagos hoy
                    </div>
                )}
            </div>
        </div>
    )
}
