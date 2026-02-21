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

export const getUsers = async (): Promise<User[]> => {
    const response = await api.get('/users/')
    return response.data
}

export const getSellers = async (): Promise<User[]> => {
    const response = await api.get('/users/sellers')
    return response.data
}

export const createUser = async (data: any): Promise<User> => {
    const response = await api.post('/users/', data)
    return response.data
}

export const updateUser = async (id: number, data: Record<string, any>): Promise<User> => {
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
