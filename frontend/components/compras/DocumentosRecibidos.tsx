'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Download, Eye, FileUp, Inbox, PackagePlus, RefreshCw, ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertaError } from '@/components/ui/alerta-error'
import { AccionFila } from '@/components/ui/accion-fila'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SearchInput } from '@/components/ui/search-input'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { avisar } from '@/lib/store/uiStore'
import { fechaHora, formatCLP, formatDate } from '@/lib/format'
import { fetchBlobUrl, getApiErrorDetail } from '@/services/api'
import {
    actualizarRecibido, cargarRecibido, getEnviosConProblemas, getRecibido, getRecibidos, getRecibidoXmlPath,
    registrarAccion, type AccionRegistro, type EnvioRecibido, type Recibido, type RecibidoDetalle,
} from '@/services/recibidos'

const NOMBRES: Record<number, string> = {
    33: 'Factura', 34: 'Factura exenta', 43: 'Liquidación factura', 46: 'Factura de compra',
    52: 'Guía de despacho', 56: 'Nota de débito', 61: 'Nota de crédito',
}

/** Acciones del registro del SII, dichas como las diría la persona. */
const ACCIONES: Record<AccionRegistro, { titulo: string; opcion?: string; explicacion: string; boton: string }> = {
    ACD: {
        titulo: 'Aceptar la factura',
        explicacion: 'Le avisa al SII que la factura está bien. Después ya no se puede reclamar.',
        boton: 'Aceptar',
    },
    ERM: {
        titulo: 'Recibí la mercadería',
        explicacion: 'Le avisa al SII que la mercadería o el servicio llegó completo. Después ya no se puede reclamar.',
        boton: 'Recibí la mercadería',
    },
    RCD: {
        titulo: 'Reclamar: la factura está mal',
        opcion: 'La factura está mal',
        explicacion: 'Precios, cantidades o datos equivocados. El proveedor tendrá que corregirla con una nota de crédito.',
        boton: 'Reclamar',
    },
    RFP: {
        titulo: 'Reclamar: faltó parte de la mercadería',
        opcion: 'Faltó parte de la mercadería',
        explicacion: 'Llegó incompleta. El proveedor tendrá que emitir una nota de crédito por lo que faltó.',
        boton: 'Reclamar',
    },
    RFT: {
        titulo: 'Reclamar: no llegó la mercadería',
        opcion: 'No llegó la mercadería',
        explicacion: 'No llegó nada. El proveedor tendrá que anular la factura con una nota de crédito.',
        boton: 'Reclamar',
    },
}

/** Por qué un correo de un proveedor llegó con problemas (`EstadoRecepEnv` del SII). */
function problema(envio: EnvioRecibido): string {
    if (envio.acuse_estado === 'ERROR') return 'no se le pudo avisar al proveedor que lo recibimos.'
    switch (envio.estado) {
        case 1: return 'el archivo no cumple el formato del SII. Si trae facturas, igual aparecen abajo.'
        case 2: return 'la firma no se pudo comprobar. Antes de pagar, revise en el SII que la factura exista.'
        case 3: return 'venía dirigido a otra empresa. No se guardó.'
        case 91: return 'el archivo no se pudo leer. Pídale al proveedor que lo vuelva a mandar.'
        default: return envio.glosa
    }
}

function diasRestantes(plazo: string): number {
    return Math.ceil((new Date(plazo).getTime() - Date.now()) / 86_400_000)
}

/** En qué va el documento, en palabras. */
function EstadoRecibido({ doc }: { doc: Recibido }) {
    if (doc.estado_registro === 'ACEPTADO') return <Badge className="bg-emerald-600">Aceptada</Badge>
    if (doc.estado_registro === 'RECLAMADO') return <Badge variant="destructive">Reclamada</Badge>
    if (!doc.con_registro || !doc.plazo) return <Badge variant="secondary">Recibido</Badge>
    const dias = diasRestantes(doc.plazo)
    if (dias <= 0) return <Badge className="bg-emerald-600" title="Pasaron 8 días sin reclamo: la ley la da por aceptada">Aceptada por plazo</Badge>
    return (
        <Badge className={dias <= 2 ? 'bg-amber-500' : 'bg-sky-600'} title={`Hasta el ${fechaHora(doc.plazo)}${doc.plazo_aproximado ? ' (aproximado)' : ''}`}>
            Por responder: {dias === 1 ? 'queda 1 día' : `quedan ${dias} días`}
        </Badge>
    )
}

interface Props {
    /** Llena "Nuevo ingreso" con el documento para ingresarlo al stock. */
    onIngresar: (doc: RecibidoDetalle) => void
}

