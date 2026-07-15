import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  or,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-rules'
const A = 'usera@example.com'
const B = 'userb@example.com'
const ADMIN = 'admin@example.com'
const WAREHOUSE = 'warehouse@example.com'
const LEGACY = 'legacy@example.com'
const ROLE_ADMIN = 'roleadmin@example.com'
const EDITOR = 'editor@example.com'
const STOCK = 'stock@example.com'
const STOCK_DELETE = 'stockdelete@example.com'
const CATALOG = 'catalog@example.com'
const INVENTORY_VIEWER = 'inventoryview@example.com'
const WAREHOUSE_PAGE = 'warehousepage@example.com'
const WAREHOUSE_ACCEPT = 'warehouseaccept@example.com'
const WAREHOUSE_REJECT = 'warehousereject@example.com'
const WAREHOUSE_RELEASE = 'warehouserelease@example.com'
let env

const userPermissions = [
  'orders.view', 'orders.create', 'orders.edit', 'orders.delete', 'orders.warehouse_export',
  'payments.view', 'payments.create', 'payments.edit', 'payments.delete',
  'export_requests.view', 'export_requests.delete',
  'customers.view', 'customers.create', 'customers.edit', 'customers.delete',
  'products.view', 'products.create', 'products.edit', 'products.delete',
  'shipments.view', 'shipments.create', 'shipments.edit', 'shipments.delete',
  'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete', 'users.manage'
]

function order(email, code) {
  return {
    id: code,
    order_code: code,
    owner_email: email,
    created_by: email,
    sale_email: email,
    active: true,
    deleted: false,
    warehouse_fulfillment_status: 'chua_xuat'
  }
}

