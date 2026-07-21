import assert from 'node:assert/strict'
import test from 'node:test'
import { appendUniqueRows, createCursorState } from '../utils/cursorPagination.mjs'

test('appendUniqueRows appends new records and replaces duplicates by id', () => {
  const rows = appendUniqueRows(
    [{ id: 'a', value: 1 }, { id: 'b', value: 2 }],
    [{ id: 'b', value: 3 }, { id: 'c', value: 4 }],
  )
  assert.deepEqual(rows, [
    { id: 'a', value: 1 },
    { id: 'b', value: 3 },
    { id: 'c', value: 4 },
  ])
})

test('appendUniqueRows ignores rows without a stable Firestore id', () => {
  assert.deepEqual(appendUniqueRows([], [{ name: 'missing' }, { firestore_id: 'x', value: 1 }]), [
    { firestore_id: 'x', value: 1 },
  ])
})

test('createCursorState returns a fresh resettable state', () => {
  assert.deepEqual(createCursorState(), { cursor: null, hasMore: false, mode: 'cursor' })
  assert.notEqual(createCursorState(), createCursorState())
})

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function source(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')
}

test('large list pages use cursor page loaders and expose a load-more control', () => {
  const expectations = {
    'pages/orders.vue': 'loadScopedOrdersPage',
    'pages/payments.vue': 'loadScopedPaymentsPage',
    'pages/invoices.vue': 'loadScopedInvoicesPage',
    'pages/shipments.vue': 'loadScopedShipmentsPage',
    'pages/imports.vue': 'loadImportOrdersPage',
    'pages/exports.vue': 'loadExportOrdersPage',
    'pages/inventory-adjustments.vue': 'loadInventoryAdjustmentsPage',
  }

  for (const [file, loader] of Object.entries(expectations)) {
    const content = source(file)
    assert.match(content, new RegExp(loader))
    assert.match(content, /<CursorLoadMore/)
    assert.match(content, /pageCursor/)
  }
})

test('parent list pages load relation rows only for the loaded parent page', () => {
  const scopedQueries = source('composables/useScopedQueries.ts')
  assert.match(scopedQueries, /fetchByFieldValues<OrderItemDoc>\('order_items', 'order_id', orderIds\)/)
  assert.match(scopedQueries, /loadImportOrderItemsForOrders/)
  assert.match(scopedQueries, /loadExportOrderItemsForOrders/)
  assert.match(source('pages/orders.vue'), /loadScopedPaymentsForOrders\(pageOrders/)
  assert.match(source('pages/orders.vue'), /loadScopedExportRequestsForOrders\(pageOrders/)
})

test('dashboard keeps the accurate client aggregation path until a backend summary exists', () => {
  const scopedQueries = source('composables/useScopedQueries.ts')
  const dashboard = source('pages/dashboard.vue')
  assert.doesNotMatch(scopedQueries, /loadAdminDashboardSummary/)
  assert.doesNotMatch(scopedQueries, /getAggregateFromServer/)
  assert.doesNotMatch(dashboard, /loadAdminDashboardSummary/)
  assert.match(dashboard, /async function loadDashboard/)
  assert.match(dashboard, /loadScopedOrders\(force\)/)
})
