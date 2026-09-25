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

/** Referencia a documento previo (OC, Guía, etc.) para Factura Electrónica. */
export interface DocumentReference {
    tipo_documento: string
    folio: string
    fecha: string // YYYY-MM-DD
}

export interface SaleCreate {
    rut_cliente: string
    tipo_dte?: number
    items: SaleItem[]
    payments: SalePaymentCreate[]
    descripcion?: string
    seller_id?: number
    referencias?: DocumentReference[]
    /** Solo guía de despacho (52): IndTraslado y TipoDespacho del SII. */
    ind_traslado?: number
    tipo_despacho?: number
}

export interface FolioStockOut {
    dte_type: number
    available: number
    total: number
    latest_folio_hasta: number
    latest_folio_desde: number
    fecha_vencimiento?: string
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
    vuelto: string
    ajuste_redondeo: string
    descripcion: string | null
    created_at: string
    related_sale_id: number | null
    /** Estado en dte-torn (ACEPTADO, REPAROS, RECHAZADO, ENVIADO, SIMULADO en Desarrollador...). null: venta anterior a la integración. */
    dte_estado: string | null
    dte_glosa: string | null
    ind_traslado: number | null
    /** Factura que cobró esta guía; null mientras está pendiente. */
    facturada_por_id: number | null
    customer: CustomerOut
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
    tipo_dte: number
    sii_reason_code: number
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

/** Pide a dte-torn el estado de las ventas que todavía esperan respuesta del SII. */
export async function actualizarEstadosDte(): Promise<{ pendientes: number; cambiadas: number }> {
    const { data } = await api.post('/sales/dte-estados')
    return data
}

export async function getGuiasPendientes(): Promise<SaleOut[]> {
    const { data } = await api.get<SaleOut[]>('/sales/guias-pendientes')
    return data
}

export async function facturarGuias(guia_ids: number[], tipo_dte: number, payment_method_id: number): Promise<SaleOut> {
    const { data } = await api.post<SaleOut>('/sales/facturar-guias', { guia_ids, tipo_dte, payment_method_id })
    return data
}

export async function createReturn(ret: ReturnCreate): Promise<SaleOut> {
    const { data } = await api.post<SaleOut>('/sales/return', ret)
    return data
}

export function getSalePdfPath(saleId: number): string {
    return `/sales/${saleId}/pdf`
}

export async function getPaymentMethods(): Promise<PaymentMethod[]> {
    const { data } = await api.get<PaymentMethod[]>('/sales/payment-methods/')
    return data
}

export async function getFoliosStatus(): Promise<FolioStockOut[]> {
    const { data } = await api.get<FolioStockOut[]>('/folios/status')
    return data
}
