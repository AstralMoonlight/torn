'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Loader2, Plus } from 'lucide-react'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import ListToolbar from '@/components/layout/ListToolbar'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { AlertaError } from '@/components/ui/alerta-error'
import { SelectOpciones } from '@/components/ui/select-opciones'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmpresaForm, EMPRESA_VACIA, type DatosEmpresa } from '@/components/saas/EmpresaForm'
import { EstadoSuscripcionBadge } from '@/components/saas/EstadoSuscripcion'
import { createTenant, getPlanes, getTenants, type EstadoSuscripcion, type Plan, type Tenant } from '@/services/saas'
import { getApiErrorDetail, getApiErrorMessage } from '@/services/api'
import { avisar } from '@/lib/store/uiStore'
import { usePermisoSaas } from '@/lib/store/sessionStore'
import { formatDate } from '@/lib/format'
import { formatRut, validateRut } from '@/lib/rut'

const FILTROS: { valor: string; texto: string; estados: EstadoSuscripcion[] | null }[] = [
    { valor: 'todas', texto: 'Todas', estados: null },
    { valor: 'por-vencer', texto: 'Por vencer', estados: ['POR_VENCER', 'SIN_PAGO'] },
    { valor: 'vencidas', texto: 'Vencidas', estados: ['EN_GRACIA', 'PRORROGA'] },
    { valor: 'suspendidas', texto: 'Suspendidas', estados: ['SUSPENDIDA'] },
]

const AMBIENTES = { DEV: 'Desarrollador', CERT: 'Certificación', PROD: 'Producción' } as const

export default function EmpresasPage() {
    const router = useRouter()
    const puedeCrear = usePermisoSaas('empresas.editar')
    const [empresas, setEmpresas] = useState<Tenant[]>([])
    const [planes, setPlanes] = useState<Plan[]>([])
    const [cargando, setCargando] = useState(true)
    const [busqueda, setBusqueda] = useState('')
    const [filtro, setFiltro] = useState('todas')

    const [creando, setCreando] = useState(false)
    const [guardando, setGuardando] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [nueva, setNueva] = useState<DatosEmpresa>(EMPRESA_VACIA)
    const [planId, setPlanId] = useState<number | ''>('')

    const cargar = useCallback(() => {
        setCargando(true)
        Promise.all([getTenants(), getPlanes()])
            .then(([t, p]) => { setEmpresas(t); setPlanes(p) })
            .catch((e) => avisar(getApiErrorMessage(e, 'No se pudieron cargar las empresas.'), { reintentar: cargar }))
            .finally(() => setCargando(false))
    }, [])
    useEffect(cargar, [cargar])

    const nombrePlan = useMemo(() => new Map(planes.map((p) => [p.id, p.name])), [planes])
    const visibles = empresas.filter((t) => {
        const q = busqueda.trim().toLowerCase()
        const estados = FILTROS.find((f) => f.valor === filtro)?.estados
        return (!q || t.name.toLowerCase().includes(q) || (t.rut ?? '').toLowerCase().includes(q))
            && (!estados || (t.is_active && estados.includes(t.suscripcion_estado)))
    })

    const abrirNueva = () => {
        setNueva(EMPRESA_VACIA)
        setPlanId(planes.find((p) => p.meses === 1)?.id ?? '')
        setError(null)
        setCreando(true)
    }

    const crear = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!nueva.name || !validateRut(nueva.rut)) return setError('Falta la razón social o el RUT no es válido.')
        setGuardando(true)
        setError(null)
        try {
            const t = await createTenant({ ...nueva, rut: formatRut(nueva.rut), plan_id: planId || null })
            router.push(`/saas-admin/empresas/${t.id}`)
        } catch (err) {
            setError(getApiErrorDetail(err, 'No se pudo crear la empresa.'))
        } finally {
            setGuardando(false)
        }
    }

    return (
        <PageContainer>
            <PageHeader
                icon={Building2}
                title="Empresas"
                actions={puedeCrear && (
                    <Button onClick={abrirNueva}><Plus className="h-4 w-4" /> Nueva empresa</Button>
                )}
            />

            <ListToolbar
                busqueda={busqueda}
                onBusqueda={setBusqueda}
                placeholder="Buscar por nombre o RUT..."
                visibles={visibles.length}
                total={empresas.length}
                unidad="empresas"
                filtros={FILTROS.map((f) => (
                    <Button key={f.valor} size="sm" variant={filtro === f.valor ? 'secondary' : 'ghost'}
                        aria-pressed={filtro === f.valor} onClick={() => setFiltro(f.valor)}>
                        {f.texto}
                    </Button>
                ))}
            />

            <div data-section="saas-admin.empresas.tabla" className="overflow-hidden rounded-xl border border-border bg-card">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Empresa</TableHead>
                            <TableHead>Plan</TableHead>
                            <TableHead>Suscripción</TableHead>
                            <TableHead className="hidden md:table-cell">Vence</TableHead>
                            <TableHead className="hidden md:table-cell">SII</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {cargando && <TableEmpty colSpan={5} loading />}
                        {!cargando && visibles.length === 0 && (
                            <TableEmpty colSpan={5}>{empresas.length ? 'Ninguna empresa coincide.' : 'Todavía no hay empresas.'}</TableEmpty>
                        )}
                        {!cargando && visibles.map((t) => (
                            <TableRow key={t.id} className="cursor-pointer" onClick={() => router.push(`/saas-admin/empresas/${t.id}`)}>
                                <TableCell>
                                    <a href={`/saas-admin/empresas/${t.id}`} className="font-medium text-foreground hover:text-primary"
                                        onClick={(e) => { e.preventDefault(); router.push(`/saas-admin/empresas/${t.id}`) }}>
                                        {t.name}
                                    </a>
                                    <p className="text-xs text-muted-foreground font-mono">{t.rut || '-'}</p>
                                </TableCell>
                                <TableCell className="text-muted-foreground">{t.plan_id ? nombrePlan.get(t.plan_id) : '-'}</TableCell>
                                <TableCell>
                                    {t.is_active
                                        ? <EstadoSuscripcionBadge estado={t.suscripcion_estado} />
                                        : <span className="text-xs font-semibold text-muted-foreground">Desactivada</span>}
                                </TableCell>
                                <TableCell className="hidden md:table-cell text-muted-foreground font-tabular">{formatDate(t.suscripcion_vence) || '-'}</TableCell>
                                <TableCell className="hidden md:table-cell text-muted-foreground">{AMBIENTES[t.sii_ambiente]}</TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={creando} onOpenChange={setCreando}>
                <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Nueva empresa</DialogTitle>
                        <DialogDescription>Se crea con su propia base de datos. Parte en certificación del SII.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={crear} className="space-y-4">
                        <EmpresaForm valor={nueva} onChange={setNueva} />
                        <div className="space-y-2 sm:max-w-xs">
                            <Label htmlFor="nueva-plan">Plan</Label>
                            <SelectOpciones
                                id="nueva-plan"
                                value={planId}
                                onChange={setPlanId}
                                opciones={planes.filter((p) => p.is_active).map((p) => ({ value: p.id, label: p.name }))}
                            />
                            <p className="text-xs text-muted-foreground">Vence cuando se registre el primer pago.</p>
                        </div>
                        <AlertaError mensaje={error} />
                        <div className="flex justify-end gap-3">
                            <Button type="button" variant="outline" onClick={() => setCreando(false)}>Cancelar</Button>
                            <Button type="submit" disabled={guardando}>
                                {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                                {guardando ? 'Creando...' : 'Crear empresa'}
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </PageContainer>
    )
}
