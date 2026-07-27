import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('sửa order luôn kiểm tra invoice thực tế thay vì tin invoice_record_count', () => {
  const source = readFileSync('pages/orders.vue', 'utf8')
  const editBlock = source.slice(source.indexOf('let invoiceMutation'), source.indexOf('const baseOrder'))
  assert.match(editBlock, /loadScopedInvoicesForOrders\(\[editing\.value\], true\)/)
  assert.match(editBlock, /if \(!currentInvoice\) \{[\s\S]*mode: 'legacy_create'/)
  assert.doesNotMatch(editBlock, /persistedInvoiceCount/)
  assert.doesNotMatch(editBlock, /invoice_record_count.*!== 1/)
})

test('atomic save phục hồi invoice đã soft-delete và không chặn bởi counter legacy', () => {
  const source = readFileSync('composables/useAtomicOrderSave.ts', 'utf8')
  assert.match(source, /isActiveOrderRelation/)
  assert.match(source, /existingInvoice = persistedInvoice/)
  assert.match(source, /created_at: existingInvoice\?\.created_at \|\| serverTimestamp\(\)/)
  assert.doesNotMatch(source, /existingOrder\.invoice_record_count\) > 0/)
})

test('trang hóa đơn và composable relation bắt buộc view_all cùng action', () => {
  const page = readFileSync('pages/invoices.vue', 'utf8')
  const relation = readFileSync('composables/useAtomicOrderRelations.ts', 'utf8')
  assert.match(page, /record: null,[\s\S]*parent: null/)
  assert.match(relation, /const requiresGlobalScope = module === 'invoices'/)
  assert.match(relation, /record: requiresGlobalScope \? null/)
  assert.match(relation, /parent: requiresGlobalScope \? null : order/)
})

test('invoices.view_all tải được parent order bằng document get, không cần orders.view_all', () => {
  const source = readFileSync('composables/useScopedQueries.ts', 'utf8')
  assert.match(source, /if \(canAll\('invoices\.view_all'\)\) \{[\s\S]*getDocFromServer\(doc\(db, 'orders', orderId\)\)/)
})
