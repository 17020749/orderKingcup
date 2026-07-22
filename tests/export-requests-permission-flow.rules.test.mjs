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
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'

const projectId = 'demo-export-requests-permission-flow'
const OWNER = 'owner@example.com'
const ACTION = 'action@example.com'
const MANAGER = 'manager@example.com'
const VIEWER = 'viewer@example.com'
const CROSS = 'cross@example.com'
let env

function user(permissions) {
  return {
    email: '',
    active: true,
    deleted: false,
    status: 'active',
    permissions_flat: permissions,
  }
}

function order(id, owner = OWNER, requestStatus = '') {
  return {
    id,
    order_code: id,
    customer_name: 'Khách hàng test',
    owner_email: owner,
    created_by: owner,
    sale_email: owner,
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: requestStatus,
    active: true,
    deleted: false,
    status: 'active',
  }
}

function exportRequest(id, orderId, requestedBy = OWNER) {
  return {
    id,
    request_id: id,
    order_id: orderId,
    order_code: orderId,
    customer_name: 'Khách hàng test',
    export_date: '2026-07-22',
    requested_by: requestedBy,
    requested_at: '2026-07-22T00:00:00.000Z',
    updated_by: requestedBy,
    order_owner_email: OWNER,
    order_created_by: OWNER,
    order_sale_email: OWNER,
    status: 'cho_xu_ly',
    payload_json: '{}',
    request_timeline_json: '[]',
    warehouse_export_code: '',
    warehouse_handled_by: '',
    warehouse_handled_at: '',
    warehouse_note: '',
    active: true,
    deleted: false,
  }
}

function notificationPayload(type, requestId, actor) {
  return {
    type,
    title: type.endsWith('_updated')
      ? 'Yêu cầu xuất kho vừa được cập nhật'
      : 'Có yêu cầu xuất kho mới',
    message: `${requestId} · Đơn order-foreign`,
    route: '/warehouse-export-requests',
    entity_collection: 'order_export_requests',
    entity_id: requestId,
    entity_code: requestId,
    created_by: actor,
    to_email: '',
    audience: 'warehouse_export',
    audience_permissions: [
      'export_requests.accept',
      'export_requests.reject',
      'export_requests.release',
      'export_requests.process',
    ],
    metadata_json: JSON.stringify({ order_id: 'order-foreign' }),
    status: 'unread',
    read: false,
    active: true,
    deleted: false,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }
}

function activityPayload(action, requestId, actor) {
  return {
    module: 'order_export_requests',
    action,
    item_code: requestId,
    item_name: requestId,
    changed_by: actor,
    after_json: JSON.stringify({ id: requestId }),
    created_at: serverTimestamp(),
    active: true,
    deleted: false,
  }
}

function createForeignRequestBatch(db, actor, requestId) {
  const batch = writeBatch(db)
  batch.set(
    doc(db, 'order_export_requests', requestId),
    {
      ...exportRequest(requestId, 'order-foreign', actor),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    },
  )
  batch.update(doc(db, 'orders', 'order-foreign'), {
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: 'cho_xu_ly',
    updated_at: serverTimestamp(),
  })
  batch.set(doc(collection(db, 'activity_logs')), activityPayload('create', requestId, actor))
  batch.set(
    doc(collection(db, 'notifications')),
    notificationPayload('warehouse_export_request_created', requestId, actor),
  )
  return batch
}

function editForeignRequestBatch(db, actor, requestId = 'request-foreign') {
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', requestId), {
    customer_name: 'Khách hàng đã sửa',
    export_date: '2026-07-23',
    updated_by: actor,
    payload_json: JSON.stringify({ note: 'đã sửa' }),
    request_timeline_json: JSON.stringify([{ action: 'update', actor }]),
    updated_at: serverTimestamp(),
  })
  batch.update(doc(db, 'orders', 'order-foreign'), {
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: 'cho_xu_ly',
    updated_at: serverTimestamp(),
  })
  batch.set(doc(collection(db, 'activity_logs')), activityPayload('update', requestId, actor))
  batch.set(
    doc(collection(db, 'notifications')),
    notificationPayload('warehouse_export_request_updated', requestId, actor),
  )
  return batch
}

