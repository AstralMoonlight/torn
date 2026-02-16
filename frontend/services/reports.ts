import api from './api'

export interface DashboardData {
    fecha: string
    kpis: {
        total_ventas: number
        total_neto: number
        total_iva: number
        num_ventas: number
        ticket_promedio: number
        num_notas_credito: number
        total_notas_credito: number
    }
    ventas_por_hora: Array<{
        hora: string
        cantidad: number
        total: number
    }>
    top_productos: Array<{
        nombre: string
        sku: string
        cantidad: number
        total: number
    }>
    medios_pago: Array<{
        nombre: string
        codigo: string
        transacciones: number
        total: number
    }>
    caja: {
        id: number
        inicio: string
        fondo: number
    } | null
}

export async function getDashboard(fecha?: string): Promise<DashboardData> {
    const params = fecha ? { fecha } : {}
    const { data } = await api.get('/reports/dashboard', { params })
    return data
}
