'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CreditCard } from 'lucide-react'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import ListToolbar from '@/components/layout/ListToolbar'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getPagos, type Pago } from '@/services/saas'
import { getApiErrorMessage } from '@/services/api'
import { avisar } from '@/lib/store/uiStore'
import { formatCLP, formatDate } from '@/lib/format'

const MEDIOS = { PASARELA: 'Flow', TRANSFERENCIA: 'Transferencia', EFECTIVO: 'Efectivo' } as const
const ESTADOS = [
    { valor: '', texto: 'Todos' },
    { valor: 'PAGADO', texto: 'Pagados' },
    { valor: 'PENDIENTE', texto: 'Pendientes' },
    { valor: 'FALLIDO', texto: 'Fallidos' },
    { valor: 'ANULADO', texto: 'Anulados' },
] as const
const TEXTO_ESTADO = { PENDIENTE: 'Pendiente', PAGADO: 'Pagado', FALLIDO: 'Fallido', ANULADO: 'Anulado' } as const

export default function PagosPage() {
    const [pagos, setPagos] = useState<Pago[]>([])
    const [cargando, setCargando] = useState(true)
    const [estado, setEstado] = useState<string>('')
    const [busqueda, setBusqueda] = useState('')

    useEffect(() => {
        getPagos(estado ? { estado } : {})
            .then(setPagos)
            .catch((e) => avisar(getApiErrorMessage(e, 'No se pudieron cargar los pagos.')))
            .finally(() => setCargando(false))
    }, [estado])

    const q = busqueda.trim().toLowerCase()
    const visibles = pagos.filter((p) => !q || p.empresa.toLowerCase().includes(q))
    const total = visibles.filter((p) => p.estado === 'PAGADO').reduce((s, p) => s + p.monto, 0)

    return (
        <PageContainer>
            <PageHeader icon={CreditCard} title="Pagos" description="Los pagos se registran desde la ficha de cada empresa." />
            <ListToolbar
                busqueda={busqueda}
                onBusqueda={setBusqueda}
                placeholder="Buscar por empresa..."
                visibles={visibles.length}
                total={pagos.length}
                unidad="pagos"
                filtros={ESTADOS.map((e) => (
                    <Button key={e.valor} size="sm" variant={estado === e.valor ? 'secondary' : 'ghost'}
                        aria-pressed={estado === e.valor} onClick={() => { if (estado !== e.valor) { setCargando(true); setEstado(e.valor) } }}>
                        {e.texto}
                    </Button>
                ))}
            />
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Fecha</TableHead>
                            <TableHead>Empresa</TableHead>
                            <TableHead>Plan</TableHead>
                            <TableHead>Medio</TableHead>
                            <TableHead className="text-right">Monto</TableHead>
                            <TableHead className="hidden md:table-cell">Período</TableHead>
                            <TableHead>Estado</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {cargando && <TableEmpty colSpan={7} loading />}
                        {!cargando && visibles.length === 0 && <TableEmpty colSpan={7}>No hay pagos.</TableEmpty>}
                        {!cargando && visibles.map((p) => (
                            <TableRow key={p.id}>
                                <TableCell className="font-tabular whitespace-nowrap">{formatDate(p.pagado_at ?? p.created_at)}</TableCell>
                                <TableCell>
                                    <Link href={`/saas-admin/empresas/${p.tenant_id}`} className="font-medium hover:text-primary hover:underline">{p.empresa}</Link>
                                </TableCell>
                                <TableCell>{p.plan}</TableCell>
                                <TableCell>{MEDIOS[p.medio]}</TableCell>
                                <TableCell className="text-right font-tabular">{formatCLP(p.monto)}</TableCell>
                                <TableCell className="hidden md:table-cell font-tabular text-muted-foreground whitespace-nowrap">
                                    {p.periodo_desde ? `${formatDate(p.periodo_desde)} a ${formatDate(p.periodo_hasta)}` : '-'}
                                </TableCell>
                                <TableCell>{TEXTO_ESTADO[p.estado]}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            {!cargando && total > 0 && (
                <p className="text-right text-sm text-muted-foreground">Pagado en esta lista: <span className="font-semibold text-foreground font-tabular">{formatCLP(total)}</span></p>
            )}
        </PageContainer>
    )
}
