'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
    AlertTriangle, ArrowDown, ArrowUp, BarChart3, CreditCard, FileText, Printer, Receipt,
    ShoppingBag, Undo2, Users, Wallet, type LucideIcon,
} from 'lucide-react'
import { getReporteVentas, type ReporteVentas } from '@/services/stats'
import { formatCLP, getTodayChile } from '@/lib/format'
import { avisar } from '@/lib/store/uiStore'
import { useSessionStore } from '@/lib/store/sessionStore'
import { cn } from '@/lib/utils'
import { nombreDte } from '@/components/pos/DteBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { SearchInput } from '@/components/ui/search-input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableEmpty, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'

const GraficoVentas = dynamic(() => import('@/components/reportes/GraficoVentas'), {
    ssr: false,
    loading: () => <div className="h-72 w-full rounded-lg bg-muted animate-pulse" />,
})

// ── Fechas: cadenas aaaa-mm-dd, calculadas en UTC para no correr el día ──

const aFecha = (s: string) => new Date(`${s}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
function sumarDias(s: string, n: number) {
    const d = aFecha(s)
    d.setUTCDate(d.getUTCDate() + n)
    return iso(d)
}
const fmt = (opciones: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-CL', { ...opciones, timeZone: 'UTC' })
const LARGA = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const DIA_MES = fmt({ day: 'numeric', month: 'long' })
const DIA_SEMANA = fmt({ weekday: 'short', day: 'numeric' })
const MES = fmt({ month: 'short' })
const MES_ANIO = fmt({ month: 'long', year: 'numeric' })

/** "martes, 30 de septiembre de 2026" o "1 de septiembre al martes, 30 de septiembre de 2026". */
function textoRango(desde: string, hasta: string) {
    if (desde === hasta) return LARGA.format(aFecha(desde))
    return `${DIA_MES.format(aFecha(desde))} al ${LARGA.format(aFecha(hasta))}`
}

type Rango = { desde: string; hasta: string }

function atajos(hoy: string): { id: string; texto: string; rango: Rango }[] {
    const lunes = sumarDias(hoy, -((aFecha(hoy).getUTCDay() + 6) % 7))
    const inicioMes = `${hoy.slice(0, 8)}01`
    const finMesAnterior = sumarDias(inicioMes, -1)
    return [
        { id: 'hoy', texto: 'Hoy', rango: { desde: hoy, hasta: hoy } },
        { id: 'ayer', texto: 'Ayer', rango: { desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) } },
        { id: 'semana', texto: 'Esta semana', rango: { desde: lunes, hasta: hoy } },
        { id: 'mes', texto: 'Este mes', rango: { desde: inicioMes, hasta: hoy } },
        { id: 'mes-anterior', texto: 'Mes anterior', rango: { desde: `${finMesAnterior.slice(0, 8)}01`, hasta: finMesAnterior } },
        { id: 'anio', texto: 'Este año', rango: { desde: `${hoy.slice(0, 4)}-01-01`, hasta: hoy } },
    ]
}

const cantidad = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 })
const porcentaje = (parte: number, total: number) => (total ? `${Math.round((parte / total) * 100)}%` : '-')

// ── Piezas ───────────────────────────────────────────────────────────

/** Variación contra el periodo anterior: flecha y signo, nunca solo color. */
function Variacion({ actual, anterior }: { actual: number; anterior: number }) {
    if (!anterior) return <span className="text-muted-foreground">Sin datos para comparar</span>
    const pct = ((actual - anterior) / Math.abs(anterior)) * 100
    const sube = pct >= 0
    const Icono = sube ? ArrowUp : ArrowDown
    return (
        <span className={cn('inline-flex items-center gap-1 font-semibold', sube ? 'text-primary' : 'text-destructive')}>
            <Icono className="h-4 w-4" aria-hidden />
            {sube ? '+' : ''}{pct.toFixed(0)}%
            <span className="sr-only">{sube ? 'más' : 'menos'} que el periodo anterior</span>
        </span>
    )
}

function Indicador({ icono: Icono, titulo, valor, detalle, children }: {
    icono: LucideIcon; titulo: string; valor: string; detalle?: React.ReactNode; children?: React.ReactNode
}) {
    return (
        <Card className="shadow-sm print:shadow-none">
            <CardContent className="p-5 space-y-2">
                <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Icono className="h-4 w-4 text-primary print:hidden" aria-hidden /> {titulo}
                </p>
                <p className="text-3xl font-bold tracking-tight text-foreground">{valor}</p>
                {detalle && <p className="text-sm text-muted-foreground">{detalle}</p>}
                {children && <div className="text-sm">{children}</div>}
            </CardContent>
        </Card>
    )
}

function Seccion({ icono: Icono, titulo, extra, children, className }: {
    icono: LucideIcon; titulo: string; extra?: React.ReactNode; children: React.ReactNode; className?: string
}) {
    return (
        <Card className={cn('shadow-sm print:shadow-none print:break-inside-avoid', className)}>
            <CardHeader className="pb-3 border-b">
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base font-semibold">
                    <span className="flex items-center gap-2">
                        <Icono className="h-5 w-5 text-primary print:hidden" aria-hidden /> {titulo}
                    </span>
                    {extra}
                </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">{children}</CardContent>
        </Card>
    )
}

type Orden = 'venta' | 'cantidad' | 'margen' | 'pct'
const COLUMNAS: { id: Orden; texto: string }[] = [
    { id: 'cantidad', texto: 'Cantidad' },
    { id: 'venta', texto: 'Venta neta' },
    { id: 'margen', texto: 'Ganancia' },
    { id: 'pct', texto: '% ganancia' },
]
const VISIBLES = 25

// ── Página ───────────────────────────────────────────────────────────

export default function ReporteVentasPage() {
    const hoy = useMemo(() => getTodayChile(), [])
    const opciones = useMemo(() => atajos(hoy), [hoy])
    const [rango, setRango] = useState<Rango>({ desde: hoy, hasta: hoy })
    const [reporte, setReporte] = useState<ReporteVentas | null>(null)
    const [busqueda, setBusqueda] = useState('')
    const [orden, setOrden] = useState<Orden>('venta')
    const [verTodos, setVerTodos] = useState(false)
    const empresa = useSessionStore((s) => s.availableTenants.find((t) => t.id === s.selectedTenantId))

    useEffect(() => {
        let vigente = true
        getReporteVentas(rango.desde, rango.hasta)
            .then((r) => { if (vigente) setReporte(r) })
            .catch(() => avisar('No se pudo cargar el reporte de ventas.', { reintentar: () => setRango({ ...rango }) }))
        return () => { vigente = false }
    }, [rango])

    const productos = useMemo(() => {
        if (!reporte) return []
        const q = busqueda.trim().toLowerCase()
        const valor = (p: ReporteVentas['productos'][number]) =>
            orden === 'pct' ? (p.venta ? p.margen / p.venta : -Infinity) : p[orden]
        return reporte.productos
            .filter((p) => !q || p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q))
            .sort((a, b) => valor(b) - valor(a))
    }, [reporte, busqueda, orden])

    if (!reporte) {
        return (
            <PageContainer>
                <Skeleton className="h-10 w-72" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
                </div>
                <Skeleton className="h-80 rounded-xl" />
            </PageContainer>
        )
    }

    const { resumen: r, anterior: a } = reporte
    // Mientras llega el periodo nuevo se ve el anterior, atenuado: sin saltos.
    const cargando = reporte.desde !== rango.desde || reporte.hasta !== rango.hasta
    const atajo = opciones.find((o) => o.rango.desde === rango.desde && o.rango.hasta === rango.hasta)
    const unidad = { hora: 'hora', dia: 'día', mes: 'mes' }[reporte.agrupacion]
    const hora = (clave: string) => `${clave.padStart(2, '0')}:00`
    const etiqueta = (clave: string) =>
        reporte.agrupacion === 'hora' ? hora(clave)
            : reporte.agrupacion === 'mes' ? MES.format(aFecha(`${clave}-01`))
                : reporte.serie.length <= 7 ? DIA_SEMANA.format(aFecha(clave)) : `${clave.slice(8, 10)}/${clave.slice(5, 7)}`
    const etiquetaLarga = (clave: string) =>
        reporte.agrupacion === 'hora' ? `${hora(clave)} a ${clave.padStart(2, '0')}:59`
            : reporte.agrupacion === 'mes' ? MES_ANIO.format(aFecha(`${clave}-01`)) : LARGA.format(aFecha(clave))
    const mejor = reporte.serie.reduce((m, p) => (p.total > m.total ? p : m), reporte.serie[0])
    const totalCobrado = reporte.medios_pago.reduce((s, m) => s + m.total, 0)
    const sinCosto = reporte.productos.filter((p) => p.costo === 0 && p.venta > 0).length
    const hayVentas = reporte.documentos.length > 0

    return (
        <PageContainer className={cn('transition-opacity', cargando && 'opacity-60')}>
            <div className="print:hidden space-y-4">
                <PageHeader
                    icon={BarChart3}
                    title="Reporte de ventas"
                    description="Cuánto vendió, cuánto ganó y cómo le pagaron."
                    actions={
                        <Button variant="outline" size="lg" onClick={() => window.print()} className="gap-2 px-5">
                            <Printer className="h-4 w-4" /> Imprimir
                        </Button>
                    }
                />

                <div data-section="reporte-diario.periodo" className="flex flex-col xl:flex-row xl:items-end gap-4">
                    <div role="group" aria-label="Periodo" className="flex flex-wrap gap-2">
                        {opciones.map((o) => (
                            <Button key={o.id} size="lg" className="px-5" variant={atajo?.id === o.id ? 'default' : 'outline'}
                                aria-pressed={atajo?.id === o.id} onClick={() => setRango(o.rango)}>
                                {o.texto}
                            </Button>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-end gap-3 xl:ml-auto">
                        <div className="space-y-1">
                            <Label htmlFor="desde">Desde</Label>
                            <Input id="desde" type="date" className="h-11 w-44" value={rango.desde} max={hoy}
                                onChange={(e) => e.target.value && setRango({
                                    desde: e.target.value, hasta: e.target.value > rango.hasta ? e.target.value : rango.hasta,
                                })} />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="hasta">Hasta</Label>
                            <Input id="hasta" type="date" className="h-11 w-44" value={rango.hasta} min={rango.desde} max={hoy}
                                onChange={(e) => e.target.value && setRango({ ...rango, hasta: e.target.value })} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Encabezado impreso */}
            <div className="hidden print:block border-b border-black pb-3">
                <p className="text-sm">{empresa?.name}{empresa?.rut ? ` · RUT ${empresa.rut}` : ''}</p>
                <h1 className="text-xl font-bold">Reporte de ventas</h1>
            </div>

            <div data-section="reporte-diario.rango">
                <p className="text-lg font-semibold text-foreground first-letter:uppercase">{textoRango(reporte.desde, reporte.hasta)}</p>
                <p className="text-sm text-muted-foreground">
                    Comparado con: {textoRango(a.desde, a.hasta)}
                    {reporte.hasta === hoy ? ', hasta la misma hora' : ''}.
                </p>
            </div>

            {reporte.rechazados.num > 0 && (
                <Alert data-section="reporte-diario.rechazados">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>
                        {reporte.rechazados.num === 1 ? 'Un documento rechazado' : `${reporte.rechazados.num} documentos rechazados`} por el SII en este periodo
                    </AlertTitle>
                    <AlertDescription>
                        Suman {formatCLP(reporte.rechazados.total)} y no se cuentan en estas cifras, porque hay que volver a emitirlos.
                        <span className="print:hidden"> Revíselos en <Link href="/historial/rechazados" className="font-medium underline">Documentos rechazados</Link>.</span>
                    </AlertDescription>
                </Alert>
            )}

            <div data-section="reporte-diario.indicadores" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 print:grid-cols-4">
                <Indicador icono={Wallet} titulo="Ventas (con IVA)" valor={formatCLP(r.venta_total)}
                    detalle={`Antes: ${formatCLP(a.venta_total)}`}>
                    <Variacion actual={r.venta_total} anterior={a.venta_total} />
                </Indicador>
                <Indicador icono={BarChart3} titulo="Ganancia" valor={formatCLP(r.margen)}
                    detalle={r.neto ? `${porcentaje(r.margen, r.neto)} de la venta sin IVA` : 'Sin ventas'}>
                    <Variacion actual={r.margen} anterior={a.margen} />
                </Indicador>
                <Indicador icono={Receipt} titulo="Ventas realizadas" valor={cantidad.format(r.num_ventas)}
                    detalle={`Promedio por venta: ${formatCLP(r.ticket_promedio)}`}>
                    <Variacion actual={r.num_ventas} anterior={a.num_ventas} />
                </Indicador>
                <Indicador icono={Undo2} titulo="Devoluciones" valor={formatCLP(r.devoluciones.total)}
                    detalle={r.devoluciones.num === 0 ? 'Sin notas de crédito'
                        : r.devoluciones.num === 1 ? '1 nota de crédito' : `${r.devoluciones.num} notas de crédito`}>
                    <span className="text-muted-foreground">Descuentos dados: {formatCLP(r.descuentos)}</span>
                </Indicador>
            </div>

            <Seccion icono={BarChart3} titulo={`Ventas por ${unidad}`}
                extra={mejor && mejor.total > 0 && (
                    <span className="text-sm font-normal text-muted-foreground">
                        Mejor {unidad}: <span className="font-semibold text-foreground">{etiquetaLarga(mejor.clave)}</span>, {formatCLP(mejor.total)}
                    </span>
                )}>
                {hayVentas ? (
                    <>
                        <div className="print:hidden"><GraficoVentas serie={reporte.serie} etiqueta={etiqueta} /></div>
                        <details className="mt-3 print:hidden">
                            <summary className="cursor-pointer text-sm font-medium text-primary">Ver como tabla</summary>
                            <Table className="mt-2">
                                <TableHeader><TableRow>
                                    <TableHead className="first-letter:uppercase">{unidad}</TableHead>
                                    <TableHead className="text-right">Ventas</TableHead>
                                    <TableHead className="text-right">Monto</TableHead>
                                </TableRow></TableHeader>
                                <TableBody>
                                    {reporte.serie.filter((p) => p.num || p.total).map((p) => (
                                        <TableRow key={p.clave}>
                                            <TableCell className="first-letter:uppercase">{etiquetaLarga(p.clave)}</TableCell>
                                            <TableCell className="text-right font-tabular">{p.num}</TableCell>
                                            <TableCell className="text-right font-tabular">{formatCLP(p.total)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </details>
                    </>
                ) : (
                    <p className="py-12 text-center text-muted-foreground">No hay ventas en este periodo.</p>
                )}
            </Seccion>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print:grid-cols-2">
                <Seccion icono={CreditCard} titulo="Cómo le pagaron" extra={<span className="font-tabular">{formatCLP(totalCobrado)}</span>}>
                    {reporte.medios_pago.length ? (
                        <ul className="space-y-4">
                            {reporte.medios_pago.map((m) => (
                                <li key={m.codigo} className="space-y-1.5">
                                    <div className="flex items-baseline gap-3">
                                        <span className="font-medium text-foreground">{m.nombre}</span>
                                        <span className="text-sm text-muted-foreground">{m.num} {m.num === 1 ? 'pago' : 'pagos'}</span>
                                        <span className="ml-auto font-semibold font-tabular">{formatCLP(m.total)}</span>
                                        <span className="w-12 text-right text-sm text-muted-foreground font-tabular">{porcentaje(m.total, totalCobrado)}</span>
                                    </div>
                                    <Progress value={totalCobrado > 0 ? Math.max(0, (m.total / totalCobrado) * 100) : 0} className="h-2 print:hidden" />
                                </li>
                            ))}
                        </ul>
                    ) : <p className="text-muted-foreground">Sin pagos en este periodo.</p>}
                    <p className="mt-4 text-xs text-muted-foreground">El efectivo ya descuenta el vuelto. Las devoluciones restan del medio con que se devolvió.</p>
                </Seccion>

                <Seccion icono={FileText} titulo="Documentos emitidos">
                    {hayVentas ? (
                        <Table>
                            <TableHeader><TableRow>
                                <TableHead>Documento</TableHead>
                                <TableHead className="text-right">Cant.</TableHead>
                                <TableHead className="text-right">Neto</TableHead>
                                <TableHead className="text-right">IVA</TableHead>
                                <TableHead className="text-right">Total</TableHead>
                            </TableRow></TableHeader>
                            <TableBody>
                                {reporte.documentos.map((d) => (
                                    <TableRow key={d.tipo_dte}>
                                        <TableCell className="font-medium">{nombreDte(d.tipo_dte)}</TableCell>
                                        <TableCell className="text-right font-tabular">{d.num}</TableCell>
                                        <TableCell className="text-right font-tabular">{formatCLP(d.neto)}</TableCell>
                                        <TableCell className="text-right font-tabular">{formatCLP(d.iva)}</TableCell>
                                        <TableCell className="text-right font-tabular font-semibold">{formatCLP(d.total)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                            <TableFooter><TableRow>
                                <TableCell>Total</TableCell>
                                <TableCell />
                                <TableCell className="text-right font-tabular">{formatCLP(r.neto)}</TableCell>
                                <TableCell className="text-right font-tabular">{formatCLP(r.iva)}</TableCell>
                                <TableCell className="text-right font-tabular">{formatCLP(r.venta_total)}</TableCell>
                            </TableRow></TableFooter>
                        </Table>
                    ) : <p className="text-muted-foreground">No se emitieron documentos en este periodo.</p>}
                    <p className="mt-4 text-xs text-muted-foreground">Las notas de crédito restan. Las guías de despacho no se cuentan: la venta es la factura que las cobra.</p>
                </Seccion>
            </div>

            {(reporte.vendedores.length > 1 || reporte.clientes.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 print:grid-cols-2">
                    {reporte.vendedores.length > 1 && (
                        <Seccion icono={Users} titulo="Por vendedor">
                            <Table>
                                <TableHeader><TableRow>
                                    <TableHead>Vendedor</TableHead>
                                    <TableHead className="text-right">Ventas</TableHead>
                                    <TableHead className="text-right">Monto</TableHead>
                                    <TableHead className="text-right">Ganancia</TableHead>
                                </TableRow></TableHeader>
                                <TableBody>
                                    {reporte.vendedores.map((v) => (
                                        <TableRow key={v.nombre}>
                                            <TableCell className="font-medium">{v.nombre}</TableCell>
                                            <TableCell className="text-right font-tabular">{v.num}</TableCell>
                                            <TableCell className="text-right font-tabular">{formatCLP(v.total)}</TableCell>
                                            <TableCell className="text-right font-tabular">{formatCLP(v.margen)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </Seccion>
                    )}
                    {reporte.clientes.length > 0 && (
                        <Seccion icono={Users} titulo="Clientes que más compraron"
                            className={reporte.vendedores.length > 1 ? undefined : 'lg:col-span-2'}>
                            <Table>
                                <TableHeader><TableRow>
                                    <TableHead>Cliente</TableHead>
                                    <TableHead className="text-right">Compras</TableHead>
                                    <TableHead className="text-right">Monto</TableHead>
                                </TableRow></TableHeader>
                                <TableBody>
                                    {reporte.clientes.map((c) => (
                                        <TableRow key={c.rut}>
                                            <TableCell>
                                                <div className="font-medium">{c.razon_social}</div>
                                                <div className="text-xs text-muted-foreground font-tabular">{c.rut}</div>
                                            </TableCell>
                                            <TableCell className="text-right font-tabular">{c.num}</TableCell>
                                            <TableCell className="text-right font-tabular">{formatCLP(c.total)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                            <p className="mt-4 text-xs text-muted-foreground">Sin las boletas a consumidor final.</p>
                        </Seccion>
                    )}
                </div>
            )}

            <Seccion icono={ShoppingBag} titulo="Productos vendidos"
                extra={<SearchInput className="w-full sm:w-72 font-normal print:hidden" placeholder="Buscar producto o código"
                    value={busqueda} onChange={(e) => setBusqueda(e.target.value)} onClear={() => setBusqueda('')} />}>
                {sinCosto > 0 && (
                    <p className="mb-3 flex items-start gap-2 text-sm text-muted-foreground">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span>
                            {sinCosto === 1 ? 'Un producto no tiene' : `${sinCosto} productos no tienen`} costo registrado: su ganancia aparece
                            como el total de la venta. Regístrelo en <Link href="/inventario" className="font-medium underline">Inventario</Link>.
                        </span>
                    </p>
                )}
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader><TableRow>
                            <TableHead>Producto</TableHead>
                            {COLUMNAS.map((c) => (
                                <TableHead key={c.id} className="text-right" aria-sort={orden === c.id ? 'descending' : 'none'}>
                                    <button type="button" onClick={() => setOrden(c.id)}
                                        className={cn('inline-flex min-h-11 items-center gap-1 cursor-pointer hover:text-foreground print:min-h-0',
                                            orden === c.id && 'font-semibold text-foreground')}>
                                        {c.texto}
                                        {orden === c.id && <ArrowDown className="h-3.5 w-3.5 print:hidden" aria-hidden />}
                                    </button>
                                </TableHead>
                            ))}
                        </TableRow></TableHeader>
                        <TableBody>
                            {productos.length === 0 ? (
                                <TableEmpty colSpan={5}>{busqueda ? 'Ningún producto coincide con la búsqueda.' : 'No se vendieron productos en este periodo.'}</TableEmpty>
                            ) : productos.map((p, i) => (
                                <TableRow key={p.product_id} className={cn(!verTodos && i >= VISIBLES && 'hidden print:table-row')}>
                                    <TableCell>
                                        <div className="font-medium text-foreground">{p.nombre}</div>
                                        <div className="text-xs text-muted-foreground">Código {p.codigo}</div>
                                    </TableCell>
                                    <TableCell className="text-right font-tabular">{cantidad.format(p.cantidad)}</TableCell>
                                    <TableCell className="text-right font-tabular">{formatCLP(p.venta)}</TableCell>
                                    <TableCell className={cn('text-right font-tabular font-semibold', p.margen < 0 && 'text-destructive')}>
                                        {p.margen < 0 && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />}
                                        {formatCLP(p.margen)}
                                        {p.margen < 0 && <span className="sr-only"> (vendido bajo el costo)</span>}
                                    </TableCell>
                                    <TableCell className="text-right font-tabular text-muted-foreground">
                                        {p.costo === 0 && p.venta > 0 ? 'sin costo' : porcentaje(p.margen, p.venta)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                        {reporte.productos.length > 0 && (
                            <TableFooter><TableRow>
                                <TableCell>Total ({reporte.productos.length} productos)</TableCell>
                                <TableCell />
                                <TableCell className="text-right font-tabular">{formatCLP(r.neto)}</TableCell>
                                <TableCell className="text-right font-tabular">{formatCLP(r.margen)}</TableCell>
                                <TableCell className="text-right font-tabular">{porcentaje(r.margen, r.neto)}</TableCell>
                            </TableRow></TableFooter>
                        )}
                    </Table>
                </div>
                {!verTodos && productos.length > VISIBLES && (
                    <Button variant="outline" size="lg" className="mt-4 w-full print:hidden" onClick={() => setVerTodos(true)}>
                        Ver los {productos.length} productos
                    </Button>
                )}
            </Seccion>

            <p className="text-xs text-muted-foreground">
                Ganancia = venta sin IVA, con descuentos, menos el costo de lo vendido (el costo que tenía cada producto al momento
                de la venta). No descuenta arriendo, sueldos ni otros gastos. Los documentos rechazados por el SII no se cuentan.
            </p>

            <style jsx global>{`
                @media print {
                    @page { size: letter portrait; margin: 12mm; }
                    body { font-family: var(--font-geist-sans), system-ui, sans-serif !important; font-size: 12px !important; }
                    [data-section="reporte-diario"] { max-width: none !important; padding: 0 !important; opacity: 1 !important; }
                    [data-section="reporte-diario"] td, [data-section="reporte-diario"] th { padding: 4px 6px !important; font-size: 11px !important; }
                    [data-section="reporte-diario"] .text-right { text-align: right !important; }
                }
            `}</style>
        </PageContainer>
    )
}
