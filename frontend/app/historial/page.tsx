'use client'

import { getApiErrorDetail, fetchBlob, printPdf } from '@/services/api'
import { useEffect, useState, Fragment } from 'react'
import { getSales, actualizarEstadosDte, getPaymentMethods, createReturn, getFoliosStatus, getSalePdfPath, type SaleOut, type PaymentMethod, type FolioStockOut } from '@/services/sales'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SearchInput } from '@/components/ui/search-input'
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
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import {
    History,
    RotateCcw,
    ExternalLink,
    Loader2,
    Receipt,
    FileText,
} from 'lucide-react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableEmpty,
} from '@/components/ui/table'
import { formatCLP } from '@/lib/format'
import { SelectOpciones } from '@/components/ui/select-opciones'
import FacturarGuiasDialog from '@/components/pos/FacturarGuiasDialog'


function DteBadge({ tipo }: { tipo: number }) {
    const map: Record<number, { label: string; color: string }> = {
        33: { label: 'Factura', color: 'bg-primary' },
        34: { label: 'Factura Exenta', color: 'bg-muted-foreground' },
        39: { label: 'Boleta', color: 'bg-primary' },
        41: { label: 'Boleta Exenta', color: 'bg-muted-foreground' },
        52: { label: 'Guía', color: 'bg-amber-600' },
        56: { label: 'N. Débito', color: 'bg-muted-foreground' },
        61: { label: 'N. Crédito', color: 'bg-destructive' },
        110: { label: 'Factura Export.', color: 'bg-indigo-600' },
        111: { label: 'ND Export.', color: 'bg-indigo-500' },
        112: { label: 'NC Export.', color: 'bg-pink-500' },
    }
    const info = map[tipo] || { label: `DTE ${tipo}`, color: 'bg-muted-foreground' }
    return <Badge className={`${info.color} text-[10px] px-1.5`}>{info.label}</Badge>
}

const ESTADOS_SII: Record<string, { label: string; color: string }> = {
    ACEPTADO: { label: 'Aceptado', color: 'bg-emerald-600' },
    REPAROS: { label: 'Con reparos', color: 'bg-amber-500' },
    RECHAZADO: { label: 'Rechazado', color: 'bg-destructive' },
    ERROR_VALIDACION: { label: 'Error', color: 'bg-destructive' },
    ANULADO: { label: 'Anulado', color: 'bg-muted-foreground' },
}

