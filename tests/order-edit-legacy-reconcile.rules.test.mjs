import assert from 'node:assert/strict'
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
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-legacy-order-edit-reconcile'
const ADMIN = 'legacy-admin@example.com'
const OWNER = 'legacy-owner@example.com'
let env

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
        active: true,
        deleted: false,
        permissions_flat: ['*'],
      }),
      setDoc(doc(db, 'orders', 'order-legacy'), {
        id: 'order-legacy',
        order_code: 'LEGACY-0001',
        order_sequence: 1,
        user_code: 'LEGACY',
        customer_id: 'customer-legacy',
        customer_code: 'CUS001',
        customer_name: 'Khách legacy',
        owner_email: OWNER,
        created_by: OWNER,
        sale_email: OWNER,
        sale_name: 'Sale legacy',
        order_status: 'Mới tạo',
        warehouse_fulfillment_status: 'chua_xuat',
        warehouse_request_status: '',
        invoice_status: 'Không xuất',
        payable_amount: 100,
        paid_amount: '0',
        debt_amount: '100',
        computed_payment_status: 'Chưa thanh toán',
        payment_status: 'Chưa thanh toán',
        payment_count: '0',
        deposit_count: '0',
        collect_count: '0',
        relation_lock_version: '1',
        payment_record_count: '0',
        invoice_record_count: '1',
        shipment_record_count: '0',
        payment_relation_revision: '0',
        invoice_relation_revision: '1',
        shipment_relation_revision: '0',
        shipment_status: '',
        shipping_fee_total: '0',
        cod_amount_total: '0',
        revision: 1,
        last_operation_id: 'legacy-before-edit',
        active: true,
        deleted: false,
        status: 'active',
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      }),
      setDoc(doc(db, 'order_items', 'item-legacy'), {
        id: 'item-legacy',
        order_id: 'order-legacy',
        order_code: 'LEGACY-0001',
        product_id: 'product-a',
        product_code: 'SP-A',
        product_name: 'Sản phẩm A',
        quantity: 10,
        unit_price: 10,
        owner_email: OWNER,
        created_by: OWNER,
        sale_email: OWNER,
        order_revision: 1,
        last_operation_id: 'legacy-before-edit',
        active: true,
        deleted: false,
        status: 'active',
        created_at: '2026-08-01T00:00:00.000Z',
      }),
      setDoc(doc(db, 'invoices', 'inv_order-legacy'), {
        id: 'inv_order-legacy',
        order_id: 'order-legacy',
        order_code: 'LEGACY-0001',
        invoice_number: '',
        invoice_date: '',
        invoice_amount: 100,
        invoice_status: 'Không xuất',
        relation_revision: 1,
        last_operation_id: 'legacy-before-edit',
        order_owner_email: OWNER,
        order_created_by: OWNER,
        order_sale_email: OWNER,
        created_by: OWNER,
        active: true,
        deleted: false,
        status: 'active',
        created_at: '2026-08-01T00:00:00.000Z',
      }),
    ])
  })
})

after(async () => env.cleanup())

async function editOneQuantity(db, operationId) {
  await runTransaction(db, async transaction => {
    const orderRef = doc(db, 'orders', 'order-legacy')
    const itemRef = doc(db, 'order_items', 'item-legacy')
    const invoiceRef = doc(db, 'invoices', 'inv_order-legacy')
    const activityRef = doc(db, 'activity_logs', `activity-${operationId}`)
    const orderSnapshot = await transaction.get(orderRef)
    const invoiceSnapshot = await transaction.get(invoiceRef)
    assert.equal(orderSnapshot.exists(), true)
    assert.equal(invoiceSnapshot.exists(), true)

    transaction.update(orderRef, {
      payable_amount: 101,
      debt_amount: 101,
      payment_status: 'Chưa thanh toán',
      computed_payment_status: 'Chưa thanh toán',
      revision: 2,
      last_operation_id: operationId,
      updated_at: serverTimestamp(),
    })
    transaction.update(invoiceRef, {
      invoice_amount: 101,
      last_operation_id: operationId,
      updated_at: serverTimestamp(),
    })
    transaction.update(itemRef, {
      quantity: 11,
      order_revision: 2,
      last_operation_id: operationId,
      updated_at: serverTimestamp(),
    })
    transaction.set(activityRef, {
      module: 'orders',
      action: 'update',
      item_code: 'LEGACY-0001',
      item_name: 'Khách legacy',
      changed_by: ADMIN,
      operation_id: operationId,
      active: true,
      deleted: false,
      created_at: serverTimestamp(),
    })
  })
}

test('legacy numeric strings reproduce permission-denied even for absolute admin edit', async () => {
  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  await assertFails(editOneQuantity(db, 'legacy-edit-before-reconcile'))

  const order = (await getDoc(doc(db, 'orders', 'order-legacy'))).data()
  assert.equal(order.revision, 1)
  assert.equal(order.paid_amount, '0')
  assert.equal((await getDoc(doc(db, 'order_items', 'item-legacy'))).data().quantity, 10)
})

test('canonical relation/payment reconcile lets the same one-item quantity edit pass', async () => {
  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'orders', 'order-legacy'), {
    relation_lock_version: 1,
    payment_record_count: 0,
    invoice_record_count: 1,
    shipment_record_count: 0,
    paid_amount: 0,
    debt_amount: 100,
    payment_count: 0,
    deposit_count: 0,
    collect_count: 0,
    computed_payment_status: 'Chưa thanh toán',
    payment_status: 'Chưa thanh toán',
    invoice_status: 'Không xuất',
    shipment_status: '',
    shipping_fee_total: 0,
    cod_amount_total: 0,
    payment_relation_revision: 0,
    invoice_relation_revision: 1,
    shipment_relation_revision: 0,
    relation_last_module: 'all',
    relation_last_action: 'reconcile',
    relation_last_document_id: '',
    relation_updated_by: ADMIN,
    relation_updated_at: serverTimestamp(),
  }))

  await assertSucceeds(editOneQuantity(db, 'legacy-edit-after-reconcile'))

  const order = (await getDoc(doc(db, 'orders', 'order-legacy'))).data()
  assert.equal(order.revision, 2)
  assert.equal(order.payable_amount, 101)
  assert.equal(order.paid_amount, 0)
  assert.equal(order.debt_amount, 101)
  assert.equal((await getDoc(doc(db, 'order_items', 'item-legacy'))).data().quantity, 11)
  assert.equal((await getDoc(doc(db, 'invoices', 'inv_order-legacy'))).data().invoice_amount, 101)
})
