/**
 * Helpers de formato para moneda y fechas.
 *
 * NOTA: este módulo fue reconstruido a partir de sus llamadas. El original se
 * perdió porque el patrón `lib/` del .gitignore (heredado de la plantilla de
 * Python) impedía versionar `frontend/lib/`. Revisa que el formato coincida con
 * lo que esperas antes de darlo por bueno.
 */

/** Zona horaria usada en toda la aplicación. */
export const CHILE_TIMEZONE = 'America/Santiago'

const clpFormatter = new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
})

/**
 * Formatea un monto como peso chileno, sin decimales.
 *
 * @param value Monto numérico o su representación en texto.
 * @returns El monto formateado (ej. `$12.345`), o `$0` si el valor no es válido.
 */
export function formatCLP(value: number | string | null | undefined): string {
    const amount = typeof value === 'string' ? parseFloat(value) : value
    if (amount === null || amount === undefined || Number.isNaN(amount)) {
        return clpFormatter.format(0)
    }
    return clpFormatter.format(Math.round(amount))
}

/**
 * Formatea una fecha en formato chileno (`dd-mm-aaaa`).
 *
 * @param value Fecha ISO (`aaaa-mm-dd`), timestamp o `Date`.
 * @returns La fecha formateada, o cadena vacía si no es interpretable.
 */
export function formatDate(value: string | number | Date | null | undefined): string {
    if (value === null || value === undefined || value === '') return ''

    // Una fecha ISO sin hora se interpreta como UTC y puede "retroceder" un día
    // al mostrarla en Chile; se arma localmente para evitarlo.
    if (typeof value === 'string') {
        const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
        if (soloFecha) {
            const [, year, month, day] = soloFecha
            return `${day}-${month}-${year}`
        }
    }

    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return ''

    return new Intl.DateTimeFormat('es-CL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: CHILE_TIMEZONE,
    }).format(date)
}

/**
 * Fecha de hoy en Chile, en formato `aaaa-mm-dd`.
 *
 * Es el formato que espera un `<input type="date">`, que es donde se usa.
 */
export function getTodayChile(): string {
    // en-CA produce directamente aaaa-mm-dd.
    return new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: CHILE_TIMEZONE,
    }).format(new Date())
}
