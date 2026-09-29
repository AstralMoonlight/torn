/**
 * Contrato de los totales (#39): la tabla vive en dte-torn, dueño del cálculo,
 * y la corren también el backend y dte-torn. `npm test` (node:test, sin
 * dependencias). Queda fuera de tsconfig: Docker construye sin `dte-torn/`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { totalesDte } from './taxes.ts'

type Caso = {
    id: string
    tipo_dte: number
    pendiente?: string[]
    lineas: { precio_neto: string; cantidad: string; exento: boolean; descuento?: string; descuento_pct?: string }[]
    descuentos_globales?: { valor: string; porcentaje: boolean }[]
    esperado: { neto: number; exento: number; iva: number; total: number }
}

const ruta = new URL('../../dte-torn/tests/casos_totales.json', import.meta.url)
const { casos } = JSON.parse(readFileSync(ruta, 'utf-8')) as { casos: Caso[] }

for (const caso of casos) {
    test(caso.id, { skip: caso.pendiente?.includes('frontend') && 'pendiente en el frontend' }, () => {
        const t = totalesDte(caso.tipo_dte, caso.lineas.map((l) => ({
            precioNeto: Number(l.precio_neto),
            cantidad: Number(l.cantidad),
            rate: l.exento ? 0 : 0.19,
            descuento: Number(l.descuento ?? 0),
            descuentoPct: l.descuento_pct ? Number(l.descuento_pct) : undefined,
        })), (caso.descuentos_globales ?? []).map((g) => ({ valor: Number(g.valor), porcentaje: g.porcentaje })))
        // `totalesDte` no separa lo exento: su neto es todo lo que no es IVA.
        assert.deepEqual(
            { neto: t.neto, iva: t.iva, total: t.total },
            { neto: caso.esperado.neto + caso.esperado.exento, iva: caso.esperado.iva, total: caso.esperado.total },
        )
    })
}
