'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Info, Loader2, Printer, RefreshCw } from 'lucide-react'
import { getApiErrorDetail } from '@/services/api'
import { imprimirVenta, reemitir, type SaleOut } from '@/services/sales'
import { AlertaError } from '@/components/ui/alerta-error'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
 * sacó los productos: solo sale un documento nuevo. dte-torn reutiliza el
 * número del rechazado si puede; si no, sale con otro y el anterior queda en
 * "Documentos rechazados" para anularlo en el SII.
 */
export default function ReemitirDialog({ venta, onClose, onEmitida }: Props) {
    const [enviando, setEnviando] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [emitida, setEmitida] = useState<SaleOut | null>(null)

    const cerrar = () => {
        setError(null)
        setEmitida(null)
        onClose()
    }

    const emitir = async () => {
        if (!venta) return
        setEnviando(true)
        setError(null)
        try {
            setEmitida(await reemitir(venta.id))
            onEmitida()
        } catch (err) {
            setError(getApiErrorDetail(err, 'No se pudo emitir de nuevo.'))
        } finally {
            setEnviando(false)
        }
    }

    const imprimir = async () => {
        if (!emitida) return
        setError(null)
        try {
            await imprimirVenta(emitida.id)
        } catch (err) {
            setError(getApiErrorDetail(err, 'No se pudo abrir el documento.'))
        }
    }

    const mismoNumero = emitida && venta && emitida.folio === venta.folio

    return (
        <Dialog open={!!venta} onOpenChange={(abierto) => { if (!abierto) cerrar() }}>
            <DialogContent data-section="historial.reemitir" className="sm:max-w-md">
                {emitida ? (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-base">
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                Documento emitido de nuevo
                            </DialogTitle>
                            <DialogDescription>
                                {mismoNumero
                                    ? `Salió con el mismo número, N° ${emitida.folio}.`
                                    : `Salió con el N° ${emitida.folio}.`}
                                {' '}Imprímalo y entrégueselo al cliente: el que se rechazó no tiene validez.
                            </DialogDescription>
                        </DialogHeader>
                        {!mismoNumero && (
                            <Alert>
                                <Info className="h-4 w-4" />
                                <AlertTitle>Queda un paso en el SII</AlertTitle>
                                <AlertDescription>
                                    El N° {venta?.folio} ya no se podía usar y hay que anularlo en el sitio del SII.
                                    Lo encuentra en{' '}
                                    <Link href="/historial/rechazados" className="font-medium underline" onClick={cerrar}>
                                        Documentos rechazados
                                    </Link>, con los pasos a seguir.
                                </AlertDescription>
                            </Alert>
                        )}
                        <AlertaError mensaje={error} />
                        <DialogFooter className="gap-2 sm:gap-0">
                            <Button variant="outline" onClick={cerrar}>Cerrar</Button>
                            <Button onClick={imprimir} className="gap-1.5">
                                <Printer className="h-4 w-4" /> Imprimir
                            </Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2 text-base">
                                <RefreshCw className="h-4 w-4" />
                                Emitir de nuevo
                            </DialogTitle>
                            <DialogDescription>
                                El SII rechazó el documento N° {venta?.folio}. Se emite otra vez con los mismos
                                productos y el mismo total. No se cobra ni se descuentan productos de nuevo.
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
                    </>
                )}
            </DialogContent>
        </Dialog>
    )
}
