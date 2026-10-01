/**
 * Fechas y formatos del reporte de ventas, compartidos por la pantalla y el
 * documento impreso. Las fechas son cadenas aaaa-mm-dd y se calculan en UTC
 * para que no se corra el día.
 */
import type { ReporteVentas } from '@/services/stats'

export const aFecha = (s: string) => new Date(`${s}T00:00:00Z`)

export function sumarDias(s: string, n: number) {
    const d = aFecha(s)
    d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().slice(0, 10)
}

const fmt = (opciones: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-CL', { ...opciones, timeZone: 'UTC' })
const LARGA = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const DIA_MES = fmt({ day: 'numeric', month: 'long' })
const DIA_SEMANA = fmt({ weekday: 'short', day: 'numeric' })
const MES = fmt({ month: 'short' })
const MES_ANIO = fmt({ month: 'long', year: 'numeric' })

/** "martes, 30 de septiembre de 2026" o "1 de septiembre al martes, 30 de septiembre de 2026". */
export function textoRango(desde: string, hasta: string) {
    if (desde === hasta) return LARGA.format(aFecha(desde))
    return `${DIA_MES.format(aFecha(desde))} al ${LARGA.format(aFecha(hasta))}`
}

export const cantidad = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 })
export const porcentaje = (parte: number, total: number) => (total ? `${Math.round((parte / total) * 100)}%` : '-')

/** Nombre de la unidad de la serie y sus etiquetas corta (eje) y larga (tooltip, tablas). */
export function etiquetasSerie(reporte: ReporteVentas) {
    const { agrupacion, serie } = reporte
    const hora = (clave: string) => `${clave.padStart(2, '0')}:00`
    return {
        unidad: { hora: 'hora', dia: 'día', mes: 'mes' }[agrupacion],
        corta: (clave: string) =>
            agrupacion === 'hora' ? hora(clave)
                : agrupacion === 'mes' ? MES.format(aFecha(`${clave}-01`))
                    : serie.length <= 7 ? DIA_SEMANA.format(aFecha(clave)) : `${clave.slice(8, 10)}/${clave.slice(5, 7)}`,
        larga: (clave: string) =>
            agrupacion === 'hora' ? `${hora(clave)} a ${clave.padStart(2, '0')}:59`
                : agrupacion === 'mes' ? MES_ANIO.format(aFecha(`${clave}-01`)) : LARGA.format(aFecha(clave)),
    }
}
