'use client'

import { useEffect, useState } from 'react'
import { Loader2, Mail } from 'lucide-react'
import { getApiErrorDetail } from '@/services/api'
import { reenviarXml, type SaleOut } from '@/services/sales'
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

/** Estado del envío del XML al correo del cliente, en palabras. */
export const ESTADOS_XML: Record<string, { label: string; color: string }> = {
    PENDIENTE: { label: 'XML por enviar', color: 'bg-sky-600' },
    ENVIADO: { label: 'XML enviado', color: 'bg-emerald-600' },
    SIN_CORREO: { label: 'Sin correo', color: 'bg-amber-500' },
    ERROR: { label: 'XML no enviado', color: 'bg-destructive' },
}

interface Props {
    venta: SaleOut | null
    onClose: () => void
    onEnviado: () => void
}

/** Manda (o vuelve a mandar) el XML y el PDF al correo del cliente. */
export default function ReenviarXmlDialog({ venta, onClose, onEnviado }: Props) {
    const [correo, setCorreo] = useState('')
    const [enviando, setEnviando] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!venta) return
        setCorreo(venta.customer?.email ?? '')
        setError(null)
    }, [venta])

    const enviar = async () => {
        if (!venta) return
        setEnviando(true)
        setError(null)
        try {
            await reenviarXml(venta.id, correo.trim())
            onClose()
            onEnviado()
        } catch (err) {
            setError(getApiErrorDetail(err, 'No se pudo mandar el XML.'))
        } finally {
            setEnviando(false)
        }
    }

    return (
        <Dialog open={!!venta} onOpenChange={(abierto) => { if (!abierto) onClose() }}>
            <DialogContent data-section="historial.reenviar-xml" className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <Mail className="h-4 w-4" />
                        Mandar el documento al cliente
                    </DialogTitle>
                    <DialogDescription>
                        N° {venta?.folio}. Se manda el XML y el PDF al correo que recibe sus facturas.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-1.5">
                    <Label htmlFor="correo-xml">Correo del cliente</Label>
                    <Input id="correo-xml" type="email" value={correo} maxLength={80}
                        placeholder="facturas@cliente.cl" onChange={(e) => setCorreo(e.target.value)} />
                </div>
                <AlertaError mensaje={error} />
                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={onClose}>Cancelar</Button>
                    <Button onClick={enviar} disabled={enviando || !correo.trim()} className="gap-1.5">
                        {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
                        Mandar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
