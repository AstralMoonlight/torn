'use client'

import { getApiErrorDetail } from '@/services/api'
import { useEffect, useRef, useState, Fragment } from 'react'
import { getSales, actualizarEstadosDte, getPaymentMethods, getFoliosStatus, getFoliosPorAnular, imprimirVenta, type SaleOut, type PaymentMethod, type FolioStockOut, type FiltroVentas } from '@/services/sales'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { avisar } from '@/lib/store/uiStore'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import ListToolbar from '@/components/layout/ListToolbar'
import {
    FileText,
    RefreshCw,
    FileWarning,
    MoreVertical,
    Printer,
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
import { formatCLP, getTodayChile, hora } from '@/lib/format'
import FiltrosRapidos from '@/components/layout/FiltrosRapidos'
import Estado, { type TonoEstado } from '@/components/layout/Estado'
import FacturarGuiasDialog from '@/components/pos/FacturarGuiasDialog'
import CorregirTextoDialog from '@/components/pos/CorregirTextoDialog'
import DevolucionDialog from '@/components/pos/DevolucionDialog'
import ReenviarXmlDialog, { ESTADOS_XML } from '@/components/pos/ReenviarXmlDialog'
import ReemitirDialog from '@/components/pos/ReemitirDialog'
import Link from 'next/link'


const POR_PAGINA = 50

// Los que el SII no reconoce: se vuelven a emitir, no se devuelven ni se corrigen.
const RECHAZADOS = ['RECHAZADO', 'ERROR_VALIDACION']

const ESTADOS_SII: Record<string, { label: string; tono: TonoEstado }> = {
    ACEPTADO: { label: 'Aceptado', tono: 'bien' },
    REPAROS: { label: 'Con reparos', tono: 'alerta' },
    RECHAZADO: { label: 'Rechazado', tono: 'mal' },
    ERROR_VALIDACION: { label: 'Con error', tono: 'mal' },
    ANULADO: { label: 'Anulado', tono: 'neutro' },
    SIMULADO: { label: 'De prueba', tono: 'alerta' },
}

function SiiEstado({ estado, glosa }: { estado: string | null; glosa: string | null }) {
    if (!estado) return <span className="text-sm text-muted-foreground">Sin datos</span>
    const info = ESTADOS_SII[estado] || { label: 'En revisión', tono: 'neutro' as const }
    return <span title={glosa || undefined}><Estado tono={info.tono}>{info.label}</Estado></span>
}

const NOMBRE_DTE: Record<number, string> = {
    33: 'Factura', 34: 'Factura exenta', 39: 'Boleta', 41: 'Boleta exenta',
    52: 'Guía de despacho', 56: 'Nota de débito', 61: 'Nota de crédito',
}

/** Resta días a una fecha aaaa-mm-dd sin pasar por la zona horaria. */
function restarDias(fecha: string, dias: number): string {
    const [y, m, d] = fecha.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d - dias)).toISOString().slice(0, 10)
}

