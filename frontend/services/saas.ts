/** Ver `backend/app/services/suscripciones.py`. */
export type EstadoSuscripcion =
    | 'CORTESIA' | 'SIN_PAGO' | 'AL_DIA' | 'POR_VENCER' | 'EN_GRACIA' | 'PRORROGA' | 'SUSPENDIDA'

/**
 * Actividad económica (ACTECO) del SII asociada a un inquilino.
 * Ver el comentario de `Tenant.economic_activities` en app/models/saas.py.
 */
export interface EconomicActivity {
    code: string
    name: string
    category?: string
    taxable?: boolean
}

export interface Tenant {
    id: number
    name: string
    rut?: string
    schema_name: string
    max_users_override?: number
    plan_max_users?: number
    is_active: boolean

    // Campos DTE
    address?: string
    commune?: string
    city?: string
    giro?: string
    economic_activities?: EconomicActivity[]
    plan_id: number | null
    suscripcion_vence: string | null
    prorroga_hasta: string | null
    suscripcion_estado: EstadoSuscripcion
    sii_ambiente: 'CERT' | 'PROD' | 'DEV'
    sii_resolucion_numero: number
    sii_resolucion_fecha: string | null
    sii_oficina: string | null

    created_at: string
}

export interface TenantCreate {
    name: string
    rut: string
    address?: string
    commune?: string
    city?: string
    giro?: string
    economic_activities?: EconomicActivity[]
    plan_id?: number | null
}

export interface TenantUpdate {
    name?: string
    is_active?: boolean
    max_users_override?: number | null
    address?: string
    commune?: string
    city?: string
    giro?: string
    economic_activities?: EconomicActivity[]
    sii_ambiente?: 'CERT' | 'PROD' | 'DEV'
    sii_resolucion_numero?: number
    sii_resolucion_fecha?: string | null
    sii_oficina?: string | null
}

export interface TenantUser {
    id: number
    tenant_id: number
    user_id: number
    role_name: string
    is_active: boolean
    user: {
        id: number
        email: string
        full_name?: string
        is_active: boolean
        is_superuser: boolean
    }
}

export interface TenantUserCreate {
    email: string
    password?: string
    full_name?: string
    role_name: string
}

export interface TenantUserUpdate {
    role_name?: string
    is_active?: boolean
    password?: string
    full_name?: string
}

export interface ActecoItem {
    code: string
    name: string
    taxable: boolean
    category?: string
    internet_available: boolean
}

import api from './api'

export async function searchActecos(q?: string, limit = 30): Promise<ActecoItem[]> {
    const params = new URLSearchParams()
    if (q?.trim()) params.set('q', q.trim())
    params.set('limit', String(Math.min(100, Math.max(1, limit))))
    const { data } = await api.get<ActecoItem[]>(`/saas/actecos?${params.toString()}`)
    return data
}

export async function getTenants(): Promise<Tenant[]> {
    const { data } = await api.get<Tenant[]>('/saas/tenants')
    return data
}

export async function getTenantUsers(tenantId: number): Promise<TenantUser[]> {
    const { data } = await api.get<TenantUser[]>(`/saas/tenants/${tenantId}/users`)
    return data
}

export async function addTenantUser(tenantId: number, user: TenantUserCreate): Promise<TenantUser> {
    const { data } = await api.post<TenantUser>(`/saas/tenants/${tenantId}/users`, user)
    return data
}

export async function createTenant(tenant: TenantCreate): Promise<Tenant> {
    const { data } = await api.post<Tenant>('/saas/tenants', tenant)
    return data
}

export async function updateTenant(tenantId: number, updates: TenantUpdate): Promise<Tenant> {
    const { data } = await api.patch<Tenant>(`/saas/tenants/${tenantId}`, updates)
    return data
}

export async function updateTenantUser(tenantId: number, userId: number, updates: TenantUserUpdate): Promise<TenantUser> {
    const { data } = await api.patch<TenantUser>(`/saas/tenants/${tenantId}/users/${userId}`, updates)
    return data
}

export async function deleteTenant(tenantId: number): Promise<void> {
    await api.delete(`/saas/tenants/${tenantId}`)
}

export async function getTenant(tenantId: number): Promise<Tenant> {
    const { data } = await api.get<Tenant>(`/saas/tenants/${tenantId}`)
    return data
}

// ── Planes, pagos y cobranza ───────────────────────────────────────────

export interface Plan {
    id: number
    name: string
    description?: string | null
    /** Precio de todo el período, en pesos con IVA. */
    precio: number
    /** 0 = Cortesía (no vence). */
    meses: number
    max_users: number
    cuotas_sin_interes: boolean
    incluye_impresora?: string | null
    is_active: boolean
}
export type PlanIn = Omit<Plan, 'id'>

export interface AjustesCobranza {
    dias_aviso: number
    dias_gracia: number
    horas_prorroga: number
}

