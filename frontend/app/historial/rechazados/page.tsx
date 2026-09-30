'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, BookOpen, CheckCircle2, FileWarning, RefreshCw } from 'lucide-react'
import { getApiErrorDetail } from '@/services/api'
import {
    getFoliosPorAnular,
    getSales,
    marcarFolioAnulado,
    type FolioPorAnular,
    type SaleOut,
} from '@/services/sales'
import { avisar } from '@/lib/store/uiStore'
import { useEsAdmin } from '@/lib/store/sessionStore'
import { formatCLP } from '@/lib/format'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import { DteBadge, nombreDte } from '@/components/pos/DteBadge'
import ReemitirDialog from '@/components/pos/ReemitirDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'

const fecha = (iso: string) =>
    new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-CL', {
        day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Santiago',
    })

function Seccion({ titulo, cantidad, descripcion, children }: {
    titulo: string
    cantidad: number
    descripcion: string
    children: React.ReactNode
}) {
    return (
        <section className="space-y-3">
            <div className="space-y-1">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                    {titulo}
                    {cantidad > 0 && <Badge className="bg-destructive text-xs px-1.5">{cantidad}</Badge>}
                </h2>
                <p className="text-sm text-muted-foreground">{descripcion}</p>
            </div>
            {children}
        </section>
    )
}

function TodoEnOrden({ texto }: { texto: string }) {
    return (
        <Card className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            {texto}
        </Card>
    )
}

/**
 * Lo que el SII no aceptó y qué hacer con cada cosa: volver a emitir los
 * rechazados y anular en el SII los números que no se pudieron reutilizar.
 */