function ownership(email) {
  return {
    order_owner_email: email,
    order_created_by: email,
    order_sale_email: email
  }
}

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', A), { email: A, active: true, deleted: false, permissions_flat: userPermissions }),
      setDoc(doc(db, 'users', B), { email: B, active: true, deleted: false, permissions_flat: userPermissions }),
      setDoc(doc(db, 'users', ADMIN), { email: ADMIN, active: true, deleted: false, is_admin: true, permissions_flat: ['*'] }),
      setDoc(doc(db, 'users', WAREHOUSE), { email: WAREHOUSE, active: true, deleted: false, permissions_flat: ['export_requests.process'] }),
      setDoc(doc(db, 'users', WAREHOUSE_PAGE), {
        email: WAREHOUSE_PAGE,
        active: true,
        deleted: false,
        permissions_flat: ['page.warehouse_export_requests']
      }),
      setDoc(doc(db, 'users', WAREHOUSE_ACCEPT), {
        email: WAREHOUSE_ACCEPT,
        active: true,
        deleted: false,
        permissions_flat: ['page.warehouse_export_requests', 'export_requests.accept']
      }),
      setDoc(doc(db, 'users', WAREHOUSE_REJECT), {
        email: WAREHOUSE_REJECT,
        active: true,
        deleted: false,
        permissions_flat: ['page.warehouse_export_requests', 'export_requests.reject']
      }),
      setDoc(doc(db, 'users', WAREHOUSE_RELEASE), {
        email: WAREHOUSE_RELEASE,
        active: true,
        deleted: false,
        permissions_flat: ['page.warehouse_export_requests', 'export_requests.release']
      }),
      setDoc(doc(db, 'users', LEGACY), { email: LEGACY, status: 'Hoạt động', deleted: false, permissions_flat: ['orders.view'] }),
      setDoc(doc(db, 'users', ROLE_ADMIN), { email: ROLE_ADMIN, active: true, deleted: false, role: 'Admin' }),
      setDoc(doc(db, 'users', EDITOR), { email: EDITOR, active: true, deleted: false, permissions_flat: ['orders.view', 'orders.edit'] }),
      setDoc(doc(db, 'orders', 'order-a'), order(A, 'order-a')),
      setDoc(doc(db, 'orders', 'order-a-exported'), { ...order(A, 'order-a-exported'), warehouse_fulfillment_status: 'da_xuat_1_phan', warehouse_request_status: 'da_xuat' }),
      setDoc(doc(db, 'orders', 'order-b'), order(B, 'order-b')),
      setDoc(doc(db, 'orders', 'order-legacy'), order(LEGACY, 'order-legacy')),
      setDoc(doc(db, 'orders', 'order-editor'), order(EDITOR, 'order-editor')),
      setDoc(doc(db, 'order_items', 'item-a'), { order_id: 'order-a', created_by: A, owner_email: A, sale_email: A, active: true, deleted: false, status: 'active' }),
      setDoc(doc(db, 'order_items', 'item-b'), { order_id: 'order-b', created_by: B, owner_email: B, sale_email: B, active: true }),
      setDoc(doc(db, 'payments', 'payment-b'), { order_id: 'order-b', created_by: B, ...ownership(B), amount: 100, active: true }),
      setDoc(doc(db, 'order_export_requests', 'export-a'), { order_id: 'order-a', requested_by: A, ...ownership(A), status: 'cho_xu_ly', payload_json: '{}', active: true, deleted: false }),
      setDoc(doc(db, 'order_export_requests', 'export-a-accepted'), { order_id: 'order-a', requested_by: A, ...ownership(A), status: 'da_tiep_nhan', payload_json: '{}', warehouse_export_code: '', warehouse_handled_by: WAREHOUSE, active: true, deleted: false }),
      setDoc(doc(db, 'order_export_requests', 'export-a-done'), { order_id: 'order-a-exported', requested_by: A, ...ownership(A), status: 'da_xuat', payload_json: '{}', active: true }),
      setDoc(doc(db, 'shipments', 'shipment-b'), { order_id: 'order-b', created_by: B, ...ownership(B), active: true }),
      setDoc(doc(db, 'invoices', 'invoice-b'), { order_id: 'order-b', created_by: B, ...ownership(B), active: true }),
      setDoc(doc(db, 'customers', 'customer-a'), { customer_name: 'A', created_by: A, active: true }),
      setDoc(doc(db, 'customers', 'customer-b'), { customer_name: 'B', created_by: B, active: true }),
      setDoc(doc(db, 'products', 'product-existing'), { product_code: 'SP001', product_name: 'Sản phẩm cũ', unit: 'Cái', created_by: A, active: true, deleted: false }),
      setDoc(doc(db, 'notifications', 'notification-a'), { to_email: A, created_by: B, status: 'unread', message: 'Test' }),
      setDoc(doc(db, 'notifications', 'notification-warehouse-a'), {
        to_email: '',
        audience: 'warehouse_export',
        audience_permissions: ['export_requests.accept', 'export_requests.reject', 'export_requests.release', 'export_requests.process'],
        created_by: A,
        status: 'unread',
        title: 'Có yêu cầu xuất kho mới',
        message: 'YCXK-TEST',
        active: true,
        deleted: false
      }),
      setDoc(doc(db, 'users', STOCK), {
        email: STOCK,
        active: true,
        deleted: false,
        permissions_flat: [
          'import.view', 'import.create', 'import.edit', 'import.delete',
          'export.view', 'export.create', 'export.edit', 'export.delete',
          'inventory.view', 'inventory.adjust', 'stock_movements.view',
          'export_requests.process'
        ]
      }),
      setDoc(doc(db, 'users', STOCK_DELETE), {
        email: STOCK_DELETE,
        active: true,
        deleted: false,
        permissions_flat: ['import.delete']
      }),
      setDoc(doc(db, 'users', CATALOG), {
        email: CATALOG,
        active: true,
        deleted: false,
        permissions_flat: ['warehouses.view', 'warehouses.manage', 'suppliers.view', 'suppliers.manage', 'units.view', 'units.manage']
      }),
      setDoc(doc(db, 'users', INVENTORY_VIEWER), {
        email: INVENTORY_VIEWER,
        active: true,
        deleted: false,
        permissions_flat: ['inventory.view']
      }),
      setDoc(doc(db, 'warehouses', 'wh-a'), { id: 'wh-a', name: 'Kho A', created_by: CATALOG, active: true, deleted: false, source: 'test' }),
      setDoc(doc(db, 'suppliers', 'supplier-a'), { id: 'supplier-a', name: 'NCC A', created_by: CATALOG, active: true, deleted: false, source: 'test' }),
      setDoc(doc(db, 'units', 'unit-a'), { id: 'unit-a', name: 'Cái', created_by: CATALOG, active: true, deleted: false, source: 'test' }),
      setDoc(doc(db, 'import_orders', 'import-a'), { id: 'import-a', code: 'PN-A', created_by: STOCK, active: true, deleted: false, source: 'test' }),
      setDoc(doc(db, 'import_order_items', 'import-item-a'), { import_order_id: 'import-a', product_id: 'product-existing', warehouse_id: 'wh-a', quantity: 5, created_by: STOCK, active: true, deleted: false, source: 'test' }),
      setDoc(doc(db, 'export_orders', 'export-real-a'), { id: 'export-real-a', code: 'PX-A', created_by: STOCK, active: true, deleted: false, source: 'test', source_request_id: '', sync_source: '' }),
      setDoc(doc(db, 'export_order_items', 'export-real-item-a'), { export_order_id: 'export-real-a', product_id: 'product-existing', from_warehouse_id: 'wh-a', quantity: 2, created_by: STOCK, active: true, deleted: false, source: 'test' }),
      setDoc(doc(db, 'export_orders', 'export-from-request-a'), { id: 'export-from-request-a', code: 'PX-REQ-A', created_by: STOCK, active: true, deleted: false, source: 'kingcup_firestore', source_request_id: 'export-a', sync_source: 'kingcup_firestore:export-a' }),
      setDoc(doc(db, 'export_order_items', 'export-from-request-item-a'), { export_order_id: 'export-from-request-a', product_id: 'product-existing', from_warehouse_id: 'wh-a', quantity: 1, created_by: STOCK, active: true, deleted: false, source: 'kingcup_firestore' }),
      setDoc(doc(db, 'inventory_adjustments', 'adjustment-a'), { id: 'adjustment-a', product_id: 'product-existing', warehouse_id: 'wh-a', quantity: 1, created_by: STOCK, active: true, deleted: false, source: 'nuxt' }),
      setDoc(doc(db, 'stock_movements', 'move-a'), { id: 'move-a', movement_type: 'import', product_id: 'product-existing', warehouse_id: 'wh-a', quantity: 5, created_by: STOCK, active: true, deleted: false, source: 'test' }),
      setDoc(doc(db, 'inventory_balances', 'wh-a__product-existing__no_logo'), { id: 'wh-a__product-existing__no_logo', product_id: 'product-existing', warehouse_id: 'wh-a', logo: '', quantity: 10, active: true, deleted: false })
    ])
  })
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') }
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await seed()
})

after(async () => env.cleanup())


