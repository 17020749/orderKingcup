import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-order-invoice-legacy-backfill'
const SALE = 'legacy-sale@example.com'
const OTHER = 'legacy-other@example.com'
const ACCOUNTANT = 'legacy-accountant@example.com'
const VIEWER = 'legacy-viewer@example.com'
let env

function baseOrder(id, overrides = {}) {
  return {
    id,
    order_code: `SALE1-${id}`,
    order_sequence: 1,
    user_code: 'SALE1',
    customer_id: 'customer-legacy',
    customer_code: 'ABC001',
    customer_name: 'Khách legacy',
    owner_email: SALE,
    created_by: SALE,
    sale_email: SALE,
    order_status: 'Mới tạo',
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: '',
    payable_amount: 150000,
    actual_revenue: 150000,
    invoice_status: 'Không xuất',
    relation_lock_version: 1,
    payment_record_count: 0,
    invoice_record_count: 0,
    shipment_record_count: 0,
    payment_relation_revision: 0,
    invoice_relation_revision: 0,
    shipment_relation_revision: 0,
    printing_lock_version: 1,
    printing_progress_count: 0,
    revision: 1,
    last_operation_id: 'seed-order',
    active: true,
    deleted: false,
    status: 'active',
    created_at: '2026-07-27T00:00:00.000Z',
    updated_at: '2026-07-27T00:00:00.000Z',
    ...overrides,
  }
}

function baseInvoice(orderId, overrides = {}) {
  return {
    id: `inv_${orderId}`,
    order_id: orderId,
    order_code: `SALE1-${orderId}`,
    invoice_number: '',
    invoice_date: '',
    invoice_amount: 150000,
    invoice_status: 'Không xuất',
    tax_code: '',
    company_name: '',
    billing_address: '',
    note: '',
    created_by: SALE,
    order_owner_email: SALE,
    order_created_by: SALE,
    order_sale_email: SALE,
    relation_revision: 1,
    last_operation_id: 'seed-invoice',
    active: true,
    deleted: false,
    status: 'active',
    created_at: '2026-07-27T00:00:00.000Z',
    updated_at: '2026-07-27T00:00:00.000Z',
    ...overrides,
  }
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', SALE), {
        email: SALE,
        user_code: 'SALE1',
        active: true,
        deleted: false,
        permissions_flat: ['page.orders', 'orders.view', 'orders.edit'],
      }),
      setDoc(doc(db, 'users', OTHER), {
        email: OTHER,
        user_code: 'SALE2',
        active: true,
        deleted: false,
        permissions_flat: ['page.orders', 'orders.view', 'orders.edit'],
      }),
      setDoc(doc(db, 'users', ACCOUNTANT), {
        email: ACCOUNTANT,
        user_code: 'ACC1',
        active: true,
        deleted: false,
        permissions_flat: ['page.invoices', 'orders.view_all', 'invoices.view_all', 'invoices.edit'],
      }),
      setDoc(doc(db, 'users', VIEWER), {
        email: VIEWER,
        user_code: 'VIEW1',
        active: true,
        deleted: false,
        permissions_flat: ['page.invoices', 'orders.view_all', 'invoices.view_all'],
      }),
      setDoc(doc(db, 'orders', 'order-legacy'), baseOrder('order-legacy')),
      setDoc(doc(db, 'orders', 'order-issued'), baseOrder('order-issued', { invoice_status: 'Đã xuất' })),
      setDoc(doc(db, 'orders', 'order-accounting'), baseOrder('order-accounting', {
        invoice_record_count: 1,
        invoice_relation_revision: 1,
      })),
      setDoc(doc(db, 'invoices', 'inv_order-accounting'), baseInvoice('order-accounting')),
    ])
  })
})

after(async () => env.cleanup())

function legacyCreateBatch(db, {
  orderId = 'order-legacy',
  nextStatus = 'Yêu cầu xuất',
  actor = SALE,
  invoiceNumber = '',
  invoiceDate = '',
  invoiceAmount = 150000,
  ownerEmail = SALE,
  includeParent = true,
  includeChild = true,
} = {}) {
  const invoiceId = `inv_${orderId}`
  const operationId = `legacy-create-${orderId}`
  const timestamp = serverTimestamp()
  const batch = writeBatch(db)
  if (includeChild) {
    batch.set(doc(db, 'invoices', invoiceId), {
      id: invoiceId,
      order_id: orderId,
      order_code: `SALE1-${orderId}`,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      invoice_amount: invoiceAmount,
      invoice_status: nextStatus,
      tax_code: '',
      company_name: '',
      billing_address: '',
      note: '',
      created_by: actor,
      order_owner_email: ownerEmail,
      order_created_by: SALE,
      order_sale_email: SALE,
      relation_revision: 1,
      last_operation_id: operationId,
      active: true,
      deleted: false,
      status: 'active',
      created_at: timestamp,
      updated_at: timestamp,
    })
  }
  if (includeParent) {
    batch.update(doc(db, 'orders', orderId), {
      note: 'Đơn cũ được lưu và tự tạo hóa đơn',
      invoice_status: nextStatus,
      invoice_record_count: 1,
      invoice_relation_revision: 1,
      relation_lock_version: 1,
      relation_last_module: 'invoices',
      relation_last_action: 'create',
      relation_last_document_id: invoiceId,
      relation_updated_by: actor,
      relation_updated_at: timestamp,
      revision: 2,
      last_operation_id: operationId,
      updated_at: timestamp,
    })
  }
  return batch
}