export default function DocumentosRecibidos({ onIngresar }: Props) {
    const [docs, setDocs] = useState<Recibido[]>([])
    const [problemas, setProblemas] = useState<EnvioRecibido[]>([])
    const [soloPorResponder, setSoloPorResponder] = useState(false)
    const [q, setQ] = useState('')
    const [cargando, setCargando] = useState(false)
    const [subiendo, setSubiendo] = useState(false)
    const [detalle, setDetalle] = useState<RecibidoDetalle | null>(null)
    const [errorDetalle, setErrorDetalle] = useState<string | null>(null)
    const [accion, setAccion] = useState<AccionRegistro | null>(null)
    const [eligiendoReclamo, setEligiendoReclamo] = useState(false)
    const archivo = useRef<HTMLInputElement>(null)

    const cargar = useCallback(async () => {
        setCargando(true)
        try {
            const [lista, conProblemas] = await Promise.all([
                getRecibidos({ q: q.trim() || undefined, sin_responder: soloPorResponder || undefined }),
                getEnviosConProblemas(),
            ])
            setDocs(lista)
            setProblemas(conProblemas)
        } catch (err) {
            avisar(getApiErrorDetail(err, 'No se pudieron cargar los documentos recibidos.'), { reintentar: cargar })
        } finally {
            setCargando(false)
        }
    }, [q, soloPorResponder])

    useEffect(() => {
        const t = setTimeout(cargar, q ? 300 : 0)
        return () => clearTimeout(t)
    }, [cargar, q])

    const abrir = async (id: string) => {
        setErrorDetalle(null)
        try {
            setDetalle(await getRecibido(id))
        } catch (err) {
            avisar(getApiErrorDetail(err, 'No se pudo abrir el documento.'))
        }
    }

    const reemplazar = (doc: Recibido) => {
        setDocs(prev => prev.map(d => (d.id === doc.id ? doc : d)))
        setDetalle(prev => (prev && prev.id === doc.id ? { ...prev, ...doc } : prev))
    }

    const confirmarAccion = async () => {
        if (!detalle || !accion) return
        setErrorDetalle(null)
        try {
            reemplazar(await registrarAccion(detalle.id, accion))
        } catch (err) {
            setErrorDetalle(getApiErrorDetail(err, 'El SII no registró la respuesta. Intente de nuevo en unos minutos.'))
        }
    }

    const consultarSii = async () => {
        if (!detalle) return
        setErrorDetalle(null)
        try {
            reemplazar(await actualizarRecibido(detalle.id))
        } catch (err) {
            setErrorDetalle(getApiErrorDetail(err, 'No se pudo consultar al SII.'))
        }
    }

    const descargarXml = async (id: string) => {
        try {
            const url = await fetchBlobUrl(getRecibidoXmlPath(id))
            window.open(url, '_blank')
            setTimeout(() => URL.revokeObjectURL(url), 60000)
        } catch (err) {
            avisar(getApiErrorDetail(err, 'No se pudo descargar el XML.'))
        }
    }

    const subir = async (file: File | undefined) => {
        if (!file) return
        setSubiendo(true)
        try {
            const carga = await cargarRecibido(file)
            if (!carga.nuevo) {
                avisar('Ese archivo ya estaba cargado.', { tipo: 'info' })
            } else if (carga.documentos.length === 0) {
                avisar(`No se cargó ningún documento: ${carga.envio.glosa}`)
            }
            await cargar()
        } catch (err) {
            avisar(getApiErrorDetail(err, 'No se pudo cargar el archivo.'))
        } finally {
            setSubiendo(false)
            if (archivo.current) archivo.current.value = ''
        }
    }

    const puedeResponder = detalle?.con_registro && !detalle.estado_registro
        && !!detalle.plazo && diasRestantes(detalle.plazo) > 0

    return (
        <div className="space-y-4">
            {problemas.length > 0 && (
                <Alert variant="destructive">
                    <ShieldAlert className="h-4 w-4" />
                    <AlertTitle>{problemas.length === 1 ? 'Un correo de un proveedor llegó con problemas' : `${problemas.length} correos de proveedores llegaron con problemas`}</AlertTitle>
                    <AlertDescription>
                        <ul className="mt-1 space-y-1 text-sm">
                            {problemas.slice(0, 5).map(p => (
                                <li key={p.id}>
                                    <span title={p.acuse_error || p.glosa}>
                                        {p.razon_social_emisor || p.correo_origen || p.nombre_archivo} ({fechaHora(p.recibido_en)}): {problema(p)}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </AlertDescription>
                </Alert>
            )}

            <Card className="shadow-sm">
                <CardContent className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
                    <SearchInput
                        className="flex-1"
                        placeholder="Buscar por proveedor, RUT o número"
                        value={q}
                        onChange={e => setQ(e.target.value)}
                        onClear={() => setQ('')}
                    />
                    <div className="flex gap-2">
                        <Button variant={soloPorResponder ? 'default' : 'outline'} onClick={() => setSoloPorResponder(v => !v)}>
                            Por responder
                        </Button>
                        <Button variant="outline" onClick={() => archivo.current?.click()} disabled={subiendo}>
                            <FileUp className="h-4 w-4 mr-2" /> {subiendo ? 'Cargando...' : 'Cargar XML'}
                        </Button>
                        <input ref={archivo} type="file" accept=".xml,application/xml,text/xml" className="hidden"
                            onChange={e => subir(e.target.files?.[0])} />
                        <Button variant="ghost" size="icon" title="Actualizar" aria-label="Actualizar" onClick={cargar} disabled={cargando}>
                            <RefreshCw className={`h-4 w-4 ${cargando ? 'animate-spin' : ''}`} />
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <p className="text-sm text-muted-foreground">
                Las facturas de proveedores llegan solas a la casilla de intercambio. Tiene 8 días para reclamar una
                factura mal hecha; si no hace nada, la ley la da por aceptada.
            </p>

            <Card className="shadow-sm overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Proveedor</TableHead>
                            <TableHead>Documento</TableHead>
                            <TableHead className="hidden md:table-cell">Fecha</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {docs.length === 0 ? (
                            <TableEmpty colSpan={6} loading={cargando}>
                                <Inbox className="mx-auto mb-2 h-8 w-8 opacity-30" />
                                {soloPorResponder ? 'No hay facturas por responder.' : 'Todavía no llegan documentos de proveedores.'}
                            </TableEmpty>
                        ) : docs.map(doc => (
                            <TableRow key={doc.id}>
                                <TableCell>
                                    <div className="font-medium">{doc.razon_social_emisor}</div>
                                    <div className="text-xs text-muted-foreground font-tabular">{doc.rut_emisor}</div>
                                </TableCell>
                                <TableCell>
                                    {NOMBRES[doc.tipo_dte] ?? `Documento ${doc.tipo_dte}`} N° {doc.folio}
                                    {doc.compra_id && <div className="text-xs text-emerald-700 dark:text-emerald-400">Ingresada (compra N° {doc.compra_id})</div>}
                                </TableCell>
                                <TableCell className="hidden md:table-cell font-tabular">{formatDate(doc.fecha_emision)}</TableCell>
                                <TableCell className="text-right font-tabular font-semibold">{formatCLP(doc.monto_total)}</TableCell>
                                <TableCell><EstadoRecibido doc={doc} /></TableCell>
                                <TableCell className="text-right">
                                    <div className="flex justify-end gap-1">
                                        <AccionFila icon={Eye} label="Ver y responder" onClick={() => abrir(doc.id)} />
                                        <AccionFila icon={Download} label="Descargar XML" onClick={() => descargarXml(doc.id)} />
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </Card>

            <Dialog open={!!detalle} onOpenChange={o => !o && setDetalle(null)}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    {detalle && (
                        <>
                            <DialogHeader>
                                <DialogTitle>
                                    {NOMBRES[detalle.tipo_dte] ?? `Documento ${detalle.tipo_dte}`} N° {detalle.folio}
                                </DialogTitle>
                                <DialogDescription>
                                    {detalle.razon_social_emisor} · RUT {detalle.rut_emisor} · emitida el {formatDate(detalle.fecha_emision)}
                                </DialogDescription>
                            </DialogHeader>

                            <div className="space-y-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <EstadoRecibido doc={detalle} />
                                    {detalle.con_registro && detalle.plazo && !detalle.estado_registro && diasRestantes(detalle.plazo) > 0 && (
                                        <span className="text-sm text-muted-foreground">
                                            Puede responder hasta el {fechaHora(detalle.plazo)}{detalle.plazo_aproximado && ' (aproximado)'}
                                        </span>
                                    )}
                                </div>

                                {!detalle.firma_valida && (
                                    <Alert variant="destructive">
                                        <AlertTriangle className="h-4 w-4" />
                                        <AlertDescription>
                                            La firma del correo no se pudo comprobar. Antes de pagarla, revise en el SII que esta
                                            factura exista.
                                        </AlertDescription>
                                    </Alert>
                                )}

                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Detalle</TableHead>
                                            <TableHead className="text-right">Cantidad</TableHead>
                                            <TableHead className="text-right">Costo unitario</TableHead>
                                            <TableHead className="text-right">Total</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {detalle.lineas.map((l, i) => (
                                            <TableRow key={i}>
                                                <TableCell>
                                                    {l.nombre}{l.exento && ' (exento)'}
                                                    {l.codigo && <span className="text-xs text-muted-foreground ml-2">{l.codigo}</span>}
                                                </TableCell>
                                                <TableCell className="text-right font-tabular">{Number(l.cantidad).toLocaleString('es-CL')} {l.unidad}</TableCell>
                                                <TableCell className="text-right font-tabular">{formatCLP(l.costo_unitario)}</TableCell>
                                                <TableCell className="text-right font-tabular">{formatCLP(l.monto)}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>

                                <div className="ml-auto w-full sm:w-64 space-y-1 text-sm font-tabular">
                                    {detalle.monto_neto > 0 && <div className="flex justify-between"><span>Neto</span><span>{formatCLP(detalle.monto_neto)}</span></div>}
                                    {detalle.monto_exento > 0 && <div className="flex justify-between"><span>Exento</span><span>{formatCLP(detalle.monto_exento)}</span></div>}
                                    {detalle.monto_iva > 0 && <div className="flex justify-between"><span>IVA</span><span>{formatCLP(detalle.monto_iva)}</span></div>}
                                    <div className="flex justify-between font-semibold text-base border-t pt-1"><span>Total</span><span>{formatCLP(detalle.monto_total)}</span></div>
                                </div>

                                {(detalle.eventos?.length ?? 0) > 0 && (
                                    <div className="text-sm">
                                        <p className="font-medium mb-1">Lo que dice el SII</p>
                                        <ul className="space-y-1 text-muted-foreground">
                                            {detalle.eventos!.map((e, i) => (
                                                <li key={i}>{e.fecha ? fechaHora(e.fecha) : ''} · {e.descripcion || e.codigo}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {detalle.accion_actor && (
                                    <p className="text-sm text-muted-foreground">
                                        Respondida por {detalle.accion_actor}{detalle.accion_at && ` el ${fechaHora(detalle.accion_at)}`}.
                                    </p>
                                )}

                                {eligiendoReclamo && (
                                    <div className="space-y-2 rounded-lg border p-3">
                                        <p className="font-medium">¿Qué pasó con esta factura?</p>
                                        {(['RCD', 'RFP', 'RFT'] as AccionRegistro[]).map(a => (
                                            <Button key={a} variant="outline" className="w-full justify-start h-auto py-2 text-left whitespace-normal"
                                                onClick={() => { setEligiendoReclamo(false); setAccion(a) }}>
                                                <span>
                                                    <span className="block font-medium">{ACCIONES[a].opcion}</span>
                                                    <span className="block text-xs text-muted-foreground">{ACCIONES[a].explicacion}</span>
                                                </span>
                                            </Button>
                                        ))}
                                    </div>
                                )}

                                <AlertaError mensaje={errorDetalle} />
                            </div>

                            <DialogFooter className="flex-col sm:flex-row gap-2">
                                {detalle.con_registro && detalle.estado_registro == null && (
                                    <Button variant="ghost" onClick={consultarSii}>
                                        <RefreshCw className="h-4 w-4 mr-2" /> Consultar al SII
                                    </Button>
                                )}
                                {puedeResponder && (
                                    <>
                                        <Button variant="outline" className="text-destructive" onClick={() => setEligiendoReclamo(v => !v)}>
                                            Reclamar
                                        </Button>
                                        <Button variant="outline" onClick={() => setAccion('ERM')}>Recibí la mercadería</Button>
                                        <Button variant="outline" onClick={() => setAccion('ACD')}>Aceptar</Button>
                                    </>
                                )}
                                {detalle.compra_id == null && detalle.estado_registro !== 'RECLAMADO' && (
                                    <Button onClick={() => { onIngresar(detalle); setDetalle(null) }}>
                                        <PackagePlus className="h-4 w-4 mr-2" /> Ingresar al stock
                                    </Button>
                                )}
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={!!accion}
                onOpenChange={o => !o && setAccion(null)}
                title={accion ? ACCIONES[accion].titulo : ''}
                description={accion && (
                    <>
                        {ACCIONES[accion].explicacion} Queda registrado en el SII y no se puede deshacer.
                    </>
                )}
                confirmLabel={accion ? ACCIONES[accion].boton : ''}
                onConfirm={confirmarAccion}
            />
        </div>
    )
}
