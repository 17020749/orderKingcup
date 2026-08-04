import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'

const projectId = 'demo-external-export-release'
const WAREHOUSE = 'warehouse@example.com'
const SALE = 'sale@example.com'
const EXPORT_ID = 'external-export-a'
const EXPORT_CODE = 'PXK-NGOAI-A'
let env

function requestData(overrides = {}) {
  return {
    id: 'request-a', request_id: 'YCXK-A', order_id: 'order-a', order_code: 'ORDER-A',
    customer_name: 'Khách A', requested_by: SALE, order_owner_email: SALE,
    order_created_by: SALE, order_sale_email: SALE, status: 'da_tiep_nhan',
    lifecycle_status: 'accepted', release_sequence: 0, active_export_order_id: '',
    warehouse_export_code: '', warehouse_export_id: '', warehouse_export_order_id: '',
    export_order_id: '', request_timeline_json: '[]',
    payload_json: JSON.stringify({ items: [{ order_item_id: 'item-a', product_id: 'product-a', product_code: 'SP-A', logo: '', export_quantity: 4 }] }),
    actual_export_summary_json: '[]', stock_movement_ids: [], revision: 0,
    active: true, deleted: false, ...overrides,
  }
}

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', WAREHOUSE), { email: WAREHOUSE, active: true, deleted: false, permissions_flat: ['page.warehouse_export_requests', 'export_requests.release'] }),
      setDoc(doc(db, 'users', SALE), { email: SALE, active: true, deleted: false, permissions_flat: ['orders.view', 'export_requests.view'] }),
      setDoc(doc(db, 'orders', 'order-a'), {
        id: 'order-a', order_code: 'ORDER-A', owner_email: SALE, created_by: SALE, sale_email: SALE,
        warehouse_fulfillment_status: 'cho_xu_ly', warehouse_request_status: 'da_tiep_nhan',
        active: true, deleted: false, status: 'active',
      }),
      setDoc(doc(db, 'order_export_requests', 'request-a'), requestData()),
    ])
  })
}

function externalPatch(overrides = {}) {
  return {
    status: 'da_xuat', lifecycle_status: 'released_external', release_mode: 'external_no_inventory',
    external_exported: true, external_export_date: '2026-08-04', external_exported_by: WAREHOUSE,
    external_exported_at: serverTimestamp(), external_export_order_id: EXPORT_ID,
    external_export_code: EXPORT_CODE, release_sequence: 1,
    active_export_order_id: '', warehouse_export_code: '', warehouse_export_id: '',
    warehouse_export_order_id: '', export_order_id: '', warehouse_handled_by: WAREHOUSE,
    warehouse_handled_at: serverTimestamp(), warehouse_note: 'Đã xuất thực tế trước khi nhập tồn',
    exported_at: serverTimestamp(), actual_exported_at: serverTimestamp(),
    actual_export_summary_json: '[{"quantity":4,"release_mode":"external_no_inventory"}]',
    stock_movement_ids: [], request_timeline_json: '[{"action":"external_release"}]',
    operation_id: 'external-release:request-a:0', last_operation_id: 'external-release:request-a:0',
    revision: 1, updated_at: serverTimestamp(), ...overrides,
  }
}

function externalExportOrder(overrides = {}) {
  return {
    id: EXPORT_ID, code: EXPORT_CODE, export_code: EXPORT_CODE, export_date: '2026-08-04',
    destination_type: 'customer', source_order_id: 'order-a', source_order_code: 'ORDER-A',
    source_request_id: 'request-a', sync_source: 'kingcup_firestore:external_no_inventory',
    customer_name: 'Khách A', destination_name: 'Khách A', to_warehouse_id: '', to_warehouse_name: '',
    note: 'Đã xuất thực tế trước khi nhập tồn', status: 'completed', lifecycle_status: 'released_external',
    release_mode: 'external_no_inventory', affects_inventory: false, stock_movement_ids: [],
    release_sequence: 1, source_request_revision: 0,
    request_operation_id: 'external-release:request-a:0', active: true, deleted: false,
    created_by: WAREHOUSE, created_at: serverTimestamp(), updated_at: serverTimestamp(),
    operation_id: 'external-release:request-a:0', last_operation_id: 'external-release:request-a:0',
    revision: 1, source: 'kingcup_firestore', ...overrides,
  }
}

