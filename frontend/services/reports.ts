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

/** Estado de un documento que requiere atención. SIN_RESPUESTA: el SII no contesta hace más de 24 h. */
export interface DocumentoConProblema {
    id: number
    tipo_dte: number
    folio: number | null
    fecha: string
    estado: 'RECHAZADO' | 'REPAROS' | 'ERROR_VALIDACION' | 'SIN_RESPUESTA'
    glosa: string | null
}

export interface Deudor {
    rut: string
    razon_social: string
    saldo: number
    vencido: number
    /** Días de atraso de la parte más antigua. */
    dias: number
}

export interface PanelData {
    sii: {
        /** Documentos emitidos este mes por estado en dte-torn (ACEPTADO, ENVIADO, ...). */
        estados: Record<string, number>
        problemas: DocumentoConProblema[]
        num_problemas: number
    }
    iva: { debito: number; credito: number; a_pagar: number; vence: string }
    guias: { pendientes: number; desde: string | null }
    cobranza: {
        total: number
        vencido: number
        tramos: { al_dia: number; '1_30': number; '31_60': number; '61_mas': number }
        /** Los 5 con más deuda vencida. */
        deudores: Deudor[]
        num_vencidos: number
    }
    ventas_30_dias: Array<{ fecha: string; total: number }>
}

export async function getPanel(): Promise<PanelData> {
    const { data } = await api.get<PanelData>('/reports/panel')
    return data
}
