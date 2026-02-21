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
    billing_day: number
    economic_activities?: any[]

    created_at: string
}

export interface TenantCreate {
    name: string
    rut: string
    address?: string
    commune?: string
    city?: string
    giro?: string
    billing_day?: number
    economic_activities?: any[]
}

export interface TenantUpdate {
    name?: string
    is_active?: boolean
    max_users_override?: number | null
    address?: string
    commune?: string
    city?: string
    giro?: string
    billing_day?: number
    economic_activities?: any[]
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

import api from './api'

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
