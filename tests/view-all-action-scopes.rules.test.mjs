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
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'

const projectId = 'demo-view-all-action-scopes'
const OWNER = 'owner@example.com'
const ACTION = 'action@example.com'
const VIEWER = 'viewer@example.com'
const MANAGER = 'manager@example.com'
const CROSS = 'cross@example.com'
let env

function activeUser(permissions) {
  return {
    active: true,
    deleted: false,
    status: 'active',
    permissions_flat: permissions,
  }
}

function order(id, owner, relations = false) {
  return {
    id,
    order_code: id,
    owner_email: owner,
    created_by: owner,
    sale_email: owner,
    actual_revenue: 1000,
    paid_amount: relations ? 200 : 0,
    debt_amount: relations ? 800 : 1000,
    payment_status: relations ? 'Đã cọc' : 'Chưa thanh toán',
    computed_payment_status: relations ? 'Đã cọc' : 'Chưa thanh toán',
    payment_count: relations ? 1 : 0,
    deposit_count: relations ? 1 : 0,
    collect_count: 0,
    invoice_status: relations ? 'Đã xuất' : 'Không xuất',
    shipment_status: relations ? 'Đang giao' : '',
    shipping_fee_total: relations ? 20 : 0,
    cod_amount_total: relations ? 100 : 0,
    relation_lock_version: 1,
    payment_record_count: relations ? 1 : 0,
    invoice_record_count: relations ? 1 : 0,
    shipment_record_count: relations ? 1 : 0,
    payment_relation_revision: relations ? 1 : 0,
    invoice_relation_revision: relations ? 1 : 0,
    shipment_relation_revision: relations ? 1 : 0,
    printing_lock_version: 1,
    printing_progress_count: 0,
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: '',
    note: '',
    active: true,
    deleted: false,
    status: 'active',
  }
}

function ownership(owner = OWNER) {
  return {
    order_owner_email: owner,
    order_created_by: owner,
    order_sale_email: owner,
  }
}

function relationMeta(module, action, documentId, actor) {
  return {
    relation_lock_version: 1,
    relation_last_module: module,
    relation_last_action: action,
    relation_last_document_id: documentId,
    relation_updated_by: actor,
    relation_updated_at: 'now',
    updated_at: 'now',
  }
}

function exportRequest(id = 'request-owner') {
  return {
    id,
    request_id: id,
    order_id: 'order-owner',
    order_code: 'order-owner',
    customer_name: 'Owner customer',
    export_date: '2026-07-22',
    requested_by: OWNER,
    updated_by: OWNER,
    ...ownership(),
    status: 'pending',
    lifecycle_status: '',
    warehouse_export_code: '',
    active_export_order_id: '',
    export_order_id: '',
    warehouse_export_order_id: '',
    warehouse_export_id: '',
    payload_json: '{}',
    request_timeline_json: '[]',
    active: true,
    deleted: false,
  }
}

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    const actions = [
      'orders.view', 'orders.edit', 'orders.delete',
      'export_requests.view', 'orders.warehouse_export', 'export_requests.delete',
      'payments.view', 'payments.create', 'payments.edit', 'payments.delete',
      'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete',
      'shipments.view', 'shipments.create', 'shipments.edit', 'shipments.delete',
    ]
    const viewAll = [
      'orders.view_all', 'export_requests.view_all', 'payments.view_all',
      'invoices.view_all', 'shipments.view_all',
    ]

    await Promise.all([
      setDoc(doc(db, 'users', OWNER), activeUser(actions)),
      setDoc(doc(db, 'users', ACTION), activeUser(actions)),
      setDoc(doc(db, 'users', VIEWER), activeUser(viewAll)),
      setDoc(doc(db, 'users', MANAGER), activeUser([...actions, ...viewAll])),
      setDoc(doc(db, 'users', CROSS), activeUser([
        'orders.view_all', 'payments.view_all', 'invoices.view', 'invoices.edit',
      ])),
      setDoc(doc(db, 'orders', 'order-owner'), order('order-owner', OWNER, true)),
      setDoc(doc(db, 'orders', 'order-clean'), order('order-clean', OWNER, false)),
      setDoc(doc(db, 'orders', 'order-action'), order('order-action', ACTION, false)),
      setDoc(doc(db, 'payments', 'payment-owner'), {
        id: 'payment-owner', order_id: 'order-owner', order_code: 'order-owner',
        payment_type: 'Cọc', payment_status: 'Đã nhận', amount: 200,
        created_by: OWNER, ...ownership(), active: true, deleted: false, status: 'active',
      }),
      setDoc(doc(db, 'invoices', 'invoice-owner'), {
        id: 'invoice-owner', order_id: 'order-owner', order_code: 'order-owner',
        invoice_number: 'HD-OWNER', invoice_status: 'Đã xuất', invoice_amount: 1000,
        created_by: OWNER, ...ownership(), active: true, deleted: false, status: 'active',
      }),
      setDoc(doc(db, 'shipments', 'shipment-owner'), {
        id: 'shipment-owner', order_id: 'order-owner', order_code: 'order-owner',
        shipping_status: 'Đang giao', shipping_fee: 20, cod_amount: 100,
        created_by: OWNER, ...ownership(), active: true, deleted: false, status: 'active',
      }),
      setDoc(doc(db, 'order_export_requests', 'request-owner'), exportRequest()),
    ])
  })
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await seed()
})

