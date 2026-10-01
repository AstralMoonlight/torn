import { formatCLP, fechaHora } from '@/lib/format'
import { cantidad, etiquetasSerie, porcentaje, textoRango } from '@/lib/reporte'
import { nombreDte } from '@/components/pos/DteBadge'
import type { AvailableTenant } from '@/lib/store/sessionStore'
import type { ReporteVentas } from '@/services/stats'

/** Texto como cadena CSS (para `content:`), sin comillas ni `<` sueltos. */
const cadenaCss = (s: string) => `"${s.replace(/["\\\n<]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `)}"`

function variacion(actual: number, anterior: number) {
    if (!anterior) return '-'
    const pct = ((actual - anterior) / Math.abs(anterior)) * 100
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')}%`
}

function Titulo({ children }: { children: React.ReactNode }) {
    return <h2 className="mb-1.5 mt-5 border-b border-black pb-0.5 text-[10.5pt] font-bold uppercase tracking-wide">{children}</h2>
}

const MODO: Record<string, string> = {
    CERT: 'Modo certificación: los documentos de este reporte son de prueba ante el SII y no tienen validez tributaria.',
    DEV: 'Modo desarrollador: los documentos de este reporte no se enviaron al SII y no tienen validez tributaria.',
}

/**
 * El reporte como documento carta: lo que sale al imprimir o guardar en PDF.
 * La pantalla se oculta entera al imprimir; esto es lo único que se ve.
 */
