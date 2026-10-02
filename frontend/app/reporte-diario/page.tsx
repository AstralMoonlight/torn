'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import {
    AlertTriangle, ArrowDown, ArrowUp, BarChart3, CreditCard, FileText, Printer,
    ShoppingBag, Users, type LucideIcon,
} from 'lucide-react'
import { getReporteVentas, type ReporteVentas } from '@/services/stats'
import { formatCLP, getTodayChile } from '@/lib/format'
import { avisar } from '@/lib/store/uiStore'
import { useSessionStore } from '@/lib/store/sessionStore'
import { cn } from '@/lib/utils'
import { aFecha, cantidad, etiquetasSerie, porcentaje, sumarDias, textoRango } from '@/lib/reporte'
import { nombreDte } from '@/components/pos/DteBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SearchInput } from '@/components/ui/search-input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableEmpty, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import ReporteImpreso from '@/components/reportes/ReporteImpreso'
import Resumen from '@/components/layout/Resumen'
import FiltrosRapidos from '@/components/layout/FiltrosRapidos'

const GraficoVentas = dynamic(() => import('@/components/reportes/GraficoVentas'), {
    ssr: false,
    loading: () => <div className="h-72 w-full rounded-lg bg-muted animate-pulse" />,
})

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
            {Math.abs(pct).toFixed(0)}% {sube ? 'más' : 'menos'} que antes
        </span>
    )
}

