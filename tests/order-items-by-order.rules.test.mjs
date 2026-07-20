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
  where,
  writeBatch,
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-order-items-by-parent'
const SALE = 'sale-flow@example.com'
const OTHER = 'other-sale@example.com'
let env

const salePermissions = [
  'customers.create',
  'customers.delete',
  'customers.edit',
  'customers.view',
  'export_requests.delete',
  'export_requests.view',
  'inventory.view',
  'invoices.create',
  'invoices.edit',
  'invoices.view',
  'orders.create',
  'orders.delete',
  'orders.edit',
  'orders.export',
  'orders.import',
  'orders.print',
  'orders.view',
  'orders.warehouse_export',
  'page.customers',
  'page.export_requests',
  'page.inventory',
  'page.invoices',
  'page.orders',
  'page.payments',
  'page.printing',
  'page.products',
  'payments.create',
  'payments.delete',
  'payments.edit',
  'payments.export',
  'payments.view',
  'printing.orders_view',
  'printing.view',
  'products.view',
]

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', SALE), {
        email: SALE,
        active: true,
        deleted: false,
        status: 'active',
        permissions_flat: salePermissions,
      }),
      setDoc(doc(db, 'users', OTHER), {
        email: OTHER,
        active: true,
        deleted: false,
        status: 'active',
        permissions_flat: ['page.orders', 'orders.view'],
      }),
      setDoc(doc(db, 'orders', 'order-owned'), {
        id: 'order-owned',
        order_code: 'SALE-CUS-0001',
        customer_id: 'customer-owned',
        owner_email: SALE,
        created_by: SALE,
        sale_email: SALE,
        warehouse_fulfillment_status: 'chua_xuat',
        warehouse_request_status: '',
        active: true,
        deleted: false,
        status: 'active',
      }),
      setDoc(doc(db, 'orders', 'order-other'), {
        id: 'order-other',
        order_code: 'OTHER-CUS-0001',
        customer_id: 'customer-other',
        owner_email: OTHER,
        created_by: OTHER,
        sale_email: OTHER,
        warehouse_fulfillment_status: 'chua_xuat',
        warehouse_request_status: '',
        active: true,
        deleted: false,
        status: 'active',
      }),
      // Dữ liệu cũ chỉ có order_id, chưa có owner_email/created_by/sale_email.
      setDoc(doc(db, 'order_items', 'legacy-item-owned'), {
        id: 'legacy-item-owned',
        order_id: 'order-owned',
        product_id: 'product-a',
        product_code: 'SP-A',
        product_name: 'Sản phẩm A',
        quantity: 100,
        active: true,
        deleted: false,
        status: 'active',
      }),
      setDoc(doc(db, 'order_items', 'legacy-item-other'), {
        id: 'legacy-item-other',
        order_id: 'order-other',
        product_id: 'product-b',
        product_code: 'SP-B',
        product_name: 'Sản phẩm B',
        quantity: 50,
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

test('Sale có orders.view tải được sản phẩm legacy theo order_id của đơn mình', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const snapshot = await assertSucceeds(getDocs(query(
    collection(db, 'order_items'),
    where('order_id', 'in', ['order-owned']),
  )))

  if (snapshot.docs.length !== 1 || snapshot.docs[0].id !== 'legacy-item-owned') {
    throw new Error('Query order_id không trả đúng sản phẩm legacy của đơn được phép xem.')
  }
})

test('Sale không thể dùng query order_id để đọc sản phẩm của đơn người khác', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertFails(getDocs(query(
    collection(db, 'order_items'),
    where('order_id', 'in', ['order-other']),
  )))
})

test('Bộ quyền người dùng thực tế chạy được luồng đọc sản phẩm rồi tạo yêu cầu xuất', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()

  await assertSucceeds(getDocs(query(
    collection(db, 'order_items'),
    where('order_id', 'in', ['order-owned']),
  )))

  const batch = writeBatch(db)
  batch.set(doc(db, 'order_export_requests', 'request-owned'), {
    id: 'request-owned',
    request_id: 'YCXK-TEST-001',
    order_id: 'order-owned',
    order_code: 'SALE-CUS-0001',
    customer_name: 'Khách thử',
    export_date: '2026-07-19',
    requested_by: SALE,
    requested_at: '2026-07-19T06:00:00.000Z',
    updated_by: SALE,
    order_owner_email: SALE,
    order_created_by: SALE,
    order_sale_email: SALE,
    status: 'cho_xu_ly',
    payload_json: JSON.stringify({
      items: [{
        product_code: 'SP-A',
        product_name: 'Sản phẩm A',
        export_quantity: 10,
      }],
    }),
    request_timeline_json: '[]',
    warehouse_export_code: '',
    active: true,
    deleted: false,
    created_at: '2026-07-19T06:00:00.000Z',
    updated_at: '2026-07-19T06:00:00.000Z',
  })
  batch.update(doc(db, 'orders', 'order-owned'), {
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: 'cho_xu_ly',
    updated_at: '2026-07-19T06:00:00.000Z',
  })
  batch.set(doc(db, 'activity_logs', 'activity-request-owned'), {
    module: 'order_export_requests',
    action: 'create',
    item_code: 'YCXK-TEST-001',
    item_name: 'SALE-CUS-0001 - Khách thử',
    changed_by: SALE,
    after_json: '{}',
    created_at: serverTimestamp(),
    active: true,
    deleted: false,
  })
  batch.set(doc(db, 'notifications', 'notification-request-owned'), {
    type: 'warehouse_export_request_created',
    title: 'Có yêu cầu xuất kho mới',
    message: 'YCXK-TEST-001',
    route: '/warehouse-export-requests',
    entity_collection: 'order_export_requests',
    entity_id: 'request-owned',
    entity_code: 'YCXK-TEST-001',
    created_by: SALE,
    to_email: '',
    audience: 'warehouse_export',
    audience_permissions: [
      'export_requests.accept',
      'export_requests.reject',
      'export_requests.release',
      'export_requests.process',
    ],
    metadata_json: '{}',
    status: 'unread',
    read: false,
    active: true,
    deleted: false,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  })

  await assertSucceeds(batch.commit())
})