test('Xóa mềm order và order_items trong cùng batch là nguyên tử', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'orders', 'order-a'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now'
  })
  batch.update(doc(db, 'order_items', 'item-a'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now'
  })
  batch.update(doc(db, 'order_export_requests', 'export-a'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now'
  })

  await assertSucceeds(batch.commit())

  await env.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore()
    const [orderSnap, itemSnap] = await Promise.all([
      getDoc(doc(adminDb, 'orders', 'order-a')),
      getDoc(doc(adminDb, 'order_items', 'item-a'))
    ])
    if (orderSnap.data()?.deleted !== true || itemSnap.data()?.deleted !== true) {
      throw new Error('Batch phải xóa mềm đồng thời cả order và order_item')
    }
  })
})

test('User A tạo payment chuẩn cho order A', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(setDoc(doc(db, 'payments', 'payment-a'), {
    order_id: 'order-a', created_by: A, ...ownership(A), amount: 200, active: true
  }))
})

test('User A không thể giả ownership để tạo payment cho order B', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertFails(setDoc(doc(db, 'payments', 'forged-payment'), {
    order_id: 'order-b', created_by: A, ...ownership(A), amount: 200, active: true
  }))
})

test('User A không thể sửa hoặc hard-delete payment của User B', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertFails(updateDoc(doc(db, 'payments', 'payment-b'), { amount: 999 }))
  await assertFails(deleteDoc(doc(db, 'payments', 'payment-b')))
})

test('User A tạo phiếu xuất order A nhưng không thể giả phiếu cho order B', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(setDoc(doc(db, 'order_export_requests', 'export-own'), {
    order_id: 'order-a', requested_by: A, ...ownership(A), status: 'cho_xu_ly', payload_json: '{}', active: true
  }))
  await assertFails(setDoc(doc(db, 'order_export_requests', 'export-forged'), {
    order_id: 'order-b', requested_by: A, ...ownership(A), status: 'cho_xu_ly', payload_json: '{}', active: true
  }))
})

test('Sale chỉ tạo/sửa yêu cầu, không được tự tiếp nhận, từ chối hoặc cho xuất kho', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()

  await assertFails(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    status: 'da_tiep_nhan',
    warehouse_handled_by: A,
    updated_at: 'now'
  }))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    status: 'tu_choi',
    warehouse_handled_by: A,
    updated_at: 'now'
  }))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    status: 'da_xuat',
    warehouse_handled_by: A,
    export_order_id: 'forged-export-order',
    updated_at: 'now'
  }))
})


test('Sale sửa được yêu cầu đang chờ bằng đúng batch của page', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  const batch = writeBatch(db)

  batch.update(doc(db, 'order_export_requests', 'export-a'), {
    order_code: 'order-a',
    customer_name: 'Khách A',
    export_date: '2026-07-15',
    updated_by: A,
    payload_json: JSON.stringify({ note: 'Sale sửa nội dung', items: [] }),
    request_timeline_json: JSON.stringify([{ action: 'update', actor: A }]),
    updated_at: 'now'
  })
  batch.update(doc(db, 'orders', 'order-a'), {
    warehouse_fulfillment_status: 'cho_xu_ly',
    warehouse_request_status: 'cho_xu_ly',
    updated_at: 'now'
  })
  batch.set(doc(collection(db, 'activity_logs')), {
    module: 'order_export_requests',
    action: 'update',
    changed_by: A,
    created_at: 'now',
    active: true,
    deleted: false
  })

  await assertSucceeds(batch.commit())
})

test('Sale không thể giả updated_by khi sửa yêu cầu', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    payload_json: '{\"quantity\":2}',
    updated_by: B,
    updated_at: 'now'
  }))
})

test('Sale xóa mềm được yêu cầu chưa được Kho tiếp nhận', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  const batch = writeBatch(db)

  batch.update(doc(db, 'order_export_requests', 'export-a'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: 'now',
    updated_at: 'now'
  })
  batch.update(doc(db, 'orders', 'order-a'), {
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: '',
    updated_at: 'now'
  })
  batch.set(doc(collection(db, 'activity_logs')), {
    module: 'order_export_requests',
    action: 'delete',
    changed_by: A,
    created_at: 'now',
    active: true,
    deleted: false
  })

  await assertSucceeds(batch.commit())
})

test('Kho đã tiếp nhận thì Sale không được sửa hoặc xóa yêu cầu', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()

  await assertFails(updateDoc(doc(db, 'order_export_requests', 'export-a-accepted'), {
    payload_json: JSON.stringify({ note: 'Không được sửa' }),
    request_timeline_json: '[]',
    updated_by: A,
    updated_at: 'now'
  }))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'export-a-accepted'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: 'now',
    updated_at: 'now'
  }))
  await assertFails(deleteDoc(doc(db, 'order_export_requests', 'export-a-accepted')))
})

test('User A không thể chiếm order_item của User B bằng owner request mới', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertFails(updateDoc(doc(db, 'order_items', 'item-b'), {
    owner_email: A, created_by: A, sale_email: A, product_name: 'forged'
  }))
})

test('User có users.manage không thể tự cấp quyền admin', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertFails(updateDoc(doc(db, 'users', A), { permissions_flat: ['*'], is_admin: true }))
})

test('Warehouse chỉ sửa field xử lý, không sửa payload phiếu', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    status: 'da_tiep_nhan', warehouse_handled_by: WAREHOUSE, updated_at: 'now'
  }))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'export-a'), { payload_json: '{"forged":true}' }))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    status: 'da_tiep_nhan', warehouse_handled_by: A, updated_at: 'now'
  }))
})


test('Quyền trang Kho xử lý YC xuất chỉ được đọc, không được xử lý', async () => {
  const db = env.authenticatedContext(WAREHOUSE_PAGE, { email: WAREHOUSE_PAGE }).firestore()

  await assertSucceeds(getDoc(doc(db, 'order_export_requests', 'export-a')))
  await assertSucceeds(getDoc(doc(db, 'warehouses', 'wh-a')))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    status: 'da_tiep_nhan',
    warehouse_handled_by: WAREHOUSE_PAGE,
    updated_at: 'now'
  }))
})

