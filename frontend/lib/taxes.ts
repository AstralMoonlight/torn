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
