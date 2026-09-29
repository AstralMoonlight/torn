'use client'

import { useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { getApiErrorDetail } from '@/services/api'
import { reemitir, type SaleOut } from '@/services/sales'
import { AlertaError } from '@/components/ui/alerta-error'
import { Button } from '@/components/ui/button'
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
 * Vuelve a emitir un documento que el SII rechazó. La venta ya se cobró y ya
 * sacó los productos: solo sale un documento nuevo, con otro número.
 */
export default function ReemitirDialog({ venta, onClose, onEmitida }: Props) {
    const [enviando, setEnviando] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const cerrar = () => {
        setError(null)
        onClose()
    }

    const emitir = async () => {
        if (!venta) return
        setEnviando(true)
        setError(null)
        try {
            await reemitir(venta.id)
            cerrar()
            onEmitida()
        } catch (err) {
            setError(getApiErrorDetail(err, 'No se pudo emitir de nuevo.'))
        } finally {
            setEnviando(false)
        }
    }

    return (
        <Dialog open={!!venta} onOpenChange={(abierto) => { if (!abierto) cerrar() }}>
            <DialogContent data-section="historial.reemitir" className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <RefreshCw className="h-4 w-4" />
                        Emitir de nuevo
                    </DialogTitle>
                    <DialogDescription>
                        El SII rechazó el documento N° {venta?.folio}. Sale uno nuevo, con otro número, con los
                        mismos productos y el mismo total. No se cobra ni se descuentan productos otra vez.
                    </DialogDescription>
                </DialogHeader>

                {venta?.dte_glosa && (
                    <p className="rounded-md border border-border bg-muted/50 p-3 text-sm">
                        <span className="font-medium">Lo que dijo el SII:</span> {venta.dte_glosa}
                    </p>
                )}
                <p className="text-sm text-muted-foreground">
                    Si el problema es un dato del cliente (giro, dirección), corríjalo primero en Clientes.
                </p>

                <AlertaError mensaje={error} />
                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={cerrar}>Cancelar</Button>
                    <Button onClick={emitir} disabled={enviando} className="gap-1.5">
                        {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
                        Emitir de nuevo
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
