import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'

const projectId = 'demo-order-export-delete-lock'
const OWNER = 'order-delete@example.com'
let env

function orderData(overrides = {}) {
  return {
    id: 'order-delete',
    order_code: 'SALE-ABC-0001',
    order_sequence: 1,
    user_code: 'SALE',
    customer_id: 'customer-1',
    customer_code: 'ABC',
    owner_email: OWNER,
    created_by: OWNER,
    sale_email: OWNER,
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: '',
    printing_lock_version: 1,
    printing_progress_count: 0,
    relation_lock_version: 1,
    payment_record_count: 0,
    invoice_record_count: 0,
    shipment_record_count: 0,
    payment_relation_revision: 0,
    invoice_relation_revision: 0,
    shipment_relation_revision: 0,
    active: true,
    deleted: false,
    status: 'active',
    created_at: '2026-07-21T00:00:00.000Z',
    ...overrides,
  }
}

function requestData(status, overrides = {}) {
  return {
    id: `request-${status}`,
    request_id: `request-${status}`,
    order_id: 'order-delete',
    order_code: 'SALE-ABC-0001',
    requested_by: OWNER,
    created_by: OWNER,
    order_owner_email: OWNER,
    order_created_by: OWNER,
    order_sale_email: OWNER,
    status,
    warehouse_export_code: '',
    active_export_order_id: '',
    export_order_id: '',
    warehouse_export_order_id: '',
    warehouse_export_id: '',
    active: true,
    deleted: false,
    created_at: '2026-07-21T00:00:00.000Z',
    ...overrides,
  }
}

async function seed(orderOverrides = {}, requestStatus = '') {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, 'users', OWNER), {
      email: OWNER,
      active: true,
      deleted: false,
      permissions_flat: ['page.orders', 'orders.view', 'orders.delete'],
    })
    await setDoc(doc(db, 'orders', 'order-delete'), orderData(orderOverrides))
    if (requestStatus) {
      await setDoc(
        doc(db, 'order_export_requests', `request-${requestStatus}`),
        requestData(requestStatus),
      )
    }
  })
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

beforeEach(async () => env.clearFirestore())
after(async () => env.cleanup())

test('orders.delete đọc được yêu cầu kho thuộc đơn của chính mình để preflight', async () => {
  await seed({}, 'tu_choi')
  const db = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  const snapshot = await assertSucceeds(getDocs(query(
    collection(db, 'order_export_requests'),
    where('order_id', '==', 'order-delete'),
  )))
  assert.equal(snapshot.size, 1)
})

test('khóa xóa đơn khi yêu cầu đã tiếp nhận dù child chưa được ghi trong batch', async () => {
  await seed({ warehouse_request_status: 'da_tiep_nhan' }, 'da_tiep_nhan')
  const db = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  await assertFails(updateDoc(doc(db, 'orders', 'order-delete'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
})

test('cho phép xóa đơn và cascade yêu cầu đã từ chối', async () => {
  await seed({ warehouse_request_status: 'co_tu_choi' }, 'tu_choi')
  const db = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  const batch = writeBatch(db)
  const deletedAt = serverTimestamp()
  batch.update(doc(db, 'orders', 'order-delete'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: deletedAt,
    updated_at: deletedAt,
  })
  batch.update(doc(db, 'order_export_requests', 'request-tu_choi'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: deletedAt,
    updated_at: deletedAt,
  })
  await assertSucceeds(batch.commit())
})

test('không cho cascade yêu cầu đã tiếp nhận', async () => {
  await seed({ warehouse_request_status: 'da_tiep_nhan' }, 'da_tiep_nhan')
  const db = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'request-da_tiep_nhan'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
})
