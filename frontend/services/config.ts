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

export type PrintFormat = '80mm' | '57mm' | 'carta'

export const PRINT_FORMAT_OPTIONS: { value: PrintFormat; label: string }[] = [
    { value: '57mm', label: 'Térmico 57mm' },
    { value: '80mm', label: 'Térmico 80mm' },
    { value: 'carta', label: 'Carta / A4' },
]

export interface SystemSettings {
    id: number
    print_format: PrintFormat
    print_formats: Record<string, PrintFormat>
    iva_default_id: number | null
}

export interface SettingsUpdate {
    print_format?: PrintFormat
    print_formats?: Record<string, PrintFormat>
    iva_default_id?: number | null
}

/**
 * Tipos de documento con formato de impresión configurable por separado.
 * "33".."61" son `Sale.tipo_dte`; "purchase" es el comprobante de compra
 * (no es un DTE). Debe reflejar `DOCUMENT_TYPES` en
 * `backend/app/utils/print_settings.py`.
 */
export const DOCUMENT_PRINT_TYPES: { key: string; label: string }[] = [
    { key: '33', label: 'Factura' },
    { key: '34', label: 'Factura Exenta' },
    { key: '39', label: 'Boleta' },
    { key: '41', label: 'Boleta Exenta' },
    { key: '56', label: 'Nota de Débito' },
    { key: '61', label: 'Nota de Crédito' },
    { key: 'purchase', label: 'Compras (Comprobante Proveedor)' },
]

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