function externalExportItem(overrides = {}) {
  return {
    id: 'external-item-a', export_order_id: EXPORT_ID, source_order_id: 'order-a',
    source_order_item_id: '', product_id: 'product-a', product_code: 'SP-A', product_name: 'Sản phẩm A',
    from_warehouse_id: '', from_warehouse_name: 'Xuất ngoài hệ thống', to_warehouse_id: '', to_warehouse_name: '',
    destination_name: 'Khách A', logo: '', source_logo: '', target_logo: '', quantity: 4, unit: 'cái',
    note: 'Đã xuất ngoài hệ thống', status: 'completed', lifecycle_status: 'released_external',
    release_mode: 'external_no_inventory', affects_inventory: false, active: true, deleted: false,
    created_by: WAREHOUSE, created_at: serverTimestamp(), updated_at: serverTimestamp(),
    operation_id: 'external-release:request-a:0', last_operation_id: 'external-release:request-a:0',
    revision: 1, source: 'kingcup_firestore', ...overrides,
  }
}

function updateOrderSummary(db, batch, fulfillment = 'da_xuat_1_phan', requestStatus = 'da_xuat') {
  batch.update(doc(db, 'orders', 'order-a'), {
    warehouse_fulfillment_status: fulfillment, warehouse_request_status: requestStatus, updated_at: serverTimestamp(),
  })
}

function addExternalRecord(db, batch, orderOverrides = {}, itemOverrides = {}) {
  batch.set(doc(db, 'export_orders', EXPORT_ID), externalExportOrder(orderOverrides))
  batch.set(doc(db, 'export_order_items', 'external-item-a'), externalExportItem(itemOverrides))
}

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } })
})
beforeEach(async () => { await env.clearFirestore(); await seed() })
after(async () => env.cleanup())

test('external release tạo phiếu hiển thị ở exports nhưng không sinh biến động tồn', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(db, batch)
  addExternalRecord(db, batch)
  await assertSucceeds(batch.commit())

  await env.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore()
    const requestRows = await getDocs(collection(adminDb, 'order_export_requests'))
    const orderRows = await getDocs(collection(adminDb, 'orders'))
    const exports = await getDocs(collection(adminDb, 'export_orders'))
    const exportItems = await getDocs(collection(adminDb, 'export_order_items'))
    const movements = await getDocs(collection(adminDb, 'stock_movements'))
    const balances = await getDocs(collection(adminDb, 'inventory_balances'))
    const request = requestRows.docs[0].data()
    const order = orderRows.docs[0].data()
    const exportOrder = exports.docs[0].data()
    assert.equal(request.status, 'da_xuat')
    assert.equal(request.external_export_order_id, EXPORT_ID)
    assert.equal(order.warehouse_request_status, 'da_xuat')
    assert.equal(order.warehouse_fulfillment_status, 'da_xuat_1_phan')
    assert.equal(exports.size, 1)
    assert.equal(exportItems.size, 1)
    assert.equal(exportOrder.affects_inventory, false)
    assert.equal(exportOrder.release_mode, 'external_no_inventory')
    assert.equal(movements.empty, true)
    assert.equal(balances.empty, true)
  })
})

test('external release cho phép đơn hàng chuyển thẳng sang đã xuất đủ', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(db, batch, 'da_xuat_du')
  addExternalRecord(db, batch)
  await assertSucceeds(batch.commit())
})

test('không có quyền release thì bị chặn dù payload đầy đủ', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', WAREHOUSE), { email: WAREHOUSE, active: true, deleted: false, permissions_flat: ['page.warehouse_export_requests'] })
  })
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(db, batch)
  addExternalRecord(db, batch)
  await assertFails(batch.commit())
})

test('chỉ tạo phiếu exports mà không cập nhật request bị chặn', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  addExternalRecord(db, batch)
  await assertFails(batch.commit())
})

test('external release thiếu phiếu exports bị chặn', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(db, batch)
  await assertFails(batch.commit())
})

test('external release không được gắn liên kết xuất chuẩn hoặc movement giả', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch({
    active_export_order_id: EXPORT_ID, export_order_id: EXPORT_ID, stock_movement_ids: ['move-fake'],
  }))
  updateOrderSummary(db, batch)
  addExternalRecord(db, batch)
  await assertFails(batch.commit())
})

test('phiếu ghi nhận bắt buộc affects_inventory false', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(db, batch)
  addExternalRecord(db, batch, { affects_inventory: true })
  await assertFails(batch.commit())
})

test('external release cập nhật order sai trạng thái bị chặn', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(db, batch, 'cho_xu_ly', 'da_tiep_nhan')
  addExternalRecord(db, batch)
  await assertFails(batch.commit())
})

test('external release bắt buộc có lý do xác nhận', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch({ warehouse_note: '' }))
  updateOrderSummary(db, batch)
  addExternalRecord(db, batch)
  await assertFails(batch.commit())
})