test('Quyền tiếp nhận chỉ được tiếp nhận, không được từ chối hoặc cho xuất', async () => {
  const db = env.authenticatedContext(WAREHOUSE_ACCEPT, { email: WAREHOUSE_ACCEPT }).firestore()

  await assertSucceeds(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    status: 'da_tiep_nhan',
    warehouse_handled_by: WAREHOUSE_ACCEPT,
    updated_at: 'now'
  }))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    status: 'tu_choi',
    warehouse_handled_by: WAREHOUSE_ACCEPT,
    updated_at: 'now'
  }))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    status: 'da_xuat',
    warehouse_handled_by: WAREHOUSE_ACCEPT,
    export_order_id: 'export-real-from-request',
    updated_at: 'now'
  }))
})

test('Quyền từ chối chỉ được từ chối, không được tiếp nhận hoặc cho xuất', async () => {
  const db = env.authenticatedContext(WAREHOUSE_REJECT, { email: WAREHOUSE_REJECT }).firestore()

  await assertSucceeds(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    status: 'tu_choi',
    warehouse_handled_by: WAREHOUSE_REJECT,
    updated_at: 'now'
  }))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    status: 'da_tiep_nhan',
    warehouse_handled_by: WAREHOUSE_REJECT,
    updated_at: 'now'
  }))
  await assertFails(setDoc(doc(db, 'export_orders', 'export-by-reject-user'), {
    id: 'export-by-reject-user',
    code: 'PX-REJECT',
    created_by: WAREHOUSE_REJECT,
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))
})

test('Quyền cho xuất được tạo phiếu xuất thật, ghi tồn và cập nhật request/order', async () => {
  const db = env.authenticatedContext(WAREHOUSE_RELEASE, { email: WAREHOUSE_RELEASE }).firestore()

  await assertSucceeds(setDoc(doc(db, 'export_orders', 'export-real-from-request'), {
    id: 'export-real-from-request',
    code: 'PX-YC-001',
    source_request_id: 'export-a',
    created_by: WAREHOUSE_RELEASE,
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))
  await assertSucceeds(setDoc(doc(db, 'export_order_items', 'export-real-from-request-item'), {
    export_order_id: 'export-real-from-request',
    product_id: 'product-existing',
    from_warehouse_id: 'wh-a',
    quantity: 2,
    created_by: WAREHOUSE_RELEASE,
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))
  await assertSucceeds(setDoc(doc(db, 'stock_movements', 'move-release'), {
    id: 'move-release',
    movement_type: 'export_customer',
    direction: 'out',
    product_id: 'product-existing',
    warehouse_id: 'wh-a',
    quantity: -2,
    created_by: WAREHOUSE_RELEASE,
    created_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))
  await assertSucceeds(updateDoc(doc(db, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: 3,
    updated_at: 'now'
  }))
  await assertSucceeds(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    status: 'da_xuat',
    warehouse_handled_by: WAREHOUSE_RELEASE,
    export_order_id: 'export-real-from-request',
    warehouse_export_order_id: 'export-real-from-request',
    exported_at: 'now',
    updated_at: 'now'
  }))
  await assertSucceeds(updateDoc(doc(db, 'orders', 'order-a'), {
    warehouse_fulfillment_status: 'da_xuat_1_phan',
    warehouse_request_status: 'da_xuat',
    updated_at: 'now'
  }))
  await assertSucceeds(setDoc(doc(db, 'notifications', 'notification-release-to-sale'), {
    type: 'warehouse_export_request_released',
    title: 'Kho đã cho xuất hàng',
    message: 'Đã tạo phiếu PX-YC-001',
    created_by: WAREHOUSE_RELEASE,
    to_email: A,
    audience: '',
    audience_permissions: [],
    status: 'unread',
    active: true,
    deleted: false
  }))
})

test('User A không sửa shipment/invoice của User B', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertFails(updateDoc(doc(db, 'shipments', 'shipment-b'), { carrier: 'forged' }))
  await assertFails(updateDoc(doc(db, 'invoices', 'invoice-b'), { invoice_amount: 999 }))
})

test('Customer chỉ hiển thị và sửa dữ liệu của chính user', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(getDoc(doc(db, 'customers', 'customer-a')))
  await assertFails(getDoc(doc(db, 'customers', 'customer-b')))
  await assertSucceeds(updateDoc(doc(db, 'customers', 'customer-a'), { phone: '123' }))
  await assertFails(updateDoc(doc(db, 'customers', 'customer-b'), { phone: '999' }))
})

test('Query customer theo created_by được phép, query toàn bộ bị chặn', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(getDocs(query(collection(db, 'customers'), where('created_by', '==', A))))
  await assertFails(getDocs(query(collection(db, 'customers'))))
})



test('OR query ownership cho order và phiếu xuất được phép', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(getDocs(query(
    collection(db, 'orders'),
    or(
      where('owner_email', '==', A),
      where('created_by', '==', A),
      where('sale_email', '==', A)
    )
  )))
  await assertSucceeds(getDocs(query(
    collection(db, 'order_export_requests'),
    or(
      where('requested_by', '==', A),
      where('order_owner_email', '==', A),
      where('order_created_by', '==', A),
      where('order_sale_email', '==', A)
    )
  )))
})

