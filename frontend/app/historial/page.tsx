'use client'

import { useEffect, useState, Fragment } from 'react'
import { getSales, getPaymentMethods, type SaleOut, type PaymentMethod } from '@/services/sales'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { createReturn } from '@/services/sales'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import {
    History,
    Search,
    FileText,
    RotateCcw,
    ExternalLink,
    Loader2,
    Receipt,
} from 'lucide-react'
import { formatCLP } from '@/lib/format'


function DteBadge({ tipo }: { tipo: number }) {
    const map: Record<number, { label: string; color: string }> = {
        33: { label: 'Factura', color: 'bg-blue-600' },
        39: { label: 'Boleta', color: 'bg-emerald-600' },
        61: { label: 'N. Crédito', color: 'bg-red-500' },
    }
    const info = map[tipo] || { label: `DTE ${tipo}`, color: 'bg-slate-500' }
    return <Badge className={`${info.color} text-[10px] px-1.5`}>{info.label}</Badge>
}

export default function HistorialPage() {
    const [sales, setSales] = useState<SaleOut[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [returnDialog, setReturnDialog] = useState<SaleOut | null>(null)
    const [returnReason, setReturnReason] = useState('')
    const [methods, setMethods] = useState<PaymentMethod[]>([])
    const [returnMethodId, setReturnMethodId] = useState<number>(0)
    const [submittingReturn, setSubmittingReturn] = useState(false)

    useEffect(() => {
        Promise.all([
            getSales(),
            getPaymentMethods(),
        ])
            .then(([s, m]) => {
                setSales(s)
                setMethods(m)
                if (m.length > 0) setReturnMethodId(m[0].id)
            })
            .catch(() => toast.error('Error cargando historial'))
            .finally(() => setLoading(false))
    }, [])

    const filtered = search.trim()
        ? sales.filter((s) =>
            s.folio.toString().includes(search) ||
            s.customer?.razon_social?.toLowerCase().includes(search.toLowerCase())
        )
        : sales

    // Sort and group by date
    const sorted = [...filtered].sort((a, b) => new Date(b.fecha_emision).getTime() - new Date(a.fecha_emision).getTime())

    const groupedSales: Record<string, SaleOut[]> = {}
    sorted.forEach((sale) => {
        const dateKey = new Date(sale.fecha_emision).toLocaleDateString('es-CL', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'America/Santiago'
        })
        if (!groupedSales[dateKey]) groupedSales[dateKey] = []
        groupedSales[dateKey].push(sale)
    })

    const handleReturn = async () => {
        if (!returnDialog || !returnReason.trim()) {
            toast.error('Ingresa un motivo')
            return
        }
        setSubmittingReturn(true)
        try {
            await createReturn({
                original_sale_id: returnDialog.id,
                items: returnDialog.details.map((d) => ({
                    product_id: d.product_id,
                    cantidad: Number(d.cantidad),
                })),
                reason: returnReason,
                return_method_id: returnMethodId,
            })
            toast.success('Nota de Crédito emitida')
            setReturnDialog(null)
            setReturnReason('')
            // Refresh sales
            const freshSales = await getSales()
            setSales(freshSales)
        } catch (err: unknown) {
            const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            toast.error(detail || 'Error al crear NC')
        } finally {
            setSubmittingReturn(false)
        }
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'

    return (
        <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-2">
                <History className="h-6 w-6 text-blue-600" />
                <div>
                    <h1 className="text-xl font-bold text-slate-900 dark:text-white">Historial de Ventas</h1>
                    <p className="text-xs text-slate-500">{sales.length} documentos</p>
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                    placeholder="Buscar por folio o RUT..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 h-10 text-sm"
                />
            </div>

            {/* Table */}
            <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
                                <th className="text-left text-[10px] uppercase tracking-wider text-slate-400 px-4 py-2.5 font-medium">Folio</th>
                                <th className="text-left text-[10px] uppercase tracking-wider text-slate-400 px-4 py-2.5 font-medium">Tipo</th>
                                <th className="text-left text-[10px] uppercase tracking-wider text-slate-400 px-4 py-2.5 font-medium hidden sm:table-cell text-center">Hora</th>
                                <th className="text-left text-[10px] uppercase tracking-wider text-slate-400 px-4 py-2.5 font-medium hidden lg:table-cell">Cliente</th>
                                <th className="text-right text-[10px] uppercase tracking-wider text-slate-400 px-4 py-2.5 font-medium">Total</th>
                                <th className="text-right text-[10px] uppercase tracking-wider text-slate-400 px-4 py-2.5 font-medium">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {loading ? (
                                <tr><td colSpan={6} className="text-center py-12 text-slate-400">Cargando...</td></tr>
                            ) : filtered.length === 0 ? (
                                <tr><td colSpan={6} className="text-center py-12 text-slate-400">Sin resultados</td></tr>
                            ) : (
                                Object.entries(groupedSales).map(([date, daySales]) => (
                                    <Fragment key={date}>
                                        <tr className="bg-slate-100/50 dark:bg-slate-900/50">
                                            <td colSpan={6} className="px-4 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/10 border-y border-slate-100 dark:border-slate-800">
                                                {date}
                                            </td>
                                        </tr>
                                        {daySales.map((sale) => (
                                            <tr key={sale.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors group">
                                                <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-900 dark:text-white">
                                                    #{sale.folio}
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <DteBadge tipo={sale.tipo_dte} />
                                                </td>
                                                <td className="px-4 py-2.5 text-xs text-slate-500 hidden sm:table-cell text-center font-tabular">
                                                    {new Date(sale.fecha_emision).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' })}
                                                </td>
                                                <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400 hidden lg:table-cell truncate max-w-[200px]">
                                                    {sale.customer?.razon_social || '—'}
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-tabular text-xs font-semibold text-slate-900 dark:text-white">
                                                    {formatCLP(parseFloat(String(sale.monto_total)))}
                                                </td>
                                                <td className="px-4 py-2.5">
                                                    <div className="flex justify-end gap-1">
                                                        <a
                                                            href={`${apiUrl}/sales/${sale.id}/pdf`}
                                                            target="_blank"
                                                            rel="noopener"
                                                            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800 transition"
                                                            title="Ver PDF"
                                                        >
                                                            <ExternalLink className="h-3.5 w-3.5" />
                                                        </a>
                                                        {sale.tipo_dte !== 61 && (
                                                            <button
                                                                onClick={() => setReturnDialog(sale)}
                                                                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 transition"
                                                                title="Nota de Crédito"
                                                            >
                                                                <RotateCcw className="h-3.5 w-3.5" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Return Dialog */}
            <Dialog open={!!returnDialog} onOpenChange={() => setReturnDialog(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <RotateCcw className="h-4 w-4 text-red-500" />
                            Nota de Crédito
                        </DialogTitle>
                        <DialogDescription>
                            Folio #{returnDialog?.folio} — {formatCLP(parseFloat(String(returnDialog?.monto_total || 0)))}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Motivo de la devolución *</Label>
                            <Input
                                placeholder="Ej: Producto defectuoso"
                                value={returnReason}
                                onChange={(e) => setReturnReason(e.target.value)}
                                className="h-9 text-sm"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs">Medio de devolución</Label>
                            <select
                                value={returnMethodId}
                                onChange={(e) => setReturnMethodId(parseInt(e.target.value))}
                                className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
                            >
                                {methods.map((m) => (
                                    <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                            </select>
                        </div>

                        {returnDialog && (
                            <>
                                <Separator />
                                <div className="space-y-1 text-xs">
                                    <p className="text-slate-400 font-medium">Ítems a devolver:</p>
                                    {returnDialog.details.map((d) => (
                                        <div key={d.product_id} className="flex justify-between">
                                            <span className="text-slate-600 dark:text-slate-400 truncate flex-1">{d.product?.nombre || `ID #${d.product_id}`}</span>
                                            <span className="font-tabular text-slate-500 ml-2">×{Number(d.cantidad)}</span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setReturnDialog(null)} className="text-xs">
                            Cancelar
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={handleReturn}
                            disabled={submittingReturn || !returnReason.trim()}
                            className="gap-1.5 text-xs"
                        >
                            {submittingReturn ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
                            Emitir NC
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
