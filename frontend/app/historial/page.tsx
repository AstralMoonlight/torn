'use client'

import { useEffect, useState, Fragment } from 'react'
import { getSales, getPaymentMethods, createReturn, getFoliosStatus, type SaleOut, type PaymentMethod, type FolioStockOut } from '@/services/sales'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { formatCLP } from '@/lib/format'


function DteBadge({ tipo }: { tipo: number }) {
    const map: Record<number, { label: string; color: string }> = {
        33: { label: 'Factura', color: 'bg-blue-600' },
        34: { label: 'Factura Exenta', color: 'bg-blue-500' },
        39: { label: 'Boleta', color: 'bg-emerald-600' },
        41: { label: 'Exenta', color: 'bg-emerald-500' },
        56: { label: 'N. Débito', color: 'bg-orange-500' },
        61: { label: 'N. Crédito', color: 'bg-red-500' },
        110: { label: 'Factura Export.', color: 'bg-indigo-600' },
        111: { label: 'ND Export.', color: 'bg-indigo-500' },
        112: { label: 'NC Export.', color: 'bg-pink-500' },
    }
    const info = map[tipo] || { label: `DTE ${tipo}`, color: 'bg-neutral-500' }
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
    const [availableAdjustments, setAvailableAdjustments] = useState<FolioStockOut[]>([])
    const [returnDteType, setReturnDteType] = useState<number>(61)
    const [siiReasonCode, setSiiReasonCode] = useState<number>(1)

    useEffect(() => {
        Promise.all([
            getSales(),
            getPaymentMethods(),
            getFoliosStatus(),
        ])
            .then(([s, m, f]) => {
                setSales(s)
                setMethods(m)
                if (m.length > 0) setReturnMethodId(m[0].id)

                const adjs = f.filter(d => [56, 61, 111, 112].includes(d.dte_type) && d.available > 0)
                setAvailableAdjustments(adjs)
                if (adjs.length > 0) {
                    const nc = adjs.find(a => a.dte_type === 61)
                    setReturnDteType(nc ? 61 : adjs[0].dte_type)
                }
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
                tipo_dte: returnDteType,
                sii_reason_code: siiReasonCode,
                items: returnDialog.details.map((d) => ({
                    product_id: d.product_id,
                    cantidad: Number(d.cantidad),
                })),
                reason: returnReason,
                return_method_id: returnMethodId,
            })
            toast.success('Documento de Ajuste emitido')
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
                    <h1 className="text-xl font-bold text-neutral-900 dark:text-white">Historial de Ventas</h1>
                    <p className="text-xs text-neutral-500">{sales.length} documentos</p>
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-400" />
                <Input
                    placeholder="Buscar por folio o RUT..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 h-10 text-sm"
                />
            </div>

            {/* Table */}
            <div className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 overflow-hidden">
                <Table>
                    <TableHeader className="bg-neutral-50 dark:bg-neutral-900">
                        <TableRow className="border-b border-neutral-200 dark:border-neutral-800">
                            <TableHead className="text-[10px] uppercase tracking-wider text-neutral-400 font-medium">Folio</TableHead>
                            <TableHead className="text-[10px] uppercase tracking-wider text-neutral-400 font-medium">Tipo</TableHead>
                            <TableHead className="text-[10px] uppercase tracking-wider text-neutral-400 font-medium hidden sm:table-cell text-center">Hora</TableHead>
                            <TableHead className="text-[10px] uppercase tracking-wider text-neutral-400 font-medium hidden lg:table-cell">Cliente</TableHead>
                            <TableHead className="text-right text-[10px] uppercase tracking-wider text-neutral-400 font-medium">Total</TableHead>
                            <TableHead className="text-right text-[10px] uppercase tracking-wider text-neutral-400 font-medium">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                        {loading ? (
                            <TableRow><TableCell colSpan={6} className="text-center py-12 text-neutral-400">Cargando...</TableCell></TableRow>
                        ) : filtered.length === 0 ? (
                            <TableRow><TableCell colSpan={6} className="text-center py-12 text-neutral-400">Sin resultados</TableCell></TableRow>
                        ) : (
                            Object.entries(groupedSales).map(([date, daySales]) => (
                                <Fragment key={date}>
                                    <TableRow className="bg-neutral-100/50 dark:bg-neutral-800/60 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/60">
                                        <TableCell colSpan={6} className="text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500 dark:text-neutral-400 border-y border-neutral-100 dark:border-neutral-800">
                                            {date}
                                        </TableCell>
                                    </TableRow>
                                    {daySales.map((sale) => (
                                        <TableRow key={sale.id} className="group">
                                            <TableCell className="font-mono text-xs font-semibold text-neutral-900 dark:text-white">
                                                #{sale.folio}
                                            </TableCell>
                                            <TableCell>
                                                <DteBadge tipo={sale.tipo_dte} />
                                            </TableCell>
                                            <TableCell className="text-xs text-neutral-500 hidden sm:table-cell text-center font-tabular">
                                                {new Date(sale.fecha_emision).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' })}
                                            </TableCell>
                                            <TableCell className="text-xs text-neutral-600 dark:text-neutral-400 hidden lg:table-cell truncate max-w-[200px]">
                                                {sale.customer?.razon_social || '—'}
                                            </TableCell>
                                            <TableCell className="text-right font-tabular text-xs font-semibold text-neutral-900 dark:text-white">
                                                {formatCLP(parseFloat(String(sale.monto_total)))}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-neutral-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                                                        title="Ver PDF"
                                                        asChild
                                                    >
                                                        <a
                                                            href={`${apiUrl}/sales/${sale.id}/pdf`}
                                                            target="_blank"
                                                            rel="noopener"
                                                        >
                                                            <ExternalLink className="h-4 w-4" />
                                                        </a>
                                                    </Button>
                                                    {![56, 61, 111, 112].includes(sale.tipo_dte) && availableAdjustments.length > 0 && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => setReturnDialog(sale)}
                                                            className="h-8 w-8 text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30"
                                                            title="Generar Nota (Ajuste)"
                                                        >
                                                            <RotateCcw className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </Fragment>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Return Dialog */}
            <Dialog open={!!returnDialog} onOpenChange={() => setReturnDialog(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <RotateCcw className="h-4 w-4 text-red-500" />
                            Generar Nota de Ajuste
                        </DialogTitle>
                        <DialogDescription>
                            Folio #{returnDialog?.folio} — {formatCLP(parseFloat(String(returnDialog?.monto_total || 0)))}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Tipo de Documento *</Label>
                                <select
                                    value={returnDteType}
                                    onChange={(e) => setReturnDteType(parseInt(e.target.value))}
                                    className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
                                >
                                    {availableAdjustments.map((a) => (
                                        <option key={a.dte_type} value={a.dte_type}>
                                            {a.dte_type === 61 ? 'N. Crédito (61)' : a.dte_type === 56 ? 'N. Débito (56)' : a.dte_type === 111 ? 'ND Export. (111)' : `DTE ${a.dte_type}`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Razón SII *</Label>
                                <select
                                    value={siiReasonCode}
                                    onChange={(e) => setSiiReasonCode(parseInt(e.target.value))}
                                    className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs truncate"
                                >
                                    <option value={1}>1 - Anula Documento</option>
                                    <option value={2}>2 - Corrige Texto</option>
                                    <option value={3}>3 - Corrige Monto</option>
                                </select>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label className="text-xs">Motivo descriptivo *</Label>
                            <Input
                                placeholder="Ej: Error en digitación"
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
                                    <p className="text-neutral-400 font-medium">Ítems a devolver:</p>
                                    {returnDialog.details.map((d) => (
                                        <div key={d.product_id} className="flex justify-between">
                                            <span className="text-neutral-600 dark:text-neutral-400 truncate flex-1">{d.product?.nombre || `ID #${d.product_id}`}</span>
                                            <span className="font-tabular text-neutral-500 ml-2">×{Number(d.cantidad)}</span>
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
                            Emitir Documento
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
