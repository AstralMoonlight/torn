'use client'

import { useEffect, useState } from 'react'
import { getReport, ReportOut } from '@/services/stats'
import { formatCLP, formatDate, getTodayChile } from '@/lib/format'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Printer, Info, Wallet, BarChart2, Calendar, Filter } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

export default function DailyReportPage() {
    // Default to today
    const [date, setDate] = useState<string>(getTodayChile())
    const [period, setPeriod] = useState<string>('day')

    const [report, setReport] = useState<ReportOut | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        async function load() {
            setLoading(true)
            try {
                const data = await getReport(period, date)
                setReport(data)
            } catch (error) {
                console.error("Error loading report:", error)
            } finally {
                setLoading(false)
            }
        }
        load()
    }, [date, period])

    const handlePrint = () => {
        window.print()
    }

    // Helper to format title based on period
    const getReportTitle = () => {
        if (!report) return "Reporte"
        const d = new Date(report.fecha)
        if (period === 'day') return `Cierre Diario - ${formatDate(report.fecha)}`
        if (period === 'week') return `Reporte Semanal`
        if (period === 'month') return `Reporte Mensual - ${d.toLocaleString('es-CL', { month: 'long', year: 'numeric', timeZone: 'America/Santiago' }).toUpperCase()}`
        return "Reporte de Ventas"
    }

    if (loading && !report) {
        return (
            <div className="p-6 max-w-4xl mx-auto space-y-6">
                <div className="flex justify-between items-center">
                    <Skeleton className="h-10 w-48" />
                    <Skeleton className="h-10 w-32" />
                </div>
                <Skeleton className="h-40 w-full rounded-xl" />
                <Skeleton className="h-[400px] w-full rounded-xl" />
            </div>
        )
    }

    // Calculations (safe fallback to 0)
    const totalVentasBrutas = Number(report?.total_ventas || 0)
    const totalIva = Math.round(totalVentasBrutas - (totalVentasBrutas / 1.19))
    const totalVentasNetas = totalVentasBrutas - totalIva
    const totalUtilidadReal = Number(report?.total_utilidad || 0)
    const totalCostos = totalVentasNetas - totalUtilidadReal
    const itemCount = report?.items.length || 0

    return (
        <div className="p-4 md:p-8 max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
            {/* Control Bar (Hidden on Print) */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 print:hidden border-b pb-6 border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-900 text-white rounded-lg dark:bg-slate-100 dark:text-slate-900">
                        <BarChart2 className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                            Reportes
                        </h1>
                        <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">
                            Histórico de Ventas
                        </p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
                    {/* Period Selector */}
                    <Select value={period} onValueChange={setPeriod}>
                        <SelectTrigger className="w-full sm:w-[140px] border-slate-200">
                            <SelectValue placeholder="Periodo" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="day">Diario</SelectItem>
                            <SelectItem value="week">Semanal</SelectItem>
                            <SelectItem value="month">Mensual</SelectItem>
                        </SelectContent>
                    </Select>

                    {/* Date Picker (Native) */}
                    <div className="relative w-full sm:w-auto">
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="flex h-10 w-full rounded-md border border-slate-200 bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 uppercase"
                        />
                    </div>

                    <Button variant="outline" onClick={handlePrint} className="w-full sm:w-auto gap-2 border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900">
                        <Printer className="h-4 w-4" />
                        Imprimir
                    </Button>
                </div>
            </div>

            {/* Print Only Header */}
            <div className="hidden print:block text-left border-b-2 border-black pb-4 mb-8">
                <h1 className="text-xl font-bold uppercase tracking-tighter">{getReportTitle()}</h1>
                <p className="text-xs font-mono">
                    Periodo: {period === 'day' ? 'Diario' : period === 'week' ? 'Semanal' : 'Mensual'} |
                    Referencia: {new Date(date + 'T12:00:00').toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}
                </p>
            </div>

            {/* Simplified Summary Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-2">
                {/* Financial Summary */}
                <div className="space-y-6">
                    <h2 className="text-sm font-bold uppercase text-slate-400 tracking-widest print:text-black">Resumen Financiero</h2>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center group">
                            <span className="text-sm text-slate-600 dark:text-slate-400">Total Ingresos (Bruto)</span>
                            <span className="font-mono font-medium">{formatCLP(totalVentasBrutas)}</span>
                        </div>
                        <div className="flex justify-between items-center text-slate-400 text-xs italic">
                            <span>Impuesto (IVA 19%)</span>
                            <span>{formatCLP(totalIva)}</span>
                        </div>
                        <Separator className="dark:bg-slate-800" />
                        <div className="flex justify-between items-center font-semibold">
                            <span className="text-sm text-slate-900 dark:text-white underline decoration-slate-200 decoration-2 underline-offset-4">Venta Neta</span>
                            <span className="text-lg">{formatCLP(totalVentasNetas)}</span>
                        </div>
                        <div className="flex justify-between items-center text-slate-500 text-xs">
                            <span>Costo de Existencias</span>
                            <span>{formatCLP(totalCostos)}</span>
                        </div>
                    </div>
                </div>

                {/* Main Utility Box */}
                <Card className="bg-slate-50/50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 print:bg-transparent print:border-black shrink-0 shadow-sm print:shadow-none">
                    <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-2">
                        <div className="p-2 bg-emerald-500/10 rounded-full print:hidden">
                            <Wallet className="h-5 w-5 text-emerald-600" />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400 print:text-black">Utilidad (Después de impuestos)</span>
                        <div className="text-4xl font-black text-slate-900 dark:text-white print:text-black">
                            {formatCLP(totalUtilidadReal)}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium">
                            <Info className="h-3 w-3" />
                            <span>Calculado sobre Venta Neta - Costo</span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Compact Table */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold uppercase text-slate-400 tracking-widest print:text-black">Detalle por Artículo</h2>
                    <span className="text-[10px] font-mono text-slate-400 uppercase">{itemCount} Items</span>
                </div>
                <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden print:border-black">
                    <Table>
                        <TableHeader className="bg-slate-50/50 dark:bg-slate-900/50 print:bg-transparent">
                            <TableRow className="border-b-slate-100 dark:border-b-slate-800 print:border-black">
                                <TableHead className="text-[11px] font-bold text-slate-500 uppercase py-3 print:text-black">Descripción Producto</TableHead>
                                <TableHead className="text-right text-[11px] font-bold text-slate-500 uppercase print:text-black">Cant.</TableHead>
                                <TableHead className="text-right text-[11px] font-bold text-slate-500 uppercase print:text-black">Venta (Neta)</TableHead>
                                <TableHead className="text-right text-[11px] font-bold text-slate-500 uppercase print:text-black">Utilidad</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {/* Loading State for Table */}
                            {loading ? (
                                Array(3).fill(0).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-8 float-right" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-16 float-right" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-16 float-right" /></TableCell>
                                    </TableRow>
                                ))
                            ) : itemCount === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={4} className="h-24 text-center text-xs text-slate-400 italic">
                                        No se registran ventas para este periodo.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                report?.items.map((item) => (
                                    <TableRow key={item.product_id} className="border-b-slate-50 dark:border-b-slate-900 print:border-black">
                                        <TableCell className="py-3">
                                            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 print:text-black">{item.full_name}</div>
                                            <div className="text-[9px] font-mono text-slate-400 print:text-slate-500 italic">SKU: {item.product_id}</div>
                                        </TableCell>
                                        <TableCell className="text-right text-xs font-mono">{item.cantidad}</TableCell>
                                        <TableCell className="text-right text-xs">{formatCLP(item.monto_total)}</TableCell>
                                        <TableCell className="text-right text-xs font-bold text-emerald-600 dark:text-emerald-400 print:text-black">
                                            {formatCLP(item.utilidad)}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            {/* Disclaimer & Tech Info */}
            <div className="flex flex-col md:flex-row justify-between pt-8 items-end gap-4 text-[9px] text-slate-400 border-t border-slate-100 dark:border-slate-800 print:border-black print:text-black">
                <div className="max-w-xs italic text-left">
                    * La utilidad mostrada es un cálculo bruto basado en el costo unitario configurado al momento del reporte.
                </div>
                <div className="text-right space-y-1">
                    <p className="font-bold print:hidden">TORN — SISTEMA DE GESTIÓN POS</p>
                    <p className="font-mono">FOLIO: {report?.fecha ? new Date(report.fecha).getTime().toString().slice(-6) : '---'}</p>
                </div>
            </div>

            <style jsx global>{`
                @media print {
                    @page { margin: 1cm; size: portrait; }
                    body { background: white !important; color: black !important; -webkit-print-color-adjust: exact; }
                    .main-layout, .sidebar-container, nav, button, header, input, .select-trigger { display: none !important; }
                    * { border-color: black !important; color: black !important; background: transparent !important; box-shadow: none !important; }
                    .print-hidden { display: none !important; }
                }
            `}</style>
        </div>
    )
}
