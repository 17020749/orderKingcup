import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { catalogReferencePlan, summarizeCatalogReferenceUsage } from '../utils/catalogReferencePlan.mjs'

test('warehouse plan checks legacy and current references without full collection loaders', () => {
  const plan = catalogReferencePlan('warehouses', {
    id: 'wh-1',
    legacy_id: 'legacy-wh',
    warehouse_code: 'KHO-01',
  })

  assert.ok(plan.some(item => item.collection === 'import_order_items' && item.field === 'warehouse_id' && item.value === 'wh-1'))
  assert.ok(plan.some(item => item.collection === 'export_order_items' && item.field === 'to_warehouse_code' && item.value === 'KHO-01'))
  assert.ok(plan.some(item => item.collection === 'inventory_balances' && item.field === 'warehouse_legacy_id' && item.value === 'legacy-wh'))
  assert.ok(plan.some(item => item.collection === 'inventory_adjustments'))
})

test('supplier and unit plans cover every relation group', () => {
  const supplier = catalogReferencePlan('suppliers', { id: 'sup-1', supplier_code: 'NCC-01' })
  assert.deepEqual(new Set(supplier.map(item => item.collection)), new Set(['import_orders']))

  const unit = catalogReferencePlan('units', { unit_code: 'THUNG', name: 'Thùng' })
  assert.deepEqual(new Set(unit.map(item => item.collection)), new Set([
    'products', 'import_order_items', 'export_order_items',
  ]))
})

test('usage summary keeps the existing user-facing detail', () => {
  assert.deepEqual(
    summarizeCatalogReferenceUsage('warehouses', { import: 1, export: 2, balance: 3, adjustment: 4 }),
    { total: 10, detail: 'nhập 1, xuất 2, tồn 3, điều chỉnh 4' },
  )
  assert.deepEqual(
    summarizeCatalogReferenceUsage('units', { product: 2, import: 1, export: 1 }),
    { total: 4, detail: 'sản phẩm 2, dòng nhập 1, dòng xuất 1' },
  )
})

test('warehouse settings loads only catalogs on mount and checks references on delete', () => {
  const page = readFileSync('pages/warehouse-settings.vue', 'utf8')
  const loadSection = page.slice(page.indexOf('async function loadRows'), page.indexOf('onMounted'))
  const deleteSection = page.slice(page.indexOf('async function removeCatalog'), page.indexOf('async function loadRows'))

  assert.doesNotMatch(loadSection, /loadImportOrders|loadImportOrderItems|loadExportOrders|loadExportOrderItems|loadInventoryBalances|loadInventoryAdjustments|loadProducts/)
  assert.match(deleteSection, /await checkCatalogUsage\(activeTab\.value, row\)/)
  assert.match(page, /where\(probe\.field, '==', probe\.value\)/)
})
