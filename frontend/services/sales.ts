import api, { fetchBlob, printPdf } from './api'
import type { Product } from './products'

export interface SalePaymentCreate {
    payment_method_id: number
    amount: number
    transaction_code?: string
}

export interface SaleItem {
    product_id: number
    cantidad: number
    /** Pesos netos (en boletas el backend los pasa a bruto)... */
    descuento?: number
    /** ...o porcentaje. No los dos. */
    descuento_pct?: number
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
    /** Descuento al total: porcentaje, o pesos netos como el de línea. */
    descuento_global?: { valor: number; porcentaje: boolean }
}

export interface FolioStockOut {
    dte_type: number
    available: number
    total: number
    latest_folio_hasta: number
    latest_folio_desde: number
    fecha_vencimiento?: string
    /** Quedan menos folios que el umbral de dte-torn (nunca en modo Desarrollador). */
    alerta: boolean
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
    /** Envío del XML al correo del cliente: PENDIENTE, ENVIADO, SIN_CORREO, ERROR; null si no aplica. */
    intercambio_estado: string | null
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
    /** Siempre nota de crédito (61). */
    tipo_dte?: 61
    /** 1 anula, 3 corrige montos. Sin él lo decide el backend según lo que vuelve.
     *  Corregir texto va por `corregirTexto`. */
    sii_reason_code?: 1 | 3
    items: { product_id: number; cantidad: number }[]
    reason: string
    return_method_id: number
}

export async function createSale(sale: SaleCreate): Promise<SaleOut> {
    const { data } = await api.post<SaleOut>('/sales/', sale)
    return data
}

/** Días en `aaaa-mm-dd` (hora de Chile). Con `q` (folio, cliente o RUT) el backend ignora las fechas. */
export interface FiltroVentas {
    desde?: string
    hasta?: string
    q?: string
    /** Solo los rechazados por el SII, en todas las fechas. */
    rechazados?: boolean
    skip?: number
    limit?: number
}

export async function getSales(filtro: FiltroVentas = {}): Promise<SaleOut[]> {
    const { data } = await api.get<SaleOut[]>('/sales/', { params: filtro })
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

/** Manda el XML y el PDF al correo del cliente (el de su ficha, u otro). */
export async function reenviarXml(saleId: number, correo?: string): Promise<SaleOut> {
    const { data } = await api.post<SaleOut>(`/sales/${saleId}/reenviar-xml`, correo ? { correo } : {})
    return data
}

/** NC que corrige texto (código 2): sin montos, no devuelve nada. */
export async function corregirTexto(saleId: number, donde_dice: string, debe_decir: string): Promise<SaleOut> {
    const { data } = await api.post<SaleOut>(`/sales/${saleId}/corrige-texto`, { donde_dice, debe_decir })
    return data
}

/** Vuelve a emitir, con otro número, un documento que el SII rechazó: no cobra ni mueve stock de nuevo. */
export async function reemitir(saleId: number): Promise<SaleOut> {
    const { data } = await api.post<SaleOut>(`/sales/${saleId}/reemitir`)
    return data
}

export function getSalePdfPath(saleId: number): string {
    return `/sales/${saleId}/pdf`
}

/**
 * Imprime el documento de una venta. Carta (PDF de dte-torn): diálogo de
 * impresión con vista previa. Ticket (HTML): una pestaña que se imprime sola.
 */
export async function imprimirVenta(saleId: number): Promise<void> {
    const { url, isPdf } = await fetchBlob(getSalePdfPath(saleId))
    if (isPdf) {
        printPdf(url)
        return
    }
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/** Rechazado que se volvió a emitir con otro número: el suyo hay que anularlo en el SII. */
export interface FolioPorAnular {
    id: string
    tipo_dte: number
    folio: number
    fecha_emision: string
    receptor_razon_social: string | null
    monto_total: number
    glosa_sii: string | null
    folio_nuevo: number | null
    caf_folio_desde: number | null
    caf_folio_hasta: number | null
}

export async function getFoliosPorAnular(): Promise<FolioPorAnular[]> {
    const { data } = await api.get<FolioPorAnular[]>('/folios/por-anular')
    return data
}

/** El administrador ya lo anuló en el SII: deja de aparecer en la lista. */
export async function marcarFolioAnulado(id: string): Promise<void> {
    await api.post(`/folios/por-anular/${id}/anulado`)
}

export async function getPaymentMethods(): Promise<PaymentMethod[]> {
    const { data } = await api.get<PaymentMethod[]>('/sales/payment-methods/')
    return data
}

export async function getFoliosStatus(): Promise<FolioStockOut[]> {
    const { data } = await api.get<FolioStockOut[]>('/folios/status')
    return data
}

/** Vigencia del certificado digital cargado en dte-torn; `null` si no hay. */
export async function getCertificado(): Promise<{ not_after: string | null; dias_restantes: number | null } | null> {
    const { data } = await api.get('/folios/certificate')
    return data
}