function deleteForeignRequestBatch(db, actor, requestId = 'request-foreign') {
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', requestId), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  })
  batch.update(doc(db, 'orders', 'order-foreign'), {
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: '',
    updated_at: serverTimestamp(),
  })
  batch.set(doc(collection(db, 'activity_logs')), activityPayload('delete', requestId, actor))
  return batch
}

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', OWNER), user([
        'export_requests.view',
        'orders.warehouse_export',
        'export_requests.delete',
      ])),
      setDoc(doc(db, 'users', ACTION), user([
        'export_requests.view',
        'orders.warehouse_export',
        'export_requests.delete',
      ])),
      setDoc(doc(db, 'users', MANAGER), user([
        'export_requests.view',
        'export_requests.view_all',
        'orders.warehouse_export',
        'export_requests.delete',
      ])),
      setDoc(doc(db, 'users', VIEWER), user([
        'export_requests.view',
        'export_requests.view_all',
      ])),
      setDoc(doc(db, 'users', CROSS), user([
        'orders.view_all',
        'orders.delete',
      ])),
      setDoc(doc(db, 'orders', 'order-own'), order('order-own', OWNER, '')),
      setDoc(doc(db, 'orders', 'order-foreign'), order('order-foreign', OWNER, 'cho_xu_ly')),
      setDoc(
        doc(db, 'order_export_requests', 'request-foreign'),
        exportRequest('request-foreign', 'order-foreign', OWNER),
      ),
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

test('view_all + action tạo, sửa và xóa yêu cầu của người khác bằng đúng batch của page', async () => {
  const db = env.authenticatedContext(MANAGER, { email: MANAGER }).firestore()
  await assertSucceeds(createForeignRequestBatch(db, MANAGER, 'request-manager').commit())
  await assertSucceeds(editForeignRequestBatch(db, MANAGER).commit())
  await assertSucceeds(deleteForeignRequestBatch(db, MANAGER).commit())
})

test('chỉ có view_all thì chỉ xem, không tạo sửa xóa', async () => {
  const db = env.authenticatedContext(VIEWER, { email: VIEWER }).firestore()
  await assertFails(createForeignRequestBatch(db, VIEWER, 'request-viewer').commit())
  await assertFails(editForeignRequestBatch(db, VIEWER).commit())
  await assertFails(deleteForeignRequestBatch(db, VIEWER).commit())
})

test('có action nhưng không có view_all chỉ thao tác dữ liệu của mình', async () => {
  const foreignDb = env.authenticatedContext(ACTION, { email: ACTION }).firestore()
  await assertFails(createForeignRequestBatch(foreignDb, ACTION, 'request-action').commit())
  await assertFails(editForeignRequestBatch(foreignDb, ACTION).commit())
  await assertFails(deleteForeignRequestBatch(foreignDb, ACTION).commit())

  const ownerDb = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  await assertSucceeds(updateDoc(doc(ownerDb, 'order_export_requests', 'request-foreign'), {
    export_date: '2026-07-24',
    updated_by: OWNER,
    updated_at: serverTimestamp(),
  }))
})


test('quyền đơn hàng không thay thế action của module yêu cầu xuất kho', async () => {
  const db = env.authenticatedContext(CROSS, { email: CROSS }).firestore()
  await assertFails(deleteForeignRequestBatch(db, CROSS).commit())
})

test('client dùng đúng action + view_all riêng cho create edit delete', () => {
  const page = readFileSync('pages/export-requests.vue', 'utf8')
  const rules = readFileSync('firestore.rules', 'utf8')

  assert.match(page, /function requestCreateDecision/)
  assert.match(page, /function requestEditDecision/)
  assert.match(page, /function requestDeleteDecision/)
  assert.match(page, /actionPermission: "orders\.warehouse_export"/)
  assert.match(page, /actionPermission: "export_requests\.delete"/)
  assert.match(page, /scopePermission: "export_requests\.view_all"/)
  assert.doesNotMatch(page, /hasPermission\("orders\.delete"\)/)
  assert.match(page, /await batch\.commit\(\);[\s\S]*?await setDoc\(doc\(collection\(db, "notifications"\)\)/)

  assert.match(rules, /hasPerm\('export_requests\.delete'\)[\s\S]*?hasPerm\('export_requests\.view_all'\)/)
  assert.doesNotMatch(rules, /hasAnyPerm\(\['export_requests\.delete', 'orders\.delete'\]\)/)
})