test('Admin đọc và sửa dữ liệu của mọi user', async () => {
  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  await assertSucceeds(getDoc(doc(db, 'payments', 'payment-b')))
  await assertSucceeds(updateDoc(doc(db, 'users', A), { display_name: 'Updated by admin' }))
})


test('User A không thể sửa hoặc xóa order của User B', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertFails(updateDoc(doc(db, 'orders', 'order-b'), { customer_name: 'forged' }))
  await assertFails(deleteDoc(doc(db, 'orders', 'order-b')))
})

test('User A không thể đổi order_id của payment thuộc mình sang order B', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(setDoc(doc(db, 'payments', 'payment-a-immutable'), {
    order_id: 'order-a', created_by: A, ...ownership(A), amount: 200, active: true
  }))
  await assertFails(updateDoc(doc(db, 'payments', 'payment-a-immutable'), {
    order_id: 'order-b', ...ownership(B)
  }))
})

test('User A không thể tạo shipment hoặc invoice giả cho order B', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertFails(setDoc(doc(db, 'shipments', 'shipment-forged'), {
    order_id: 'order-b', created_by: A, ...ownership(A), active: true
  }))
  await assertFails(setDoc(doc(db, 'invoices', 'invoice-forged'), {
    order_id: 'order-b', created_by: A, ...ownership(A), active: true
  }))
})

test('User A không thể hard-delete shipment hoặc invoice của User B', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertFails(deleteDoc(doc(db, 'shipments', 'shipment-b')))
  await assertFails(deleteDoc(doc(db, 'invoices', 'invoice-b')))
})

test('User thường không thể tạo, sửa hoặc xóa role', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertFails(setDoc(doc(db, 'roles', 'admin-forged'), { permissions: ['*'] }))
  await assertFails(updateDoc(doc(db, 'roles', 'missing-role'), { permissions: ['*'] }))
  await assertFails(deleteDoc(doc(db, 'roles', 'missing-role')))
})

test('Tương thích user status Hoạt động và role Admin cũ', async () => {
  const legacyDb = env.authenticatedContext(LEGACY, { email: LEGACY }).firestore()
  await assertSucceeds(getDoc(doc(legacyDb, 'orders', 'order-legacy')))

  const roleAdminDb = env.authenticatedContext(ROLE_ADMIN, { email: ROLE_ADMIN }).firestore()
  await assertSucceeds(getDocs(collection(roleAdminDb, 'users')))
})

test('Order item dùng owner_email/created_by/sale_email và đối chiếu parent thật', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(setDoc(doc(db, 'order_items', 'item-a-new'), {
    order_id: 'order-a', owner_email: A, created_by: A, sale_email: A,
    product_name: 'Sản phẩm A', active: true
  }))
  await assertFails(setDoc(doc(db, 'order_items', 'item-b-forged'), {
    order_id: 'order-b', owner_email: A, created_by: A, sale_email: A,
    product_name: 'Giả mạo', active: true
  }))
})

test('Admin có thể tạo dữ liệu con cho order của user khác', async () => {
  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  await assertSucceeds(setDoc(doc(db, 'payments', 'payment-b-by-admin'), {
    order_id: 'order-b', created_by: ADMIN, ...ownership(B), amount: 300, active: true
  }))
  await assertSucceeds(setDoc(doc(db, 'order_items', 'item-b-by-admin'), {
    order_id: 'order-b', owner_email: B, created_by: B, sale_email: B,
    product_name: 'Admin thêm', active: true
  }))
})

test('Chủ phiếu chỉ sửa khi phiếu còn ở trạng thái cho phép', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    payload_json: '{"quantity":2}', updated_at: 'now'
  }))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'export-a-done'), {
    payload_json: '{"quantity":999}', updated_at: 'now'
  }))
  await assertFails(deleteDoc(doc(db, 'order_export_requests', 'export-a-done')))
})

test('Quyền orders.edit không được giả trạng thái thanh toán hoặc kho', async () => {
  const db = env.authenticatedContext(EDITOR, { email: EDITOR }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'orders', 'order-editor'), {
    customer_name: 'Tên mới', updated_at: 'now'
  }))
  await assertFails(updateDoc(doc(db, 'orders', 'order-editor'), {
    paid_amount: 999999, payment_status: 'Đã thanh toán', updated_at: 'now'
  }))
  await assertFails(updateDoc(doc(db, 'orders', 'order-editor'), {
    warehouse_fulfillment_status: 'da_xuat_du', updated_at: 'now'
  }))
})



test('User có quyền sản phẩm được thêm, sửa và xóa mềm nhưng không hard-delete', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(setDoc(doc(db, 'products', 'product-new'), {
    product_code: 'SP002', product_name: 'Sản phẩm mới', unit: 'Chiếc',
    out_of_stock_max: 0, warning_stock_min: 1, warning_stock_max: 10,
    normal_stock_min: 11, created_by: A, active: true, deleted: false
  }))
  await assertSucceeds(updateDoc(doc(db, 'products', 'product-existing'), {
    product_name: 'Sản phẩm đã sửa', updated_at: 'now'
  }))
  await assertSucceeds(updateDoc(doc(db, 'products', 'product-existing'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now'
  }))
  await assertFails(deleteDoc(doc(db, 'products', 'product-new')))
})

test('Chủ phiếu được xóa mềm phiếu chưa xuất nhưng không xóa phiếu đã xuất', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'order_export_requests', 'export-a'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now'
  }))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'export-a-done'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now'
  }))
})

test('Không thể xóa mềm đơn đã có số lượng xuất kho', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertFails(updateDoc(doc(db, 'orders', 'order-a-exported'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now'
  }))
  await assertFails(deleteDoc(doc(db, 'orders', 'order-a-exported')))
})

