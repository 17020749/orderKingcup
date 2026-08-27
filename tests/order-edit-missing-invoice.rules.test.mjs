import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import {
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-edit-missing-invoice'
const ADMIN = 'missing-invoice-admin@example.com'
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
      setDoc(doc(db, 'orders', 'order-missing-invoice'), {
        id: 'order-missing-invoice',
        order_code: 'LEGACY-NOINV-0001',
        order_sequence: 1,
        user_code: 'LEGACY',
        customer_id: 'customer-legacy',
        customer_code: 'CUS001',
        customer_name: 'Khách legacy chưa invoice',
        owner_email: OWNER,
        created_by: OWNER,
        sale_email: OWNER,
        sale_name: 'Sale legacy',
        order_status: 'Mới tạo',
        warehouse_fulfillment_status: 'chua_xuat',
        warehouse_request_status: '',
        invoice_status: 'Không xuất',
        subtotal_no_vat: 100,
        vat_rate: 0,
        vat_amount: 0,
        total_vat: 100,
        actual_revenue: 100,
        discount_amount: 0,
        payable_amount: 100,
        paid_amount: 0,
        debt_amount: 100,
        computed_payment_status: 'Chưa thanh toán',
        payment_status: 'Chưa thanh toán',
        payment_count: 0,
        deposit_count: 0,
        collect_count: 0,
        relation_lock_version: 1,
        payment_record_count: 0,
        invoice_record_count: 0,
        shipment_record_count: 0,
        payment_relation_revision: 0,
        invoice_relation_revision: 0,
        shipment_relation_revision: 0,
        shipment_status: '',
        shipping_fee_total: 0,
        cod_amount_total: 0,
        items_count: 1,
        revision: 1,
        last_operation_id: 'before-edit',
        active: true,
        deleted: false,
        status: 'active',
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      }),
      setDoc(doc(db, 'order_items', 'item-missing-invoice'), {
        id: 'item-missing-invoice',
        order_id: 'order-missing-invoice',
        order_code: 'LEGACY-NOINV-0001',
        product_id: 'product-a',
        product_code: 'SP-A',
        product_name: 'Sản phẩm A',
        quantity: 10,
        unit_price: 10,
        owner_email: OWNER,
        created_by: OWNER,
        sale_email: OWNER,
        order_revision: 1,
        last_operation_id: 'before-edit',
        active: true,
        deleted: false,
        status: 'active',
        created_at: '2026-08-01T00:00:00.000Z',
      }),
    ])
  })
})

after(async () => env.cleanup())

test('absolute admin can change quantity while lazily creating the missing legacy invoice', async () => {
  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()

  await assertSucceeds(runTransaction(db, async transaction => {
    const orderRef = doc(db, 'orders', 'order-missing-invoice')
    const itemRef = doc(db, 'order_items', 'item-missing-invoice')
    const invoiceRef = doc(db, 'invoices', 'inv_order-missing-invoice')
    const activityRef = doc(db, 'activity_logs', 'activity-missing-invoice-edit')
    const orderSnapshot = await transaction.get(orderRef)
    assert.equal(orderSnapshot.exists(), true)

    transaction.update(orderRef, {
      subtotal_no_vat: 110,
      total_vat: 110,
      actual_revenue: 110,
      payable_amount: 110,
      debt_amount: 110,
      payment_status: 'Chưa thanh toán',
      computed_payment_status: 'Chưa thanh toán',
      invoice_status: 'Không xuất',
      invoice_record_count: 1,
      invoice_relation_revision: 1,
      relation_lock_version: 1,
      relation_last_module: 'invoices',
      relation_last_action: 'create',
      relation_last_document_id: 'inv_order-missing-invoice',
      relation_updated_by: ADMIN,
      relation_updated_at: serverTimestamp(),
      revision: 2,
      last_operation_id: 'missing-invoice-edit',
      updated_at: serverTimestamp(),
    })

    transaction.set(invoiceRef, {
      id: 'inv_order-missing-invoice',
      order_id: 'order-missing-invoice',
      order_code: 'LEGACY-NOINV-0001',
      invoice_number: '',
      invoice_date: '',
      invoice_amount: 110,
      invoice_status: 'Không xuất',
      created_by: ADMIN,
      order_owner_email: OWNER,
      order_created_by: OWNER,
      order_sale_email: OWNER,
      relation_revision: 1,
      last_operation_id: 'missing-invoice-edit',
      status: 'active',
      active: true,
      deleted: false,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    })

    transaction.update(itemRef, {
      quantity: 11,
      order_revision: 2,
      last_operation_id: 'missing-invoice-edit',
      updated_at: serverTimestamp(),
    })

    transaction.set(activityRef, {
      module: 'orders',
      action: 'update',
      item_code: 'LEGACY-NOINV-0001',
      item_name: 'Khách legacy chưa invoice',
      changed_by: ADMIN,
      operation_id: 'missing-invoice-edit',
      order_revision: 2,
      active: true,
      deleted: false,
      created_at: serverTimestamp(),
    })
  }))

  assert.equal((await getDoc(doc(db, 'orders', 'order-missing-invoice'))).data().payable_amount, 110)
  assert.equal((await getDoc(doc(db, 'order_items', 'item-missing-invoice'))).data().quantity, 11)
  assert.equal((await getDoc(doc(db, 'invoices', 'inv_order-missing-invoice'))).data().invoice_amount, 110)
})