export default function ReporteImpreso({ reporte, empresa, enCurso }: {
    reporte: ReporteVentas
    empresa?: AvailableTenant
    /** El rango llega hasta hoy: la comparación es hasta la misma hora. */
    enCurso: boolean
}) {
    const { resumen: r, anterior: a } = reporte
    const { unidad, corta, larga } = etiquetasSerie(reporte)
    const max = Math.max(0, ...reporte.serie.map((p) => p.total))
    const mejor = reporte.serie.find((p) => p.total === max)
    const cada = Math.ceil(reporte.serie.length / 16)
    const totalCobrado = reporte.medios_pago.reduce((s, m) => s + m.total, 0)
    const margenPct = (x: { margen: number; neto: number }) => (x.neto ? (x.margen / x.neto) * 100 : 0)
    const pie = `${empresa?.name ?? ''} · Reporte de ventas · ${textoRango(reporte.desde, reporte.hasta)}`

    const filas: [string, number, number, (n: number) => string][] = [
        ['Ventas con IVA', r.venta_total, a.venta_total, formatCLP],
        ['Venta neta (sin IVA)', r.neto, a.neto, formatCLP],
        ['IVA', r.iva, a.iva, formatCLP],
        ['Costo de lo vendido', r.costo, a.costo, formatCLP],
        ['Ganancia', r.margen, a.margen, formatCLP],
        ['Número de ventas', r.num_ventas, a.num_ventas, (n) => cantidad.format(n)],
        ['Promedio por venta', r.ticket_promedio, a.ticket_promedio, formatCLP],
    ]
    const pctActual = margenPct(r)
    const pctAnterior = margenPct(a)

    return (
        <article className="reporte-impreso hidden print:block text-[9.5pt] leading-snug text-black">
            <header className="flex items-end justify-between gap-6 border-b-2 border-black pb-2">
                <div>
                    <p className="text-[8.5pt] uppercase tracking-[0.15em] text-neutral-600">Reporte de ventas</p>
                    <h1 className="text-[16pt] font-bold leading-tight">{empresa?.name}</h1>
                    {empresa?.rut && <p>RUT {empresa.rut}</p>}
                </div>
                <dl className="grid grid-cols-[auto_auto] gap-x-3 text-right text-[8.5pt]">
                    <dt className="text-neutral-600">Periodo</dt>
                    <dd className="font-semibold first-letter:uppercase">{textoRango(reporte.desde, reporte.hasta)}</dd>
                    <dt className="text-neutral-600">Comparado con</dt>
                    <dd className="first-letter:uppercase">{textoRango(a.desde, a.hasta)}{enCurso ? ', hasta la misma hora' : ''}</dd>
                    <dt className="text-neutral-600">Emitido</dt>
                    <dd>{fechaHora(new Date())}</dd>
                </dl>
            </header>

            {empresa?.sii_ambiente && MODO[empresa.sii_ambiente] && (
                <p className="mt-2 border border-black px-2 py-1 text-[8.5pt]">{MODO[empresa.sii_ambiente]}</p>
            )}
            {reporte.rechazados.num > 0 && (
                <p className="mt-2 border border-black px-2 py-1 text-[8.5pt]">
                    {reporte.rechazados.num === 1 ? 'Un documento rechazado' : `${reporte.rechazados.num} documentos rechazados`} por
                    el SII, por {formatCLP(reporte.rechazados.total)}, no se cuentan en estas cifras: hay que volver a emitirlos.
                </p>
            )}

            <Titulo>Resumen</Titulo>
            <table>
                <thead>
                    <tr>
                        <th className="text-left">Concepto</th>
                        <th className="text-right">Este periodo</th>
                        <th className="text-right">Periodo anterior</th>
                        <th className="text-right">Variación</th>
                    </tr>
                </thead>
                <tbody>
                    {filas.map(([nombre, actual, anterior, f]) => (
                        <tr key={nombre} className={nombre === 'Ganancia' || nombre === 'Ventas con IVA' ? 'font-bold' : undefined}>
                            <td>{nombre}</td>
                            <td className="text-right">{f(actual)}</td>
                            <td className="text-right text-neutral-600">{f(anterior)}</td>
                            <td className="text-right">{variacion(actual, anterior)}</td>
                        </tr>
                    ))}
                    <tr>
                        <td>Ganancia sobre la venta neta</td>
                        <td className="text-right">{r.neto ? `${pctActual.toFixed(1).replace('.', ',')}%` : '-'}</td>
                        <td className="text-right text-neutral-600">{a.neto ? `${pctAnterior.toFixed(1).replace('.', ',')}%` : '-'}</td>
                        <td className="text-right">
                            {r.neto && a.neto ? `${pctActual >= pctAnterior ? '+' : ''}${(pctActual - pctAnterior).toFixed(1).replace('.', ',')} pts` : '-'}
                        </td>
                    </tr>
                </tbody>
            </table>
            <p className="mt-1 text-[8.5pt] text-neutral-700">
                Devoluciones: {r.devoluciones.num === 0 ? 'ninguna' : `${r.devoluciones.num} ${r.devoluciones.num === 1 ? 'nota' : 'notas'} de crédito por ${formatCLP(r.devoluciones.total)} (ya restadas)`}.
                {' '}Descuentos dados: {formatCLP(r.descuentos)}.
            </p>

            <section className="break-inside-avoid">
                <Titulo>Ventas por {unidad}</Titulo>
                {max > 0 ? (
                    <>
                        <div className="flex h-[3.2cm] items-end gap-[2px] border-b border-black">
                            {reporte.serie.map((p) => (
                                <div key={p.clave} className="flex-1 bg-neutral-700"
                                    style={{ height: `${(Math.max(0, p.total) / max) * 100}%` }} />
                            ))}
                        </div>
                        <div className="flex gap-[2px] pt-0.5 text-[7pt] text-neutral-600">
                            {reporte.serie.map((p, i) => (
                                <span key={p.clave} className="flex-1 overflow-visible whitespace-nowrap text-center">
                                    {i % cada === 0 ? corta(p.clave) : ''}
                                </span>
                            ))}
                        </div>
                        {mejor && (
                            <p className="mt-1 text-[8.5pt] text-neutral-700 first-letter:uppercase">
                                {unidad} con más venta: {larga(mejor.clave)}, {formatCLP(mejor.total)}.
                            </p>
                        )}
                    </>
                ) : <p>No hay ventas en este periodo.</p>}
            </section>

            <div className="grid grid-cols-2 gap-6">
                <section className="break-inside-avoid">
                    <Titulo>Medios de pago</Titulo>
                    <table>
                        <thead><tr>
                            <th className="text-left">Medio</th><th className="text-right">Pagos</th>
                            <th className="text-right">Monto</th><th className="text-right">%</th>
                        </tr></thead>
                        <tbody>
                            {reporte.medios_pago.map((m) => (
                                <tr key={m.codigo}>
                                    <td>{m.nombre}</td><td className="text-right">{m.num}</td>
                                    <td className="text-right">{formatCLP(m.total)}</td>
                                    <td className="text-right">{porcentaje(m.total, totalCobrado)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot><tr>
                            <td>Total cobrado</td><td /><td className="text-right">{formatCLP(totalCobrado)}</td><td />
                        </tr></tfoot>
                    </table>
                    <p className="mt-1 text-[8pt] text-neutral-600">El efectivo descuenta el vuelto; lo devuelto resta de su medio.</p>
                </section>

                <section className="break-inside-avoid">
                    <Titulo>Documentos emitidos</Titulo>
                    <table>
                        <thead><tr>
                            <th className="text-left">Documento</th><th className="text-right">Cant.</th>
                            <th className="text-right">Neto</th><th className="text-right">IVA</th><th className="text-right">Total</th>
                        </tr></thead>
                        <tbody>
                            {reporte.documentos.map((d) => (
                                <tr key={d.tipo_dte}>
                                    <td>{nombreDte(d.tipo_dte)}</td><td className="text-right">{d.num}</td>
                                    <td className="text-right">{formatCLP(d.neto)}</td>
                                    <td className="text-right">{formatCLP(d.iva)}</td>
                                    <td className="text-right">{formatCLP(d.total)}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot><tr>
                            <td>Total</td><td />
                            <td className="text-right">{formatCLP(r.neto)}</td>
                            <td className="text-right">{formatCLP(r.iva)}</td>
                            <td className="text-right">{formatCLP(r.venta_total)}</td>
                        </tr></tfoot>
                    </table>
                    <p className="mt-1 text-[8pt] text-neutral-600">Las notas de crédito restan; las guías de despacho no se cuentan.</p>
                </section>
            </div>

            {(reporte.vendedores.length > 1 || reporte.clientes.length > 0) && (
                <div className="grid grid-cols-2 gap-6">
                    {reporte.vendedores.length > 1 && (
                        <section className="break-inside-avoid">
                            <Titulo>Por vendedor</Titulo>
                            <table>
                                <thead><tr>
                                    <th className="text-left">Vendedor</th><th className="text-right">Ventas</th>
                                    <th className="text-right">Monto</th><th className="text-right">Ganancia</th>
                                </tr></thead>
                                <tbody>
                                    {reporte.vendedores.map((v) => (
                                        <tr key={v.nombre}>
                                            <td>{v.nombre}</td><td className="text-right">{v.num}</td>
                                            <td className="text-right">{formatCLP(v.total)}</td>
                                            <td className="text-right">{formatCLP(v.margen)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    )}
                    {reporte.clientes.length > 0 && (
                        <section className={reporte.vendedores.length > 1 ? 'break-inside-avoid' : 'col-span-2 break-inside-avoid'}>
                            <Titulo>Clientes que más compraron</Titulo>
                            <table>
                                <thead><tr>
                                    <th className="text-left">Cliente</th><th className="text-left">RUT</th>
                                    <th className="text-right">Compras</th><th className="text-right">Monto</th>
                                </tr></thead>
                                <tbody>
                                    {reporte.clientes.map((c) => (
                                        <tr key={c.rut}>
                                            <td>{c.razon_social}</td><td className="whitespace-nowrap">{c.rut}</td>
                                            <td className="text-right">{c.num}</td>
                                            <td className="text-right">{formatCLP(c.total)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    )}
                </div>
            )}

            <Titulo>Detalle por producto</Titulo>
            {reporte.productos.length ? (
                <table>
                    <thead><tr>
                        <th className="text-right">#</th><th className="text-left">Código</th><th className="text-left">Producto</th>
                        <th className="text-right">Cant.</th><th className="text-right">Venta neta</th><th className="text-right">Costo</th>
                        <th className="text-right">Ganancia</th><th className="text-right">%</th>
                    </tr></thead>
                    <tbody>
                        {reporte.productos.map((p, i) => (
                            <tr key={p.product_id}>
                                <td className="text-right text-neutral-600">{i + 1}</td>
                                <td className="whitespace-nowrap">{p.codigo}</td>
                                <td>{p.nombre}</td>
                                <td className="text-right">{cantidad.format(p.cantidad)}</td>
                                <td className="text-right">{formatCLP(p.venta)}</td>
                                <td className="text-right">{p.costo === 0 && p.venta > 0 ? 'sin costo' : formatCLP(p.costo)}</td>
                                <td className="text-right font-semibold">{formatCLP(p.margen)}</td>
                                <td className="text-right">{porcentaje(p.margen, p.venta)}</td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot><tr>
                        <td /><td /><td>Total ({reporte.productos.length} productos)</td><td />
                        <td className="text-right">{formatCLP(r.neto)}</td>
                        <td className="text-right">{formatCLP(r.costo)}</td>
                        <td className="text-right">{formatCLP(r.margen)}</td>
                        <td className="text-right">{porcentaje(r.margen, r.neto)}</td>
                    </tr></tfoot>
                </table>
            ) : <p>No se vendieron productos en este periodo.</p>}

            <p className="mt-4 border-t border-neutral-400 pt-1.5 text-[8pt] text-neutral-700">
                Ganancia: venta sin IVA, con descuentos, menos el costo que tenía cada producto al momento de venderlo. No descuenta
                arriendo, sueldos ni otros gastos. Los productos &quot;sin costo&quot; no tienen costo registrado y su ganancia aparece completa.
                No se cuentan las guías de despacho ni los documentos rechazados por el SII.
            </p>

            <style>{`
                @media print {
                    @page {
                        size: letter portrait;
                        margin: 14mm 12mm 16mm;
                        @bottom-left { content: ${cadenaCss(pie)}; font: 7.5pt sans-serif; color: #555; }
                        @bottom-right { content: "Página " counter(page) " de " counter(pages); font: 7.5pt sans-serif; color: #555; }
                    }
                    body { font-family: var(--font-geist-sans), system-ui, sans-serif !important; font-size: 9.5pt !important;
                        background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    /* El layout de la app tiene alto fijo y scroll interno: impreso, solo salía la primera hoja. */
                    div:has(> [data-section="contenido"]), [data-section="contenido"] {
                        display: block !important; height: auto !important; overflow: visible !important; padding: 0 !important;
                    }
                    [data-section="contenido"] > :not([data-section="reporte-diario"]) { display: none !important; }
                    [data-section="reporte-diario"] { max-width: none !important; padding: 0 !important; margin: 0 !important; opacity: 1 !important; }
                    .reporte-impreso table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
                    .reporte-impreso th, .reporte-impreso td { padding: 2.5px 5px; font-size: inherit; border-bottom: 0.5px solid #bbb; vertical-align: top; }
                    .reporte-impreso thead th { font-weight: 600; font-size: 8pt; color: #333; border-bottom: 1px solid #000; background: #f1f1f1; }
                    .reporte-impreso tfoot td { font-weight: 700; border-top: 1px solid #000; border-bottom: none; }
                    .reporte-impreso tr { break-inside: avoid; }
                }
            `}</style>
        </article>
    )
}
