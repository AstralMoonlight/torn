'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { FileText, Loader2 } from 'lucide-react'
import { getApiErrorDetail } from '@/services/api'
import { facturarGuias, getGuiasPendientes, type PaymentMethod, type SaleOut } from '@/services/sales'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { formatCLP } from '@/lib/format'

interface Props {
    open: boolean
    methods: PaymentMethod[]
    onClose: () => void
    onFacturada: () => void
}

/** Factura una o varias guías pendientes de un mismo cliente, con sus líneas y precios. */
export default function FacturarGuiasDialog({ open, methods, onClose, onFacturada }: Props) {
    const [guias, setGuias] = useState<SaleOut[]>([])
    const [customerId, setCustomerId] = useState<number | null>(null)
    const [seleccion, setSeleccion] = useState<number[]>([])
    const [tipoDte, setTipoDte] = useState(33)
    const [methodId, setMethodId] = useState<number>(0)
    const [enviando, setEnviando] = useState(false)

    useEffect(() => {
        if (!open) return
        setSeleccion([])
        getGuiasPendientes()
            .then((g) => {
                setGuias(g)
                setCustomerId(g[0]?.customer.id ?? null)
            })
            .catch((err) => toast.error(getApiErrorDetail(err, 'No se pudieron cargar las guías.')))
        if (methods.length > 0) setMethodId(methods[0].id)
    }, [open, methods])

    const clientes = useMemo(
        () => [...new Map(guias.map((g) => [g.customer.id, g.customer])).values()],
        [guias],
    )
    const delCliente = guias.filter((g) => g.customer.id === customerId)
    // Referencial: la factura recalcula el IVA sobre el total de líneas.
    const total = delCliente.filter((g) => seleccion.includes(g.id)).reduce((s, g) => s + Number(g.monto_total), 0)

    const alternar = (id: number) =>
        setSeleccion((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

    const facturar = async () => {
        setEnviando(true)
        try {
            const factura = await facturarGuias(seleccion, tipoDte, methodId)
            toast.success(`Factura folio #${factura.folio} emitida por ${formatCLP(Number(factura.monto_total))}`)
            onFacturada()
            onClose()
        } catch (err) {
            toast.error(getApiErrorDetail(err, 'No se pudo facturar.'))
        } finally {
            setEnviando(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogContent data-section="historial.facturar-guias" className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <FileText className="h-4 w-4" /> Facturar guías de despacho
                    </DialogTitle>
                    <DialogDescription>
                        La factura toma las líneas y precios de las guías y las referencia. No vuelve a descontar stock.
                    </DialogDescription>
                </DialogHeader>

                {guias.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">No hay guías pendientes de facturar.</p>
                ) : (
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label className="text-xs">Cliente</Label>
                            <select
                                value={customerId ?? ''}
                                onChange={(e) => { setCustomerId(Number(e.target.value)); setSeleccion([]) }}
                                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                            >
                                {clientes.map((c) => (
                                    <option key={c.id} value={c.id}>{c.razon_social} ({c.rut})</option>
                                ))}
                            </select>
                        </div>

                        <div className="max-h-56 space-y-1 overflow-auto rounded-md border border-border p-2">
                            {delCliente.map((g) => (
                                <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-accent">
                                    <input type="checkbox" checked={seleccion.includes(g.id)} onChange={() => alternar(g.id)} />
                                    <span className="font-mono font-semibold">#{g.folio}</span>
                                    <span className="text-muted-foreground">
                                        {new Date(g.fecha_emision).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}
                                    </span>
                                    <span className="ml-auto font-tabular">{formatCLP(Number(g.monto_total))}</span>
                                </label>
                            ))}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                                <Label className="text-xs">Documento</Label>
                                <select
                                    value={tipoDte}
                                    onChange={(e) => setTipoDte(Number(e.target.value))}
                                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                                >
                                    <option value={33}>Factura (33)</option>
                                    <option value={34}>Factura Exenta (34)</option>
                                </select>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="text-xs">Medio de pago</Label>
                                <select
                                    value={methodId}
                                    onChange={(e) => setMethodId(Number(e.target.value))}
                                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                                >
                                    {methods.map((m) => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {seleccion.length > 0 && (
                            <p className="text-right text-sm">
                                <span className="text-muted-foreground">Total guías: </span>
                                <span className="font-semibold font-tabular">{formatCLP(total)}</span>
                            </p>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={onClose} className="text-xs">Cancelar</Button>
                    <Button onClick={facturar} disabled={enviando || seleccion.length === 0 || !methodId} className="gap-1.5 text-xs">
                        {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                        Emitir factura
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
