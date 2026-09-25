'use client'

import { useEffect, useState } from 'react'
import { getReport, ReportOut } from '@/services/stats'
import { formatCLP, formatDate, getTodayChile } from '@/lib/format'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableEmpty } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Printer, Info, Wallet, BarChart2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'

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
        if (period === 'day') return `Cierre diario - ${formatDate(report.fecha)}`
        if (period === 'week') return `Reporte semanal`
        if (period === 'month') return `Reporte mensual - ${d.toLocaleString('es-CL', { month: 'long', year: 'numeric', timeZone: 'America/Santiago' }).toUpperCase()}`
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
    // Neto e IVA vienen calculados del backend a partir de lo registrado en
    // cada venta. Dividir el bruto por 1.19 daba cifras falsas con documentos
    // exentos o productos con otra tasa.
    const totalIva = Number(report?.total_iva || 0)
    const totalVentasNetas = Number(report?.total_neto || 0)
    const totalUtilidadReal = Number(report?.total_utilidad || 0)
    const totalCostos = totalVentasNetas - totalUtilidadReal
    const itemCount = report?.items.length || 0

    return (
        <PageContainer className="max-w-4xl space-y-8 animate-in fade-in duration-500">
            {/* Control Bar (Hidden on Print) */}
            <div data-section="reporte-diario.controles" className="print:hidden border-b pb-6 border-border">
                <PageHeader
                    icon={BarChart2}
                    title="Reportes"
                    description="Histórico de ventas"
                    actions={
                        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
                            {/* Period Selector */}
                            <Select value={period} onValueChange={setPeriod}>
                                <SelectTrigger className="w-full sm:w-[140px] border-border">
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
                                    className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 uppercase"
                                />
                            </div>

                            <Button variant="outline" onClick={handlePrint} className="w-full sm:w-auto gap-2 border-border hover:bg-accent">
                                <Printer className="h-4 w-4" />
                                Imprimir
                            </Button>
                        </div>
                    }
                />
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
            <div data-section="reporte-diario.resumen" className="grid grid-cols-1 md:grid-cols-2 gap-8 py-2">
                {/* Financial Summary */}
                <div className="space-y-6">
                    <h2 className="text-sm font-bold uppercase text-muted-foreground tracking-widest print:text-black">Resumen financiero</h2>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center group">
                            <span className="text-sm text-muted-foreground dark:text-muted-foreground">Total ingresos (bruto)</span>
                            <span className="font-mono font-medium">{formatCLP(totalVentasBrutas)}</span>
                        </div>
                        <div className="flex justify-between items-center text-muted-foreground text-xs italic">
                            <span>Impuesto (IVA 19%)</span>
                            <span>{formatCLP(totalIva)}</span>
                        </div>
                        <Separator />
                        <div className="flex justify-between items-center font-semibold">
                            <span className="text-sm text-foreground underline decoration-border decoration-2 underline-offset-4">Venta neta</span>
                            <span className="text-lg">{formatCLP(totalVentasNetas)}</span>
                        </div>
                        <div className="flex justify-between items-center text-muted-foreground text-xs">
                            <span>Costo de existencias</span>
                            <span>{formatCLP(totalCostos)}</span>
                        </div>
                    </div>
                </div>

                {/* Main Utility Box */}
                <Card className="bg-muted/50 border-border print:bg-transparent print:border-black shrink-0 shadow-sm print:shadow-none">
                    <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-2">
                        <div className="p-2 bg-primary/10 rounded-full print:hidden">
                            <Wallet className="h-5 w-5 text-primary" />
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary print:text-black">Utilidad (después de impuestos)</span>
                        <div className="text-4xl font-black text-foreground print:text-black">
                            {formatCLP(totalUtilidadReal)}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-medium">
                            <Info className="h-3 w-3" />
                            <span>Calculado sobre venta neta - costo</span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Compact Table */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold uppercase text-muted-foreground tracking-widest print:text-black">Detalle por artículo</h2>
                    <span className="text-[10px] font-mono text-muted-foreground uppercase">{itemCount} Items</span>
                </div>
                <div data-section="reporte-diario.tabla" className="border border-border rounded-lg overflow-hidden print:border-black">
                    <Table>
                        <TableHeader className="print:bg-transparent">
                            <TableRow className="border-b-border print:border-black">
                                <TableHead className="py-3 print:text-black">Descripción del producto</TableHead>
                                <TableHead className="text-right print:text-black">Cant.</TableHead>
                                <TableHead className="text-right print:text-black">Venta (neta)</TableHead>
                                <TableHead className="text-right print:text-black">Utilidad</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {/* Loading State for Table */}
                            {loading ? (
                                <TableEmpty colSpan={4} loading />
                            ) : itemCount === 0 ? (
                                <TableEmpty colSpan={4}>No se registran ventas para este periodo.</TableEmpty>
                            ) : (
                                report?.items.map((item) => (
                                    <TableRow key={item.product_id} className="border-b-border print:border-black">
                                        <TableCell className="py-3">
                                            <div className="text-xs font-semibold text-foreground print:text-black">{item.full_name}</div>
                                            <div className="text-[9px] font-mono text-muted-foreground print:text-muted-foreground italic">SKU: {item.product_id}</div>
                                        </TableCell>
                                        <TableCell className="text-right text-xs font-mono">{item.cantidad}</TableCell>
                                        <TableCell className="text-right text-xs">{formatCLP(item.monto_total)}</TableCell>
                                        <TableCell className="text-right text-xs font-bold text-primary print:text-black">
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
            <div className="flex flex-col md:flex-row justify-between pt-8 items-end gap-4 text-[9px] text-muted-foreground border-t border-border print:border-black print:text-black">
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
        </PageContainer>
    )
}
