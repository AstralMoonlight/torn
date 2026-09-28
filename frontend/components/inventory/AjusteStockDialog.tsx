'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertaError } from '@/components/ui/alerta-error'
import { SelectOpciones } from '@/components/ui/select-opciones'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableEmpty } from '@/components/ui/table'
import { getApiErrorDetail } from '@/services/api'
import { ajustarStock, getMovimientos, type MotivoAjuste, type Product, type StockMovement } from '@/services/products'
import { formatDate } from '@/lib/format'

const MOTIVOS: { value: MotivoAjuste; label: string }[] = [
    { value: 'CONTEO', label: 'Conteo (toma de inventario)' },
    { value: 'MERMA', label: 'Merma o pérdida' },
    { value: 'INICIAL', label: 'Stock inicial' },
    { value: 'AJUSTE', label: 'Otro' },
]

/** Nombre de cada motivo en el kardex, en palabras del día a día. */
const MOTIVO_TEXTO: Record<string, string> = {
    VENTA: 'Venta', GUIA: 'Guía', DEVOLUCION: 'Devolución', COMPRA: 'Compra',
    CONTEO: 'Conteo', MERMA: 'Merma', INICIAL: 'Stock inicial', AJUSTE: 'Ajuste',
}

const numero = (v: string | null) => (v === null ? '' : Number(v).toLocaleString('es-CL'))

/**
 * Ajuste de stock: se pregunta cuántas hay ahora y el sistema anota la
 * diferencia en el kardex. Debajo, los últimos movimientos del producto.
 */
export default function AjusteStockDialog({ product, onClose }: {
    product: Product | null
    onClose: (cambio?: boolean) => void
}) {
    const [contadas, setContadas] = useState('')
    const [motivo, setMotivo] = useState<MotivoAjuste>('CONTEO')
    const [nota, setNota] = useState('')
    const [guardando, setGuardando] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [movimientos, setMovimientos] = useState<StockMovement[] | null>(null)

    useEffect(() => {
        if (!product) return
        setContadas('')
        setMotivo(Number(product.stock_actual) === 0 ? 'INICIAL' : 'CONTEO')
        setNota('')
        setError(null)
        setMovimientos(null)
        getMovimientos(product.id).then(setMovimientos).catch(() => setMovimientos([]))
    }, [product])

    if (!product) return null
    const actual = Number(product.stock_actual)
    const diferencia = contadas === '' ? null : Number(contadas) - actual

    const guardar = async () => {
        setGuardando(true)
        setError(null)
        try {
            await ajustarStock(product.id, Number(contadas), motivo, nota.trim())
            onClose(true)
        } catch (err) {
            setError(getApiErrorDetail(err, 'No se pudo ajustar el stock.'))
        } finally {
            setGuardando(false)
        }
    }

    return (
        <Dialog open onOpenChange={(abierto) => { if (!abierto) onClose() }}>
            <DialogContent data-section="inventario.ajustar-stock" className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Ajustar stock</DialogTitle>
                    <DialogDescription>
                        {product.full_name}. El sistema dice que hay <strong>{numero(product.stock_actual)}</strong>.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="ajuste-contadas">¿Cuántas hay ahora?</Label>
                        <Input id="ajuste-contadas" type="number" min={0} inputMode="decimal" autoFocus
                            value={contadas} onChange={(e) => setContadas(e.target.value)} className="text-lg font-tabular" />
                        {diferencia !== null && !Number.isNaN(diferencia) && (
                            <p className="text-sm text-muted-foreground">
                                {diferencia === 0 ? 'Sin diferencia: no se anota nada.'
                                    : diferencia > 0 ? `Entran ${numero(String(diferencia))}` : `Salen ${numero(String(-diferencia))}`}
                            </p>
                        )}
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="ajuste-motivo">Motivo</Label>
                        <SelectOpciones id="ajuste-motivo" value={motivo}
                            onChange={(v) => v && setMotivo(v)} opciones={MOTIVOS} />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="ajuste-nota">Nota (opcional)</Label>
                        <Input id="ajuste-nota" value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)}
                            placeholder="Ej: se quebraron 2 en la bodega" />
                    </div>
                </div>

                <div className="space-y-2">
                    <p className="text-sm font-medium">Últimos movimientos</p>
                    <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                        <Table compacta>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Fecha</TableHead>
                                    <TableHead>Motivo</TableHead>
                                    <TableHead className="text-right">Cantidad</TableHead>
                                    <TableHead className="text-right">Saldo</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {movimientos === null ? (
                                    <TableEmpty colSpan={4} loading />
                                ) : movimientos.length === 0 ? (
                                    <TableEmpty colSpan={4}>Sin movimientos</TableEmpty>
                                ) : movimientos.slice(0, 20).map((m) => (
                                    <TableRow key={m.id}>
                                        <TableCell className="text-xs">{formatDate(m.fecha)}</TableCell>
                                        <TableCell className="text-xs" title={m.description || undefined}>
                                            {MOTIVO_TEXTO[m.motivo] || m.motivo}
                                            {m.description && <span className="block text-muted-foreground truncate max-w-[180px]">{m.description}</span>}
                                        </TableCell>
                                        <TableCell className={`text-right text-xs font-tabular ${m.tipo === 'SALIDA' ? 'text-destructive' : ''}`}>
                                            {m.tipo === 'SALIDA' ? '-' : '+'}{numero(m.cantidad)}
                                        </TableCell>
                                        <TableCell className="text-right text-xs font-tabular">{numero(m.balance_after)}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </div>

                <AlertaError mensaje={error} />
                <DialogFooter>
                    <Button variant="outline" onClick={() => onClose()}>Cancelar</Button>
                    <Button onClick={guardar} disabled={guardando || contadas === '' || Number(contadas) < 0}>
                        {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                        Guardar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
