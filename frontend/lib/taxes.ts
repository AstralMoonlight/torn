/**
 * Resolución de tasas de impuesto en el cliente.
 *
 * Refleja `app/utils/taxes.py`, que es donde se decide lo que realmente se
 * cobra. Lo de aquí sirve para previsualizar; si ambos discrepan, manda el
 * backend.
 */

/** Tasa por defecto cuando el producto no tiene un impuesto asociado. */
export const DEFAULT_TAX_RATE = 0.19

/**
 * Normaliza una tasa a fracción decimal.
 *
 * Los datos históricos guardan tanto `0.19` como `19`, así que se aceptan las
 * dos formas.
 */
export function normalizeTaxRate(rate: number | null | undefined): number {
    if (rate === null || rate === undefined) return 0
    const value = Number(rate)
    if (Number.isNaN(value)) return 0
    return value > 1 ? value / 100 : value
}

/** Tasa aplicable a un producto, con la del sistema como respaldo. */
export function productTaxRate(
    product: { tax?: { rate: number } | null } | null | undefined
): number {
    if (!product || !product.tax) return DEFAULT_TAX_RATE
    return normalizeTaxRate(product.tax.rate)
}

// ── Montos del DTE ──────────────────────────────────────────────────
// Réplica de `totales_dte` en backend/app/utils/taxes.py, que a su vez replica
// `calcular_totales` de dte-torn. Lo que muestra el POS tiene que ser el total
// exacto del documento: si una de las tres cambia, las tres.

/** Boletas: el precio que va al documento ya trae el IVA. */
export const BOLETAS = [39, 41]

/**
 * Redondeo al peso, mitad hacia arriba (ROUND_HALF_UP del backend). El margen
 * absorbe el error de punto flotante: 950 * 1.19 da 1130.4999999999998 y debe
 * redondear a 1131, igual que con Decimal.
 */
export function pesos(x: number): number {
    return Math.round(x + 1e-6)
}

/** Precio unitario bruto al peso, el que se muestra y el que va a la boleta. */
export function precioBruto(precioNeto: number, rate: number): number {
    return pesos(precioNeto * (1 + rate))
}

/** Totales de un documento a partir de sus líneas (neto unitario, cantidad, tasa). */
export function totalesDte(
    tipoDte: number,
    lineas: { precioNeto: number; cantidad: number; rate: number }[],
): { neto: number; iva: number; total: number } {
    const boleta = BOLETAS.includes(tipoDte)
    let afecto = 0
    let exento = 0
    for (const l of lineas) {
        const precio = boleta ? precioBruto(l.precioNeto, l.rate) : l.precioNeto
        const monto = pesos(l.cantidad * precio)
        if (l.rate === 0) exento += monto
        else afecto += monto
    }
    const iva = boleta
        ? afecto - (afecto ? pesos(afecto / (1 + DEFAULT_TAX_RATE)) : 0)
        : pesos(afecto * DEFAULT_TAX_RATE)
    const total = boleta ? afecto + exento : afecto + exento + iva
    return { neto: total - iva, iva, total }
}