function Seccion({ icono: Icono, titulo, extra, children, className }: {
    icono: LucideIcon; titulo: string; extra?: React.ReactNode; children: React.ReactNode; className?: string
}) {
    return (
        <Card className={cn('shadow-sm', className)}>
            <CardHeader className="pb-3 border-b">
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base font-semibold">
                    <span className="flex items-center gap-2">
                        <Icono className="h-5 w-5 text-primary" aria-hidden /> {titulo}
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

    // Al imprimir o guardar en PDF, el título de la pestaña es el nombre del archivo.
    useEffect(() => {
        if (!reporte) return
        const original = document.title
        const nombre = `Reporte de ventas ${empresa?.name ?? ''} ${reporte.desde} a ${reporte.hasta}`
        const antes = () => { document.title = nombre }
        const despues = () => { document.title = original }
        window.addEventListener('beforeprint', antes)
        window.addEventListener('afterprint', despues)
        return () => { window.removeEventListener('beforeprint', antes); window.removeEventListener('afterprint', despues) }
    }, [reporte, empresa])

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
    const { unidad, corta: etiqueta, larga: etiquetaLarga } = etiquetasSerie(reporte)
    const mejor = reporte.serie.reduce((m, p) => (p.total > m.total ? p : m), reporte.serie[0])
    const totalCobrado = reporte.medios_pago.reduce((s, m) => s + m.total, 0)
    const sinCosto = reporte.productos.filter((p) => p.costo === 0 && p.venta > 0).length
    const hayVentas = reporte.documentos.length > 0

    return (
        <PageContainer className={cn('transition-opacity', cargando && 'opacity-60')}>
            <div className="space-y-6 print:hidden">
                <div className="space-y-4">
                    <PageHeader
                        title="Reporte de ventas"
                        description="Cuánto vendiste, cuánto ganaste y cómo te pagaron, en el período que elijas."
                        actions={
                            <Button variant="outline" size="lg" onClick={() => window.print()} className="gap-2 px-5">
                                <Printer className="h-4 w-4" /> Imprimir
                            </Button>
                        }
                    />

                    <div data-section="reporte-diario.periodo" className="flex flex-col xl:flex-row xl:items-end gap-4">
                        <FiltrosRapidos
                            etiqueta="Período"
                            valor={atajo?.id ?? ''}
                            onChange={(id) => { const o = opciones.find((x) => x.id === id); if (o) setRango(o.rango) }}
                            opciones={opciones.map((o) => ({ valor: o.id, etiqueta: o.texto }))}
                        />
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
                            <span> Revíselos en <Link href="/historial/rechazados" className="font-medium underline">Documentos rechazados</Link>.</span>
                        </AlertDescription>
                    </Alert>
                )}

                <div data-section="reporte-diario.indicadores" className="space-y-2">
                    <Resumen datos={[
                        {
                            etiqueta: 'Vendiste',
                            valor: formatCLP(r.venta_total),
                            nota: <>{cantidad.format(r.num_ventas)} {r.num_ventas === 1 ? 'venta' : 'ventas'}, promedio {formatCLP(r.ticket_promedio)}. <Variacion actual={r.venta_total} anterior={a.venta_total} /></>,
                        },
                        {
                            etiqueta: 'Ganaste',
                            valor: formatCLP(r.margen),
                            nota: <>{r.neto ? `El ${porcentaje(r.margen, r.neto)} de la venta sin IVA.` : 'Sin ventas.'} <Variacion actual={r.margen} anterior={a.margen} /></>,
                        },
                        {
                            etiqueta: 'IVA de tus ventas',
                            valor: formatCLP(r.iva),
                            nota: 'Va al F29 junto con el de tus compras',
                        },
                    ]} />
                    <p className="text-sm text-muted-foreground">
                        Devoluciones: {formatCLP(r.devoluciones.total)}
                        {r.devoluciones.num === 0 ? ', sin notas de crédito' : r.devoluciones.num === 1 ? ' en 1 nota de crédito' : ` en ${r.devoluciones.num} notas de crédito`}.
                        {' '}Descuentos dados: {formatCLP(r.descuentos)}.
                    </p>
                </div>

                <Seccion icono={BarChart3} titulo={`Ventas por ${unidad}`}
                    extra={mejor && mejor.total > 0 && (
                        <span className="text-sm font-normal text-muted-foreground">
                            Mejor {unidad}: <span className="font-semibold text-foreground">{etiquetaLarga(mejor.clave)}</span>, {formatCLP(mejor.total)}
                        </span>
                    )}>
                    {hayVentas ? (
                        <>
                            <div><GraficoVentas serie={reporte.serie} etiqueta={etiqueta} /></div>
                            <details className="mt-3">
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

                <Tabs data-section="reporte-diario.detalle" defaultValue="productos" className="space-y-4">
                    <TabsList className="h-auto flex-wrap">
                        <TabsTrigger value="productos">Por producto</TabsTrigger>
                        {reporte.vendedores.length > 1 && <TabsTrigger value="vendedores">Por vendedor</TabsTrigger>}
                        {reporte.clientes.length > 0 && <TabsTrigger value="clientes">Por cliente</TabsTrigger>}
                        <TabsTrigger value="documentos">Por documento</TabsTrigger>
                        <TabsTrigger value="pagos">Medios de pago</TabsTrigger>
                    </TabsList>
                    <TabsContent value="productos">
                    <Seccion icono={ShoppingBag} titulo="Productos vendidos"
                    extra={<SearchInput className="w-full sm:w-72 font-normal" placeholder="Buscar producto o código"
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
                                            className={cn('inline-flex min-h-11 items-center gap-1 cursor-pointer hover:text-foreground',
                                                orden === c.id && 'font-semibold text-foreground')}>
                                            {c.texto}
                                            {orden === c.id && <ArrowDown className="h-3.5 w-3.5" aria-hidden />}
                                        </button>
                                    </TableHead>
                                ))}
                            </TableRow></TableHeader>
                            <TableBody>
                                {productos.length === 0 ? (
                                    <TableEmpty colSpan={5}>{busqueda ? 'Ningún producto coincide con la búsqueda.' : 'No se vendieron productos en este periodo.'}</TableEmpty>
                                ) : productos.map((p, i) => (
                                    <TableRow key={p.product_id} className={cn(!verTodos && i >= VISIBLES && 'hidden')}>
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
                                            {p.costo === 0 && p.venta > 0 ? 'sin costo' : (
                                                <span className="inline-flex items-center justify-end gap-2">
                                                    <Progress value={p.venta > 0 ? Math.max(0, Math.min(100, (p.margen / p.venta) * 100)) : 0} className="hidden h-2 w-24 sm:block" />
                                                    <span className="w-12">{porcentaje(p.margen, p.venta)}</span>
                                                </span>
                                            )}
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
                        <Button variant="outline" size="lg" className="mt-4 w-full" onClick={() => setVerTodos(true)}>
                            Ver los {productos.length} productos
                        </Button>
                    )}
                </Seccion>
                    </TabsContent>
                    {reporte.vendedores.length > 1 && (
                        <TabsContent value="vendedores">
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
                        </TabsContent>
                    )}
                    {reporte.clientes.length > 0 && (
                        <TabsContent value="clientes">
                        <Seccion icono={Users} titulo="Clientes que más compraron">
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
                        </TabsContent>
                    )}
                    <TabsContent value="documentos">
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
                    </TabsContent>
                    <TabsContent value="pagos">
                    <Seccion icono={CreditCard} titulo="Cómo te pagaron" extra={<span className="font-tabular">{formatCLP(totalCobrado)}</span>}>
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
                                        <Progress value={totalCobrado > 0 ? Math.max(0, (m.total / totalCobrado) * 100) : 0} className="h-2" />
                                    </li>
                                ))}
                            </ul>
                        ) : <p className="text-muted-foreground">Sin pagos en este periodo.</p>}
                        <p className="mt-4 text-xs text-muted-foreground">El efectivo ya descuenta el vuelto. Las devoluciones restan del medio con que se devolvió.</p>
                    </Seccion>
                    </TabsContent>
                </Tabs>

                <p className="text-xs text-muted-foreground">
                    Ganancia = venta sin IVA, con descuentos, menos el costo de lo vendido (el costo que tenía cada producto al momento
                    de la venta). No descuenta arriendo, sueldos ni otros gastos. Los documentos rechazados por el SII no se cuentan.
                </p>
            </div>

            <ReporteImpreso reporte={reporte} empresa={empresa} enCurso={reporte.hasta === hoy} />
        </PageContainer>
    )
}