test('Người nhận notification chỉ được đổi trạng thái đọc, không đổi người nhận hoặc nội dung', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'notifications', 'notification-a'), {
    status: 'read', read_at: 'now', updated_at: 'now'
  }))
  await assertFails(updateDoc(doc(db, 'notifications', 'notification-a'), {
    to_email: A.toUpperCase(), message: 'Đã sửa nội dung'
  }))
})


test('Tạo phiếu xuất và cập nhật tổng hợp đơn trong cùng batch', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  const batch = writeBatch(db)
  batch.set(doc(db, 'order_export_requests', 'export-batch-create'), {
    id: 'export-batch-create',
    request_id: 'YCXK-BATCH-CREATE',
    order_id: 'order-a',
    requested_by: A,
    ...ownership(A),
    status: 'cho_xu_ly',
    payload_json: '{"items":[{"product_code":"SP001","export_quantity":1}]}',
    active: true,
    deleted: false,
    created_at: 'now',
    updated_at: 'now'
  })
  batch.update(doc(db, 'orders', 'order-a'), {
    warehouse_fulfillment_status: 'cho_xu_ly',
    warehouse_request_status: 'cho_xu_ly',
    updated_at: 'now'
  })
  batch.set(doc(collection(db, 'activity_logs')), {
    module: 'order_export_requests',
    action: 'create',
    item_code: 'YCXK-BATCH-CREATE',
    changed_by: A,
    created_at: 'now',
    active: true,
    deleted: false
  })
  await assertSucceeds(batch.commit())
})

test('Xóa mềm phiếu chưa xuất và cập nhật lại tổng hợp đơn trong cùng batch', async () => {
  const db = env.authenticatedContext(A, { email: A }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'export-a'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: 'now',
    updated_at: 'now'
  })
  batch.update(doc(db, 'orders', 'order-a'), {
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: '',
    updated_at: 'now'
  })
  batch.set(doc(collection(db, 'activity_logs')), {
    module: 'order_export_requests',
    action: 'delete',
    item_code: 'export-a',
    changed_by: A,
    created_at: 'now',
    active: true,
    deleted: false
  })
  await assertSucceeds(batch.commit())
})

