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
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-missing-invoice-read'
const SALE = 'hieunt051999@gmail.com'
const ORDER_ID = 'ord_1784691728437_2c2195192150'
const ITEM_ID = 'item_raw_legacy_1'
const INVOICE_ID = `inv_${ORDER_ID}`
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
      setDoc(doc(db, 'users', SALE), {
        email: SALE,
        user_code: 'SALE01',
        active: true,
        deleted: false,
        permissions_flat: [
          'page.orders', 'orders.view', 'orders.edit',
          'invoices.view', 'invoices.create', 'invoices.edit',
        ],
      }),
      setDoc(doc(db, 'orders', ORDER_ID), {
        id: ORDER_ID,
        order_code: 'SALE01-ABC001-0001',
        customer_id: 'customer-legacy',
        customer_name: 'Khách legacy',
        owner_email: '',
        created_by: '',
        sale_email: '',
        warehouse_fulfillment_status: 'chua_xuat',
        payable_amount: 150000,
        actual_revenue: 150000,
        invoice_status: 'Không xuất',
        active: true,
        deleted: false,
        status: 'active',
      }),
      setDoc(doc(db, 'order_items', ITEM_ID), {
        id: ITEM_ID,
        order_id: ORDER_ID,
        order_code: 'SALE01-ABC001-0001',
        product_id: 'product-legacy',
        product_code: 'SP-LEGACY',
        product_name: 'Sản phẩm dữ liệu cũ',
        quantity: 10,
        unit_price: 15000,
      }),
    ])
  })
})

after(async () => env.cleanup())

function saveLegacyOrder(db, { readMissingInvoice }) {
  return runTransaction(db, async transaction => {
    const orderRef = doc(db, 'orders', ORDER_ID)
    const itemRef = doc(db, 'order_items', ITEM_ID)
    const invoiceRef = doc(db, 'invoices', INVOICE_ID)
    const orderSnapshot = await transaction.get(orderRef)
    assert.equal(orderSnapshot.exists(), true)
    if (readMissingInvoice) await transaction.get(invoiceRef)

    const timestamp = serverTimestamp()
    const operationId = `repair-${ORDER_ID}`
    transaction.set(invoiceRef, {
      id: INVOICE_ID,
      order_id: ORDER_ID,
      order_code: 'SALE01-ABC001-0001',
      invoice_number: '',
      invoice_date: '',
      invoice_amount: 150000,
      invoice_status: 'Không xuất',
      tax_code: '',
      company_name: '',
      billing_address: '',
      note: '',
      created_by: SALE,
      order_owner_email: '',
      order_created_by: '',
      order_sale_email: '',
      relation_revision: 1,
      last_operation_id: operationId,
      active: true,
      deleted: false,
      status: 'active',
      created_at: timestamp,
      updated_at: timestamp,
    })
    transaction.update(orderRef, {
      note: 'Sale sửa đơn legacy',
      invoice_status: 'Không xuất',
      invoice_record_count: 1,
      invoice_relation_revision: 1,
      relation_lock_version: 1,
      relation_last_module: 'invoices',
      relation_last_action: 'create',
      relation_last_document_id: INVOICE_ID,
      relation_updated_by: SALE,
      relation_updated_at: timestamp,
      revision: 1,
      last_operation_id: operationId,
      updated_at: timestamp,
    })
    transaction.update(itemRef, {
      product_name: 'Sản phẩm dữ liệu cũ đã sửa',
      owner_email: '',
      created_by: '',
      sale_email: '',
      order_revision: 1,
      last_operation_id: operationId,
      updated_at: timestamp,
    })
  })
}

test('old client reproduces permission-denied by reading missing invoice first', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertFails(saveLegacyOrder(db, { readMissingInvoice: true }))
  await env.withSecurityRulesDisabled(async context => {
    assert.equal((await getDoc(doc(context.firestore(), 'invoices', INVOICE_ID))).exists(), false)
  })
})

test('fixed client atomically edits order and creates invoice without that read', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertSucceeds(saveLegacyOrder(db, { readMissingInvoice: false }))
  const order = (await getDoc(doc(db, 'orders', ORDER_ID))).data()
  const invoice = (await getDoc(doc(db, 'invoices', INVOICE_ID))).data()
  assert.equal(order.revision, 1)
  assert.equal(invoice.order_id, ORDER_ID)
  assert.equal(invoice.created_by, SALE)
})