function accountingUpdateBatch(db, actor = ACCOUNTANT) {
  const timestamp = serverTimestamp()
  const batch = writeBatch(db)
  batch.update(doc(db, 'invoices', 'inv_order-accounting'), {
    invoice_number: '',
    invoice_date: '',
    invoice_amount: -1,
    invoice_status: 'Đã xuất',
    relation_revision: 2,
    last_operation_id: 'accounting-status-only',
    updated_at: timestamp,
  })
  batch.update(doc(db, 'orders', 'order-accounting'), {
    invoice_status: 'Đã xuất',
    invoice_record_count: 1,
    invoice_relation_revision: 2,
    relation_lock_version: 1,
    relation_last_module: 'invoices',
    relation_last_action: 'update',
    relation_last_document_id: 'inv_order-accounting',
    relation_updated_by: actor,
    relation_updated_at: timestamp,
    updated_at: timestamp,
  })
  return batch
}

test('Sale có orders.edit tự tạo invoice cho order legacy trong cùng batch', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertSucceeds(legacyCreateBatch(db).commit())
  const savedOrder = (await getDoc(doc(db, 'orders', 'order-legacy'))).data()
  const savedInvoice = (await getDoc(doc(db, 'invoices', 'inv_order-legacy'))).data()
  assert.equal(savedOrder.invoice_record_count, 1)
  assert.equal(savedOrder.invoice_status, 'Yêu cầu xuất')
  assert.equal(savedInvoice.invoice_status, 'Yêu cầu xuất')
})

test('lazy create bắt buộc parent và child cùng giao dịch', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertFails(legacyCreateBatch(db, { includeParent: false }).commit())
  await assertFails(legacyCreateBatch(db, { includeChild: false }).commit())
})

test('Sale không được giả dữ liệu kế toán, số tiền hoặc trạng thái Đã xuất khi tạo legacy', async () => {
  for (const invalid of [
    { invoiceNumber: 'FORGED' },
    { invoiceDate: '2026-07-27' },
    { invoiceAmount: 1 },
    { ownerEmail: OTHER },
    { nextStatus: 'Đã xuất' },
  ]) {
    await env.clearFirestore()
    await beforeEach[Symbol.for('noop')]
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore()
      await Promise.all([
        setDoc(doc(db, 'users', SALE), { email: SALE, active: true, deleted: false, permissions_flat: ['orders.view', 'orders.edit'] }),
        setDoc(doc(db, 'orders', 'order-legacy'), baseOrder('order-legacy')),
      ])
    })
    const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
    await assertFails(legacyCreateBatch(db, invalid).commit())
  }
})

test('order legacy đã mang Đã xuất được tạo invoice Đã xuất với số và ngày trống', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertSucceeds(legacyCreateBatch(db, {
    orderId: 'order-issued',
    nextStatus: 'Đã xuất',
  }).commit())
  const savedInvoice = (await getDoc(doc(db, 'invoices', 'inv_order-issued'))).data()
  assert.equal(savedInvoice.invoice_status, 'Đã xuất')
  assert.equal(savedInvoice.invoice_number, '')
  assert.equal(savedInvoice.invoice_date, '')
})

test('kế toán chỉ cần trạng thái hợp lệ, không còn bị chặn bởi số tiền, số hóa đơn hoặc ngày', async () => {
  const db = env.authenticatedContext(ACCOUNTANT, { email: ACCOUNTANT }).firestore()
  await assertSucceeds(accountingUpdateBatch(db).commit())
  const savedInvoice = (await getDoc(doc(db, 'invoices', 'inv_order-accounting'))).data()
  assert.equal(savedInvoice.invoice_status, 'Đã xuất')
  assert.equal(savedInvoice.invoice_amount, -1)
  assert.equal(savedInvoice.invoice_number, '')
  assert.equal(savedInvoice.invoice_date, '')
})

test('người không có invoices.edit vẫn không sửa được hóa đơn', async () => {
  const db = env.authenticatedContext(VIEWER, { email: VIEWER }).firestore()
  await assertFails(accountingUpdateBatch(db, VIEWER).commit())
})
