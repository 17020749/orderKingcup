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
const CATALOG = 'catalog@example.com'
const INVENTORY_VIEWER = 'inventoryview@example.com'
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
      setDoc(doc(db, 'order_export_requests', 'export-a'), { order_id: 'order-a', requested_by: A, ...ownership(A), status: 'cho_xu_ly', payload_json: '{}', active: true }),
      setDoc(doc(db, 'order_export_requests', 'export-a-done'), { order_id: 'order-a-exported', requested_by: A, ...ownership(A), status: 'da_xuat', payload_json: '{}', active: true }),
      setDoc(doc(db, 'shipments', 'shipment-b'), { order_id: 'order-b', created_by: B, ...ownership(B), active: true }),
      setDoc(doc(db, 'invoices', 'invoice-b'), { order_id: 'order-b', created_by: B, ...ownership(B), active: true }),
      setDoc(doc(db, 'customers', 'customer-a'), { customer_name: 'A', created_by: A, active: true }),
      setDoc(doc(db, 'customers', 'customer-b'), { customer_name: 'B', created_by: B, active: true }),
      setDoc(doc(db, 'products', 'product-existing'), { product_code: 'SP001', product_name: 'Sản phẩm cũ', unit: 'Cái', created_by: A, active: true, deleted: false }),
      setDoc(doc(db, 'notifications', 'notification-a'), { to_email: A, created_by: B, status: 'unread', message: 'Test' }),
      setDoc(doc(db, 'users', STOCK), {
        email: STOCK,
        active: true,
        deleted: false,
        permissions_flat: [
          'import.view', 'import.create', 'import.edit',
          'export.view', 'export.create', 'export.edit',
          'inventory.view', 'inventory.adjust', 'stock_movements.view',
          'export_requests.process'
        ]
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
      setDoc(doc(db, 'export_orders', 'export-real-a'), { id: 'export-real-a', code: 'PX-A', created_by: STOCK, active: true, deleted: false, source: 'test' }),
      setDoc(doc(db, 'export_order_items', 'export-real-item-a'), { export_order_id: 'export-real-a', product_id: 'product-existing', warehouse_id: 'wh-a', quantity: 2, created_by: STOCK, active: true, deleted: false, source: 'test' }),
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
