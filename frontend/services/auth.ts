import api from './api'

export interface User {
    id: number
    rut: string
    name: string
    role: string
}

export interface LoginResponse {
    access_token: string
    token_type: string
    user_id: number
    rut: string
    name: string
    role: string
}

export async function login(rut: string, password: string): Promise<LoginResponse> {
    const { data } = await api.post<LoginResponse>('/auth/login', {
        rut,
        password,
    })
    return data
}
