import api from './api'
import type { Product } from './products'

export interface SalePaymentCreate {
    payment_method_id: number
    amount: number
    transaction_code?: string
}

export interface SaleItem {
    product_id: number
    cantidad: number
}

export interface SaleCreate {
    rut_cliente: string
    tipo_dte?: number
    items: SaleItem[]
    payments: SalePaymentCreate[]
    descripcion?: string
}

export interface SaleDetailOut {
    product_id: number
    cantidad: string
    precio_unitario: string
    descuento: string
    subtotal: string
    product: Product
}

export interface CustomerOut {
    id: number
    rut: string
    razon_social: string
    giro: string | null
    direccion: string | null
    comuna: string | null
    ciudad: string | null
    email: string | null
    current_balance: string
    is_active: boolean
}

export interface SaleOut {
    id: number
    folio: number
    tipo_dte: number
    fecha_emision: string
    monto_neto: string
    iva: string
    monto_total: string
    descripcion: string | null
    created_at: string
    related_sale_id: number | null
    user: CustomerOut
    details: SaleDetailOut[]
}

export interface PaymentMethod {
    id: number
    code: string
    name: string
    is_active: boolean
}

export interface ReturnCreate {
    original_sale_id: number
    items: { product_id: number; cantidad: number }[]
    reason: string
    return_method_id: number
}

export async function createSale(sale: SaleCreate): Promise<SaleOut> {
    const { data } = await api.post<SaleOut>('/sales/', sale)
    return data
}

export async function getSales(skip = 0, limit = 50): Promise<SaleOut[]> {
    const { data } = await api.get<SaleOut[]>('/sales/', { params: { skip, limit } })
    return data
}

export async function createReturn(ret: ReturnCreate): Promise<SaleOut> {
    const { data } = await api.post<SaleOut>('/sales/return', ret)
    return data
}

export async function getSalePdfUrl(saleId: number): string {
    return `${api.defaults.baseURL}/sales/${saleId}/pdf`
}

export async function getPaymentMethods(): Promise<PaymentMethod[]> {
    const { data } = await api.get<PaymentMethod[]>('/sales/payment-methods/')
    return data
}