export interface Pago {
    id: number
    tenant_id: number
    empresa: string
    plan_id: number
    plan: string
    monto: number
    medio: 'PASARELA' | 'TRANSFERENCIA' | 'EFECTIVO'
    estado: 'PENDIENTE' | 'PAGADO' | 'FALLIDO' | 'ANULADO'
    periodo_desde: string | null
    periodo_hasta: string | null
    nota?: string | null
    created_at: string | null
    pagado_at: string | null
}

export interface Problema {
    tenant_id: number
    empresa: string
    nivel: 'critico' | 'aviso' | 'info'
    tipo: string
    mensaje: string
}

export interface Resumen {
    empresas_activas: number
    por_estado: Partial<Record<EstadoSuscripcion, number>>
    cobrado_mes: number
    pagos_mes: number
    problemas: Problema[]
}

export const getPlanes = () => api.get<Plan[]>('/saas/planes').then(r => r.data)
export const createPlan = (plan: PlanIn) => api.post<Plan>('/saas/planes', plan).then(r => r.data)
export const updatePlan = (id: number, plan: PlanIn) => api.put<Plan>(`/saas/planes/${id}`, plan).then(r => r.data)
export const getAjustes = () => api.get<AjustesCobranza>('/saas/ajustes').then(r => r.data)
export const putAjustes = (a: AjustesCobranza) => api.put<AjustesCobranza>('/saas/ajustes', a).then(r => r.data)

export const getPagos = (filtro: { tenant_id?: number; estado?: string } = {}) =>
    api.get<Pago[]>('/saas/pagos', { params: filtro }).then(r => r.data)
export const registrarPago = (tenantId: number, pago: { plan_id: number; medio: 'TRANSFERENCIA' | 'EFECTIVO'; monto?: number; nota?: string }) =>
    api.post<Pago>(`/saas/tenants/${tenantId}/pagos`, pago).then(r => r.data)
export const anularPago = (id: number) => api.post<Pago>(`/saas/pagos/${id}/anular`).then(r => r.data)
export const cambiarSuscripcion = (tenantId: number, plan_id: number, suscripcion_vence: string | null) =>
    api.put<Tenant>(`/saas/tenants/${tenantId}/suscripcion`, { plan_id, suscripcion_vence }).then(r => r.data)
export const darProrroga = (tenantId: number, horas: number) =>
    api.post<Tenant>(`/saas/tenants/${tenantId}/prorroga`, { horas }).then(r => r.data)
export const crearLinkPago = (tenantId: number, plan_id: number, email?: string) =>
    api.post<{ url: string }>(`/saas/tenants/${tenantId}/link-pago`, { plan_id, email: email || undefined }).then(r => r.data.url)

export const getResumen = () => api.get<Resumen>('/saas/resumen').then(r => r.data)
export const getProblemas = (tenantId: number) => api.get<Problema[]>(`/saas/tenants/${tenantId}/problemas`).then(r => r.data)

// ── Equipo de Factureando ──────────────────────────────────────────────

export interface Permiso { clave: string; nombre: string }
export interface Cargo { id: number; nombre: string; permisos: string[] }
export interface Miembro {
    id: number
    email: string
    full_name?: string | null
    is_active: boolean
    is_superuser: boolean
    cargo_id: number | null
    es_dueno: boolean
    permisos: string[]
}

export const getPermisos = () => api.get<Permiso[]>('/saas/permisos').then(r => r.data)
export const getCargos = () => api.get<Cargo[]>('/saas/cargos').then(r => r.data)
export const createCargo = (c: Omit<Cargo, 'id'>) => api.post<Cargo>('/saas/cargos', c).then(r => r.data)
export const updateCargo = (id: number, c: Omit<Cargo, 'id'>) => api.put<Cargo>(`/saas/cargos/${id}`, c).then(r => r.data)
export const deleteCargo = (id: number) => api.delete(`/saas/cargos/${id}`)
export const getEquipo = () => api.get<Miembro[]>('/saas/equipo').then(r => r.data)
export const createMiembro = (m: { email: string; full_name?: string; password: string; cargo_id: number }) =>
    api.post<Miembro>('/saas/equipo', m).then(r => r.data)
export const updateMiembro = (id: number, m: { full_name?: string; password?: string; cargo_id?: number; is_active?: boolean }) =>
    api.patch<Miembro>(`/saas/equipo/${id}`, m).then(r => r.data)

// ── Suscripción vista desde la empresa ─────────────────────────────────

export interface MiSuscripcion {
    estado: EstadoSuscripcion
    plan: string | null
    vence: string | null
    prorroga_hasta: string | null
    planes: Plan[]
    /** La pasarela (Flow) está configurada. */
    pasarela: boolean
}

export const getMiSuscripcion = () => api.get<MiSuscripcion>('/suscripcion').then(r => r.data)
export const pagarSuscripcion = (plan_id: number) =>
    api.post<{ url: string }>('/suscripcion/pagar', { plan_id }).then(r => r.data.url)
