'use client'

import { useEffect, useState } from 'react'
import { getSales, createReturn, getPaymentMethods, type SaleOut, type PaymentMethod } from '@/services/sales'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
    History,
    FileText,
    RotateCcw,
    ExternalLink,
    Loader2,
    Search,
} from 'lucide-react'

function formatCLP(value: string | number): string {
    return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        minimumFractionDigits: 0,
    }).format(typeof value === 'string' ? parseFloat(value) : value)
}

function formatDate(date: string): string {
    return new Date(date).toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function dteLabel(tipo: number): string {
    switch (tipo) {
        case 33: return 'Factura'
        case 34: return 'F. Exenta'
        case 39: return 'Boleta'
        case 61: return 'Nota Crédito'
        default: return `DTE ${tipo}`
    }
}

export default function HistorialPage() {
    const [sales, setSales] = useState<SaleOut[]>([])
    const [loading, setLoading] = useState(true)
    const [searchFolio, setSearchFolio] = useState('')

    // Return modal state
    const [returnSale, setReturnSale] = useState<SaleOut | null>(null)
    const [returnReason, setReturnReason] = useState('')
    const [returnMethodId, setReturnMethodId] = useState<number>(1)
    const [returning, setReturning] = useState(false)
    const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])

    useEffect(() => {
        loadSales()
        getPaymentMethods().then(setPaymentMethods).catch(console.error)
    }, [])

    const loadSales = () => {
        setLoading(true)
        getSales()
            .then(setSales)
            .catch(() => toast.error('Error cargando ventas'))
            .finally(() => setLoading(false))
    }

    const filtered = searchFolio.trim()
        ? sales.filter((s) => s.folio.toString().includes(searchFolio))
        : sales

    const handleReturn = async (sale: SaleOut) => {
        if (!returnReason.trim()) {
            toast.error('Debes ingresar un motivo')
            return
        }

        setReturning(true)
        try {
            await createReturn({
                original_sale_id: sale.id,
                items: sale.details.map((d) => ({
                    product_id: d.product_id,
                    cantidad: parseFloat(d.cantidad),
                })),
                reason: returnReason,
                return_method_id: returnMethodId,
            })

            toast.success(`Nota de Crédito emitida para Folio #${sale.folio}`)
            setReturnSale(null)
            setReturnReason('')
            loadSales()
        } catch (err: unknown) {
            const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
            toast.error(detail || 'Error al generar devolución')
        } finally {
            setReturning(false)
        }
    }

    const openPdf = (saleId: number) => {
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
        window.open(`${baseUrl}/sales/${saleId}/pdf`, '_blank')
    }

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900/30">
                    <History className="h-6 w-6 text-indigo-600" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Historial de Ventas</h1>
                    <p className="text-sm text-slate-500">Consulta, reimprime y devuelve</p>
                </div>
            </div>

            {/* Search */}
            <div className="relative max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                    placeholder="Buscar por folio..."
                    className="pl-10"
                    value={searchFolio}
                    onChange={(e) => setSearchFolio(e.target.value)}
                />
            </div>

            {/* Table */}
            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Folio</TableHead>
                                <TableHead>Tipo</TableHead>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Cliente</TableHead>
                                <TableHead className="text-right">Neto</TableHead>
                                <TableHead className="text-right">IVA</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                                <TableHead className="text-center">Acciones</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        {Array.from({ length: 8 }).map((_, j) => (
                                            <TableCell key={j}>
                                                <Skeleton className="h-4 w-full" />
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))
                            ) : filtered.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center py-8 text-slate-400">
                                        {searchFolio ? 'No se encontraron ventas con ese folio' : 'No hay ventas registradas'}
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filtered.map((sale) => {
                                    const isNC = sale.tipo_dte === 61
                                    return (
                                        <TableRow key={sale.id} className={isNC ? 'bg-amber-50/50 dark:bg-amber-950/10' : ''}>
                                            <TableCell className="font-mono font-bold">#{sale.folio}</TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant={isNC ? 'destructive' : 'outline'}
                                                    className="text-[10px]"
                                                >
                                                    {dteLabel(sale.tipo_dte)}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-sm text-slate-500">
                                                {formatDate(sale.created_at)}
                                            </TableCell>
                                            <TableCell>
                                                <div>
                                                    <p className="text-sm font-medium">{sale.user.razon_social}</p>
                                                    <p className="text-xs text-slate-400 font-mono">{sale.user.rut}</p>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right font-tabular">{formatCLP(sale.monto_neto)}</TableCell>
                                            <TableCell className="text-right font-tabular">{formatCLP(sale.iva)}</TableCell>
                                            <TableCell className="text-right font-tabular font-semibold">{formatCLP(sale.monto_total)}</TableCell>
                                            <TableCell>
                                                <div className="flex items-center justify-center gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 text-xs gap-1"
                                                        onClick={() => openPdf(sale.id)}
                                                    >
                                                        <FileText className="h-3.5 w-3.5" />
                                                        PDF
                                                    </Button>
                                                    {!isNC && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-8 text-xs gap-1 text-amber-600 hover:text-amber-700"
                                                            onClick={() => {
                                                                setReturnSale(sale)
                                                                setReturnReason('')
                                                            }}
                                                        >
                                                            <RotateCcw className="h-3.5 w-3.5" />
                                                            Devolver
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Return Dialog */}
            <Dialog open={!!returnSale} onOpenChange={() => setReturnSale(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <RotateCcw className="h-5 w-5 text-amber-600" />
                            Devolución — Folio #{returnSale?.folio}
                        </DialogTitle>
                        <DialogDescription>
                            Se emitirá una Nota de Crédito por todos los productos de esta venta.
                        </DialogDescription>
                    </DialogHeader>

                    {returnSale && (
                        <div className="space-y-4">
                            {/* Items Summary */}
                            <div className="rounded-lg bg-slate-50 p-3 space-y-1 dark:bg-slate-900">
                                {returnSale.details.map((d, i) => (
                                    <div key={i} className="flex justify-between text-sm">
                                        <span>
                                            {d.product.nombre} × {parseFloat(d.cantidad)}
                                        </span>
                                        <span className="font-tabular">{formatCLP(d.subtotal)}</span>
                                    </div>
                                ))}
                                <div className="flex justify-between font-semibold text-sm pt-1 border-t border-slate-200 dark:border-slate-700">
                                    <span>Total NC</span>
                                    <span>{formatCLP(returnSale.monto_total)}</span>
                                </div>
                            </div>

                            {/* Reason */}
                            <div className="space-y-2">
                                <Label>Motivo de Devolución</Label>
                                <Textarea
                                    placeholder="Ej: Producto defectuoso, error en talla..."
                                    value={returnReason}
                                    onChange={(e) => setReturnReason(e.target.value)}
                                    rows={2}
                                />
                            </div>

                            {/* Return Method */}
                            <div className="space-y-2">
                                <Label>Forma de Devolución</Label>
                                <select
                                    value={returnMethodId}
                                    onChange={(e) => setReturnMethodId(parseInt(e.target.value))}
                                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                >
                                    {paymentMethods.map((m) => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReturnSale(null)} disabled={returning}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={() => returnSale && handleReturn(returnSale)}
                            disabled={returning || !returnReason.trim()}
                            className="bg-amber-600 hover:bg-amber-700 gap-2"
                        >
                            {returning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                            Emitir Nota de Crédito
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
