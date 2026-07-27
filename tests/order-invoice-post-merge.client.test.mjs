import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ORDER_EDIT_SYSTEM_FIELDS,
  stripOrderEditSystemFields,
} from '../utils/orderAtomicSave.mjs'

// These tests guard the regressions found during the audits after the atomic order/invoice changes.

test('sửa order loại bỏ toàn bộ field hệ thống dễ bị stale trước khi ghi', () => {
  const payload = Object.fromEntries(ORDER_EDIT_SYSTEM_FIELDS.map(field => [field, `stale:${field}`]))
  payload.customer_name = 'Khách vẫn được sửa'
  payload.note = 'Ghi chú mới'

  const result = stripOrderEditSystemFields(payload)

  assert.equal(result.customer_name, 'Khách vẫn được sửa')
  assert.equal(result.note, 'Ghi chú mới')
  for (const field of ORDER_EDIT_SYSTEM_FIELDS) {
    assert.equal(Object.hasOwn(result, field), false, `${field} phải bị loại khỏi payload sửa order`)
  }
  assert.equal(payload.invoice_relation_revision, 'stale:invoice_relation_revision')
})

test('orders.vue dùng helper chung thay vì danh sách protected fields thiếu relation', () => {
  const source = readFileSync('pages/orders.vue', 'utf8')
  assert.match(source, /stripOrderEditSystemFields\(\{ \.\.\.form, \.\.\.totals \}\)/)
  assert.doesNotMatch(source, /const protectedFields = \[/)
})

test('trang hóa đơn chỉ tải parent order của invoice đang hiển thị', () => {
  const invoices = readFileSync('pages/invoices.vue', 'utf8')
  const scoped = readFileSync('composables/useScopedQueries.ts', 'utf8')

  assert.match(invoices, /loadScopedOrdersForInvoices/)
  assert.doesNotMatch(invoices, /orders\.value = await loadScopedOrders\(force\)/)
  assert.match(scoped, /async function loadScopedOrdersForInvoices/)
  assert.match(scoped, /fetchByFieldValues<OrderDoc>\('orders', 'id', orderIds\)/)
})

test('trang hóa đơn yêu cầu parent đã tải và invoices.view_all cùng action', () => {
  const invoices = readFileSync('pages/invoices.vue', 'utf8')
  const scoped = readFileSync('composables/useScopedQueries.ts', 'utf8')
  assert.match(invoices, /function parentOrderForInvoice/)
  assert.match(invoices, /if \(!order\) return false/)
  assert.match(invoices, /viewAllPermission: 'invoices\.view_all'/)
  assert.match(invoices, /record: null/)
  assert.match(invoices, /parent: null/)
  assert.match(scoped, /canAll\('invoices\.view_all'\)/)
  assert.match(scoped, /getDocFromServer\(doc\(db, 'orders', orderId\)\)/)
})
