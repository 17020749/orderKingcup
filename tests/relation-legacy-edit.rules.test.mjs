import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, writeBatch } from 'firebase/firestore'

const projectId = 'demo-relation-legacy-edit'
const OWNER = 'owner@example.com'
const MANAGER = 'manager@example.com'
let env

const managerPermissions = [
  'orders.view', 'orders.view_all',
  'payments.view', 'payments.view_all', 'payments.edit',
  'invoices.view', 'invoices.view_all', 'invoices.edit',
  'shipments.view', 'shipments.view_all', 'shipments.edit',
]

function ownership() {
  return {
    order_owner_email: OWNER,
    order_created_by: OWNER,
    order_sale_email: OWNER,
  }
}

function order() {
  return {
    id: 'order-owner', order_code: 'ORD-LEGACY', owner_email: OWNER, created_by: OWNER, sale_email: OWNER,
    actual_revenue: 1000, paid_amount: 200, debt_amount: 800,
    payment_status: 'Đã cọc', computed_payment_status: 'Đã cọc', payment_count: 1, deposit_count: 1, collect_count: 0,
    invoice_status: 'HĐ nháp', shipment_status: 'Đang giao', shipping_fee_total: 20, cod_amount_total: 0,
    relation_lock_version: 1, payment_record_count: 1, invoice_record_count: 1, shipment_record_count: 1,
    payment_relation_revision: 1, invoice_relation_revision: 1, shipment_relation_revision: 1,
    printing_lock_version: 1, printing_progress_count: 0,
    warehouse_fulfillment_status: 'chua_xuat', warehouse_request_status: '',
    active: true, deleted: false, status: 'active',
  }
}

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', MANAGER), { active: true, deleted: false, status: 'active', permissions_flat: managerPermissions }),
      setDoc(doc(db, 'orders', 'order-owner'), order()),
      setDoc(doc(db, 'payments', 'payment-legacy'), {
        id: 'payment-legacy', order_id: 'order-owner', order_code: 'ORD-LEGACY', ...ownership(),
        amount: 200, payment_type: 'Cọc', payment_status: 'Đã nhận', active: true, deleted: false, status: 'active',
      }),
      setDoc(doc(db, 'invoices', 'invoice-legacy'), {
        id: 'invoice-legacy', order_id: 'order-owner', order_code: 'ORD-LEGACY', ...ownership(),
        invoice_status: 'HĐ nháp', company_name: 'Legacy', active: true, deleted: false, status: 'active',
      }),
      setDoc(doc(db, 'shipments', 'shipment-legacy'), {
        id: 'shipment-legacy', order_id: 'order-owner', order_code: 'ORD-LEGACY', ...ownership(),
        shipping_status: 'Đang giao', shipping_fee: 20, active: true, deleted: false, status: 'active',
      }),
    ])
  })
}

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } })
})
beforeEach(async () => { await env.clearFirestore(); await seed() })
after(async () => env.cleanup())

function relationMeta(module, documentId) {
  return {
    relation_lock_version: 1,
    relation_last_module: module,
    relation_last_action: 'update',
    relation_last_document_id: documentId,
    relation_updated_by: MANAGER,
    relation_updated_at: 'now',
    updated_at: 'now',
  }
}

test('manager sửa payment legacy thiếu created_by khi client không backfill identity', async () => {
  const db = env.authenticatedContext(MANAGER, { email: MANAGER }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'payments', 'payment-legacy'), { amount: 250, relation_revision: 2, last_operation_id: 'op-pay', updated_at: 'now' })
  batch.update(doc(db, 'orders', 'order-owner'), {
    ...relationMeta('payments', 'payment-legacy'), payment_record_count: 1, payment_relation_revision: 2,
    paid_amount: 250, debt_amount: 750, payment_status: 'Đã cọc', computed_payment_status: 'Đã cọc',
    payment_count: 1, deposit_count: 1, collect_count: 0,
  })
  await assertSucceeds(batch.commit())
})

test('manager sửa invoice legacy thiếu created_by khi client không backfill identity', async () => {
  const db = env.authenticatedContext(MANAGER, { email: MANAGER }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'invoices', 'invoice-legacy'), { company_name: 'Updated', relation_revision: 2, last_operation_id: 'op-inv', updated_at: 'now' })
  batch.update(doc(db, 'orders', 'order-owner'), {
    ...relationMeta('invoices', 'invoice-legacy'), invoice_record_count: 1, invoice_relation_revision: 2, invoice_status: 'HĐ nháp',
  })
  await assertSucceeds(batch.commit())
})

test('manager sửa shipment legacy thiếu created_by khi client không backfill identity', async () => {
  const db = env.authenticatedContext(MANAGER, { email: MANAGER }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'shipments', 'shipment-legacy'), { shipping_status: 'Đã giao', relation_revision: 2, last_operation_id: 'op-shp', updated_at: 'now' })
  batch.update(doc(db, 'orders', 'order-owner'), {
    ...relationMeta('shipments', 'shipment-legacy'), shipment_record_count: 1, shipment_relation_revision: 2,
    shipment_status: 'Đã giao', shipping_fee_total: 20, cod_amount_total: 0,
  })
  await assertSucceeds(batch.commit())
})

test('backfill created_by bằng người sửa trên bản ghi legacy vẫn bị chặn', async () => {
  const db = env.authenticatedContext(MANAGER, { email: MANAGER }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'payments', 'payment-legacy'), { created_by: MANAGER, amount: 250, updated_at: 'now' })
  batch.update(doc(db, 'orders', 'order-owner'), {
    ...relationMeta('payments', 'payment-legacy'), payment_record_count: 1, payment_relation_revision: 2,
    paid_amount: 250, debt_amount: 750, payment_status: 'Đã cọc', computed_payment_status: 'Đã cọc',
    payment_count: 1, deposit_count: 1, collect_count: 0,
  })
  await assertFails(batch.commit())
})
