'use client'

import { getApiErrorDetail } from '@/services/api'
import { useEffect, useRef, useState, Fragment } from 'react'
import { getSales, actualizarEstadosDte, getPaymentMethods, getFoliosStatus, getFoliosPorAnular, imprimirVenta, type SaleOut, type PaymentMethod, type FolioStockOut, type FiltroVentas } from '@/services/sales'
import { Button } from '@/components/ui/button'
import { AccionFila } from '@/components/ui/accion-fila'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { avisar } from '@/lib/store/uiStore'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import ListToolbar from '@/components/layout/ListToolbar'
import {
    History,
    RotateCcw,
    ExternalLink,
    FileText,
    PencilLine,
    Mail,
    RefreshCw,
    FileWarning,
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
import { formatCLP, getTodayChile } from '@/lib/format'
import FacturarGuiasDialog from '@/components/pos/FacturarGuiasDialog'
import CorregirTextoDialog from '@/components/pos/CorregirTextoDialog'
import DevolucionDialog from '@/components/pos/DevolucionDialog'
import ReenviarXmlDialog, { ESTADOS_XML } from '@/components/pos/ReenviarXmlDialog'
import ReemitirDialog from '@/components/pos/ReemitirDialog'
import { DteBadge } from '@/components/pos/DteBadge'
import Link from 'next/link'


const POR_PAGINA = 50

// Los que el SII no reconoce: se vuelven a emitir, no se devuelven ni se corrigen.
const RECHAZADOS = ['RECHAZADO', 'ERROR_VALIDACION']

const ESTADOS_SII: Record<string, { label: string; color: string }> = {
    ACEPTADO: { label: 'Aceptado', color: 'bg-emerald-600' },
    REPAROS: { label: 'Con reparos', color: 'bg-amber-500' },
    RECHAZADO: { label: 'Rechazado', color: 'bg-destructive' },
    ERROR_VALIDACION: { label: 'Error', color: 'bg-destructive' },
    ANULADO: { label: 'Anulado', color: 'bg-muted-foreground' },
    SIMULADO: { label: 'Prueba', color: 'bg-amber-600' },
}

function SiiBadge({ estado, glosa }: { estado: string | null; glosa: string | null }) {
    if (!estado) return <span className="text-xs text-muted-foreground">-</span>
    const info = ESTADOS_SII[estado] || { label: 'En proceso', color: 'bg-sky-600' }
    return <Badge title={glosa || estado} className={`${info.color} text-xs px-1.5`}>{info.label}</Badge>
}

export default function HistorialPage() {
    const [sales, setSales] = useState<SaleOut[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [returnDialog, setReturnDialog] = useState<SaleOut | null>(null)
    const [methods, setMethods] = useState<PaymentMethod[]>([])
    // Sin números de nota de crédito no se ofrece devolver ni corregir.
    const [hayNotasCredito, setHayNotasCredito] = useState(false)
    const [corregirDialog, setCorregirDialog] = useState<SaleOut | null>(null)
    const [facturarOpen, setFacturarOpen] = useState(false)
    const [xmlDialog, setXmlDialog] = useState<SaleOut | null>(null)
    const [reemitirDialog, setReemitirDialog] = useState<SaleOut | null>(null)
    const [desde, setDesde] = useState(getTodayChile)
    const [hasta, setHasta] = useState(getTodayChile)
    const [hayMas, setHayMas] = useState(false)
    // Rechazados por emitir de nuevo más números por anular en el SII, en todas las fechas.
    const [pendientesSii, setPendientesSii] = useState(0)

    // La búsqueda recorre todas las ventas en el servidor, sin importar las fechas.
    const filtro = (): FiltroVentas => search.trim() ? { q: search.trim() } : { desde, hasta }

    const traerVentas = async (skip = 0) => {
        const pagina = await getSales({ ...filtro(), skip, limit: POR_PAGINA })
        setHayMas(pagina.length === POR_PAGINA)
        setSales(prev => skip === 0 ? pagina : [...prev, ...pagina])
        return pagina
    }

    const contarPendientesSii = () => Promise.all([
        getSales({ rechazados: true, limit: 200 }),
        // Sin dte-torn no hay lista de folios: el historial se muestra igual.
        getFoliosPorAnular().catch(() => []),
    ]).then(([r, f]) => setPendientesSii(r.length + f.length)).catch(() => null)

    const recargarVentas = () => {
        contarPendientesSii()
        return traerVentas().catch(() => avisar('No se pudo cargar el historial.'))
    }

    const cargar = () => {
        setLoading(true)
        Promise.all([
            // Si dte-torn no responde, el historial se muestra igual con el último estado conocido.
            actualizarEstadosDte().catch(() => null).then(() => { contarPendientesSii(); return traerVentas() }),
            getPaymentMethods(),
            getFoliosStatus(),
        ])
            .then(([s, m, f]) => {
                const rechazadas = s.filter(v => RECHAZADOS.includes(v.dte_estado ?? ''))
                if (rechazadas.length > 0) {
                    avisar(`El SII rechazó ${rechazadas.length} documento(s): N° ${rechazadas.map(v => v.folio).join(', ')}. Véalos en "Rechazados", arriba a la derecha.`)
                }
                setMethods(m)
                setHayNotasCredito(f.some((d: FolioStockOut) => d.dte_type === 61 && d.available > 0))
            })
            .catch(() => avisar('No se pudo cargar el historial.', { reintentar: cargar }))
            .finally(() => setLoading(false))
    }

    const primeraCarga = useRef(true)
    useEffect(() => {
        if (primeraCarga.current) {
            primeraCarga.current = false
            cargar()
            return
        }
        // Espera a que se deje de escribir antes de ir al servidor.
        const t = setTimeout(() => {
            setLoading(true)
            recargarVentas().finally(() => setLoading(false))
        }, 300)
        return () => clearTimeout(t)
    }, [search, desde, hasta]) // eslint-disable-line react-hooks/exhaustive-deps

    // El servidor ya las devuelve de la más nueva a la más antigua.
    const groupedSales: Record<string, SaleOut[]> = {}
    sales.forEach((sale) => {
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

    const verPdf = async (saleId: number) => {
        try {
            await imprimirVenta(saleId)
        } catch (err) {
            avisar(getApiErrorDetail(err, 'No se pudo cargar el documento.'))
        }
    }

    return (
        <PageContainer>
            <PageHeader
                icon={History}
                title="Historial de ventas"
                description="Revisa, reimprime y anula los documentos emitidos."
            />

            <ListToolbar
                busqueda={search}
                onBusqueda={setSearch}
                placeholder="Buscar por número, cliente o RUT..."
                visibles={sales.length}
                total={sales.length}
                unidad="documentos"
                filtros={search.trim() ? (
                    <span className="text-sm text-muted-foreground">Buscando en todas las fechas</span>
                ) : (
                    <>
                        <Label className="flex items-center gap-2 text-sm font-normal">
                            Desde
                            <Input type="date" value={desde} max={hasta}
                                onChange={(e) => e.target.value && setDesde(e.target.value)} className="h-9 w-auto" />
                        </Label>
                        <Label className="flex items-center gap-2 text-sm font-normal">
                            Hasta
                            <Input type="date" value={hasta} min={desde}
                                onChange={(e) => e.target.value && setHasta(e.target.value)} className="h-9 w-auto" />
                        </Label>
                        {(desde !== getTodayChile() || hasta !== getTodayChile()) && (
                            <Button variant="outline" size="sm" onClick={() => { setDesde(getTodayChile()); setHasta(getTodayChile()) }}>
                                Hoy
                            </Button>
                        )}
                    </>
                )}
                acciones={
                    <>
                        <Button asChild variant="outline" size="sm" className="gap-1.5">
                            <Link href="/historial/rechazados">
                                <FileWarning className="h-4 w-4" /> Rechazados
                                {pendientesSii > 0 && (
                                    <Badge className="bg-destructive text-xs px-1.5">{pendientesSii}</Badge>
                                )}
                            </Link>
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setFacturarOpen(true)}>
                            <FileText className="h-4 w-4" /> Facturar guías
                        </Button>
                    </>
                }
            />

            {/* Table */}
            <div data-section="historial.tabla" className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="border-b border-border">
                            <TableHead>N°</TableHead>
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
                        ) : sales.length === 0 ? (
                            <TableEmpty colSpan={7}>
                                {search.trim() ? 'Ninguna venta coincide con la búsqueda' : 'Sin ventas en estas fechas'}
                            </TableEmpty>
                        ) : (
                            Object.entries(groupedSales).map(([date, daySales]) => (
                                <Fragment key={date}>
                                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                                        <TableCell colSpan={7} className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground border-y border-border">
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
                                                    <span className={`ml-1 text-xs ${sale.facturada_por_id ? 'text-muted-foreground' : 'text-amber-600'}`}>
                                                        {sale.facturada_por_id ? 'facturada' : 'por facturar'}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                <SiiBadge estado={sale.dte_estado} glosa={sale.dte_glosa} />
                                                {sale.intercambio_estado && ESTADOS_XML[sale.intercambio_estado] && (
                                                    <Badge className={`${ESTADOS_XML[sale.intercambio_estado].color} ml-1 text-xs px-1.5`}>
                                                        {ESTADOS_XML[sale.intercambio_estado].label}
                                                    </Badge>
                                                )}
                                                {sale.estado_receptor === 'RECLAMADO' && (
                                                    <Badge variant="destructive" className="ml-1 text-xs px-1.5"
                                                        title="El cliente la reclamó en el SII: corresponde emitir una nota de crédito">
                                                        Reclamada por el cliente
                                                    </Badge>
                                                )}
                                                {sale.estado_receptor === 'ACEPTADO' && (
                                                    <Badge className="bg-emerald-600 ml-1 text-xs px-1.5">Aceptada por el cliente</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground hidden sm:table-cell text-center font-tabular">
                                                {new Date(sale.fecha_emision).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Santiago' })}
                                            </TableCell>
                                            <TableCell className="text-xs text-muted-foreground dark:text-muted-foreground hidden lg:table-cell truncate max-w-[200px]">
                                                {sale.customer?.razon_social || '-'}
                                            </TableCell>
                                            <TableCell className="text-right font-tabular text-xs font-semibold text-foreground">
                                                {formatCLP(parseFloat(String(sale.monto_total)))}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <AccionFila icon={ExternalLink} label="Ver PDF" onClick={() => verPdf(sale.id)} />
                                                    {[33, 34, 52, 56, 61].includes(sale.tipo_dte) && ['ACEPTADO', 'REPAROS'].includes(sale.dte_estado ?? '') && (
                                                        <AccionFila icon={Mail} label="Mandar el XML al cliente" onClick={() => setXmlDialog(sale)} />
                                                    )}
                                                    {RECHAZADOS.includes(sale.dte_estado ?? '') && (
                                                        <AccionFila icon={RefreshCw} label="Emitir de nuevo" onClick={() => setReemitirDialog(sale)} />
                                                    )}
                                                    {[33, 34, 39, 41].includes(sale.tipo_dte) && hayNotasCredito && !RECHAZADOS.includes(sale.dte_estado ?? '') && (
                                                        <AccionFila icon={RotateCcw} label="Devolver productos" onClick={() => setReturnDialog(sale)} peligro />
                                                    )}
                                                    {[33, 34].includes(sale.tipo_dte) && hayNotasCredito && !RECHAZADOS.includes(sale.dte_estado ?? '') && (
                                                        <AccionFila icon={PencilLine} label="Corregir un dato (giro, dirección...)" onClick={() => setCorregirDialog(sale)} />
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
            {hayMas && !loading && (
                <div className="flex justify-center">
                    <Button variant="outline" onClick={() => traerVentas(sales.length).catch(() => avisar('No se pudo cargar el historial.'))}>
                        Ver más
                    </Button>
                </div>
            )}

            <DevolucionDialog
                venta={returnDialog}
                methods={methods}
                onClose={() => setReturnDialog(null)}
                onDevuelta={recargarVentas}
            />
            <CorregirTextoDialog
                venta={corregirDialog}
                onClose={() => setCorregirDialog(null)}
                onEmitida={recargarVentas}
            />
            <ReenviarXmlDialog venta={xmlDialog} onClose={() => setXmlDialog(null)} onEnviado={recargarVentas} />
            <ReemitirDialog venta={reemitirDialog} onClose={() => setReemitirDialog(null)} onEmitida={recargarVentas} />
            <FacturarGuiasDialog
                open={facturarOpen}
                methods={methods}
                onClose={() => setFacturarOpen(false)}
                onFacturada={recargarVentas}
            />
        </PageContainer>
    )
}
