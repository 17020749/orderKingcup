import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { planOrderEditInvoiceMutation } from '../utils/orderInvoiceFlow.mjs'
import { preservePersistedOrderIdentityForEdit } from '../utils/orderAtomicSave.mjs'

test('client runtime chọn legacy_create khi order cũ không có invoice dù counter từng ghi 1', () => {
  const mutation = planOrderEditInvoiceMutation({
    orderId: 'ord_1784691728437_2c2195192150',
    persistedStatus: 'Không xuất',
    requestedStatus: 'Không xuất',
    activeInvoiceCount: 0,
    currentInvoice: null,
    payload: { tax_code: '', company_name: '', billing_address: '', note: '' },
  })

  assert.deepEqual(mutation, {
    mode: 'legacy_create',
    invoiceId: 'inv_ord_1784691728437_2c2195192150',
    requestedStatus: 'Không xuất',
    payload: { tax_code: '', company_name: '', billing_address: '', note: '' },
  })
})

test('client runtime chỉ status_update khi có đúng một invoice và Sale đổi trạng thái', () => {
  const invoice = {
    id: 'inv_order-existing',
    invoice_status: 'Không xuất',
    relation_revision: 4,
  }
  assert.equal(planOrderEditInvoiceMutation({
    orderId: 'order-existing',
    persistedStatus: 'Không xuất',
    requestedStatus: 'Không xuất',
    currentInvoice: invoice,
    activeInvoiceCount: 1,
  }), undefined)

  assert.deepEqual(planOrderEditInvoiceMutation({
    orderId: 'order-existing',
    persistedStatus: 'Không xuất',
    requestedStatus: 'Yêu cầu xuất',
    currentInvoice: invoice,
    activeInvoiceCount: 1,
  }), {
    mode: 'status_update',
    invoiceId: 'inv_order-existing',
    requestedStatus: 'Yêu cầu xuất',
    expectedStatus: 'Không xuất',
    expectedRelationRevision: 4,
  })
})

test('client runtime chặn nhiều invoice hoạt động trước transaction', () => {
  assert.throws(() => planOrderEditInvoiceMutation({
    orderId: 'order-duplicate',
    persistedStatus: 'Không xuất',
    requestedStatus: 'Không xuất',
    currentInvoice: { id: 'invoice-a' },
    activeInvoiceCount: 2,
  }), /nhiều hóa đơn đang hoạt động/)
})

test('client edit giữ nguyên cả sự vắng mặt của field identity trên order legacy', () => {
  const persistedOrder = {
    id: 'ord_1784691728437_2c2195192150',
    order_code: 'SALE01-ABC001-0001',
    customer_id: 'customer-legacy',
    owner_email: 'hieunt051999@gmail.com',
    created_by: 'hieunt051999@gmail.com',
    sale_email: 'hieunt051999@gmail.com',
  }
  const payload = preservePersistedOrderIdentityForEdit({
    order_code: 'SALE01-ABC001-0001',
    order_sequence: 1,
    user_code: 'SALE01',
    customer_id: 'customer-legacy',
    customer_code: 'ABC001',
    owner_email: 'changed@example.com',
    created_by: 'changed@example.com',
    sale_email: 'changed@example.com',
    created_at: 'new-value',
    note: 'Nội dung được sửa',
  }, persistedOrder)

  assert.equal(payload.note, 'Nội dung được sửa')
  assert.equal(payload.order_code, persistedOrder.order_code)
  assert.equal(payload.customer_id, persistedOrder.customer_id)
  assert.equal(payload.owner_email, persistedOrder.owner_email)
  assert.equal(payload.created_by, persistedOrder.created_by)
  assert.equal(payload.sale_email, persistedOrder.sale_email)
  for (const field of ['order_sequence', 'user_code', 'customer_code', 'created_at']) {
    assert.equal(Object.hasOwn(payload, field), false, `${field} không được tự thêm vào order legacy`)
  }
})

test('orders.vue dùng runtime planner thay vì tự dựng nhánh legacy bằng source rời rạc', () => {
  const source = readFileSync('pages/orders.vue', 'utf8')
  const editBlock = source.slice(source.indexOf('let invoiceMutation'), source.indexOf('const baseOrder'))
  assert.match(source, /planOrderEditInvoiceMutation/)
  assert.match(editBlock, /loadScopedInvoicesForOrders\(\[editing\.value\], true\)/)
  assert.match(editBlock, /planOrderEditInvoiceMutation\(\{/)
  assert.doesNotMatch(editBlock, /persistedInvoiceCount/)
})

test('atomic save phục hồi invoice đã soft-delete, giữ identity legacy và không chặn bởi counter', () => {
  const source = readFileSync('composables/useAtomicOrderSave.ts', 'utf8')
  assert.match(source, /isActiveOrderRelation/)
  assert.match(source, /existingInvoice = persistedInvoice/)
  assert.match(source, /created_at: existingInvoice\?\.created_at \|\| serverTimestamp\(\)/)
  assert.match(source, /preservePersistedOrderIdentityForEdit/)
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
