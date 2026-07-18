import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync('utils/warehouseLotAllocation.ts', 'utf8')
const transactions = readFileSync('composables/useWarehouseCostTransactions.ts', 'utf8')

test('lot engine supports configured issue policies', () => {
  assert.match(source, /'fifo'/)
  assert.match(source, /'fefo'/)
  assert.match(source, /'smallest_lot_first'/)
})

test('export transaction stores only lot references and quantities', () => {
  assert.match(transactions, /lot_allocations_json/)
  const exportSection = transactions.slice(transactions.indexOf('async function createExportOrder'))
  assert.doesNotMatch(exportSection, /unit_cost\s*:/)
  assert.doesNotMatch(exportSection, /line_cost\s*:/)
})

test('priced fields are limited to import transaction payloads', () => {
  const importSection = transactions.slice(
    transactions.indexOf('async function createImportOrder'),
    transactions.indexOf('async function prepareExportLines'),
  )
  assert.match(importSection, /unit_cost:/)
  assert.match(importSection, /line_cost:/)
})
