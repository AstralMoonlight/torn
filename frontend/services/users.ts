import api from './api'

export interface User {
    id: number
    rut?: string
    name: string
    email?: string
    role?: string
    role_id?: number
    is_active: boolean
    is_owner?: boolean
    role_obj?: {
        name: string
        permissions: Record<string, boolean>
    }
}

/** Campos que acepta POST /users/ (equivale a `UserCreate` del backend). */
export interface UserCreateInput {
    full_name: string
    rut?: string
    email?: string
    role_id?: number
    password?: string
}

/** Campos que acepta PUT /users/{id} (equivale a `UserUpdate` del backend). */
export interface UserUpdateInput {
    full_name?: string
    email?: string
    role_id?: number
    is_active?: boolean
    password?: string
}

export const getUsers = async (): Promise<User[]> => {
    const response = await api.get('/users/')
    return response.data
}

export const getSellers = async (): Promise<User[]> => {
    const response = await api.get('/users/sellers')
    return response.data
}

export const createUser = async (data: UserCreateInput): Promise<User> => {
    const response = await api.post('/users/', data)
    return response.data
}

export const updateUser = async (id: number, data: UserUpdateInput): Promise<User> => {
    const response = await api.put(`/users/${id}`, data)
    return response.data
}

export const deleteUser = async (id: number): Promise<void> => {
    await api.delete(`/users/${id}`)
}

export const userService = {
    getUsers,
    getSellers,
    createUser,
    updateUser,
    deleteUser
}