after(async () => env.cleanup())

test('orders.view_all chỉ mở phạm vi; edit/delete vẫn cần quyền action', async () => {
  const viewerDb = env.authenticatedContext(VIEWER, { email: VIEWER }).firestore()
  const actionDb = env.authenticatedContext(ACTION, { email: ACTION }).firestore()
  const managerDb = env.authenticatedContext(MANAGER, { email: MANAGER }).firestore()
  const ownerDb = env.authenticatedContext(OWNER, { email: OWNER }).firestore()

  await assertSucceeds(getDoc(doc(viewerDb, 'orders', 'order-owner')))
  await assertFails(updateDoc(doc(viewerDb, 'orders', 'order-owner'), { note: 'viewer', updated_at: 'viewer' }))
  await assertFails(updateDoc(doc(actionDb, 'orders', 'order-owner'), { note: 'other', updated_at: 'other' }))
  await assertSucceeds(updateDoc(doc(managerDb, 'orders', 'order-owner'), { note: 'manager', updated_at: 'manager' }))
  await assertSucceeds(updateDoc(doc(ownerDb, 'orders', 'order-owner'), { note: 'owner', updated_at: 'owner' }))

  const deleted = { deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now' }
  await assertFails(updateDoc(doc(viewerDb, 'orders', 'order-clean'), deleted))
  await assertFails(updateDoc(doc(actionDb, 'orders', 'order-clean'), deleted))
  await assertSucceeds(updateDoc(doc(managerDb, 'orders', 'order-clean'), deleted))
})

test('export_requests.view_all kết hợp action được tạo, sửa và xóa phiếu của người khác', async () => {
  const viewerDb = env.authenticatedContext(VIEWER, { email: VIEWER }).firestore()
  const actionDb = env.authenticatedContext(ACTION, { email: ACTION }).firestore()
  const managerDb = env.authenticatedContext(MANAGER, { email: MANAGER }).firestore()

  await assertSucceeds(getDoc(doc(viewerDb, 'order_export_requests', 'request-owner')))
  await assertFails(updateDoc(doc(viewerDb, 'order_export_requests', 'request-owner'), {
    customer_name: 'viewer', updated_by: VIEWER, updated_at: 'viewer',
  }))
  await assertFails(updateDoc(doc(actionDb, 'order_export_requests', 'request-owner'), {
    customer_name: 'action', updated_by: ACTION, updated_at: 'action',
  }))
  await assertSucceeds(updateDoc(doc(managerDb, 'order_export_requests', 'request-owner'), {
    customer_name: 'manager', updated_by: MANAGER, updated_at: 'manager',
  }))

  const newRequest = {
    ...exportRequest('request-manager'),
    requested_by: MANAGER,
    updated_by: MANAGER,
  }
  await assertFails(setDoc(doc(actionDb, 'order_export_requests', 'request-action'), {
    ...newRequest, id: 'request-action', request_id: 'request-action', requested_by: ACTION, updated_by: ACTION,
  }))
  await assertSucceeds(setDoc(doc(managerDb, 'order_export_requests', 'request-manager'), newRequest))

  const deleted = { deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now' }
  await assertFails(updateDoc(doc(viewerDb, 'order_export_requests', 'request-owner'), deleted))
  await assertFails(updateDoc(doc(actionDb, 'order_export_requests', 'request-owner'), deleted))
  await assertSucceeds(updateDoc(doc(managerDb, 'order_export_requests', 'request-owner'), deleted))
})

function paymentUpdateBatch(db, actor) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'payments', 'payment-owner'), { amount: 250, updated_at: 'edit' })
  batch.update(doc(db, 'orders', 'order-owner'), {
    ...relationMeta('payments', 'update', 'payment-owner', actor),
    payment_record_count: 1,
    payment_relation_revision: 2,
    paid_amount: 250,
    debt_amount: 750,
    payment_status: 'Đã cọc',
    computed_payment_status: 'Đã cọc',
    payment_count: 1,
    deposit_count: 1,
    collect_count: 0,
  })
  return batch
}

