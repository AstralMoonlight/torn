import api from './api'

export interface StatPeriod {
    sales_total: number
    /** Neto e IVA reales acumulados en las ventas del periodo. */
    sales_net: number
    sales_tax: number
    sales_count: number
    margin_total: number
    period: string
    /** Ventas del mismo tramo del periodo anterior (hoy hasta ahora contra ayer a esta hora). */
    sales_total_prev: number
}

export interface DashboardSummary {
    daily: StatPeriod
    weekly: StatPeriod
    monthly: StatPeriod
}

export interface TopProduct {
    product_id: number
    nombre: string
    full_name: string
    total_qty: number
    total_margin: number
    total_sales: number
}

export interface TopProductsResponse {
    by_quantity: TopProduct[]
    by_margin: TopProduct[]
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
    const { data } = await api.get<DashboardSummary>('/stats/summary')
    return data
}

export async function getTopProducts(days: number = 30, limit: number = 5): Promise<TopProductsResponse> {
    const { data } = await api.get<TopProductsResponse>('/stats/top-products', {
        params: { days, limit }
    })
    return data
}

/** Totales de un periodo. Margen: venta neta (con descuentos) menos el costo de lo vendido. */
export interface ResumenVentas {
    venta_total: number
    neto: number
    iva: number
    costo: number
    margen: number
    num_ventas: number
    ticket_promedio: number
}

export interface ReporteVentas {
    /** aaaa-mm-dd, ambos incluidos. */
    desde: string
    hasta: string
    resumen: ResumenVentas & {
        descuentos: number
        devoluciones: { num: number; total: number }
    }
    /** El periodo con que se compara; si está en curso, hasta la misma hora. */
    anterior: ResumenVentas & { desde: string; hasta: string }
    agrupacion: 'hora' | 'dia' | 'mes'
    /** clave: hora (0-23), aaaa-mm-dd o aaaa-mm según `agrupacion`. */
    serie: { clave: string; total: number; num: number }[]
    /** Lo cobrado: el efectivo ya descuenta el vuelto y las devoluciones restan. */
    medios_pago: { codigo: string; nombre: string; num: number; total: number }[]
    /** Montos con signo: la nota de crédito resta. */
    documentos: { tipo_dte: number; num: number; neto: number; iva: number; total: number }[]
    vendedores: { nombre: string; num: number; total: number; margen: number }[]
    /** Los 10 que más compraron, sin consumidor final. */
    clientes: { rut: string; razon_social: string; num: number; total: number }[]
    productos: {
        product_id: number
        codigo: string
        nombre: string
        cantidad: number
        venta: number
        costo: number
        margen: number
    }[]
    /** Rechazados por el SII en el periodo: fuera de los totales, solo se informan. */
    rechazados: { num: number; total: number }
}

export async function getReporteVentas(desde: string, hasta: string): Promise<ReporteVentas> {
    const { data } = await api.get<ReporteVentas>('/stats/report', { params: { desde, hasta } })
    return data
}
