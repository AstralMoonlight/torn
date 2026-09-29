'use client'

import { useState } from 'react'
import { Loader2, PencilLine } from 'lucide-react'
import { getApiErrorDetail } from '@/services/api'
import { corregirTexto, type SaleOut } from '@/services/sales'
import { AlertaError } from '@/components/ui/alerta-error'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
    onClose: () => void
    onEmitida: () => void
}

/**
 * Nota de crédito que corrige un dato escrito (giro, dirección...) de una
 * factura. No devuelve dinero ni productos: el total es $0.
 */
export default function CorregirTextoDialog({ venta, onClose, onEmitida }: Props) {
    const [dondeDice, setDondeDice] = useState('')
    const [debeDecir, setDebeDecir] = useState('')
    const [enviando, setEnviando] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const cerrar = () => {
        setDondeDice('')
        setDebeDecir('')
        setError(null)
        onClose()
    }

    const emitir = async () => {
        if (!venta) return
        setEnviando(true)
        setError(null)
        try {
            await corregirTexto(venta.id, dondeDice.trim(), debeDecir.trim())
            cerrar()
            onEmitida()
        } catch (err) {
            setError(getApiErrorDetail(err, 'No se pudo emitir la nota de crédito.'))
        } finally {
            setEnviando(false)
        }
    }

    return (
        <Dialog open={!!venta} onOpenChange={(abierto) => { if (!abierto) cerrar() }}>
            <DialogContent data-section="historial.corregir-texto" className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <PencilLine className="h-4 w-4" />
                        Corregir un dato de la factura
                    </DialogTitle>
                    <DialogDescription>
                        Factura N° {venta?.folio}. Se emite una nota de crédito por $0: no devuelve dinero ni productos.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label htmlFor="donde-dice">Dónde dice</Label>
                        <Input id="donde-dice" value={dondeDice} maxLength={400}
                            placeholder="Ej: Giro: Ferreteria"
                            onChange={(e) => setDondeDice(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="debe-decir">Debe decir</Label>
                        <Input id="debe-decir" value={debeDecir} maxLength={400}
                            placeholder="Ej: Giro: Ferreteria y pinturas"
                            onChange={(e) => setDebeDecir(e.target.value)} />
                    </div>
                </div>

                <AlertaError mensaje={error} />
                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={cerrar}>Cancelar</Button>
                    <Button onClick={emitir} disabled={enviando || !dondeDice.trim() || !debeDecir.trim()} className="gap-1.5">
                        {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
                        Emitir nota de crédito
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
