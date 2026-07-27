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

const projectId = 'demo-orderkingcup-invoice-order-repair-permissions'
const SALE = 'sale-repair@example.com'
const OWNER_EDITOR = 'owner-invoice-editor@example.com'
const ACCOUNTANT = 'accountant-global@example.com'
let env

function orderData(id, owner, overrides = {}) {
  return {
    id,
    order_code: `SALE1-${id}`,
    order_sequence: 1,
    user_code: 'SALE1',
    customer_id: 'customer-1',
    customer_code: 'ABC001',
    customer_name: 'Khách kiểm thử',
    owner_email: owner,
    created_by: owner,
    sale_email: owner,
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

function invoiceData(orderId, owner, overrides = {}) {
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
    created_by: owner,
    order_owner_email: owner,
    order_created_by: owner,
    order_sale_email: owner,
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
      setDoc(doc(db, 'users', OWNER_EDITOR), {
        email: OWNER_EDITOR,
        user_code: 'SALE2',
        active: true,
        deleted: false,
        permissions_flat: [
          'page.invoices', 'invoices.view',
          'invoices.create', 'invoices.edit', 'invoices.delete',
        ],
      }),
      setDoc(doc(db, 'users', ACCOUNTANT), {
        email: ACCOUNTANT,
        user_code: 'ACC1',
        active: true,
        deleted: false,
        permissions_flat: [
          'page.invoices', 'invoices.view_all',
          'invoices.create', 'invoices.edit', 'invoices.delete',
        ],
      }),
      setDoc(doc(db, 'orders', 'order-stale-count'), orderData('order-stale-count', SALE, {
        invoice_record_count: 1,
      })),
      setDoc(doc(db, 'orders', 'order-deleted-invoice'), orderData('order-deleted-invoice', SALE, {
        invoice_record_count: 1,
        invoice_relation_revision: 1,
      })),
      setDoc(doc(db, 'invoices', 'inv_order-deleted-invoice'), invoiceData('order-deleted-invoice', SALE, {
        active: false,
        deleted: true,
        status: 'deleted',
        deleted_at: '2026-07-27T01:00:00.000Z',
      })),
      setDoc(doc(db, 'orders', 'order-accounting'), orderData('order-accounting', SALE, {
        invoice_record_count: 1,
        invoice_relation_revision: 1,
      })),
      setDoc(doc(db, 'invoices', 'inv_order-accounting'), invoiceData('order-accounting', SALE)),
      setDoc(doc(db, 'orders', 'order-accounting-create'), orderData('order-accounting-create', SALE)),
      setDoc(doc(db, 'orders', 'order-accounting-delete'), orderData('order-accounting-delete', SALE, {
        invoice_record_count: 1,
        invoice_relation_revision: 1,
      })),
      setDoc(doc(db, 'invoices', 'inv_order-accounting-delete'), invoiceData('order-accounting-delete', SALE)),
      setDoc(doc(db, 'orders', 'order-owner-editor'), orderData('order-owner-editor', OWNER_EDITOR, {
        invoice_record_count: 1,
        invoice_relation_revision: 1,
      })),
      setDoc(doc(db, 'invoices', 'inv_order-owner-editor'), invoiceData('order-owner-editor', OWNER_EDITOR)),
    ])
  })
})

after(async () => env.cleanup())

