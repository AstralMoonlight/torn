import api from './api'

export interface StatPeriod {
    sales_total: number
    sales_count: number
    margin_total: number
    period: string
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

export interface ReportItem {
    product_id: number
    full_name: string
    cantidad: number
    monto_total: number
    utilidad: number
}

export interface ReportOut {
    fecha: string
    period: string
    total_ventas: number
    total_utilidad: number
    items: ReportItem[]
}

export async function getReport(period: string = 'day', date?: string): Promise<ReportOut> {
    const { data } = await api.get<ReportOut>('/stats/report', {
        params: { period, date }
    })
    return data
}
