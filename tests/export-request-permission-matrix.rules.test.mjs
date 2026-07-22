import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore'

const projectId = 'demo-export-request-permission-matrix'
const ACTOR = 'actor@example.com'
const OTHER = 'other@example.com'
let env

function order(id, owner) {
  return {
    id,
    order_code: id,
    owner_email: owner,
    created_by: owner,
    sale_email: owner,
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: '',
    printing_lock_version: 1,
    printing_progress_count: 0,
    relation_lock_version: 1,
    payment_record_count: 0,
    invoice_record_count: 0,
    shipment_record_count: 0,
    active: true,
    deleted: false,
    status: 'active',
  }
}

function ownership(owner) {
  return {
    order_owner_email: owner,
    order_created_by: owner,
    order_sale_email: owner,
  }
}

function exportRequest(id, orderId, owner, status = 'cho_xu_ly') {
  return {
    id,
    request_id: id,
    order_id: orderId,
    order_code: orderId,
    requested_by: owner,
    created_by: owner,
    updated_by: owner,
    ...ownership(owner),
    status,
    payload_json: '{}',
    request_timeline_json: '[]',
    warehouse_export_code: '',
    active_export_order_id: '',
    export_order_id: '',
    warehouse_export_order_id: '',
    warehouse_export_id: '',
    active: true,
    deleted: false,
    created_at: 'created',
    requested_at: 'requested',
    updated_at: 'seed',
  }
}

async function setPermissions(permissions) {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', ACTOR), {
      email: ACTOR,
      active: true,
      deleted: false,
      permissions_flat: permissions,
    })
  })
}

function client() {
  return env.authenticatedContext(ACTOR, { email: ACTOR }).firestore()
}

function createRequestBatch(db, suffix, orderId, orderOwner) {
  const requestId = `request-create-${suffix}`
  const batch = writeBatch(db)
  batch.set(doc(db, 'order_export_requests', requestId), {
    ...exportRequest(requestId, orderId, ACTOR),
    ...ownership(orderOwner),
  })
  batch.update(doc(db, 'orders', orderId), {
    warehouse_fulfillment_status: 'cho_xu_ly',
    warehouse_request_status: 'cho_xu_ly',
    updated_at: `create-${suffix}`,
  })
  return batch.commit()
}

function editRequestBatch(db, suffix, orderId) {
  const requestId = `request-${suffix}`
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', requestId), {
    payload_json: JSON.stringify({ edited: true }),
    request_timeline_json: JSON.stringify([{ action: 'edit', actor: ACTOR }]),
    updated_by: ACTOR,
    updated_at: `edit-${suffix}`,
  })
  batch.update(doc(db, 'orders', orderId), {
    warehouse_fulfillment_status: 'cho_xu_ly',
    warehouse_request_status: 'cho_xu_ly',
    updated_at: `edit-${suffix}`,
  })
  return batch.commit()
}

function deleteRequestBatch(db, suffix, orderId) {
  const requestId = `request-${suffix}`
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', requestId), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: `delete-${suffix}`,
    updated_at: `delete-${suffix}`,
  })
  batch.update(doc(db, 'orders', orderId), {
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: '',
    updated_at: `delete-${suffix}`,
  })
  return batch.commit()
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'orders', 'order-own'), order('order-own', ACTOR)),
      setDoc(doc(db, 'orders', 'order-foreign'), order('order-foreign', OTHER)),
      setDoc(doc(db, 'orders', 'order-create-own'), order('order-create-own', ACTOR)),
      setDoc(doc(db, 'orders', 'order-create-foreign'), order('order-create-foreign', OTHER)),
      setDoc(doc(db, 'order_export_requests', 'request-own'), exportRequest('request-own', 'order-own', ACTOR)),
      setDoc(doc(db, 'order_export_requests', 'request-foreign'), exportRequest('request-foreign', 'order-foreign', OTHER)),
      setDoc(doc(db, 'order_export_requests', 'request-locked'), exportRequest('request-locked', 'order-foreign', OTHER, 'da_tiep_nhan')),
    ])
    await Promise.all([
      updateDoc(doc(db, 'orders', 'order-own'), {
        warehouse_fulfillment_status: 'cho_xu_ly', warehouse_request_status: 'cho_xu_ly',
      }),
      updateDoc(doc(db, 'orders', 'order-foreign'), {
        warehouse_fulfillment_status: 'cho_xu_ly', warehouse_request_status: 'cho_xu_ly',
      }),
    ])
  })
})

