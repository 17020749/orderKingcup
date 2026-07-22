import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore'

const projectId = 'demo-unified-permission-matrix'
const ACTOR = 'actor@example.com'
const OTHER = 'other@example.com'
let env

function user(permissions) {
  return { email: ACTOR, active: true, deleted: false, permissions_flat: permissions }
}

function order(id, owner) {
  return {
    id, order_code: id, owner_email: owner, created_by: owner, sale_email: owner,
    actual_revenue: 1000, paid_amount: 100, debt_amount: 900,
    payment_status: 'Đã cọc', computed_payment_status: 'Đã cọc',
    payment_count: 1, deposit_count: 1, collect_count: 0,
    invoice_status: 'HĐ nháp', shipment_status: 'Chờ giao', shipping_fee_total: 10, cod_amount_total: 0,
    relation_lock_version: 1, payment_record_count: 1, invoice_record_count: 1, shipment_record_count: 1,
    payment_relation_revision: 1, invoice_relation_revision: 1, shipment_relation_revision: 1,
    printing_lock_version: 1, printing_progress_count: 0,
    warehouse_fulfillment_status: 'chua_xuat', active: true, deleted: false, status: 'active',
  }
}

function ownership(owner) {
  return { order_owner_email: owner, order_created_by: owner, order_sale_email: owner }
}

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    for (const [suffix, owner] of [['own', ACTOR], ['foreign', OTHER]]) {
      const orderId = `order-${suffix}`
      await setDoc(doc(db, 'orders', orderId), order(orderId, owner))
      await setDoc(doc(db, 'payments', `payments-${suffix}`), {
        id: `payments-${suffix}`, order_id: orderId, order_code: orderId,
        amount: 100, payment_type: 'Cọc', payment_status: 'Đã nhận', note: '',
        created_by: owner, ...ownership(owner), active: true, deleted: false, status: 'active',
      })
      await setDoc(doc(db, 'invoices', `invoices-${suffix}`), {
        id: `invoices-${suffix}`, order_id: orderId, order_code: orderId,
        invoice_number: `INV-${suffix}`, invoice_status: 'HĐ nháp', note: '',
        created_by: owner, ...ownership(owner), active: true, deleted: false, status: 'active',
      })
      await setDoc(doc(db, 'shipments', `shipments-${suffix}`), {
        id: `shipments-${suffix}`, order_id: orderId, order_code: orderId,
        tracking_code: `TRACK-${suffix}`, shipping_status: 'Chờ giao', shipping_fee: 10, note: '',
        created_by: owner, ...ownership(owner), active: true, deleted: false, status: 'active',
      })
    }
  })
}

async function setActorPermissions(permissions) {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', ACTOR), user(permissions))
  })
}

function relationParentPatch(module, documentId) {
  const prefix = module === 'payments' ? 'payment' : module === 'invoices' ? 'invoice' : 'shipment'
  return {
    relation_lock_version: 1,
    relation_last_module: module,
    relation_last_action: 'update',
    relation_last_document_id: documentId,
    relation_updated_by: ACTOR,
    relation_updated_at: 'now',
    updated_at: 'now',
    [`${prefix}_record_count`]: 1,
    [`${prefix}_relation_revision`]: 2,
  }
}

async function updateRelation(db, module, suffix) {
  const childId = `${module}-${suffix}`
  const batch = writeBatch(db)
  batch.update(doc(db, module, childId), { note: `updated-${suffix}`, updated_at: 'now' })
  batch.update(doc(db, 'orders', `order-${suffix}`), relationParentPatch(module, childId))
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
  await seed()
})

after(async () => env.cleanup())

test('orders tuân theo action AND (owner OR orders.view_all)', async () => {
  await setActorPermissions(['orders.view', 'orders.edit'])
  let db = env.authenticatedContext(ACTOR, { email: ACTOR }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'orders', 'order-own'), { note: 'own', updated_at: 'now' }))
  await assertFails(updateDoc(doc(db, 'orders', 'order-foreign'), { note: 'foreign', updated_at: 'now' }))

  await setActorPermissions(['orders.view_all'])
  db = env.authenticatedContext(ACTOR, { email: ACTOR }).firestore()
  await assertSucceeds(getDoc(doc(db, 'orders', 'order-foreign')))
  await assertFails(updateDoc(doc(db, 'orders', 'order-foreign'), { note: 'no-action', updated_at: 'now' }))

  await setActorPermissions(['orders.view', 'orders.view_all', 'orders.edit'])
  db = env.authenticatedContext(ACTOR, { email: ACTOR }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'orders', 'order-foreign'), { note: 'all', updated_at: 'now' }))
})

for (const module of ['payments', 'invoices', 'shipments']) {
  test(`${module} tuân theo view/view_all/action cùng module`, async () => {
    await setActorPermissions([`${module}.view`, `${module}.edit`, 'orders.view_all'])
    let db = env.authenticatedContext(ACTOR, { email: ACTOR }).firestore()
    await assertSucceeds(updateRelation(db, module, 'own'))
    await assertFails(updateRelation(db, module, 'foreign'))

    await setActorPermissions([`${module}.view_all`, 'orders.view_all'])
    db = env.authenticatedContext(ACTOR, { email: ACTOR }).firestore()
    await assertSucceeds(getDoc(doc(db, module, `${module}-foreign`)))
    await assertFails(updateRelation(db, module, 'foreign'))

    await setActorPermissions([`${module}.view`, `${module}.view_all`, `${module}.edit`, 'orders.view_all'])
    db = env.authenticatedContext(ACTOR, { email: ACTOR }).firestore()
    await assertSucceeds(updateRelation(db, module, 'foreign'))
  })
}
