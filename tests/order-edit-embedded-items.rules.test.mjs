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

const projectId = 'demo-orderkingcup-embedded-order-items-edit'
const ADMIN = 'embedded-admin@example.com'
const OWNER = 'embedded-owner@example.com'
let env

function item(index, quantity = 5000) {
  return {
    id: `item-${index}`,
    order_id: 'order-embedded',
    product_id: `product-${index}`,
    product_code: `SP-${index}`,
    product_name: `Sản phẩm ${index}`,
    unit: 'Cái',
    quantity,
    unit_price: 1000 + index,
    packing_standard: '',
    box_quantity: 0,
    odd_quantity: 0,
    note: '',
    has_logo: index < 3,
    logo_lines: index < 3
      ? [{ logo: 'UV', logo_color: '', quantity, unit_price: 1000 + index, line_total: quantity * (1000 + index) }]
      : [],
    logo_json: index < 3
      ? JSON.stringify([{ logo: 'UV', logo_color: '', quantity, unit_price: 1000 + index, line_total: quantity * (1000 + index) }])
      : '',
    cost_price: 0,
    vat_rate: 8,
    line_total: quantity * (1000 + index),
    line_cost: 0,
    line_profit: quantity * (1000 + index),
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
    const embeddedItems = Array.from({ length: 10 }, (_, index) => item(index + 1))
    await Promise.all([
      setDoc(doc(db, 'users', ADMIN), {
        email: ADMIN,
        active: true,
        deleted: false,
        permissions_flat: ['*'],
      }),
      setDoc(doc(db, 'orders', 'order-embedded'), {
        id: 'order-embedded',
        firestore_id: 'order-embedded',
        order_code: 'LEGACY-EMBEDDED-0001',
        order_sequence: 1,
        user_code: 'LEGACY',
        customer_id: 'customer-embedded',
        customer_code: 'CUS001',
        customer_name: 'Khách embedded',
        phone: '0818777769',
        owner_email: OWNER,
        created_by: OWNER,
        sale_email: OWNER,
        sale_name: 'Sale legacy',
        order_date: '2026-08-25T16:00',
        order_status: 'Mới tạo',
        warehouse_fulfillment_status: 'chua_xuat',
        warehouse_request_status: '',
        invoice_status: 'Không xuất',
        subtotal_no_vat: 100000,
        vat_rate: 8,
        vat_amount: 8000,
        total_vat: 108000,
        actual_revenue: 108000,
        discount_amount: 0,
        adjustment_amount: 0,
        shipping_fee: 0,
        payable_amount: 108000,
        paid_amount: 0,
        debt_amount: 108000,
        computed_payment_status: 'Chưa thanh toán',
        payment_status: 'Chưa thanh toán',
        payment_count: 0,
        deposit_count: 0,
        collect_count: 0,
        relation_lock_version: 1,
        payment_record_count: 0,
        invoice_record_count: 1,
        shipment_record_count: 0,
        payment_relation_revision: 0,
        invoice_relation_revision: 1,
        shipment_relation_revision: 0,
        shipment_status: '',
        shipping_fee_total: 0,
        cod_amount_total: 0,
        items_count: 10,
        items: embeddedItems,
        revision: 1,
        last_operation_id: 'before-edit',
        active: true,
        deleted: false,
        status: 'active',
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      }),
      ...embeddedItems.map(row => setDoc(doc(db, 'order_items', row.id), {
        ...row,
        order_code: 'LEGACY-EMBEDDED-0001',
        owner_email: OWNER,
        created_by: OWNER,
        sale_email: OWNER,
        order_revision: 1,
        last_operation_id: 'before-edit',
        active: true,
        deleted: false,
        status: 'active',
        created_at: '2026-08-01T00:00:00.000Z',
      })),
      setDoc(doc(db, 'invoices', 'inv_order-embedded'), {
        id: 'inv_order-embedded',
        order_id: 'order-embedded',
        order_code: 'LEGACY-EMBEDDED-0001',
        invoice_number: '',
        invoice_date: '',
        invoice_amount: 108000,
        invoice_status: 'Không xuất',
        relation_revision: 1,
        last_operation_id: 'before-edit',
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

test('client strips legacy embedded items and system fields before atomic edit', () => {
  const source = readFileSync('composables/useAtomicOrderSave.ts', 'utf8')
  assert.match(source, /stripOrderEditSystemFields\(input\.orderPayload/)
  assert.match(source, /function withoutLegacyEmbeddedItems/)
  assert.match(source, /before_json: JSON\.stringify\(withoutLegacyEmbeddedItems\(input\.activityBefore/)
  assert.match(source, /\.\.\.withoutLegacyEmbeddedItems\(finalOrderPayload\)/)
})

test('absolute admin can edit one quantity while legacy parent embedded snapshot stays untouched', async () => {
  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  const nextItems = Array.from({ length: 10 }, (_, index) => item(index + 1, index === 0 ? 5001 : 5000))

  await assertSucceeds(runTransaction(db, async transaction => {
    const orderRef = doc(db, 'orders', 'order-embedded')
    const itemRef = doc(db, 'order_items', 'item-1')
    const invoiceRef = doc(db, 'invoices', 'inv_order-embedded')
    const activityRef = doc(db, 'activity_logs', 'activity-embedded-edit')
    const orderSnapshot = await transaction.get(orderRef)
    const invoiceSnapshot = await transaction.get(invoiceRef)
    assert.equal(orderSnapshot.exists(), true)
    assert.equal(invoiceSnapshot.exists(), true)

    transaction.update(orderRef, {
      subtotal_no_vat: 101000,
      vat_amount: 8080,
      total_vat: 109080,
      actual_revenue: 109080,
      payable_amount: 109080,
      debt_amount: 109080,
      payment_status: 'Chưa thanh toán',
      computed_payment_status: 'Chưa thanh toán',
      revision: 2,
      last_operation_id: 'embedded-edit',
      updated_at: serverTimestamp(),
    })
    transaction.update(invoiceRef, {
      invoice_amount: 109080,
      last_operation_id: 'embedded-edit',
      updated_at: serverTimestamp(),
    })
    transaction.update(itemRef, {
      ...nextItems[0],
      order_code: 'LEGACY-EMBEDDED-0001',
      owner_email: OWNER,
      created_by: OWNER,
      sale_email: OWNER,
      order_revision: 2,
      last_operation_id: 'embedded-edit',
      updated_at: serverTimestamp(),
    })
    transaction.set(activityRef, {
      module: 'orders',
      action: 'update',
      item_code: 'LEGACY-EMBEDDED-0001',
      item_name: 'Khách embedded',
      changed_by: ADMIN,
      before_json: JSON.stringify({ revision: 1, items_count: 10 }),
      after_json: JSON.stringify({ revision: 2, items_count: 10, removed_item_ids: [] }),
      operation_id: 'embedded-edit',
      order_revision: 2,
      active: true,
      deleted: false,
      created_at: serverTimestamp(),
    })
  }))

  assert.equal((await getDoc(doc(db, 'order_items', 'item-1'))).data().quantity, 5001)
  assert.equal((await getDoc(doc(db, 'orders', 'order-embedded'))).data().items[0].quantity, 5000)
})
