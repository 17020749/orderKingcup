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
  setDoc,
  updateDoc,
} from 'firebase/firestore'

const projectId = 'demo-order-relation-reconcile'
const ADMIN = 'admin@example.com'
const USER = 'user@example.com'
let env

function reconciledPatch(actor = ADMIN) {
  return {
    relation_lock_version: 1,
    payment_record_count: 1,
    invoice_record_count: 1,
    shipment_record_count: 1,
    paid_amount: 200,
    debt_amount: 800,
    payment_status: 'Đã cọc',
    computed_payment_status: 'Đã cọc',
    payment_count: 1,
    deposit_count: 1,
    collect_count: 0,
    invoice_status: 'Đã xuất',
    shipment_status: 'Đang giao',
    shipping_fee_total: 25,
    cod_amount_total: 500,
    payment_relation_revision: 0,
    invoice_relation_revision: 0,
    shipment_relation_revision: 0,
    relation_last_module: 'all',
    relation_last_action: 'reconcile',
    relation_last_document_id: '',
    relation_updated_by: actor,
    relation_updated_at: 'now',
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
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', ADMIN), {
        email: ADMIN,
        is_admin: true,
        permissions_flat: ['*'],
        active: true,
        deleted: false,
      }),
      setDoc(doc(db, 'users', USER), {
        email: USER,
        permissions_flat: ['orders.view', 'orders.edit'],
        active: true,
        deleted: false,
      }),
      setDoc(doc(db, 'orders', 'order-a'), {
        id: 'order-a',
        order_code: 'ORDER-A',
        owner_email: USER,
        created_by: USER,
        sale_email: USER,
        warehouse_fulfillment_status: 'da_xuat_du',
        printing_lock_version: 1,
        printing_progress_count: 0,
        relation_lock_version: 0,
        payment_record_count: 0,
        invoice_record_count: 0,
        shipment_record_count: 0,
        payment_relation_revision: 0,
        invoice_relation_revision: 0,
        shipment_relation_revision: 0,
        active: true,
        deleted: false,
        status: 'active',
      }),
      setDoc(doc(db, 'payments', 'pay-a'), {
        id: 'pay-a', order_id: 'order-a', created_by: USER,
        order_owner_email: USER, order_created_by: USER, order_sale_email: USER,
        payment_status: 'Đã nhận', amount: 200, active: true, deleted: false,
      }),
      setDoc(doc(db, 'invoices', 'inv-a'), {
        id: 'inv-a', order_id: 'order-a', created_by: USER,
        order_owner_email: USER, order_created_by: USER, order_sale_email: USER,
        invoice_status: 'Đã xuất', active: true, deleted: false,
      }),
      setDoc(doc(db, 'shipments', 'shp-a'), {
        id: 'shp-a', order_id: 'order-a', created_by: USER,
        order_owner_email: USER, order_created_by: USER, order_sale_email: USER,
        shipping_status: 'Đang giao', active: true, deleted: false,
      }),
    ])
  })
})

after(async () => env.cleanup())

test('absolute admin can enumerate all relation collections for reconciliation', async () => {
  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  await assertSucceeds(getDocs(collection(db, 'orders')))
  await assertSucceeds(getDocs(collection(db, 'payments')))
  await assertSucceeds(getDocs(collection(db, 'invoices')))
  await assertSucceeds(getDocs(collection(db, 'shipments')))
})

test('absolute admin can reconcile a fully exported order without opening normal edits', async () => {
  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'orders', 'order-a'), reconciledPatch()))
})

test('normal owner cannot forge the admin reconciliation marker', async () => {
  const db = env.authenticatedContext(USER, { email: USER }).firestore()
  await assertFails(updateDoc(doc(db, 'orders', 'order-a'), reconciledPatch(USER)))
})

test('admin reconciliation only accepts the relation summary field set', async () => {
  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  await assertFails(updateDoc(doc(db, 'orders', 'order-a'), {
    ...reconciledPatch(),
    customer_name: 'Changed by maintenance',
  }))
})
