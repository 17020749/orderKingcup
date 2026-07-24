import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Security boundary: Warehouse and bus transport operate on request snapshots,
// while Firestore Rules alone validate the original order-item references.
function matchBlock(source, start, end) {
  const from = source.indexOf(start)
  assert.notEqual(from, -1, `Missing block start: ${start}`)
  const to = source.indexOf(end, from)
  assert.notEqual(to, -1, `Missing block end: ${end}`)
  return source.slice(from, to)
}

test('bus transport uses request snapshots and never queries orders or customers', () => {
  const page = readFileSync('pages/bus-transport.vue', 'utf8')
  assert.ok(page.includes("collection(db, 'order_export_requests')"))
  assert.ok(page.includes('isRejectedRequest'))
  assert.ok(page.includes('source_request_id'))
  assert.ok(page.includes('receiver_phone'))
  assert.ok(page.includes('receiver_address'))
  assert.ok(!page.includes("collection(db, 'orders')"))
  assert.ok(!page.includes("doc(db, 'customers'"))
  assert.ok(!page.includes('customerCache'))
})

test('warehouse UI does not receive order read permission through rules', () => {
  const rules = readFileSync('firestore.rules', 'utf8')
  const customerBlock = matchBlock(rules, 'match /customers/{docId}', 'match /customer_codes/{customerCode}')
  const orderBlock = matchBlock(rules, 'match /orders/{docId}', 'match /order_items/{docId}')
  assert.ok(!customerBlock.includes("'export.print'"))
  assert.ok(!customerBlock.includes("'bus_transport.view'"))
  assert.ok(!orderBlock.includes("hasPerm('bus_transport.view')"))
  assert.ok(rules.includes('requestSnapshotAllowsExportItem'))
  assert.ok(rules.includes("sourceItem.get('order_id', '') == request.resource.data.get('source_order_id', '')"))
  assert.ok(rules.includes("request.resource.data.get('quantity', 0) <= sourceItem.get('quantity', 0)"))
})

test('permission catalog remains unchanged and has no warehouse order dependency', () => {
  const access = readFileSync('constants/accessMatrix.mjs', 'utf8')
  assert.ok(access.includes("'page.bus_transport': ['bus_transport.view']"))
  assert.ok(access.includes("'bus_transport.view': ['page.bus_transport']"))
  assert.ok(!access.includes("'bus_transport.view': ['page.bus_transport', 'orders.view"))
  assert.ok(!access.includes("'export_requests.release': ['page.warehouse_export_requests', 'inventory.view', 'export.view', 'orders.view"))
})
