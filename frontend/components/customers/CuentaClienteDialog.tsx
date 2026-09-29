'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
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
import { getCuenta, registrarPago, type Customer, type CuentaCliente } from '@/services/customers'
import { getPaymentMethods, type PaymentMethod } from '@/services/sales'
import { formatCLP, formatDate } from '@/lib/format'

/**
 * Cuenta corriente del cliente: lo que debe, de dónde sale la deuda (ventas
 * fiadas y notas de crédito) y los pagos. Desde aquí se registra un pago.
 */
export default function CuentaClienteDialog({ customer, onClose }: {
    customer: Customer | null
    onClose: (actualizado?: Customer) => void
}) {
    const [cuenta, setCuenta] = useState<CuentaCliente | null>(null)
    const [medios, setMedios] = useState<PaymentMethod[]>([])
    const [monto, setMonto] = useState('')
    const [medio, setMedio] = useState<number | ''>('')
    const [nota, setNota] = useState('')
    const [guardando, setGuardando] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [actualizado, setActualizado] = useState<Customer | undefined>()

    const cargar = (rut: string) =>
        getCuenta(rut).then(setCuenta).catch((err) => setError(getApiErrorDetail(err, 'No se pudo cargar la cuenta.')))

    useEffect(() => {
        if (!customer) return
        setCuenta(null)
        setMonto('')
        setNota('')
        setError(null)
        setActualizado(undefined)
        cargar(customer.rut)
        getPaymentMethods().then((m) => {
            // El crédito interno es la deuda misma: no sirve para pagarla.
            const validos = m.filter((x) => x.code !== 'CREDITO_INTERNO')
            setMedios(validos)
            setMedio(validos.find((x) => x.code === 'EFECTIVO')?.id ?? validos[0]?.id ?? '')
        }).catch(() => setMedios([]))
    }, [customer])

    if (!customer) return null
    const saldo = Number(cuenta?.saldo ?? customer.current_balance)

    const pagar = async () => {
        setGuardando(true)
        setError(null)
        try {
            setActualizado(await registrarPago(customer.rut, Number(monto), Number(medio), nota.trim()))
            setMonto('')
            setNota('')
            await cargar(customer.rut)
        } catch (err) {
            setError(getApiErrorDetail(err, 'No se pudo registrar el pago.'))
        } finally {
            setGuardando(false)
        }
    }

    return (
        <Dialog open onOpenChange={(abierto) => { if (!abierto) onClose(actualizado) }}>
            <DialogContent data-section="clientes.cuenta" className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Cuenta de {customer.razon_social}</DialogTitle>
                    <DialogDescription>Ventas con crédito interno, notas de crédito y pagos.</DialogDescription>
                </DialogHeader>

                <div className="rounded-lg border border-border bg-muted/50 p-4">
                    <p className="text-sm text-muted-foreground">Debe</p>
                    <p className={`text-3xl font-bold font-tabular ${saldo > 0 ? 'text-destructive' : ''}`}>{formatCLP(saldo)}</p>
                </div>

                {saldo > 0 && (
                    <div className="space-y-3 rounded-lg border border-border p-4">
                        <p className="font-medium">Registrar pago</p>
                        <div className="grid gap-3 sm:grid-cols-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="pago-monto">Monto</Label>
                                <Input id="pago-monto" type="number" min={1} max={saldo} inputMode="numeric"
                                    value={monto} onChange={(e) => setMonto(e.target.value)} className="font-tabular" />
                                <button type="button" className="text-xs text-primary hover:underline"
                                    onClick={() => setMonto(String(saldo))}>
                                    Paga todo ({formatCLP(saldo)})
                                </button>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="pago-medio">Medio de pago</Label>
                                <SelectOpciones id="pago-medio" value={medio} onChange={setMedio}
                                    opciones={medios.map((m) => ({ value: m.id, label: m.name }))} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="pago-nota">Nota (opcional)</Label>
                                <Input id="pago-nota" value={nota} maxLength={200} onChange={(e) => setNota(e.target.value)} />
                            </div>
                        </div>
                        <div className="flex justify-end">
                            <Button onClick={pagar}
                                disabled={guardando || !medio || !(Number(monto) > 0) || Number(monto) > saldo}>
                                {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                                Registrar pago
                            </Button>
                        </div>
                    </div>
                )}

                <AlertaError mensaje={error} />

                <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                    <Table compacta>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Fecha</TableHead>
                                <TableHead>Detalle</TableHead>
                                <TableHead className="text-right">Debe más</TableHead>
                                <TableHead className="text-right">Pagó o abonó</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {cuenta === null ? (
                                <TableEmpty colSpan={4} loading />
                            ) : cuenta.movimientos.length === 0 ? (
                                <TableEmpty colSpan={4}>Sin movimientos de crédito</TableEmpty>
                            ) : cuenta.movimientos.map((m, i) => (
                                <TableRow key={i}>
                                    <TableCell className="text-xs">{formatDate(m.fecha)}</TableCell>
                                    <TableCell className="text-xs">{m.detalle}</TableCell>
                                    <TableCell className="text-right text-xs font-tabular">{Number(m.cargo) ? formatCLP(m.cargo) : ''}</TableCell>
                                    <TableCell className="text-right text-xs font-tabular">{Number(m.abono) ? formatCLP(m.abono) : ''}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </DialogContent>
        </Dialog>
    )
}
