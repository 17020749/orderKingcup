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
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-customer-view-all'
const OWNER = 'customer-owner@example.com'
const VIEW_ALL = 'customer-view-all@example.com'
const VIEW_ONLY = 'customer-view-only@example.com'
const LIMITED = 'customer-limited@example.com'
const ORDER_VIEW_ALL = 'order-view-all@example.com'
const ADMIN = 'admin@example.com'
let env

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', OWNER), {
        email: OWNER,
        user_code: 'OWN1',
        active: true,
        deleted: false,
        permissions_flat: [
          'page.customers', 'customers.view', 'customers.orders_view',
          'page.orders', 'orders.view',
        ],
      }),
      setDoc(doc(db, 'users', VIEW_ALL), {
        email: VIEW_ALL,
        user_code: 'ALL1',
        active: true,
        deleted: false,
        permissions_flat: [
          'page.customers', 'customers.view', 'customers.view_all',
          'customers.orders_view', 'customers.edit', 'customers.delete',
          'page.orders', 'orders.view', 'orders.create',
        ],
      }),
      setDoc(doc(db, 'users', LIMITED), {
        email: LIMITED,
        user_code: 'LIM1',
        active: true,
        deleted: false,
        permissions_flat: [
          'page.customers', 'customers.view', 'customers.orders_view',
          'customers.edit', 'customers.delete',
          'page.orders', 'orders.view', 'orders.create',
        ],
      }),
      setDoc(doc(db, 'users', VIEW_ONLY), {
        email: VIEW_ONLY,
        user_code: 'VON1',
        active: true,
        deleted: false,
        permissions_flat: [
          'page.customers', 'customers.view', 'customers.view_all',
        ],
      }),
      setDoc(doc(db, 'users', ORDER_VIEW_ALL), {
        email: ORDER_VIEW_ALL,
        user_code: 'OVA1',
        active: true,
        deleted: false,
        permissions_flat: [
          'page.customers', 'customers.view', 'customers.view_all',
          'customers.orders_view', 'page.orders', 'orders.view', 'orders.view_all',
        ],
      }),
      setDoc(doc(db, 'users', ADMIN), {
        email: ADMIN,
        user_code: 'ADM1',
        active: true,
        deleted: false,
        permissions_flat: ['*'],
      }),
      setDoc(doc(db, 'customers', 'customer-owner'), {
        id: 'customer-owner',
        customer_code: 'CUS001',
        customer_name: 'Khách của owner',
        created_by: OWNER,
        active: true,
        deleted: false,
        status: 'active',
        created_at: '2026-07-23T00:00:00.000Z',
        updated_at: Timestamp.fromDate(new Date('2026-07-23T00:00:00.000Z')),
      }),
      setDoc(doc(db, 'orders', 'foreign-order-for-owner-customer'), {
        id: 'foreign-order-for-owner-customer',
        order_code: 'ALL1-CUS001-0001',
        order_sequence: 1,
        user_code: 'ALL1',
        customer_id: 'customer-owner',
        customer_code: 'CUS001',
        customer_name: 'Khách của owner',
        owner_email: VIEW_ALL,
        created_by: VIEW_ALL,
        sale_email: VIEW_ALL,
        order_status: 'Mới tạo',
        warehouse_fulfillment_status: 'chua_xuat',
        warehouse_request_status: '',
        items_count: 1,
        revision: 1,
        active: true,
        deleted: false,
        status: 'active',
        created_at: '2026-07-23T00:00:00.000Z',
      }),
      setDoc(doc(db, 'order_items', 'foreign-item-for-owner-customer'), {
        id: 'foreign-item-for-owner-customer',
        order_id: 'foreign-order-for-owner-customer',
        order_code: 'ALL1-CUS001-0001',
        product_id: 'product-1',
        product_name: 'Sản phẩm',
        quantity: 1,
        unit_price: 100,
        owner_email: VIEW_ALL,
        created_by: VIEW_ALL,
        sale_email: VIEW_ALL,
        active: true,
        deleted: false,
        status: 'active',
      }),
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

function dbFor(email) {
  return env.authenticatedContext(email, { email }).firestore()
}

async function createOwnOrderForCustomer(db, actor, orderId) {
  const sequenceRef = doc(db, 'order_sequences', 'customer-owner')
  const orderRef = doc(db, 'orders', orderId)
  return runTransaction(db, async transaction => {
    const sequence = await transaction.get(sequenceRef)
    const next = sequence.exists() ? Number(sequence.data().last_number || 0) + 1 : 1
    const userCode = actor === VIEW_ALL ? 'ALL1' : 'LIM1'
    transaction.set(sequenceRef, {
      customer_id: 'customer-owner',
      customer_code: 'CUS001',
      last_number: next,
      updated_by: actor,
      updated_at: '2026-07-23T01:00:00.000Z',
      created_at: '2026-07-23T01:00:00.000Z',
    })
    transaction.set(orderRef, {
      id: orderId,
      order_code: `${userCode}-CUS001-${String(next).padStart(4, '0')}`,
      order_sequence: next,
      user_code: userCode,
      customer_id: 'customer-owner',
      customer_code: 'CUS001',
      customer_name: 'Khách của owner',
      owner_email: actor,
      created_by: actor,
      sale_email: actor,
      order_status: 'Mới tạo',
      warehouse_fulfillment_status: 'chua_xuat',
      warehouse_request_status: '',
      items_count: 0,
      revision: 1,
      active: true,
      deleted: false,
      status: 'active',
      created_at: '2026-07-23T01:00:00.000Z',
      updated_at: '2026-07-23T01:00:00.000Z',
    })
  })
}