export default function RechazadosPage() {
    const esAdmin = useEsAdmin()
    const [rechazados, setRechazados] = useState<SaleOut[]>([])
    const [porAnular, setPorAnular] = useState<FolioPorAnular[]>([])
    const [cargando, setCargando] = useState(true)
    const [reemitir, setReemitir] = useState<SaleOut | null>(null)
    const [anulando, setAnulando] = useState<FolioPorAnular | null>(null)

    const cargar = () => Promise.all([getSales({ rechazados: true, limit: 200 }), getFoliosPorAnular()])
        .then(([r, f]) => {
            setRechazados(r)
            setPorAnular(f)
        })
        .catch((err) => avisar(getApiErrorDetail(err, 'No se pudieron cargar los documentos rechazados.'),
            { reintentar: cargar }))
        .finally(() => setCargando(false))

    useEffect(() => { cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

    const confirmarAnulado = async () => {
        if (!anulando) return
        try {
            await marcarFolioAnulado(anulando.id)
            setPorAnular((lista) => lista.filter((f) => f.id !== anulando.id))
        } catch (err) {
            avisar(getApiErrorDetail(err, 'No se pudo marcar como anulado.'))
        }
    }

    return (
        <PageContainer>
            <PageHeader
                icon={FileWarning}
                title="Documentos rechazados"
                description="Lo que el SII no aceptó y qué hacer con cada uno."
                volver={{ href: '/historial', label: 'Historial' }}
            />

            {cargando ? (
                <div className="space-y-3">
                    <Skeleton className="h-6 w-60" />
                    <Skeleton className="h-32 w-full" />
                </div>
            ) : (
                <>
                    <Seccion
                        titulo="Por emitir de nuevo"
                        cantidad={rechazados.length}
                        descripcion="La venta ya se cobró y los productos ya salieron: solo falta un documento válido. Corrija primero lo que indica el SII (por ejemplo, el giro del cliente en Clientes)."
                    >
                        {rechazados.length === 0 ? (
                            <TodoEnOrden texto="No hay documentos por emitir de nuevo." />
                        ) : (
                            <div data-section="rechazados.por-emitir" className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>N°</TableHead>
                                            <TableHead>Tipo</TableHead>
                                            <TableHead className="hidden md:table-cell">Fecha</TableHead>
                                            <TableHead className="hidden lg:table-cell">Cliente</TableHead>
                                            <TableHead className="hidden sm:table-cell text-right">Total</TableHead>
                                            <TableHead className="hidden sm:table-cell">Motivo del SII</TableHead>
                                            <TableHead className="text-right"><span className="sr-only">Acción</span></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {rechazados.map((venta) => (
                                            <TableRow key={venta.id}>
                                                <TableCell className="font-mono text-xs font-semibold">
                                                    #{venta.folio}
                                                    <span className="sm:hidden block font-sans font-normal text-muted-foreground">
                                                        {formatCLP(parseFloat(String(venta.monto_total)))}
                                                    </span>
                                                </TableCell>
                                                <TableCell>
                                                    <DteBadge tipo={venta.tipo_dte} />
                                                    {venta.dte_glosa && <p className="sm:hidden mt-1 text-xs">{venta.dte_glosa}</p>}
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{fecha(venta.fecha_emision)}</TableCell>
                                                <TableCell className="hidden lg:table-cell max-w-[180px] truncate text-xs text-muted-foreground">
                                                    {venta.customer?.razon_social || '-'}
                                                </TableCell>
                                                <TableCell className="hidden sm:table-cell text-right font-tabular text-xs font-semibold">
                                                    {formatCLP(parseFloat(String(venta.monto_total)))}
                                                </TableCell>
                                                <TableCell className="hidden sm:table-cell max-w-[260px] text-xs">
                                                    {venta.dte_glosa || <span className="text-muted-foreground">El SII no indicó el motivo</span>}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button size="sm" className="gap-1.5" onClick={() => setReemitir(venta)}>
                                                        <RefreshCw className="h-4 w-4" /> Emitir de nuevo
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </Seccion>

                    <Seccion
                        titulo="Números por anular en el SII"
                        cantidad={porAnular.length}
                        descripcion="Cuando un rechazado ya no puede volver a usar su número, sale con otro. El número que quedó sin usar hay que anularlo en el sitio del SII; si no, el SII lo sigue contando como disponible y entrega menos folios nuevos."
                    >
                        {porAnular.length === 0 ? (
                            <TodoEnOrden texto="No hay números pendientes de anular." />
                        ) : (
                            <div data-section="rechazados.por-anular" className="grid gap-3 md:grid-cols-2">
                                {porAnular.map((f) => (
                                    <Card key={f.id} className="space-y-3 p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="font-semibold">{nombreDte(f.tipo_dte)} N° {f.folio}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {fecha(f.fecha_emision)}
                                                    {f.receptor_razon_social && ` · ${f.receptor_razon_social}`}
                                                    {` · ${formatCLP(f.monto_total)}`}
                                                </p>
                                            </div>
                                            {f.folio_nuevo && (
                                                <Badge variant="outline" className="shrink-0 text-xs">Reemplazado por N° {f.folio_nuevo}</Badge>
                                            )}
                                        </div>
                                        {f.glosa_sii && (
                                            <p className="rounded-md bg-muted/50 p-2 text-xs">
                                                <span className="font-medium">Motivo del rechazo:</span> {f.glosa_sii}
                                            </p>
                                        )}
                                        <div className="flex items-center justify-between gap-3">
                                            <p className="text-xs text-muted-foreground">
                                                {f.caf_folio_desde != null && f.caf_folio_hasta != null
                                                    ? `En el SII está en el rango ${f.caf_folio_desde} al ${f.caf_folio_hasta}.`
                                                    : null}
                                            </p>
                                            {esAdmin && (
                                                <Button size="sm" variant="outline" onClick={() => setAnulando(f)}>
                                                    Ya lo anulé
                                                </Button>
                                            )}
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        )}

                        <Link
                            href="/historial/rechazados/anular-folios"
                            data-section="rechazados.guia"
                            className="group flex items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/50 hover:bg-primary/5"
                        >
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                <BookOpen className="h-5 w-5" />
                            </span>
                            <span className="flex-1 space-y-0.5">
                                <span className="block font-semibold">Cómo anular un número en el SII</span>
                                <span className="block text-sm text-muted-foreground">
                                    Paso a paso, desde entrar al SII hasta confirmar la anulación.
                                </span>
                            </span>
                            <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
                        </Link>
                    </Seccion>
                </>
            )}

            <ReemitirDialog venta={reemitir} onClose={() => setReemitir(null)} onEmitida={cargar} />
            <ConfirmDialog
                open={!!anulando}
                onOpenChange={(abierto) => { if (!abierto) setAnulando(null) }}
                title={`¿Ya anuló el N° ${anulando?.folio} en el SII?`}
                description="Deja de aparecer en esta lista. Márquelo solo después de anularlo en el sitio del SII."
                confirmLabel="Sí, ya lo anulé"
                onConfirm={confirmarAnulado}
            />
        </PageContainer>
    )
}
