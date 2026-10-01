/** `npm test`. Queda fuera de tsconfig, como taxes.test.ts. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatCLP } from './format.ts'

test('formatCLP pone el signo antes del peso y no deja "-$0"', () => {
    assert.equal(formatCLP(-13000), '-$13.000')
    assert.equal(formatCLP(1234.6), '$1.235')
    assert.equal(formatCLP(-0.4), '$0')
})