function SiiBadge({ estado, glosa }: { estado: string | null; glosa: string | null }) {
    if (!estado) return <span className="text-xs text-muted-foreground">—</span>
    const info = ESTADOS_SII[estado] || { label: 'En proceso', color: 'bg-sky-600' }
    return <Badge title={glosa || estado} className={`${info.color} text-[10px] px-1.5`}>{info.label}</Badge>
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
    const [facturarOpen, setFacturarOpen] = useState(false)

    useEffect(() => {
        Promise.all([
            // Si dte-torn no responde, el historial se muestra igual con el último estado conocido.
            actualizarEstadosDte().catch(() => null).then(() => getSales()),
            getPaymentMethods(),
            getFoliosStatus(),
        ])
            .then(([s, m, f]) => {
                setSales(s)
                const rechazadas = s.filter(v => v.dte_estado === 'RECHAZADO' || v.dte_estado === 'ERROR_VALIDACION')
                if (rechazadas.length > 0) {
                    toast.error(`El SII rechazó ${rechazadas.length} documento(s): folio ${rechazadas.map(v => v.folio).join(', ')}`)
                }
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
            const detail = getApiErrorDetail(err, '')
            toast.error(detail || 'Error al crear NC')
        } finally {
            setSubmittingReturn(false)
        }
    }

    const verPdf = async (saleId: number) => {
        try {
            // PDF (carta, de dte-torn): diálogo de impresión con vista previa.
            // HTML (tickets): se abre en una pestaña y se imprime solo al cargar.
            const { url: blobUrl, isPdf } = await fetchBlob(getSalePdfPath(saleId))
            if (isPdf) {
                printPdf(blobUrl)
                return
            }
            window.open(blobUrl, '_blank')
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
        } catch (err) {
            toast.error(getApiErrorDetail(err, 'No se pudo cargar el documento.'))
        }
    }

    return (
        <PageContainer>
            <PageHeader
                icon={History}
                title="Historial de Ventas"
                description={`${sales.length} documentos`}
                actions={
                    <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setFacturarOpen(true)}>
                        <FileText className="h-4 w-4" /> Facturar guías
                    </Button>
                }
            />

            {/* Search */}
            <SearchInput data-section="historial.buscador" placeholder="Buscar por folio o RUT..." value={search} onChange={(e) => setSearch(e.target.value)} />

            {/* Table */}
            <div data-section="historial.tabla" className="rounded-xl border border-border bg-card overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="border-b border-border">
                            <TableHead>Folio</TableHead>
                            <TableHead>Tipo</TableHead>
                            <TableHead>SII</TableHead>
                            <TableHead className="hidden sm:table-cell text-center">Hora</TableHead>
                            <TableHead className="hidden lg:table-cell">Cliente</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-border">
                        {loading ? (
                            <TableEmpty colSpan={7} loading />
                        ) : filtered.length === 0 ? (
                            <TableEmpty colSpan={7}>Sin resultados</TableEmpty>
                        ) : (
                            Object.entries(groupedSales).map(([date, daySales]) => (
                                <Fragment key={date}>
                                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                                        <TableCell colSpan={7} className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground border-y border-border">
                                            {date}
                                        </TableCell>
                                    </TableRow>
                                    {daySales.map((sale) => (
                                        <TableRow key={sale.id} className="group">
                                            <TableCell className="font-mono text-xs font-semibold text-foreground">
                                                #{sale.folio}
                                            </TableCell>
                                            <TableCell>
                                                <DteBadge tipo={sale.tipo_dte} />
                                                {sale.tipo_dte === 52 && [1, 2, 3].includes(sale.ind_traslado ?? 0) && (
                                                    <span className={`ml-1 text-[10px] ${sale.facturada_por_id ? 'text-muted-foreground' : 'text-amber-600'}`}>
                                                        {sale.facturada_por_id ? 'facturada' : 'por facturar'}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <SiiBadge estado={sale.dte_estado} glosa={sale.dte_glosa} />
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground hidden sm:table-cell text-center font-tabular">
                                                {new Date(sale.fecha_emision).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' })}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground dark:text-muted-foreground hidden lg:table-cell truncate max-w-[200px]">
                                                {sale.customer?.razon_social || '—'}
                                            </TableCell>
                                            <TableCell className="text-right font-tabular text-xs font-semibold text-foreground">
                                                {formatCLP(parseFloat(String(sale.monto_total)))}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10"
                                                        title="Ver PDF"
                                                        onClick={() => verPdf(sale.id)}
                                                    >
                                                        <ExternalLink className="h-4 w-4" />
                                                    </Button>
                                                    {![52, 56, 61, 111, 112].includes(sale.tipo_dte) && availableAdjustments.length > 0 && (
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => setReturnDialog(sale)}
                                                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
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
                <DialogContent data-section="historial.nota-ajuste" className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base">
                            <RotateCcw className="h-4 w-4 text-destructive" />
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
                                <SelectOpciones className="h-9 text-xs" value={returnDteType}
                                    onChange={(v) => setReturnDteType(Number(v))}
                                    opciones={availableAdjustments.map((a) => ({
                                        value: a.dte_type,
                                        label: a.dte_type === 61 ? 'N. Crédito (61)' : a.dte_type === 56 ? 'N. Débito (56)' : a.dte_type === 111 ? 'ND Export. (111)' : `DTE ${a.dte_type}`,
                                    }))} />
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Razón SII *</Label>
                                <SelectOpciones className="h-9 text-xs" value={siiReasonCode}
                                    onChange={(v) => setSiiReasonCode(Number(v))}
                                    opciones={[
                                        { value: 1, label: '1 - Anula Documento' },
                                        { value: 2, label: '2 - Corrige Texto' },
                                        { value: 3, label: '3 - Corrige Monto' },
                                    ]} />
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
                            <SelectOpciones className="h-9 text-xs" value={returnMethodId}
                                onChange={(v) => setReturnMethodId(Number(v))}
                                opciones={methods.map((m) => ({ value: m.id, label: m.name }))} />
                        </div>

                        {returnDialog && (
                            <>
                                <Separator />
                                <div className="space-y-1 text-xs">
                                    <p className="text-muted-foreground font-medium">Ítems a devolver:</p>
                                    {returnDialog.details.map((d) => (
                                        <div key={d.product_id} className="flex justify-between">
                                            <span className="text-muted-foreground dark:text-muted-foreground truncate flex-1">{d.product?.nombre || `ID #${d.product_id}`}</span>
                                            <span className="font-tabular text-muted-foreground ml-2">×{Number(d.cantidad)}</span>
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
            <FacturarGuiasDialog
                open={facturarOpen}
                methods={methods}
                onClose={() => setFacturarOpen(false)}
                onFacturada={() => getSales().then(setSales)}
            />
        </PageContainer>
    )
}
