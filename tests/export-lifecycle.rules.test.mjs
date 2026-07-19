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

const projectId = 'demo-export-lifecycle-step8'
const WAREHOUSE = 'warehouse@example.com'
const SALE = 'sale@example.com'
let env

function orderData() {
  return {
    id: 'order-a',
    order_code: 'ORDER-A',
    owner_email: SALE,
    created_by: SALE,
    sale_email: SALE,
    warehouse_fulfillment_status: 'cho_xu_ly',
    warehouse_request_status: 'da_tiep_nhan',
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
  }
}

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
    actual_export_summary_json: '[]',
    stock_movement_ids: [],
    revision: 0,
    active: true,
    deleted: false,
    ...overrides,
  }
}

function generatedExportData(overrides = {}) {
  return {
    id: 'request_export__request-a',
    code: 'PXK-YCXK-A',
    export_code: 'PXK-YCXK-A',
    export_date: '2026-07-19',
    destination_type: 'customer',
    source_order_code: 'ORDER-A',
    source_request_id: 'request-a',
    sync_source: 'kingcup_firestore:request-a',
    source: 'kingcup_firestore',
    lifecycle_status: 'released',
    release_sequence: 1,
    source_request_revision: 0,
    request_operation_id: 'op-release-a',
    customer_name: 'Khách A',
    destination_name: 'Khách A',
    created_by: WAREHOUSE,
    operation_id: 'op-release-a',
    last_operation_id: 'op-release-a',
    revision: 1,
    active: true,
    deleted: false,
    status: 'completed',
    ...overrides,
  }
}

function generatedItemData(overrides = {}) {
  return {
    id: 'request_export__request-a__1',
    export_order_id: 'request_export__request-a',
    product_id: 'product-a',
    product_code: 'SP-A',
    product_name: 'Sản phẩm A',
    from_warehouse_id: 'warehouse-a',
    from_warehouse_name: 'Kho A',
    to_warehouse_id: '',
    to_warehouse_name: '',
    destination_name: 'Khách A',
    logo: '',
    source_logo: '',
    target_logo: '',
    quantity: 2,
    unit: 'Cái',
    created_by: WAREHOUSE,
    operation_id: 'op-release-a',
    last_operation_id: 'op-release-a',
    revision: 1,
    source: 'kingcup_firestore',
    active: true,
    deleted: false,
    status: 'completed',
    ...overrides,
  }
}

function releaseRequestPatch(exportId = 'request_export__request-a', sequence = 1, operationId = 'op-release-a') {
  return {
    status: 'da_xuat',
    lifecycle_status: 'released',
    release_sequence: sequence,
    active_export_order_id: exportId,
    warehouse_export_code: sequence === 1 ? 'PXK-YCXK-A' : `PXK-YCXK-A-${sequence}`,
    warehouse_export_id: exportId,
    warehouse_export_order_id: exportId,
    export_order_id: exportId,
    warehouse_handled_by: WAREHOUSE,
    warehouse_handled_at: 'now',
    warehouse_note: '',
    exported_at: 'now',
    actual_exported_at: 'now',
    actual_export_summary_json: '[{"product_id":"product-a","warehouse_id":"warehouse-a","quantity":2}]',
    stock_movement_ids: [`move-${sequence}`],
    request_timeline_json: '[{"action":"warehouse_export"}]',
    operation_id: operationId,
    last_operation_id: operationId,
    last_released_export_order_id: exportId,
    last_released_export_code: sequence === 1 ? 'PXK-YCXK-A' : `PXK-YCXK-A-${sequence}`,
    last_released_by: WAREHOUSE,
    revision: sequence,
    updated_at: 'now',
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
        permissions_flat: [
          'page.warehouse_export_requests',
          'export_requests.release',
          'export.view',
          'inventory.view',
          'stock_movements.view',
        ],
      }),
      setDoc(doc(db, 'users', SALE), {
        email: SALE,
        active: true,
        deleted: false,
        permissions_flat: ['orders.view', 'export_requests.view'],
      }),
      setDoc(doc(db, 'orders', 'order-a'), orderData()),
      setDoc(doc(db, 'order_export_requests', 'request-a'), requestData()),
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

test('release phải tạo export và cập nhật request trong cùng batch', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.set(doc(db, 'export_orders', 'request_export__request-a'), generatedExportData())
  batch.set(doc(db, 'export_order_items', 'request_export__request-a__1'), generatedItemData())
  batch.update(doc(db, 'order_export_requests', 'request-a'), releaseRequestPatch())
  batch.update(doc(db, 'orders', 'order-a'), {
    warehouse_fulfillment_status: 'da_xuat_1_phan',
    warehouse_request_status: 'da_xuat',
    updated_at: 'now',
  })
  await assertSucceeds(batch.commit())
})

test('request release hoặc generated export ghi một phía đều bị chặn', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'request-a'), releaseRequestPatch()))
  await assertFails(setDoc(doc(db, 'export_orders', 'request_export__request-a'), generatedExportData()))
})

test('generated export giả liên kết sang request khác bị chặn', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.set(doc(db, 'export_orders', 'request_export__request-a'), generatedExportData({ source_request_id: 'request-forged' }))
  batch.update(doc(db, 'order_export_requests', 'request-a'), releaseRequestPatch())
  await assertFails(batch.commit())
})

