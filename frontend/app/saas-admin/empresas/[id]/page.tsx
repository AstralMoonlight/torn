'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Building2, CreditCard, FileCheck, Loader2, Store, Users } from 'lucide-react'
import PageContainer from '@/components/layout/PageContainer'
import PageHeader from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { AlertaError } from '@/components/ui/alerta-error'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EmpresaForm, type DatosEmpresa } from '@/components/saas/EmpresaForm'
import { EstadoSuscripcionBadge } from '@/components/saas/EstadoSuscripcion'
import { SuscripcionEmpresa } from '@/components/saas/SuscripcionEmpresa'
import { SiiEmpresa } from '@/components/saas/SiiEmpresa'
import { UsuariosEmpresa } from '@/components/saas/UsuariosEmpresa'
import { getPlanes, getTenant, updateTenant, type Plan, type Tenant } from '@/services/saas'
import { getApiErrorDetail, getApiErrorMessage } from '@/services/api'
import { avisar } from '@/lib/store/uiStore'
import { useSessionStore, usePermisoSaas } from '@/lib/store/sessionStore'

const datosDe = (t: Tenant): DatosEmpresa => ({
    name: t.name, rut: t.rut ?? '', giro: t.giro ?? '', address: t.address ?? '',
    commune: t.commune ?? '', city: t.city ?? '', economic_activities: t.economic_activities ?? [],
})

export default function FichaEmpresaPage() {
    const router = useRouter()
    const id = Number(useParams().id)
    const puedeEditar = usePermisoSaas('empresas.editar')
    const puedeEntrar = usePermisoSaas('empresas.entrar')
    const puedeUsuarios = usePermisoSaas('empresas.usuarios')
    const [empresa, setEmpresa] = useState<Tenant | null>(null)
    const [planes, setPlanes] = useState<Plan[]>([])
    const [noExiste, setNoExiste] = useState(false)
    const [datos, setDatos] = useState<DatosEmpresa | null>(null)
    const [guardando, setGuardando] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const cargar = useCallback(() => {
        getTenant(id)
            .then((t) => { setEmpresa(t); setDatos((d) => d ?? datosDe(t)) })
            .catch((e) => {
                if ((e as { response?: { status?: number } })?.response?.status === 404) setNoExiste(true)
                else avisar(getApiErrorMessage(e, 'No se pudo cargar la empresa.'), { reintentar: cargar })
            })
    }, [id])

    useEffect(() => {
        cargar()
        getPlanes().then(setPlanes).catch(() => setPlanes([]))
    }, [cargar])

    const guardarDatos = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!datos) return
        setGuardando(true)
        setError(null)
        try {
            // El RUT no va: no cambia (ver `EmpresaForm`).
            setEmpresa(await updateTenant(id, {
                name: datos.name, giro: datos.giro, address: datos.address, commune: datos.commune,
                city: datos.city, economic_activities: datos.economic_activities,
            }))
        } catch (err) {
            setError(getApiErrorDetail(err, 'No se pudieron guardar los datos.'))
        } finally {
            setGuardando(false)
        }
    }

    const alternarActiva = async (activa: boolean) => {
        try {
            setEmpresa(await updateTenant(id, { is_active: activa }))
        } catch (err) {
            avisar(getApiErrorDetail(err, 'No se pudo cambiar el estado de la empresa.'))
        }
    }

    // Soporte: entra al sistema de la empresa como administrador (ver `get_current_tenant_user`).
    const entrar = () => {
        if (!empresa) return
        const { availableTenants, selectTenant } = useSessionStore.getState()
        if (!availableTenants.some((t) => t.id === empresa.id)) {
            useSessionStore.setState((s) => ({
                availableTenants: [...s.availableTenants, {
                    id: empresa.id, name: empresa.name, rut: empresa.rut || '', role_name: 'ADMINISTRADOR',
                    is_active: empresa.is_active, max_users: empresa.max_users_override || empresa.plan_max_users || 1,
                    sii_ambiente: empresa.sii_ambiente, suscripcion_estado: empresa.suscripcion_estado,
                    suscripcion_vence: empresa.suscripcion_vence, prorroga_hasta: empresa.prorroga_hasta,
                }],
            }))
        }
        selectTenant(empresa.id)
        router.push('/pos')
    }

    if (noExiste) {
        return <PageContainer><PageHeader title="Empresa no encontrada" volver={{ href: '/saas-admin/empresas', label: 'Empresas' }} /></PageContainer>
    }
    if (!empresa || !datos) {
        return <PageContainer><Skeleton className="h-8 w-64" /><Skeleton className="h-64 rounded-xl" /></PageContainer>
    }

    return (
        <PageContainer>
            <PageHeader
                icon={Building2}
                title={empresa.name}
                volver={{ href: '/saas-admin/empresas', label: 'Empresas' }}
                actions={puedeEntrar && empresa.is_active && (
                    <Button variant="outline" onClick={entrar}><Store className="h-4 w-4" /> Entrar al sistema</Button>
                )}
            >
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span className="font-mono">{empresa.rut || '-'}</span>
                    {empresa.is_active ? <EstadoSuscripcionBadge estado={empresa.suscripcion_estado} /> : <span className="font-semibold">Desactivada</span>}
                </div>
            </PageHeader>

            <Tabs defaultValue="suscripcion" className="space-y-6">
                <TabsList className="flex-wrap h-auto">
                    <TabsTrigger value="suscripcion" className="gap-2"><CreditCard className="h-4 w-4" /> Suscripción</TabsTrigger>
                    <TabsTrigger value="sii" className="gap-2"><FileCheck className="h-4 w-4" /> SII</TabsTrigger>
                    {puedeUsuarios && <TabsTrigger value="usuarios" className="gap-2"><Users className="h-4 w-4" /> Usuarios</TabsTrigger>}
                    <TabsTrigger value="datos" className="gap-2"><Building2 className="h-4 w-4" /> Datos</TabsTrigger>
                </TabsList>

                <TabsContent value="suscripcion">
                    <SuscripcionEmpresa empresa={empresa} planes={planes} onCambio={cargar} />
                </TabsContent>
                <TabsContent value="sii">
                    <SiiEmpresa empresa={empresa} onCambio={cargar} />
                </TabsContent>
                {puedeUsuarios && (
                    <TabsContent value="usuarios">
                        <UsuariosEmpresa empresa={empresa} onCambio={cargar} />
                    </TabsContent>
                )}
                <TabsContent value="datos">
                    <form onSubmit={guardarDatos} className="space-y-4 rounded-xl border border-border bg-card p-4">
                        <fieldset disabled={!puedeEditar} className="space-y-4">
                            <EmpresaForm valor={datos} onChange={setDatos} rutFijo />
                            <div className="flex items-center gap-3">
                                <Switch id="empresa-activa" checked={empresa.is_active} onCheckedChange={alternarActiva} />
                                <Label htmlFor="empresa-activa">
                                    {empresa.is_active ? 'Activa' : 'Desactivada: nadie puede entrar a esta empresa'}
                                </Label>
                            </div>
                        </fieldset>
                        <AlertaError mensaje={error} />
                        {puedeEditar && (
                            <div className="flex justify-end">
                                <Button type="submit" disabled={guardando}>{guardando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar datos</Button>
                            </div>
                        )}
                    </form>
                </TabsContent>
            </Tabs>
        </PageContainer>
    )
}
