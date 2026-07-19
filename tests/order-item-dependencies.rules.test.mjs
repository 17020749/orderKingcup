import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore'

const projectId = 'demo-order-item-dependencies'
const EDITOR = 'editor@example.com'
const ADMIN = 'admin@example.com'
const PRINTER = 'printer@example.com'
const WAREHOUSE = 'warehouse@example.com'
let env

function orderData(id, fulfillment = 'chua_xuat') {
  return {
    id,
    order_code: id.toUpperCase(),
    owner_email: EDITOR,
    created_by: EDITOR,
    sale_email: EDITOR,
    warehouse_fulfillment_status: fulfillment,
    warehouse_request_status: '',
    printing_lock_version: 1,
    printing_progress_count: 1,
    relation_lock_version: 1,
    payment_record_count: 0,
    invoice_record_count: 0,
    shipment_record_count: 0,
    active: true,
    deleted: false,
    status: 'active',
  }
}

function itemData(id, orderId = 'order-active') {
  return {
    id,
    order_id: orderId,
    order_code: orderId.toUpperCase(),
    product_id: 'product-a',
    product_code: 'SP-A',
    product_name: 'Sản phẩm A',
    quantity: 10,
    unit_price: 1,
    owner_email: EDITOR,
    created_by: EDITOR,
    sale_email: EDITOR,
    active: true,
    deleted: false,
    status: 'active',
  }
}

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', EDITOR), {
        email: EDITOR, active: true, deleted: false,
        permissions_flat: ['page.orders', 'orders.view', 'orders.edit'],
      }),
      setDoc(doc(db, 'users', ADMIN), {
        email: ADMIN, active: true, deleted: false, is_admin: true, permissions_flat: ['*'],
      }),
      setDoc(doc(db, 'users', PRINTER), {
        email: PRINTER, active: true, deleted: false,
        permissions_flat: ['printing.view', 'printing.edit'],
      }),
      setDoc(doc(db, 'users', WAREHOUSE), {
        email: WAREHOUSE, active: true, deleted: false,
        permissions_flat: ['export_requests.release', 'export.view'],
      }),
      setDoc(doc(db, 'orders', 'order-active'), orderData('order-active')),
      setDoc(doc(db, 'orders', 'order-full'), orderData('order-full', 'da_xuat_du')),
      setDoc(doc(db, 'order_items', 'item-active'), itemData('item-active')),
      setDoc(doc(db, 'order_items', 'item-full'), itemData('item-full', 'order-full')),
      setDoc(doc(db, 'print_orders', 'print-active'), {
        id: 'print-active', order_id: 'order-active', order_code: 'ORDER-ACTIVE',
        created_by: PRINTER, active: true, deleted: false, status: 'active',
      }),
      setDoc(doc(db, 'print_order_items', 'print-item-existing'), {
        id: 'print-item-existing', print_order_id: 'print-active',
        source_order_item_id: 'item-active', product_id: 'product-a', product_code: 'SP-A',
        print_quantity: 2, actual_print_quantity: 0, created_by: PRINTER,
        active: true, deleted: false, status: 'active',
      }),
      setDoc(doc(db, 'order_export_requests', 'request-active'), {
        id: 'request-active', request_id: 'YCXK-A', order_id: 'order-active', order_code: 'ORDER-ACTIVE',
        requested_by: EDITOR, order_owner_email: EDITOR, order_created_by: EDITOR, order_sale_email: EDITOR,
        status: 'da_tiep_nhan', lifecycle_status: 'accepted', release_sequence: 0,
        active_export_order_id: '', export_order_id: '', warehouse_export_order_id: '', warehouse_export_id: '',
        payload_json: JSON.stringify({ items: [{ order_item_id: 'item-active', product_id: 'product-a', product_code: 'SP-A', logo: '', export_quantity: 2 }] }),
        request_timeline_json: '[]', actual_export_summary_json: '[]', stock_movement_ids: [], revision: 0,
        active: true, deleted: false,
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

test('fulfilled order content is locked for editor and admin', async () => {
  for (const email of [EDITOR, ADMIN]) {
    const db = env.authenticatedContext(email, { email }).firestore()
    await assertFails(updateDoc(doc(db, 'orders', 'order-full'), { note: 'cannot edit' }))
    await assertFails(updateDoc(doc(db, 'order_items', 'item-full'), { quantity: 11 }))
    await assertFails(setDoc(doc(db, 'order_items', `new-${email}`), itemData(`new-${email}`, 'order-full')))
  }
})

test('orders.edit owner can read export and printing dependencies used by client guard', async () => {
  const db = env.authenticatedContext(EDITOR, { email: EDITOR }).firestore()
  assert.equal((await assertSucceeds(getDoc(doc(db, 'order_export_requests', 'request-active')))).exists(), true)
  assert.equal((await assertSucceeds(getDoc(doc(db, 'print_orders', 'print-active')))).exists(), true)
  assert.equal((await assertSucceeds(getDoc(doc(db, 'print_order_items', 'print-item-existing')))).exists(), true)
})

test('new print item must reference an active item in the same source order', async () => {
  const db = env.authenticatedContext(PRINTER, { email: PRINTER }).firestore()
  const base = {
    id: 'print-new', print_order_id: 'print-active', source_order_item_id: 'item-active',
    product_id: 'product-a', product_code: 'SP-A', print_quantity: 2, actual_print_quantity: 0,
    created_by: PRINTER, active: true, deleted: false, status: 'active',
  }
  await assertSucceeds(setDoc(doc(db, 'print_order_items', 'print-valid'), base))
  await assertFails(setDoc(doc(db, 'print_order_items', 'print-missing-source'), { ...base, id: 'print-missing-source', source_order_item_id: '' }))
  await assertFails(setDoc(doc(db, 'print_order_items', 'print-forged-product'), { ...base, id: 'print-forged-product', product_id: 'forged' }))
  await assertFails(setDoc(doc(db, 'print_order_items', 'print-other-order'), { ...base, id: 'print-other-order', source_order_item_id: 'item-full' }))
})

function releaseBatch(db, itemOverrides = {}) {
  const batch = writeBatch(db)
  const exportId = 'request_export__request-active'
  batch.set(doc(db, 'export_orders', exportId), {
    id: exportId, code: 'PXK-YCXK-A', export_code: 'PXK-YCXK-A', source_request_id: 'request-active',
    sync_source: 'kingcup_firestore:request-active', source: 'kingcup_firestore', lifecycle_status: 'released',
    release_sequence: 1, source_request_revision: 0, request_operation_id: 'op-release',
    created_by: WAREHOUSE, operation_id: 'op-release', last_operation_id: 'op-release', revision: 1,
    active: true, deleted: false, status: 'completed',
  })
  batch.set(doc(db, 'export_order_items', 'export-item'), {
    id: 'export-item', export_order_id: exportId, source_order_id: 'order-active', source_order_item_id: 'item-active',
    product_id: 'product-a', product_code: 'SP-A', product_name: 'Sản phẩm A', quantity: 2,
    created_by: WAREHOUSE, source: 'kingcup_firestore', active: true, deleted: false, status: 'completed',
    ...itemOverrides,
  })
  batch.update(doc(db, 'order_export_requests', 'request-active'), {
    status: 'da_xuat', lifecycle_status: 'released', release_sequence: 1,
    active_export_order_id: exportId, export_order_id: exportId, warehouse_export_order_id: exportId, warehouse_export_id: exportId,
    warehouse_export_code: 'PXK-YCXK-A', warehouse_handled_by: WAREHOUSE, warehouse_handled_at: 'now',
    warehouse_note: '', exported_at: 'now', actual_exported_at: 'now',
    actual_export_summary_json: '[]', stock_movement_ids: [], request_timeline_json: '[]',
    operation_id: 'op-release', last_operation_id: 'op-release', last_released_export_order_id: exportId,
    last_released_export_code: 'PXK-YCXK-A', last_released_by: WAREHOUSE, revision: 1, updated_at: 'now',
  })
  return batch
}

test('generated export item must reference the real source order item', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  await assertSucceeds(releaseBatch(db).commit())
  await env.clearFirestore()
  await seed()
  for (const forged of [
    { source_order_item_id: '' },
    { source_order_item_id: 'missing' },
    { source_order_id: 'order-full' },
    { product_id: 'forged' },
    { quantity: 11 },
  ]) {
    await assertFails(releaseBatch(db, forged).commit())
  }
})