type Periodo = 'hoy' | 'ayer' | 'semana' | 'fechas'

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
    const [periodo, setPeriodo] = useState<Periodo>('hoy')
    const elegirPeriodo = (p: Periodo) => {
        setPeriodo(p)
        const hoy = getTodayChile()
        if (p === 'hoy') { setDesde(hoy); setHasta(hoy) }
        if (p === 'ayer') { setDesde(restarDias(hoy, 1)); setHasta(restarDias(hoy, 1)) }
        if (p === 'semana') { setDesde(restarDias(hoy, 6)); setHasta(hoy) }
    }
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

    /** Lo vendido en la lista, con las notas de crédito restando. */
    const totalNeto = (ventas: SaleOut[]) =>
        ventas.reduce((t, v) => t + (v.tipo_dte === 61 ? -1 : v.tipo_dte === 52 ? 0 : 1) * Number(v.monto_total), 0)

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
                title="Historial de ventas"
                description="Todos los documentos que emitiste. Desde aquí los reimprimes, devuelves o reenvías al correo del cliente."
                actions={
                    <Button variant="outline" className="h-11" onClick={() => setFacturarOpen(true)}>
                        <FileText className="h-4 w-4" /> Facturar guías
                    </Button>
                }
            />

            <ListToolbar
                busqueda={search}
                onBusqueda={setSearch}
                placeholder="Folio, cliente o RUT (busca en todas las fechas)"
                visibles={sales.length}
                total={sales.length}
                unidad="documentos"
                filtros={search.trim() ? (
                    <span className="text-sm text-muted-foreground">Buscando en todas las fechas</span>
                ) : (
                    <>
                        <FiltrosRapidos
                            etiqueta="Período"
                            valor={periodo}
                            onChange={elegirPeriodo}
                            opciones={[
                                { valor: 'hoy', etiqueta: 'Hoy' },
                                { valor: 'ayer', etiqueta: 'Ayer' },
                                { valor: 'semana', etiqueta: 'Últimos 7 días' },
                                { valor: 'fechas', etiqueta: 'Elegir fechas' },
                            ]}
                        />
                        {periodo === 'fechas' && (
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
                            </>
                        )}
                    </>
                )}
                acciones={
                    <Button asChild variant="outline" size="sm"
                        className={pendientesSii > 0 ? 'border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive' : undefined}>
                        <Link href="/historial/rechazados">
                            <FileWarning className="h-4 w-4" /> Rechazados por el SII
                            {pendientesSii > 0 && <span className="font-semibold font-tabular">{pendientesSii}</span>}
                        </Link>
                    </Button>
                }
            />

            {!loading && !search.trim() && sales.length > 0 && !hayMas && (
                <p className="text-[15px] text-foreground">
                    {periodo === 'hoy' ? 'Hoy emitiste' : periodo === 'ayer' ? 'Ayer emitiste' : 'Emitiste'}{' '}
                    <strong>{sales.length} {sales.length === 1 ? 'documento' : 'documentos'}</strong> por{' '}
                    <strong className="font-tabular">{formatCLP(totalNeto(sales))}</strong>
                    {sales.some((v) => v.tipo_dte === 61) && ', ya descontadas las devoluciones'}.
                </p>
            )}

            {/* Table */}
            <div data-section="historial.tabla" className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-16">Hora</TableHead>
                            <TableHead>Documento</TableHead>
                            <TableHead className="hidden lg:table-cell">Cliente</TableHead>
                            <TableHead>SII</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead><span className="sr-only">Acciones</span></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableEmpty colSpan={6} loading />
                        ) : sales.length === 0 ? (
                            <TableEmpty colSpan={6}>
                                {search.trim() ? 'Ningún documento coincide con la búsqueda.' : 'No hay ventas en estas fechas.'}
                            </TableEmpty>
                        ) : (
                            Object.entries(groupedSales).map(([date, daySales]) => (
                                <Fragment key={date}>
                                    {Object.keys(groupedSales).length > 1 && (
                                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                                            <TableCell colSpan={6} className="text-sm font-semibold text-foreground first-letter:uppercase">
                                                {date}
                                            </TableCell>
                                        </TableRow>
                                    )}
                                    {daySales.map((sale) => {
                                        const rechazado = RECHAZADOS.includes(sale.dte_estado ?? '')
                                        const puedeXml = [33, 34, 52, 56, 61].includes(sale.tipo_dte) && ['ACEPTADO', 'REPAROS'].includes(sale.dte_estado ?? '')
                                        const puedeDevolver = [33, 34, 39, 41].includes(sale.tipo_dte) && hayNotasCredito && !rechazado
                                        const puedeCorregir = [33, 34].includes(sale.tipo_dte) && hayNotasCredito && !rechazado
                                        return (
                                            <TableRow key={sale.id}>
                                                <TableCell className="text-[15px] text-muted-foreground font-tabular">{hora(sale.fecha_emision)}</TableCell>
                                                <TableCell className="text-[15px]">
                                                    <p className="text-foreground">{NOMBRE_DTE[sale.tipo_dte] ?? 'Documento'} {sale.folio}</p>
                                                    {sale.tipo_dte === 52 && [1, 2, 3].includes(sale.ind_traslado ?? 0) && (
                                                        <p className={`text-sm ${sale.facturada_por_id ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400'}`}>
                                                            {sale.facturada_por_id ? 'Ya facturada' : 'Por facturar'}
                                                        </p>
                                                    )}
                                                </TableCell>
                                                <TableCell className="hidden lg:table-cell text-[15px] text-foreground truncate max-w-[220px]">
                                                    {sale.customer?.razon_social || 'Sin cliente'}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-wrap items-center gap-1">
                                                        <SiiEstado estado={sale.dte_estado} glosa={sale.dte_glosa} />
                                                        {sale.intercambio_estado && ESTADOS_XML[sale.intercambio_estado] && (
                                                            <Badge className={`${ESTADOS_XML[sale.intercambio_estado].color} text-xs px-1.5`}>
                                                                {ESTADOS_XML[sale.intercambio_estado].label}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right text-[15px] font-semibold text-foreground font-tabular">
                                                    {formatCLP(sale.tipo_dte === 61 ? -Number(sale.monto_total) : Number(sale.monto_total))}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center justify-end gap-1">
                                                        {rechazado ? (
                                                            <Button variant="outline" size="sm" onClick={() => setReemitirDialog(sale)}>
                                                                <RefreshCw className="h-4 w-4" /> Emitir de nuevo
                                                            </Button>
                                                        ) : (
                                                            <Button variant="outline" size="sm" onClick={() => verPdf(sale.id)}>
                                                                <Printer className="h-4 w-4" /> Imprimir
                                                            </Button>
                                                        )}
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Más acciones de ${NOMBRE_DTE[sale.tipo_dte] ?? 'documento'} ${sale.folio}`}>
                                                                    <MoreVertical className="h-4 w-4" />
                                                                </Button>
                                                            </DropdownMenuTrigger>
                                                            <DropdownMenuContent align="end" className="w-64">
                                                                {rechazado && <DropdownMenuItem onSelect={() => verPdf(sale.id)}>Ver el documento</DropdownMenuItem>}
                                                                {puedeDevolver && <DropdownMenuItem onSelect={() => setReturnDialog(sale)}>Devolver productos (nota de crédito)</DropdownMenuItem>}
                                                                {puedeXml && <DropdownMenuItem onSelect={() => setXmlDialog(sale)}>Reenviar al correo del cliente</DropdownMenuItem>}
                                                                {puedeCorregir && <DropdownMenuItem onSelect={() => setCorregirDialog(sale)}>Corregir giro o dirección</DropdownMenuItem>}
                                                                {!rechazado && !puedeDevolver && !puedeXml && !puedeCorregir && (
                                                                    <DropdownMenuItem disabled>No hay más acciones para este documento</DropdownMenuItem>
                                                                )}
                                                            </DropdownMenuContent>
                                                        </DropdownMenu>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
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