after(async () => env.cleanup())

test('create requires orders.warehouse_export and own parent or export_requests.view_all', async () => {
  await setPermissions(['orders.warehouse_export'])
  let db = client()
  await assertSucceeds(createRequestBatch(db, 'own', 'order-create-own', ACTOR))
  await assertFails(createRequestBatch(db, 'foreign-denied', 'order-create-foreign', OTHER))

  await setPermissions(['orders.warehouse_export', 'export_requests.view_all'])
  db = client()
  await assertSucceeds(createRequestBatch(db, 'foreign-allowed', 'order-create-foreign', OTHER))
})

test('edit requires orders.warehouse_export and own request/parent or same-module view_all', async () => {
  await setPermissions(['orders.warehouse_export'])
  let db = client()
  await assertSucceeds(editRequestBatch(db, 'own', 'order-own'))
  await assertFails(editRequestBatch(db, 'foreign', 'order-foreign'))

  await setPermissions(['orders.warehouse_export', 'export_requests.view_all'])
  db = client()
  await assertSucceeds(editRequestBatch(db, 'foreign', 'order-foreign'))
})

test('orders.delete is never a substitute for direct export request delete', async () => {
  await setPermissions(['orders.delete', 'export_requests.view_all'])
  const db = client()
  await assertFails(deleteRequestBatch(db, 'foreign', 'order-foreign'))
  await assertFails(deleteDoc(doc(db, 'order_export_requests', 'request-own')))
})

test('export_requests.delete authorizes the own child soft-delete itself', async () => {
  await setPermissions(['export_requests.delete'])
  const db = client()
  await assertSucceeds(updateDoc(doc(db, 'order_export_requests', 'request-own'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'child-only', updated_at: 'child-only',
  }))
})

test('export_requests.delete authorizes the own parent warehouse summary update', async () => {
  await setPermissions(['export_requests.delete'])
  const db = client()
  await assertSucceeds(updateDoc(doc(db, 'orders', 'order-own'), {
    warehouse_fulfillment_status: 'chua_xuat', warehouse_request_status: '', updated_at: 'parent-only',
  }))
})

test('export_requests.delete removes own request but not a foreign request', async () => {
  await setPermissions(['export_requests.delete'])
  const db = client()
  await assertSucceeds(deleteRequestBatch(db, 'own', 'order-own'))
  await assertFails(deleteRequestBatch(db, 'foreign', 'order-foreign'))
})

test('export_requests.delete plus view_all removes a foreign request', async () => {
  await setPermissions(['export_requests.delete', 'export_requests.view_all'])
  const db = client()
  await assertSucceeds(deleteRequestBatch(db, 'foreign', 'order-foreign'))
})

test('view_all alone reads all but grants no create, edit or delete action', async () => {
  await setPermissions(['export_requests.view_all'])
  const db = client()
  await assertSucceeds(getDoc(doc(db, 'order_export_requests', 'request-foreign')))
  await assertFails(createRequestBatch(db, 'viewall-only', 'order-create-foreign', OTHER))
  await assertFails(editRequestBatch(db, 'foreign', 'order-foreign'))
  await assertFails(deleteRequestBatch(db, 'foreign', 'order-foreign'))
})

test('business locks and immutable ownership win even with view_all plus action', async () => {
  await setPermissions([
    'orders.warehouse_export',
    'export_requests.delete',
    'export_requests.view_all',
  ])
  const db = client()
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'request-locked'), {
    payload_json: '{"locked":true}', updated_by: ACTOR, updated_at: 'locked-edit',
  }))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'request-locked'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'locked-delete', updated_at: 'locked-delete',
  }))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'request-foreign'), {
    requested_by: ACTOR, updated_by: ACTOR, updated_at: 'forged-owner',
  }))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'request-foreign'), {
    order_id: 'order-own', updated_by: ACTOR, updated_at: 'forged-parent',
  }))
})
