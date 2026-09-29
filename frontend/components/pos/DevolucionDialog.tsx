'use client'

import { useEffect, useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { getApiErrorDetail } from '@/services/api'
import { createReturn, type PaymentMethod, type SaleOut } from '@/services/sales'
import { AlertaError } from '@/components/ui/alerta-error'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SelectOpciones } from '@/components/ui/select-opciones'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'

interface Props {
    venta: SaleOut | null
    methods: PaymentMethod[]
    onClose: () => void
    onDevuelta: () => void
}

/**
 * Devolución de productos (nota de crédito) en palabras simples: qué vuelve,
 * por qué y cómo se devuelve el dinero. El código del SII lo decide el backend
 * (anula si vuelve todo, corrige montos si vuelve una parte).
 */
export default function DevolucionDialog({ venta, methods, onClose, onDevuelta }: Props) {
    const [cantidades, setCantidades] = useState<Record<number, string>>({})
    const [motivo, setMotivo] = useState('')
    const [methodId, setMethodId] = useState(0)
    const [enviando, setEnviando] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const todo = (v: SaleOut) => Object.fromEntries(v.details.map((d) => [d.product_id, String(Number(d.cantidad))]))

    useEffect(() => {
        if (!venta) return
        setCantidades(todo(venta))
        setMotivo('')
        setError(null)
        const efectivo = methods.find((m) => m.code === 'EFECTIVO')
        setMethodId(efectivo?.id ?? methods[0]?.id ?? 0)
    }, [venta, methods])

    const items = (venta?.details ?? [])
        .map((d) => ({ product_id: d.product_id, cantidad: Number(cantidades[d.product_id] || 0) }))
        .filter((i) => i.cantidad > 0)

    const devolver = async () => {
        if (!venta) return
        setEnviando(true)
        setError(null)
        try {
            await createReturn({ original_sale_id: venta.id, items, reason: motivo.trim(), return_method_id: methodId })
            onClose()
            onDevuelta()
        } catch (err) {
            setError(getApiErrorDetail(err, 'No se pudo hacer la devolución.'))
        } finally {
            setEnviando(false)
        }
    }

    return (
        <Dialog open={!!venta} onOpenChange={(abierto) => { if (!abierto) onClose() }}>
            <DialogContent data-section="historial.devolucion" className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <RotateCcw className="h-4 w-4 text-destructive" />
                        Devolver productos
                    </DialogTitle>
                    <DialogDescription>
                        Venta N° {venta?.folio}. Se emite una nota de crédito por lo que vuelve.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label>¿Qué vuelve?</Label>
                            <div className="flex gap-1">
                                <Button variant="ghost" size="sm" onClick={() => venta && setCantidades(todo(venta))}>Todo</Button>
                                <Button variant="ghost" size="sm" onClick={() => setCantidades({})}>Nada</Button>
                            </div>
                        </div>
                        {venta?.details.map((d) => (
                            <div key={d.product_id} className="flex items-center gap-2">
                                <span className="flex-1 truncate text-sm">{d.product?.nombre || `Producto ${d.product_id}`}</span>
                                <Input type="number" min={0} max={Number(d.cantidad)} step="any"
                                    aria-label={`Cantidad que vuelve de ${d.product?.nombre ?? d.product_id}`}
                                    value={cantidades[d.product_id] ?? ''}
                                    onChange={(e) => setCantidades({ ...cantidades, [d.product_id]: e.target.value })}
                                    className="h-10 w-20 text-right font-tabular" />
                                <span className="w-14 text-xs text-muted-foreground">de {Number(d.cantidad)}</span>
                            </div>
                        ))}
                    </div>

                    <div className="space-y-1.5">
                        <Label htmlFor="motivo-devolucion">¿Por qué?</Label>
                        <Input id="motivo-devolucion" value={motivo} maxLength={90}
                            placeholder="Ej: producto fallado" onChange={(e) => setMotivo(e.target.value)} />
                    </div>

                    <div className="space-y-1.5">
                        <Label>¿Cómo se devuelve el dinero?</Label>
                        <SelectOpciones value={methodId} onChange={(v) => setMethodId(Number(v))}
                            opciones={methods.map((m) => ({ value: m.id, label: m.name }))} />
                    </div>
                </div>

                <AlertaError mensaje={error} />
                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button variant="destructive" onClick={devolver}
                        disabled={enviando || items.length === 0 || !motivo.trim() || !methodId} className="gap-1.5">
                        {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
                        Devolver
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