test('Warehouse catalog: user có quyền quản lý đọc/tạo được, user thường bị chặn', async () => {
  const catalogDb = env.authenticatedContext(CATALOG, { email: CATALOG }).firestore()
  const normalDb = env.authenticatedContext(A, { email: A }).firestore()

  await assertSucceeds(getDoc(doc(catalogDb, 'warehouses', 'wh-a')))
  await assertFails(getDoc(doc(normalDb, 'warehouses', 'wh-a')))

  await assertSucceeds(setDoc(doc(catalogDb, 'warehouses', 'wh-new'), {
    id: 'wh-new',
    name: 'Kho mới',
    created_by: CATALOG,
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))

  await assertFails(setDoc(doc(catalogDb, 'warehouses', 'wh-forged'), {
    id: 'wh-forged',
    name: 'Kho giả',
    created_by: A,
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))
})

test('Warehouse catalog: không cho sửa danh tính legacy/source của kho', async () => {
  const catalogDb = env.authenticatedContext(CATALOG, { email: CATALOG }).firestore()

  await assertSucceeds(updateDoc(doc(catalogDb, 'warehouses', 'wh-a'), {
    name: 'Kho A đã sửa',
    updated_at: 'now'
  }))

  await assertFails(updateDoc(doc(catalogDb, 'warehouses', 'wh-a'), {
    source: 'forged',
    created_by: CATALOG,
    updated_at: 'now'
  }))
})

test('Nhập kho Firestore: chỉ user có import.create được tạo phiếu và số lượng phải dương', async () => {
  const stockDb = env.authenticatedContext(STOCK, { email: STOCK }).firestore()
  const normalDb = env.authenticatedContext(A, { email: A }).firestore()

  await assertSucceeds(setDoc(doc(stockDb, 'import_orders', 'import-new'), {
    id: 'import-new',
    code: 'PN-NEW',
    created_by: STOCK,
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))

  await assertSucceeds(setDoc(doc(stockDb, 'import_order_items', 'import-item-new'), {
    import_order_id: 'import-new',
    product_id: 'product-existing',
    warehouse_id: 'wh-a',
    logo: '',
    quantity: 3,
    created_by: STOCK,
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))

  await assertFails(setDoc(doc(stockDb, 'import_order_items', 'import-item-negative'), {
    import_order_id: 'import-new',
    product_id: 'product-existing',
    warehouse_id: 'wh-a',
    quantity: -3,
    created_by: STOCK,
    active: true,
    deleted: false,
    source: 'nuxt'
  }))

  await assertFails(setDoc(doc(normalDb, 'import_orders', 'import-normal'), {
    id: 'import-normal',
    code: 'PN-NORMAL',
    created_by: A,
    active: true,
    deleted: false,
    source: 'nuxt'
  }))
})

test('Xóa mềm phiếu nhập Firestore: import.delete được đảo tồn bằng movement và balance', async () => {
  const deleteDb = env.authenticatedContext(STOCK_DELETE, { email: STOCK_DELETE }).firestore()

  await assertSucceeds(updateDoc(doc(deleteDb, 'import_orders', 'import-a'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: 'now',
    updated_by: STOCK_DELETE,
    updated_at: 'now'
  }))

  await assertSucceeds(updateDoc(doc(deleteDb, 'import_order_items', 'import-item-a'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: 'now',
    updated_by: STOCK_DELETE,
    updated_at: 'now'
  }))

  await assertSucceeds(setDoc(doc(deleteDb, 'stock_movements', 'move-import-delete'), {
    id: 'move-import-delete',
    movement_type: 'import_delete_reverse',
    direction: 'out',
    product_id: 'product-existing',
    warehouse_id: 'wh-a',
    logo: '',
    quantity: -5,
    created_by: STOCK_DELETE,
    created_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))

  await assertSucceeds(updateDoc(doc(deleteDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: 5,
    updated_at: 'now'
  }))
})

test('Xuất kho thật Firestore: tạo phiếu xuất thật và chi tiết phải có số lượng dương', async () => {
  const stockDb = env.authenticatedContext(STOCK, { email: STOCK }).firestore()

  await assertSucceeds(setDoc(doc(stockDb, 'export_orders', 'export-real-new'), {
    id: 'export-real-new',
    code: 'PX-NEW',
    created_by: STOCK,
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))

  await assertSucceeds(setDoc(doc(stockDb, 'export_order_items', 'export-real-item-new'), {
    export_order_id: 'export-real-new',
    product_id: 'product-existing',
    from_warehouse_id: 'wh-a',
    logo: '',
    quantity: 2,
    created_by: STOCK,
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))

  await assertFails(setDoc(doc(stockDb, 'export_order_items', 'export-real-item-zero'), {
    export_order_id: 'export-real-new',
    product_id: 'product-existing',
    from_warehouse_id: 'wh-a',
    quantity: 0,
    created_by: STOCK,
    active: true,
    deleted: false,
    source: 'nuxt'
  }))
})

test('Tồn kho Firestore: đọc theo quyền, không cho ghi tồn âm', async () => {
  const viewerDb = env.authenticatedContext(INVENTORY_VIEWER, { email: INVENTORY_VIEWER }).firestore()
  const stockDb = env.authenticatedContext(STOCK, { email: STOCK }).firestore()
  const normalDb = env.authenticatedContext(A, { email: A }).firestore()

  await assertSucceeds(getDoc(doc(viewerDb, 'inventory_balances', 'wh-a__product-existing__no_logo')))
  await assertSucceeds(getDoc(doc(stockDb, 'inventory_balances', 'wh-a__product-existing__no_logo')))
  await assertFails(getDoc(doc(normalDb, 'inventory_balances', 'wh-a__product-existing__no_logo')))

  await assertSucceeds(updateDoc(doc(stockDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: 7,
    updated_at: 'now'
  }))

  await assertFails(updateDoc(doc(stockDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: -1,
    updated_at: 'now'
  }))
})

test('Stock movements là append-only với client kho, chỉ admin được sửa lịch sử', async () => {
  const stockDb = env.authenticatedContext(STOCK, { email: STOCK }).firestore()
  const adminDb = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()

  await assertSucceeds(setDoc(doc(stockDb, 'stock_movements', 'move-new'), {
    id: 'move-new',
    movement_type: 'import',
    direction: 'in',
    product_id: 'product-existing',
    warehouse_id: 'wh-a',
    logo: '',
    quantity: 3,
    created_by: STOCK,
    created_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))

  await assertFails(updateDoc(doc(stockDb, 'stock_movements', 'move-a'), {
    quantity: 999,
    updated_at: 'now'
  }))

  await assertSucceeds(updateDoc(doc(adminDb, 'stock_movements', 'move-a'), {
    note: 'admin correction note',
    updated_at: 'now'
  }))
})


test('Phiếu xuất thủ công được sửa và hủy mềm với đúng quyền', async () => {
  const stockDb = env.authenticatedContext(STOCK, { email: STOCK }).firestore()

  await assertSucceeds(updateDoc(doc(stockDb, 'export_orders', 'export-real-a'), {
    note: 'Đã sửa phiếu thủ công',
    updated_by: STOCK,
    updated_at: 'now'
  }))

  await assertSucceeds(updateDoc(doc(stockDb, 'export_order_items', 'export-real-item-a'), {
    quantity: 3,
    updated_by: STOCK,
    updated_at: 'now'
  }))

  await assertSucceeds(updateDoc(doc(stockDb, 'export_orders', 'export-real-a'), {
    deleted: true,
    active: false,
    status: 'cancelled',
    deleted_at: 'now',
    deleted_by: STOCK,
    deleted_reason: 'Tạo nhầm',
    cancelled_at: 'now',
    cancelled_by: STOCK,
    cancel_reason: 'Tạo nhầm',
    updated_by: STOCK,
    updated_at: 'now'
  }))

  await assertSucceeds(updateDoc(doc(stockDb, 'export_order_items', 'export-real-item-a'), {
    deleted: true,
    active: false,
    status: 'cancelled',
    deleted_at: 'now',
    deleted_by: STOCK,
    deleted_reason: 'Tạo nhầm',
    updated_by: STOCK,
    updated_at: 'now'
  }))
})

test('Phiếu xuất sinh từ order_export_requests bị khóa sửa và hủy trực tiếp', async () => {
  const stockDb = env.authenticatedContext(STOCK, { email: STOCK }).firestore()

  await assertFails(updateDoc(doc(stockDb, 'export_orders', 'export-from-request-a'), {
    note: 'Không được sửa',
    updated_by: STOCK,
    updated_at: 'now'
  }))

  await assertFails(updateDoc(doc(stockDb, 'export_orders', 'export-from-request-a'), {
    deleted: true,
    active: false,
    status: 'cancelled',
    deleted_at: 'now',
    updated_by: STOCK,
    updated_at: 'now'
  }))

  await assertFails(updateDoc(doc(stockDb, 'export_order_items', 'export-from-request-item-a'), {
    quantity: 99,
    updated_by: STOCK,
    updated_at: 'now'
  }))
})

test('export.delete được ghi movement hoàn tồn và cập nhật balance không âm', async () => {
  const stockDb = env.authenticatedContext(STOCK, { email: STOCK }).firestore()

  await assertSucceeds(setDoc(doc(stockDb, 'stock_movements', 'move-export-cancel'), {
    id: 'move-export-cancel',
    movement_type: 'export_cancel_reverse_source',
    direction: 'in',
    product_id: 'product-existing',
    warehouse_id: 'wh-a',
    quantity: 2,
    created_by: STOCK,
    created_at: 'now',
    active: true,
    deleted: false,
    source: 'nuxt'
  }))

  await assertSucceeds(updateDoc(doc(stockDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: 12,
    updated_at: 'now'
  }))

  await assertFails(updateDoc(doc(stockDb, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
    quantity: -1,
    updated_at: 'now'
  }))
})

test('Điều chỉnh tồn là append-only với user kho', async () => {
  const stockDb = env.authenticatedContext(STOCK, { email: STOCK }).firestore()
  const adminDb = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()

  await assertFails(updateDoc(doc(stockDb, 'inventory_adjustments', 'adjustment-a'), {
    quantity: 999,
    updated_at: 'now'
  }))

  await assertFails(deleteDoc(doc(stockDb, 'inventory_adjustments', 'adjustment-a')))

  await assertSucceeds(updateDoc(doc(adminDb, 'inventory_adjustments', 'adjustment-a'), {
    note: 'Admin bổ sung ghi chú',
    updated_at: 'now'
  }))
})

test('Thông báo cá nhân chỉ được query bởi đúng người nhận', async () => {
  const dbA = env.authenticatedContext(A, { email: A }).firestore()
  const dbB = env.authenticatedContext(B, { email: B }).firestore()

  await assertSucceeds(getDocs(query(
    collection(dbA, 'notifications'),
    where('to_email', '==', A)
  )))
  await assertFails(getDocs(query(
    collection(dbB, 'notifications'),
    where('to_email', '==', A)
  )))
})

test('Thông báo broadcast của kho chỉ đọc được bởi user có quyền trang và quyền xử lý phù hợp', async () => {
  const acceptDb = env.authenticatedContext(WAREHOUSE_ACCEPT, { email: WAREHOUSE_ACCEPT }).firestore()
  const pageOnlyDb = env.authenticatedContext(WAREHOUSE_PAGE, { email: WAREHOUSE_PAGE }).firestore()
  const legacyProcessDb = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const saleDb = env.authenticatedContext(A, { email: A }).firestore()

  await assertSucceeds(getDocs(query(
    collection(acceptDb, 'notifications'),
    where('audience', '==', 'warehouse_export')
  )))
  await assertFails(getDocs(query(
    collection(pageOnlyDb, 'notifications'),
    where('audience', '==', 'warehouse_export')
  )))
  await assertFails(getDocs(query(
    collection(legacyProcessDb, 'notifications'),
    where('audience', '==', 'warehouse_export')
  )))
  await assertFails(getDocs(query(
    collection(saleDb, 'notifications'),
    where('audience', '==', 'warehouse_export')
  )))
})

test('Sale có quyền tạo yêu cầu được tạo thông báo broadcast cho kho', async () => {
  const saleDb = env.authenticatedContext(A, { email: A }).firestore()
  const inventoryDb = env.authenticatedContext(INVENTORY_VIEWER, { email: INVENTORY_VIEWER }).firestore()

  await assertSucceeds(setDoc(doc(saleDb, 'notifications', 'notification-sale-created'), {
    type: 'warehouse_export_request_created',
    title: 'Có yêu cầu xuất kho mới',
    message: 'YCXK-NEW',
    created_by: A,
    to_email: '',
    audience: 'warehouse_export',
    audience_permissions: ['export_requests.accept', 'export_requests.reject', 'export_requests.release'],
    status: 'unread',
    active: true,
    deleted: false
  }))

  await assertFails(setDoc(doc(inventoryDb, 'notifications', 'notification-invalid-broadcast'), {
    type: 'warehouse_export_request_created',
    title: 'Không hợp lệ',
    message: 'Không có quyền tạo yêu cầu',
    created_by: INVENTORY_VIEWER,
    to_email: '',
    audience: 'warehouse_export',
    audience_permissions: ['export_requests.accept'],
    status: 'unread',
    active: true,
    deleted: false
  }))
})

test('Mỗi user chỉ được tạo và đọc trạng thái đã đọc của chính mình', async () => {
  const dbA = env.authenticatedContext(A, { email: A }).firestore()
  const dbB = env.authenticatedContext(B, { email: B }).firestore()
  const readId = `notification-warehouse-a__${A}`

  await assertSucceeds(setDoc(doc(dbA, 'notification_reads', readId), {
    id: readId,
    notification_id: 'notification-warehouse-a',
    user_email: A,
    read_at: 'now',
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false
  }))

  await assertSucceeds(getDocs(query(
    collection(dbA, 'notification_reads'),
    where('user_email', '==', A)
  )))

  await assertSucceeds(setDoc(doc(dbA, 'notification_reads', readId), {
    read_at: 'later',
    created_at: 'later',
    updated_at: 'later'
  }, { merge: true }))

  await assertFails(setDoc(doc(dbB, 'notification_reads', `notification-warehouse-a__${A}-fake`), {
    id: `notification-warehouse-a__${A}-fake`,
    notification_id: 'notification-warehouse-a',
    user_email: A,
    read_at: 'now',
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false
  }))
})