test('hủy release phải cancel export và mở lại request trong cùng batch', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'order_export_requests', 'request-a'), requestData({
        ...releaseRequestPatch(),
        revision: 1,
      })),
      setDoc(doc(db, 'export_orders', 'request_export__request-a'), generatedExportData()),
      setDoc(doc(db, 'export_order_items', 'request_export__request-a__1'), generatedItemData()),
    ])
  })

  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'export_orders', 'request_export__request-a'), {
    lifecycle_status: 'cancelled',
    deleted: true,
    active: false,
    status: 'cancelled',
    deleted_at: 'later',
    deleted_by: WAREHOUSE,
    deleted_reason: 'Khách hoãn',
    cancelled_at: 'later',
    cancelled_by: WAREHOUSE,
    cancel_reason: 'Khách hoãn',
    operation_id: 'op-cancel-a',
    last_operation_id: 'op-cancel-a',
    revision: 2,
    updated_at: 'later',
  })
  batch.update(doc(db, 'export_order_items', 'request_export__request-a__1'), {
    deleted: true,
    active: false,
    status: 'cancelled',
    deleted_at: 'later',
    deleted_by: WAREHOUSE,
    deleted_reason: 'Khách hoãn',
    operation_id: 'op-cancel-a',
    last_operation_id: 'op-cancel-a',
    revision: 2,
    updated_at: 'later',
  })
  batch.update(doc(db, 'order_export_requests', 'request-a'), {
    status: 'da_tiep_nhan',
    lifecycle_status: 'release_cancelled',
    active_export_order_id: '',
    warehouse_export_code: '',
    warehouse_export_id: '',
    warehouse_export_order_id: '',
    export_order_id: '',
    exported_at: null,
    actual_exported_at: null,
    actual_export_summary_json: '[]',
    stock_movement_ids: [],
    warehouse_handled_by: WAREHOUSE,
    warehouse_handled_at: 'later',
    warehouse_note: 'Khách hoãn',
    request_timeline_json: '[{"action":"warehouse_export_cancel"}]',
    operation_id: 'op-cancel-a',
    last_operation_id: 'op-cancel-a',
    last_cancelled_export_order_id: 'request_export__request-a',
    last_cancelled_export_code: 'PXK-YCXK-A',
    last_cancelled_by: WAREHOUSE,
    last_cancel_reason: 'Khách hoãn',
    cancel_count: 1,
    revision: 2,
    updated_at: 'later',
  })
  batch.update(doc(db, 'orders', 'order-a'), {
    warehouse_fulfillment_status: 'cho_xu_ly',
    warehouse_request_status: 'da_tiep_nhan',
    updated_at: 'later',
  })
  await assertSucceeds(batch.commit())
})

test('hủy chỉ request hoặc chỉ generated export đều bị chặn', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'order_export_requests', 'request-a'), requestData({ ...releaseRequestPatch(), revision: 1 })),
      setDoc(doc(db, 'export_orders', 'request_export__request-a'), generatedExportData()),
    ])
  })
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'request-a'), {
    status: 'da_tiep_nhan',
    lifecycle_status: 'release_cancelled',
    active_export_order_id: '',
    warehouse_export_code: '',
    warehouse_export_id: '',
    warehouse_export_order_id: '',
    export_order_id: '',
    exported_at: null,
    actual_exported_at: null,
    actual_export_summary_json: '[]',
    stock_movement_ids: [],
    warehouse_handled_by: WAREHOUSE,
    warehouse_handled_at: 'later',
    warehouse_note: 'Khách hoãn',
    request_timeline_json: '[]',
    operation_id: 'op-cancel-a',
    last_operation_id: 'op-cancel-a',
    last_cancelled_export_order_id: 'request_export__request-a',
    last_cancelled_export_code: 'PXK-YCXK-A',
    last_cancelled_by: WAREHOUSE,
    last_cancel_reason: 'Khách hoãn',
    cancel_count: 1,
    revision: 2,
    updated_at: 'later',
  }))
  await assertFails(updateDoc(doc(db, 'export_orders', 'request_export__request-a'), {
    lifecycle_status: 'cancelled',
    deleted: true,
    active: false,
    status: 'cancelled',
    deleted_at: 'later',
    deleted_by: WAREHOUSE,
    deleted_reason: 'Khách hoãn',
    cancelled_at: 'later',
    cancelled_by: WAREHOUSE,
    cancel_reason: 'Khách hoãn',
    operation_id: 'op-cancel-a',
    last_operation_id: 'op-cancel-a',
    revision: 2,
    updated_at: 'later',
  }))
})

test('sau hủy có thể release lần hai bằng export ID sequence mới', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, 'order_export_requests', 'request-a'), requestData({
      status: 'da_tiep_nhan',
      lifecycle_status: 'release_cancelled',
      release_sequence: 1,
      cancel_count: 1,
      last_cancelled_export_order_id: 'request_export__request-a',
      revision: 2,
    }))
  })
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const exportId = 'request_export__request-a__2'
  const operationId = 'op-release-a-2'
  const batch = writeBatch(db)
  batch.set(doc(db, 'export_orders', exportId), generatedExportData({
    id: exportId,
    code: 'PXK-YCXK-A-2',
    export_code: 'PXK-YCXK-A-2',
    release_sequence: 2,
    source_request_revision: 2,
    request_operation_id: operationId,
    operation_id: operationId,
    last_operation_id: operationId,
  }))
  batch.update(doc(db, 'order_export_requests', 'request-a'), {
    ...releaseRequestPatch(exportId, 2, operationId),
    revision: 3,
  })
  await assertSucceeds(batch.commit())
  const snap = await getDoc(doc(db, 'order_export_requests', 'request-a'))
  if (snap.data()?.active_export_order_id !== exportId) throw new Error('Request phải trỏ tới release lần hai')
})
