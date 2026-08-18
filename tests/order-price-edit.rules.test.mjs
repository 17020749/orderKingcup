import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc, serverTimestamp, writeBatch } from 'firebase/firestore'

const projectId = 'demo-order-price-edit'
const OWNER = 'price-owner@example.com'
let env

function order(overrides = {}) {
  return {
    id: 'order-price', order_code: 'PRICE-0001', owner_email: OWNER,
    created_by: OWNER, sale_email: OWNER, revision: 1, price_revision: 0,
    actual_revenue: 1000, subtotal_no_vat: 1000, vat_amount: 0, total_vat: 1000,
    payable_amount: 1000, discount_amount: 0, paid_amount: 200, debt_amount: 800,
    payment_status: 'Thanh toán một phần', computed_payment_status: 'Thanh toán một phần',
    payment_count: 1, deposit_count: 0, collect_count: 1, invoice_status: 'not_issued',
    payment_record_count: 1, invoice_record_count: 0, shipment_record_count: 0,
    payment_relation_revision: 1, invoice_relation_revision: 0, shipment_relation_revision: 0,
    relation_lock_version: 1, warehouse_fulfillment_status: 'da_xuat_du',
    warehouse_request_status: 'da_xuat', active: true, deleted: false, status: 'active',
    last_operation_id: 'seed-price', ...overrides,
  }
}

function item(overrides = {}) {
  return {
    id: 'item-price', order_id: 'order-price', order_code: 'PRICE-0001',
    owner_email: OWNER, created_by: OWNER, sale_email: OWNER, product_id: 'product-1',
    product_code: 'P-1', product_name: 'Product 1', unit: 'piece', quantity: 10,
    unit_price: 100, line_total: 1000, line_profit: 1000, logo_json: '',
    order_revision: 1, active: true, deleted: false, status: 'active', ...overrides,
  }
}

async function seed(orderOverrides = {}) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, 'users', OWNER), {
      email: OWNER, active: true, deleted: false,
      permissions_flat: ['page.orders', 'orders.view', 'orders.edit'],
    })
    await setDoc(doc(db, 'orders', 'order-price'), order(orderOverrides))
    await setDoc(doc(db, 'order_items', 'item-price'), item())
  })
}

function priceBatch(db, {
  quantity = 10,
  debtAmount = 1000,
  status = 'Thanh toán một phần',
} = {}) {
  const batch = writeBatch(db)
  const updatedAt = serverTimestamp()
  batch.update(doc(db, 'orders', 'order-price'), {
    subtotal_no_vat: 1200, vat_amount: 0, total_vat: 1200, actual_revenue: 1200,
    payable_amount: 1200, debt_amount: debtAmount, payment_status: status,
    computed_payment_status: status, revision: 2, price_revision: 1,
    last_operation_id: 'price-update-1', updated_at: updatedAt,
  })
  batch.update(doc(db, 'order_items', 'item-price'), {
    quantity, unit_price: 120, line_total: quantity * 120, line_profit: quantity * 120,
    order_revision: 2, price_revision: 1, last_operation_id: 'price-update-1', updated_at: updatedAt,
  })
  return batch
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

after(async () => { await env.cleanup() })

test('allows price-only edits on a fully fulfilled order', async () => {
  await seed()
  const db = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  await assertSucceeds(priceBatch(db).commit())
})

test('rejects forged debt and payment status in a price edit transaction', async () => {
  await seed()
  const db = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  await assertFails(priceBatch(db, { debtAmount: 0, status: 'Đã thanh toán' }).commit())
})

test('rejects quantity changes in a price edit transaction', async () => {
  await seed()
  const db = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  await assertFails(priceBatch(db, { quantity: 11 }).commit())
})
