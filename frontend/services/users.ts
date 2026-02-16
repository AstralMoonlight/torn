import api from './api'

export interface User {
    id: number
    rut: string
    razon_social: string
    email?: string
    role: string
    is_active: boolean
}

export interface UserCreate {
    rut: string
    razon_social: string
    email?: string
    role: string
}

export interface UserUpdate {
    razon_social?: string
    email?: string
    role?: string
    is_active?: boolean
}

export async function getSellers(): Promise<User[]> {
    const { data } = await api.get<User[]>('/users/sellers')
    return data
}

export async function getUsers(): Promise<User[]> {
    const { data } = await api.get<User[]>('/users/')
    return data
}

export async function createUser(user: UserCreate): Promise<User> {
    const { data } = await api.post<User>('/users/', user)
    return data
}

export async function updateUser(id: number, user: UserUpdate): Promise<User> {
    const { data } = await api.put<User>(`/users/${id}`, user)
    return data
}

export async function deleteUser(id: number): Promise<void> {
    await api.delete(`/users/${id}`)
}
