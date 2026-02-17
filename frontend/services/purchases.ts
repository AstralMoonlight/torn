import api from './api'
import { type Product } from './products'
import { type Provider } from './providers'

export interface PurchaseItem {
    product_id: number
    cantidad: number
    precio_costo_unitario: number
}

export interface PurchaseCreate {
    provider_id: number
    folio?: string
    tipo_documento: string // FACTURA | BOLETA | SIN_DOCUMENTO
    items: PurchaseItem[]
    observacion?: string
    fecha_compra?: string
}

export interface PurchaseDetail {
    id: number
    product_id: number
    cantidad: number
    precio_costo_unitario: number
    subtotal: number
    product: Product
}

export interface Purchase {
    id: number
    provider_id: number
    folio?: string
    tipo_documento: string
    fecha_compra: string
    monto_neto: number
    iva: number
    monto_total: number
    observacion?: string
    created_at: string
    provider: Provider
    details: PurchaseDetail[]
}

export async function getPurchases(): Promise<Purchase[]> {
    const { data } = await api.get<Purchase[]>('/purchases/')
    return data
}

export async function getPurchase(id: number): Promise<Purchase> {
    const { data } = await api.get<Purchase>(`/purchases/${id}`)
    return data
}

export async function createPurchase(purchase: PurchaseCreate): Promise<Purchase> {
    const { data } = await api.post<Purchase>('/purchases/', purchase)
    return data
}

export async function updatePurchase(id: number, purchase: PurchaseCreate): Promise<Purchase> {
    const { data } = await api.put<Purchase>(`/purchases/${id}`, purchase)
    return data
}

export async function deletePurchase(id: number): Promise<void> {
    await api.delete(`/purchases/${id}`)
}
