import api from './api'

export interface AvailableTenant {
    id: number
    name: string
    rut: string
    role_name: string
    is_active: boolean
    max_users: number
}

/** Usuario global del SaaS, tal como lo devuelven /auth/login y /auth/validate
 * (equivale a SaaSUserOut en el backend). No tiene rut, name ni role: esos
 * son atributos del usuario operativo local de cada tenant (services/users.ts). */
export interface SessionUser {
    id: number
    email: string
    full_name?: string
    is_superuser: boolean
}

export interface LoginResponse {
    access_token: string
    token_type: string
    user: SessionUser
    available_tenants: AvailableTenant[]
}

export async function login(email: string, password: string): Promise<LoginResponse> {
    const { data } = await api.post<LoginResponse>('/auth/login', {
        email,
        password,
    })
    return data
}

export async function validateSession(): Promise<{ user: SessionUser; available_tenants: AvailableTenant[] }> {
    const { data } = await api.get<{ user: SessionUser; available_tenants: AvailableTenant[] }>('/auth/validate')
    return data
}
