import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync('utils/warehouseLotAllocation.ts', 'utf8')
const transactions = readFileSync('composables/useWarehouseCostTransactions.ts', 'utf8')
const productsPage = readFileSync('pages/products.vue', 'utf8')
const settingsPage = readFileSync('pages/settings/general.vue', 'utf8')
const inventoryPage = readFileSync('pages/inventory.vue', 'utf8')

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

test('product catalog removes legacy cost_price and settings provides migration', () => {
  assert.match(productsPage, /cost_price:\s*deleteField\(\)/)
  assert.doesNotMatch(productsPage, /Giá vốn/)
  assert.match(settingsPage, /cleanupLegacyProductCosts/)
  assert.match(settingsPage, /cost_price:\s*deleteField\(\)/)
})

test('inventory cost details require import.view and join prices only in the viewer', () => {
  assert.match(inventoryPage, /hasPermission\('import\.view'\)/)
  assert.match(inventoryPage, /if \(canViewCost\.value\)/)
  assert.match(inventoryPage, /loadImportOrderItems\(force\)/)
  assert.match(inventoryPage, /Các lô giá/)
  assert.match(inventoryPage, /Giá trị còn lại/)
  assert.match(inventoryPage, /costItem as any\)\.unit_cost/)
})

test('warehouse users can load inventory without reading priced import documents', () => {
  const guardedLoadIndex = inventoryPage.indexOf('if (canViewCost.value)')
  const importLoadIndex = inventoryPage.indexOf('loadImportOrders(force)', guardedLoadIndex)
  const importItemLoadIndex = inventoryPage.indexOf('loadImportOrderItems(force)', guardedLoadIndex)
  assert.ok(guardedLoadIndex >= 0)
  assert.ok(importLoadIndex > guardedLoadIndex)
  assert.ok(importItemLoadIndex > guardedLoadIndex)
})