function invoiceUpdateBatch(db, actor) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'invoices', 'invoice-owner'), { company_name: 'Updated company', updated_at: 'edit' })
  batch.update(doc(db, 'orders', 'order-owner'), {
    ...relationMeta('invoices', 'update', 'invoice-owner', actor),
    invoice_record_count: 1,
    invoice_relation_revision: 2,
    invoice_status: 'Đã xuất',
  })
  return batch
}

function shipmentUpdateBatch(db, actor) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'shipments', 'shipment-owner'), { shipping_status: 'Đã giao', updated_at: 'edit' })
  batch.update(doc(db, 'orders', 'order-owner'), {
    ...relationMeta('shipments', 'update', 'shipment-owner', actor),
    shipment_record_count: 1,
    shipment_relation_revision: 2,
    shipment_status: 'Đã giao',
    shipping_fee_total: 20,
    cod_amount_total: 100,
  })
  return batch
}

test('payment, invoice và shipment dùng view_all riêng của chính module khi sửa', async () => {
  const viewerDb = env.authenticatedContext(VIEWER, { email: VIEWER }).firestore()
  const actionDb = env.authenticatedContext(ACTION, { email: ACTION }).firestore()
  const managerDb = env.authenticatedContext(MANAGER, { email: MANAGER }).firestore()
  const crossDb = env.authenticatedContext(CROSS, { email: CROSS }).firestore()

  await assertSucceeds(getDoc(doc(viewerDb, 'payments', 'payment-owner')))
  await assertSucceeds(getDoc(doc(viewerDb, 'invoices', 'invoice-owner')))
  await assertSucceeds(getDoc(doc(viewerDb, 'shipments', 'shipment-owner')))

  await assertFails(paymentUpdateBatch(viewerDb, VIEWER).commit())
  await assertFails(paymentUpdateBatch(actionDb, ACTION).commit())
  await assertFails(invoiceUpdateBatch(crossDb, CROSS).commit())
  await assertFails(getDoc(doc(crossDb, 'invoices', 'invoice-owner')))

  await assertSucceeds(paymentUpdateBatch(managerDb, MANAGER).commit())
  await assertSucceeds(invoiceUpdateBatch(managerDb, MANAGER).commit())
  await assertSucceeds(shipmentUpdateBatch(managerDb, MANAGER).commit())
})

function paymentDeleteBatch(db, actor) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'payments', 'payment-owner'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now',
  })
  batch.update(doc(db, 'orders', 'order-owner'), {
    ...relationMeta('payments', 'delete', 'payment-owner', actor),
    payment_record_count: 0,
    payment_relation_revision: 2,
    paid_amount: 0,
    debt_amount: 1000,
    payment_status: 'Chưa thanh toán',
    computed_payment_status: 'Chưa thanh toán',
    payment_count: 0,
    deposit_count: 0,
    collect_count: 0,
  })
  return batch
}

function invoiceDeleteBatch(db, actor) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'invoices', 'invoice-owner'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now',
  })
  batch.update(doc(db, 'orders', 'order-owner'), {
    ...relationMeta('invoices', 'delete', 'invoice-owner', actor),
    invoice_record_count: 0,
    invoice_relation_revision: 2,
    invoice_status: 'Không xuất',
  })
  return batch
}

function shipmentDeleteBatch(db, actor) {
  const batch = writeBatch(db)
  batch.update(doc(db, 'shipments', 'shipment-owner'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now',
  })
  batch.update(doc(db, 'orders', 'order-owner'), {
    ...relationMeta('shipments', 'delete', 'shipment-owner', actor),
    shipment_record_count: 0,
    shipment_relation_revision: 2,
    shipment_status: '',
    shipping_fee_total: 0,
    cod_amount_total: 0,
  })
  return batch
}

test('payment, invoice và shipment cần view_all cộng delete để xóa bản ghi người khác', async () => {
  const viewerDb = env.authenticatedContext(VIEWER, { email: VIEWER }).firestore()
  const actionDb = env.authenticatedContext(ACTION, { email: ACTION }).firestore()
  const managerDb = env.authenticatedContext(MANAGER, { email: MANAGER }).firestore()

  await assertFails(paymentDeleteBatch(viewerDb, VIEWER).commit())
  await assertFails(paymentDeleteBatch(actionDb, ACTION).commit())

  await assertSucceeds(paymentDeleteBatch(managerDb, MANAGER).commit())
  await assertSucceeds(invoiceDeleteBatch(managerDb, MANAGER).commit())
  await assertSucceeds(shipmentDeleteBatch(managerDb, MANAGER).commit())
})
