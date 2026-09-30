import api from './api'
import { type Provider } from './providers'

/** Lo que registró el SII sobre el documento (aceptaciones, reclamos, NC). */
export interface EventoRegistro {
    codigo: string
    descripcion: string
    responsable: string
    fecha: string
}

/** Documento de un proveedor, recibido en la casilla o cargado a mano. */
export interface Recibido {
    id: string
    tipo_dte: number
    folio: number
    rut_emisor: string
    razon_social_emisor: string
    fecha_emision: string
    monto_neto: number
    monto_exento: number
    monto_iva: number
    monto_total: number
    firma_valida: boolean
    origen: 'CORREO' | 'MANUAL'
    recibido_en: string
    /** Si se acepta o reclama en el SII (facturas 33, 34 y 43). */
    con_registro: boolean
    fecha_recepcion_sii: string | null
    plazo: string | null
    plazo_aproximado: boolean
    /** ACEPTADO, RECLAMADO o null (sin responder). */
    estado_registro: 'ACEPTADO' | 'RECLAMADO' | null
    accion: string | null
    accion_at: string | null
    accion_actor: string | null
    eventos: EventoRegistro[] | null
    registro_error: string | null
    /** La compra con que se ingresó al stock. */
    compra_id: number | null
}

export interface LineaRecibida {
    nombre: string
    codigo: string
    cantidad: string
    unidad: string
    /** Costo neto por unidad, con el descuento de la línea. */
    costo_unitario: string
    monto: number
    exento: boolean
    /** Nuestro producto que calza por código o nombre. */
    product_id: number | null
}

export interface RecibidoDetalle extends Recibido {
    detalle: {
        emisor: Record<string, string>
        referencias: Record<string, string>[]
    }
    lineas: LineaRecibida[]
    provider_id: number | null
}

export interface EnvioRecibido {
    id: string
    codigo: number
    origen: string
    correo_origen: string | null
    asunto: string | null
    nombre_archivo: string
    rut_emisor: string | null
    razon_social_emisor: string | null
    /** 0: recibido conforme. */
    estado: number
    glosa: string
    acuse_estado: string
    acuse_error: string | null
    recibido_en: string
}

export interface CargaRecibido {
    envio: EnvioRecibido
    documentos: Recibido[]
    nuevo: boolean
}

/** ACD acepta, ERM recibo de mercaderías, RCD reclamo al contenido, RFP falta parcial, RFT falta total. */
export type AccionRegistro = 'ACD' | 'ERM' | 'RCD' | 'RFP' | 'RFT'

export async function getRecibidos(params: { q?: string; sin_responder?: boolean; desde?: string; hasta?: string; offset?: number }): Promise<Recibido[]> {
    const { data } = await api.get<Recibido[]>('/recibidos', { params })
    return data
}

export async function getRecibido(id: string): Promise<RecibidoDetalle> {
    const { data } = await api.get<RecibidoDetalle>(`/recibidos/${id}`)
    return data
}

export async function getEnviosConProblemas(): Promise<EnvioRecibido[]> {
    const { data } = await api.get<EnvioRecibido[]>('/recibidos/envios')
    return data
}

export async function cargarRecibido(archivo: File): Promise<CargaRecibido> {
    const form = new FormData()
    form.append('file', archivo)
    const { data } = await api.post<CargaRecibido>('/recibidos', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    return data
}

export async function registrarAccion(id: string, accion: AccionRegistro): Promise<Recibido> {
    const { data } = await api.post<Recibido>(`/recibidos/${id}/accion`, { accion })
    return data
}

export async function actualizarRecibido(id: string): Promise<Recibido> {
    const { data } = await api.post<Recibido>(`/recibidos/${id}/actualizar`)
    return data
}

/** El proveedor del documento; el backend lo crea si no existe. */
export async function proveedorDeRecibido(id: string): Promise<Provider> {
    const { data } = await api.post<Provider>(`/recibidos/${id}/proveedor`)
    return data
}

export function getRecibidoXmlPath(id: string): string {
    return `/recibidos/${id}/xml`
}
