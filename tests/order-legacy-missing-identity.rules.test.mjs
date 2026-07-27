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

const projectId = 'demo-orderkingcup-legacy-missing-identity'
const SALE = 'hieunt051999@gmail.com'
const OTHER_SALE = 'other-sale@example.com'
const ORDER_ID = 'ord_1784691728437_2c2195192150'
const INVOICE_ID = `inv_${ORDER_ID}`
let env

function legacyOrder() {
  return {
    id: ORDER_ID,
    order_code: 'SALE01-ABC001-0001',
    customer_id: 'customer-legacy',
    customer_name: 'Khách legacy',
    owner_email: SALE,
    created_by: SALE,
    sale_email: SALE,
    warehouse_fulfillment_status: 'chua_xuat',
    payable_amount: 150000,
    actual_revenue: 150000,
    invoice_status: 'Không xuất',
    active: true,
    deleted: false,
    status: 'active',
    // Oldest records intentionally do not contain order_sequence, user_code,
    // customer_code, created_at, relation counters or revision fields.
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
        user_code: 'SALE01',
        active: true,
        deleted: false,
        permissions_flat: ['page.orders', 'orders.view', 'orders.edit'],
      }),
      setDoc(doc(db, 'users', OTHER_SALE), {
        email: OTHER_SALE,
        user_code: 'SALE02',
        active: true,
        deleted: false,
        permissions_flat: ['page.orders', 'orders.view', 'orders.edit'],
      }),
      setDoc(doc(db, 'orders', ORDER_ID), legacyOrder()),
    ])
  })
})

after(async () => env.cleanup())

function repairMissingInvoiceBatch(db, actor, identityDrift = {}) {
  const timestamp = serverTimestamp()
  const operationId = `repair-${ORDER_ID}`
  const batch = writeBatch(db)

  batch.set(doc(db, 'invoices', INVOICE_ID), {
    id: INVOICE_ID,
    order_id: ORDER_ID,
    order_code: 'SALE01-ABC001-0001',
    invoice_number: '',
    invoice_date: '',
    invoice_amount: 150000,
    invoice_status: 'Không xuất',
    tax_code: '',
    company_name: '',
    billing_address: '',
    note: '',
    created_by: actor,
    order_owner_email: SALE,
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

  batch.update(doc(db, 'orders', ORDER_ID), {
    note: 'Sale sửa đơn legacy và tự tạo hóa đơn',
    invoice_status: 'Không xuất',
    invoice_record_count: 1,
    invoice_relation_revision: 1,
    relation_lock_version: 1,
    relation_last_module: 'invoices',
    relation_last_action: 'create',
    relation_last_document_id: INVOICE_ID,
    relation_updated_by: actor,
    relation_updated_at: timestamp,
    revision: 1,
    last_operation_id: operationId,
    updated_at: timestamp,
    ...identityDrift,
  })

  return batch
}

test('Sale sở hữu order cũ thiếu invoice và thiếu identity field vẫn sửa + tạo invoice nguyên tử', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertSucceeds(repairMissingInvoiceBatch(db, SALE).commit())

  const order = (await getDoc(doc(db, 'orders', ORDER_ID))).data()
  const invoice = (await getDoc(doc(db, 'invoices', INVOICE_ID))).data()
  assert.equal(order.invoice_record_count, 1)
  assert.equal(invoice.order_id, ORDER_ID)
  assert.equal(invoice.created_by, SALE)
  for (const field of ['order_sequence', 'user_code', 'customer_code', 'created_at']) {
    assert.equal(Object.hasOwn(order, field), false, `${field} phải tiếp tục vắng mặt sau edit`)
  }
})

test('Client tự thêm identity field còn thiếu vào order legacy bị Rules từ chối', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertFails(repairMissingInvoiceBatch(db, SALE, {
    order_sequence: 1,
    user_code: 'SALE01',
    customer_code: 'ABC001',
  }).commit())
})

test('Sale khác không được lợi dụng nhánh repair để tạo invoice cho order không sở hữu', async () => {
  const db = env.authenticatedContext(OTHER_SALE, { email: OTHER_SALE }).firestore()
  await assertFails(repairMissingInvoiceBatch(db, OTHER_SALE).commit())
})
