import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { planOrderEditInvoiceMutation } from '../utils/orderInvoiceFlow.mjs'
import { preservePersistedOrderIdentityForEdit } from '../utils/orderAtomicSave.mjs'
import { moduleActionDecision } from '../utils/permissionDecisions.mjs'

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

test('client runtime lên kế hoạch đồng bộ snapshot hóa đơn khi đổi khách', () => {
  const invoice = {
    id: 'inv_order-existing',
    invoice_status: 'Không xuất',
    relation_revision: 4,
  }
  assert.deepEqual(planOrderEditInvoiceMutation({
    orderId: 'order-existing',
    persistedStatus: 'Không xuất',
    requestedStatus: 'Không xuất',
    currentInvoice: invoice,
    activeInvoiceCount: 1,
    customerChanged: true,
    payload: { tax_code: 'MST', company_name: 'Công ty mới', billing_address: 'Địa chỉ mới' },
  }), {
    mode: 'customer_update',
    invoiceId: 'inv_order-existing',
    requestedStatus: 'Không xuất',
    expectedStatus: 'Không xuất',
    expectedRelationRevision: 4,
    payload: { tax_code: 'MST', company_name: 'Công ty mới', billing_address: 'Địa chỉ mới' },
  })
})

test('client runtime chặn đổi khách khi đồng thời đổi trạng thái hóa đơn hoặc hóa đơn đã xuất', () => {
  const invoice = { id: 'inv_order-existing', invoice_status: 'Không xuất', relation_revision: 1 }
  assert.throws(() => planOrderEditInvoiceMutation({
    orderId: 'order-existing', persistedStatus: 'Không xuất', requestedStatus: 'Yêu cầu xuất',
    currentInvoice: invoice, customerChanged: true,
  }), /trạng thái hóa đơn/)
  assert.throws(() => planOrderEditInvoiceMutation({
    orderId: 'order-existing', persistedStatus: 'Đã xuất', requestedStatus: 'Đã xuất',
    currentInvoice: { ...invoice, invoice_status: 'Đã xuất' }, customerChanged: true,
  }), /hóa đơn đã xuất/)
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
    owner_email: '',
    created_by: '',
    sale_email: '',
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

test('client nhận ownership legacy bằng user_code hoặc tiền tố order_code, không nhận order Sale khác', () => {
  const permissions = ['orders.edit']
  const owned = moduleActionDecision({
    actionPermission: 'orders.edit',
    viewAllPermission: 'orders.view_all',
    permissions,
    record: { order_code: 'SALE01-ABC001-0001', owner_email: '', created_by: '', sale_email: '' },
    currentUserEmail: 'hieunt051999@gmail.com',
    currentUserCode: 'SALE01',
    allowLegacyOrderCodeOwnership: true,
  })
  assert.equal(owned.allowed, true)
  assert.equal(owned.ownsRecord, true)

  const foreign = moduleActionDecision({
    actionPermission: 'orders.edit',
    viewAllPermission: 'orders.view_all',
    permissions,
    record: { order_code: 'SALE01-ABC001-0001', owner_email: '', created_by: '', sale_email: '' },
    currentUserEmail: 'other-sale@example.com',
    currentUserCode: 'SALE02',
    allowLegacyOrderCodeOwnership: true,
  })
  assert.equal(foreign.allowed, false)
  assert.equal(foreign.code, 'missing_scope')
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