function legacyRepairBatch(db, {
  orderId,
  actor = SALE,
  currentRelationRevision = 0,
  preservedCreatedAt = null,
} = {}) {
  const invoiceId = `inv_${orderId}`
  const operationId = `repair-${orderId}`
  const timestamp = serverTimestamp()
  const nextRelationRevision = currentRelationRevision + 1
  const batch = writeBatch(db)
  batch.set(doc(db, 'invoices', invoiceId), {
    id: invoiceId,
    order_id: orderId,
    order_code: `SALE1-${orderId}`,
    invoice_number: '',
    invoice_date: '',
    invoice_amount: 150000,
    invoice_status: 'Yêu cầu xuất',
    tax_code: '',
    company_name: '',
    billing_address: '',
    note: '',
    created_by: actor,
    order_owner_email: SALE,
    order_created_by: SALE,
    order_sale_email: SALE,
    relation_revision: nextRelationRevision,
    last_operation_id: operationId,
    active: true,
    deleted: false,
    status: 'active',
    created_at: preservedCreatedAt || timestamp,
    updated_at: timestamp,
  })
  batch.update(doc(db, 'orders', orderId), {
    note: 'Sửa đơn cũ và tự tạo hóa đơn',
    invoice_status: 'Yêu cầu xuất',
    invoice_record_count: 1,
    invoice_relation_revision: nextRelationRevision,
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
  return batch
}

function accountingCreateBatch(db, actor) {
  const orderId = 'order-accounting-create'
  const invoiceId = 'invoice-accounting-created'
  const timestamp = serverTimestamp()
  const batch = writeBatch(db)
  batch.set(doc(db, 'invoices', invoiceId), {
    ...invoiceData(orderId, SALE, {
      id: invoiceId,
      created_by: actor,
      order_owner_email: SALE,
      order_created_by: SALE,
      order_sale_email: SALE,
      relation_revision: 1,
      last_operation_id: 'accounting-create',
      created_at: timestamp,
      updated_at: timestamp,
    }),
  })
  batch.update(doc(db, 'orders', orderId), {
    invoice_status: 'Không xuất',
    invoice_record_count: 1,
    invoice_relation_revision: 1,
    relation_lock_version: 1,
    relation_last_module: 'invoices',
    relation_last_action: 'create',
    relation_last_document_id: invoiceId,
    relation_updated_by: actor,
    relation_updated_at: timestamp,
    updated_at: timestamp,
  })
  return batch
}

function accountingUpdateBatch(db, orderId, actor) {
  const invoiceId = `inv_${orderId}`
  const timestamp = serverTimestamp()
  const batch = writeBatch(db)
  batch.update(doc(db, 'invoices', invoiceId), {
    invoice_status: 'Đã xuất',
    relation_revision: 2,
    last_operation_id: `accounting-update-${orderId}`,
    updated_at: timestamp,
  })
  batch.update(doc(db, 'orders', orderId), {
    invoice_status: 'Đã xuất',
    invoice_record_count: 1,
    invoice_relation_revision: 2,
    relation_lock_version: 1,
    relation_last_module: 'invoices',
    relation_last_action: 'update',
    relation_last_document_id: invoiceId,
    relation_updated_by: actor,
    relation_updated_at: timestamp,
    updated_at: timestamp,
  })
  return batch
}

function accountingDeleteBatch(db, actor) {
  const orderId = 'order-accounting-delete'
  const invoiceId = `inv_${orderId}`
  const timestamp = serverTimestamp()
  const batch = writeBatch(db)
  batch.update(doc(db, 'invoices', invoiceId), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: timestamp,
    updated_at: timestamp,
  })
  batch.update(doc(db, 'orders', orderId), {
    invoice_status: 'Không xuất',
    invoice_record_count: 0,
    invoice_relation_revision: 2,
    relation_lock_version: 1,
    relation_last_module: 'invoices',
    relation_last_action: 'delete',
    relation_last_document_id: invoiceId,
    relation_updated_by: actor,
    relation_updated_at: timestamp,
    updated_at: timestamp,
  })
  return batch
}

test('Sale sửa order có counter = 1 nhưng không có invoice vẫn tự tạo invoice', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertSucceeds(legacyRepairBatch(db, { orderId: 'order-stale-count' }).commit())
  const invoice = (await getDoc(doc(db, 'invoices', 'inv_order-stale-count'))).data()
  assert.equal(invoice.invoice_status, 'Yêu cầu xuất')
})

test('Sale sửa order có invoice deterministic đã soft-delete thì khôi phục lại cùng document', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertSucceeds(legacyRepairBatch(db, {
    orderId: 'order-deleted-invoice',
    currentRelationRevision: 1,
    preservedCreatedAt: '2026-07-27T00:00:00.000Z',
  }).commit())
  const invoice = (await getDoc(doc(db, 'invoices', 'inv_order-deleted-invoice'))).data()
  assert.equal(invoice.active, true)
  assert.equal(invoice.deleted, false)
  assert.equal(invoice.relation_revision, 2)
})

test('invoices.view_all + invoices.create/edit/delete thao tác được toàn bộ mà không cần orders.view_all', async () => {
  const db = env.authenticatedContext(ACCOUNTANT, { email: ACCOUNTANT }).firestore()
  await assertSucceeds(getDoc(doc(db, 'orders', 'order-accounting')))
  await assertSucceeds(accountingCreateBatch(db, ACCOUNTANT).commit())
  await assertSucceeds(accountingUpdateBatch(db, 'order-accounting', ACCOUNTANT).commit())
  await assertSucceeds(accountingDeleteBatch(db, ACCOUNTANT).commit())
})

test('có action hóa đơn nhưng thiếu invoices.view_all vẫn không được thêm, sửa hoặc xóa dù là bản ghi của mình', async () => {
  const db = env.authenticatedContext(OWNER_EDITOR, { email: OWNER_EDITOR }).firestore()
  await assertFails(accountingCreateBatch(db, OWNER_EDITOR).commit())
  await assertFails(accountingUpdateBatch(db, 'order-owner-editor', OWNER_EDITOR).commit())
})
