import api from './api'

export interface Provider {
    id: number
    rut: string
    razon_social: string
    giro?: string
    direccion?: string
    email?: string
    telefono?: string
    is_active: boolean
}

export type ProviderCreate = Omit<Provider, 'id' | 'is_active'>
export type ProviderUpdate = Partial<ProviderCreate> & { is_active?: boolean }

export async function getProviders(): Promise<Provider[]> {
    const { data } = await api.get<Provider[]>('/providers/')
    return data
}

export async function createProvider(provider: ProviderCreate): Promise<Provider> {
    const { data } = await api.post<Provider>('/providers/', provider)
    return data
}

export async function updateProvider(id: number, provider: ProviderUpdate): Promise<Provider> {
    const { data } = await api.put<Provider>(`/providers/${id}`, provider)
    return data
}

export async function deleteProvider(id: number): Promise<void> {
    await api.delete(`/providers/${id}`)
}
