import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'

const projectId = 'demo-external-export-release'
const WAREHOUSE = 'warehouse@example.com'
const SALE = 'sale@example.com'
let env

function requestData(overrides = {}) {
  return {
    id: 'request-a',
    request_id: 'YCXK-A',
    order_id: 'order-a',
    order_code: 'ORDER-A',
    customer_name: 'Khách A',
    requested_by: SALE,
    order_owner_email: SALE,
    order_created_by: SALE,
    order_sale_email: SALE,
    status: 'da_tiep_nhan',
    lifecycle_status: 'accepted',
    release_sequence: 0,
    active_export_order_id: '',
    warehouse_export_code: '',
    warehouse_export_id: '',
    warehouse_export_order_id: '',
    export_order_id: '',
    request_timeline_json: '[]',
    payload_json: JSON.stringify({
      items: [{
        order_item_id: 'item-a',
        product_id: 'product-a',
        product_code: 'SP-A',
        logo: '',
        export_quantity: 4,
      }],
    }),
    actual_export_summary_json: '[]',
    stock_movement_ids: [],
    revision: 0,
    active: true,
    deleted: false,
    ...overrides,
  }
}

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', WAREHOUSE), {
        email: WAREHOUSE,
        active: true,
        deleted: false,
        permissions_flat: ['page.warehouse_export_requests', 'export_requests.release'],
      }),
      setDoc(doc(db, 'users', SALE), {
        email: SALE,
        active: true,
        deleted: false,
        permissions_flat: ['orders.view', 'export_requests.view'],
      }),
      setDoc(doc(db, 'orders', 'order-a'), {
        id: 'order-a',
        order_code: 'ORDER-A',
        owner_email: SALE,
        created_by: SALE,
        sale_email: SALE,
        warehouse_fulfillment_status: 'cho_xu_ly',
        warehouse_request_status: 'da_tiep_nhan',
        active: true,
        deleted: false,
        status: 'active',
      }),
      setDoc(doc(db, 'order_export_requests', 'request-a'), requestData()),
    ])
  })
}

function externalPatch(overrides = {}) {
  return {
    status: 'da_xuat',
    lifecycle_status: 'released_external',
    release_mode: 'external_no_inventory',
    external_exported: true,
    external_export_date: '2026-08-04',
    external_exported_by: WAREHOUSE,
    external_exported_at: serverTimestamp(),
    active_export_order_id: '',
    warehouse_export_code: '',
    warehouse_export_id: '',
    warehouse_export_order_id: '',
    export_order_id: '',
    warehouse_handled_by: WAREHOUSE,
    warehouse_handled_at: serverTimestamp(),
    warehouse_note: 'Đã xuất thực tế trước khi nhập tồn',
    exported_at: serverTimestamp(),
    actual_exported_at: serverTimestamp(),
    actual_export_summary_json: '[{"quantity":4,"release_mode":"external_no_inventory"}]',
    stock_movement_ids: [],
    request_timeline_json: '[{"action":"external_release"}]',
    operation_id: 'external-release:request-a:0',
    last_operation_id: 'external-release:request-a:0',
    revision: 1,
    updated_at: serverTimestamp(),
    ...overrides,
  }
}

function updateOrderSummary(batch, fulfillment = 'da_xuat_1_phan', requestStatus = 'da_xuat') {
  batch.update(doc(batch._firestore, 'orders', 'order-a'), {
    warehouse_fulfillment_status: fulfillment,
    warehouse_request_status: requestStatus,
    updated_at: serverTimestamp(),
  })
}

function notificationData() {
  return {
    type: 'warehouse_export_request_released',
    title: 'Kho xác nhận đơn đã xuất ngoài hệ thống',
    message: 'YCXK-A · Đơn ORDER-A đã xuất thực tế ngoài hệ thống và không trừ tồn kho.',
    route: '/export-requests',
    entity_collection: 'order_export_requests',
    entity_id: 'request-a',
    entity_code: 'YCXK-A',
    created_by: WAREHOUSE,
    to_email: SALE,
    audience: '',
    audience_permissions: [],
    metadata_json: JSON.stringify({ order_id: 'order-a', order_code: 'ORDER-A' }),
    status: 'unread',
    read: false,
    active: true,
    deleted: false,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
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
  await seed()
})

after(async () => env.cleanup())

test('external release cập nhật request + order nhưng không sinh dữ liệu kho', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(batch)
  batch.set(doc(db, 'notifications', 'notification-a'), notificationData())
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

    assert.equal(request.status, 'da_xuat')
    assert.equal(request.lifecycle_status, 'released_external')
    assert.equal(request.release_mode, 'external_no_inventory')
    assert.equal(order.warehouse_request_status, 'da_xuat')
    assert.equal(order.warehouse_fulfillment_status, 'da_xuat_1_phan')
    assert.equal(exports.empty, true)
    assert.equal(exportItems.empty, true)
    assert.equal(movements.empty, true)
    assert.equal(balances.empty, true)
  })
})

test('external release cho phép đơn hàng chuyển thẳng sang đã xuất đủ', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(batch, 'da_xuat_du')
  await assertSucceeds(batch.commit())
})

test('không có quyền release thì external release bị chặn dù order cập nhật đúng', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', WAREHOUSE), {
      email: WAREHOUSE,
      active: true,
      deleted: false,
      permissions_flat: ['page.warehouse_export_requests'],
    })
  })

  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(batch)
  await assertFails(batch.commit())
})

test('external release không được gắn phiếu xuất hoặc movement giả', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch({
    active_export_order_id: 'export-fake',
    export_order_id: 'export-fake',
    stock_movement_ids: ['move-fake'],
  }))
  updateOrderSummary(batch)
  await assertFails(batch.commit())
})

test('external release chỉ cập nhật request bị chặn để tránh lệch trạng thái đơn hàng', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'request-a'), externalPatch()))
})

test('external release cập nhật order sai trạng thái bị chặn', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(batch, 'cho_xu_ly', 'da_tiep_nhan')
  await assertFails(batch.commit())
})

test('external release bắt buộc có lý do xác nhận', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch({ warehouse_note: '' }))
  updateOrderSummary(batch)
  await assertFails(batch.commit())
})