test('customers.view_all đọc toàn bộ khách nhưng không thay thế action', async () => {
  const allDb = dbFor(VIEW_ALL)
  const viewOnlyDb = dbFor(VIEW_ONLY)
  const limitedDb = dbFor(LIMITED)

  await assertSucceeds(getDocs(collection(allDb, 'customers')))
  await assertSucceeds(getDocs(collection(viewOnlyDb, 'customers')))
  await assertFails(getDocs(collection(limitedDb, 'customers')))
  await assertSucceeds(updateDoc(doc(allDb, 'customers', 'customer-owner'), {
    customer_name: 'Khách đã sửa bởi view_all + edit',
    updated_at: serverTimestamp(),
  }))
  await assertFails(updateDoc(doc(limitedDb, 'customers', 'customer-owner'), {
    customer_name: 'Không được sửa',
    updated_at: serverTimestamp(),
  }))
  await assertFails(updateDoc(doc(viewOnlyDb, 'customers', 'customer-owner'), {
    customer_name: 'View all không tự cấp edit',
    updated_at: serverTimestamp(),
  }))
  await assertFails(updateDoc(doc(allDb, 'customers', 'customer-owner'), {
    customer_name: 'Payload không hợp lệ',
    arbitrary_privileged_field: true,
    updated_at: serverTimestamp(),
  }))
})

test('customers.view_all + customers.delete chỉ cho phép payload xóa mềm hợp lệ', async () => {
  const allDb = dbFor(VIEW_ALL)
  const limitedDb = dbFor(LIMITED)

  await assertFails(updateDoc(doc(limitedDb, 'customers', 'customer-owner'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
  await assertFails(updateDoc(doc(allDb, 'customers', 'customer-owner'), {
    active: true,
    status: 'deleted',
    deleted_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
  await assertSucceeds(updateDoc(doc(allDb, 'customers', 'customer-owner'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
})

test('customers.view_all cho phép tạo đơn của mình với khách do người khác tạo', async () => {
  await assertSucceeds(createOwnOrderForCustomer(
    dbFor(VIEW_ALL),
    VIEW_ALL,
    'order-created-with-foreign-customer',
  ))
  await assertFails(createOwnOrderForCustomer(
    dbFor(LIMITED),
    LIMITED,
    'order-denied-with-foreign-customer',
  ))
})

test('chủ khách xem mọi đơn của khách; người xem khách ngoài phạm vi cần orders.view_all', async () => {
  const ownerDb = dbFor(OWNER)
  const customerViewerDb = dbFor(VIEW_ALL)
  const orderViewerDb = dbFor(ORDER_VIEW_ALL)

  await assertSucceeds(getDocs(query(
    collection(ownerDb, 'orders'),
    where('customer_id', '==', 'customer-owner'),
  )))
  await assertSucceeds(getDoc(doc(ownerDb, 'order_items', 'foreign-item-for-owner-customer')))

  await assertSucceeds(getDoc(doc(customerViewerDb, 'customers', 'customer-owner')))
  await assertFails(getDocs(query(
    collection(customerViewerDb, 'orders'),
    where('customer_id', '==', 'customer-owner'),
  )))
  await assertSucceeds(getDocs(query(
    collection(orderViewerDb, 'orders'),
    where('customer_id', '==', 'customer-owner'),
  )))
})

function permissionLogPayload(email, overrides = {}) {
  return {
    user_email: email,
    route: '/payments',
    module: 'payments',
    operation: 'edit',
    stage: 'missing_action',
    source: 'preflight',
    error_type: 'missing_permission',
    record_id: 'payment-01',
    record_status: '(unknown)',
    firebase_code: '',
    firebase_message: '',
    required_permissions_json: '["payments.edit"]',
    missing_permissions_json: '["payments.edit"]',
    granted_permissions_json: '["payments.view"]',
    diagnostic_summary: 'Thiếu quyền: payments.edit',
    context_json: '{}',
    stack: '',
    created_at: serverTimestamp(),
    expires_at: Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000),
    active: true,
    deleted: false,
    ...overrides,
  }
}

test('log lỗi quyền là append-only, actor-bound và chỉ admin được đọc', async () => {
  const userDb = dbFor(LIMITED)
  const adminDb = dbFor(ADMIN)
  const logRef = doc(userDb, 'permission_error_logs', 'log-1')

  await assertSucceeds(setDoc(logRef, permissionLogPayload(LIMITED)))
  await assertFails(getDoc(logRef))
  await assertSucceeds(getDoc(doc(adminDb, 'permission_error_logs', 'log-1')))
  await assertFails(updateDoc(logRef, { diagnostic_summary: 'forged' }))
  await assertFails(setDoc(
    doc(userDb, 'permission_error_logs', 'forged-email'),
    permissionLogPayload(OWNER),
  ))
  await assertFails(setDoc(
    doc(userDb, 'permission_error_logs', 'bad-expiry'),
    permissionLogPayload(LIMITED, {
      expires_at: Timestamp.fromMillis(Date.now() + 5 * 24 * 60 * 60 * 1000),
    }),
  ))
})
