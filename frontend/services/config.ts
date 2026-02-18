import api from './api'

export interface Tax {
    id: number
    name: string
    rate: number
    is_active: boolean
    is_default: boolean
}

export interface TaxCreate {
    name: string
    rate: number
    is_active?: boolean
    is_default?: boolean
}

export interface SystemSettings {
    id: number
    print_format: '80mm' | 'carta'
    iva_default_id: number | null
}

export interface SettingsUpdate {
    print_format?: '80mm' | 'carta'
    iva_default_id?: number | null
}

export async function getTaxes(): Promise<Tax[]> {
    const { data } = await api.get<Tax[]>('/config/taxes/')
    return data
}

export async function createTax(tax: TaxCreate): Promise<Tax> {
    const { data } = await api.post<Tax>('/config/taxes/', tax)
    return data
}

export async function updateTax(taxId: number, tax: Partial<TaxCreate>): Promise<Tax> {
    const { data } = await api.put<Tax>(`/config/taxes/${taxId}`, tax)
    return data
}

export async function getSettings(): Promise<SystemSettings> {
    const { data } = await api.get<SystemSettings>('/config/settings/')
    return data
}

export async function updateSettings(settings: SettingsUpdate): Promise<SystemSettings> {
    const { data } = await api.put<SystemSettings>('/config/settings/', settings)
    return data
}
