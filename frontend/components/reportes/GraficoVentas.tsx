'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatCLP } from '@/lib/format'
import type { ReporteVentas } from '@/services/stats'

type Punto = ReporteVentas['serie'][number]

const TOOLTIP_STYLE = {
    borderRadius: '0.5rem',
    border: '1px solid hsl(var(--border))',
    background: 'hsl(var(--popover))',
    color: 'hsl(var(--popover-foreground))',
    fontSize: '14px',
}

const miles = (v: number) => (Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${Math.round(v / 1000)}k`)

/** Barras de venta por hora, día o mes, con la cantidad de ventas en el tooltip. */
export default function GraficoVentas({ serie, etiqueta }: { serie: Punto[]; etiqueta: (clave: string) => string }) {
    return (
        <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="clave" tickFormatter={etiqueta} tick={{ fontSize: 12 }} minTickGap={8}
                        tickLine={false} axisLine={{ stroke: 'hsl(var(--border))' }} />
                    <YAxis tickFormatter={miles} tick={{ fontSize: 12 }} width={56} tickLine={false} axisLine={false} />
                    <Tooltip
                        labelFormatter={(c) => etiqueta(String(c))}
                        formatter={(v, _n, item) => {
                            const num = (item.payload as Punto).num
                            return [`${formatCLP(Number(v))} (${num} ${num === 1 ? 'venta' : 'ventas'})`, 'Vendido']
                        }}
                        contentStyle={TOOLTIP_STYLE}
                        cursor={{ fill: 'hsl(var(--muted))' }}
                    />
                    <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={48} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    )
}
