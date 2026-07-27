import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import {
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { chunkOrderIds, SAFE_RELATION_QUERY_CHUNK_SIZE } from '../utils/orderItemScope.mjs'

const projectId = 'demo-orderkingcup-invoice-access-limits'
const SALE = 'invoice-access-sale@example.com'
let env

async function seedBase() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', SALE), {
        email: SALE,
        user_code: 'SALE1',
        active: true,
        deleted: false,
        permissions_flat: ['page.orders', 'orders.view', 'orders.create', 'orders.edit', 'orders.delete'],
      }),
      setDoc(doc(db, 'customers', 'customer-access'), {
        id: 'customer-access',
        customer_code: 'ABC001',
        customer_name: 'Khách kiểm thử access limit',
        created_by: SALE,
        active: true,
        deleted: false,
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
  await seedBase()
})

after(async () => env.cleanup())

test('relation query luôn chia tối đa 5 order để chừa biên Rules access calls', () => {
  assert.equal(SAFE_RELATION_QUERY_CHUNK_SIZE, 5)
  assert.deepEqual(
    chunkOrderIds(Array.from({ length: 11 }, (_, index) => `order-${index + 1}`)),
    [
      ['order-1', 'order-2', 'order-3', 'order-4', 'order-5'],
      ['order-6', 'order-7', 'order-8', 'order-9', 'order-10'],
      ['order-11'],
    ],
  )
})

test('query 5 invoice theo order của Sale không vượt giới hạn Rules query', async () => {
  const ids = Array.from({ length: 5 }, (_, index) => `order-query-${index + 1}`)
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all(ids.flatMap((orderId, index) => {
      const orderCode = `SALE1-ABC001-${String(index + 1).padStart(4, '0')}`
      return [
        setDoc(doc(db, 'orders', orderId), {
          id: orderId,
          order_code: orderCode,
          order_sequence: index + 1,
          user_code: 'SALE1',
          customer_id: 'customer-access',
          customer_code: 'ABC001',
          owner_email: SALE,
          created_by: SALE,
          sale_email: SALE,
          invoice_status: 'Không xuất',
          invoice_record_count: 1,
          invoice_relation_revision: 1,
          relation_lock_version: 1,
          warehouse_fulfillment_status: 'chua_xuat',
          warehouse_request_status: '',
          printing_lock_version: 1,
          printing_progress_count: 0,
          payment_record_count: 0,
          shipment_record_count: 0,
          active: true,
          deleted: false,
          status: 'active',
        }),
        setDoc(doc(db, 'invoices', `inv_${orderId}`), {
          id: `inv_${orderId}`,
          order_id: orderId,
          order_code: orderCode,
          invoice_status: 'Không xuất',
          invoice_amount: 1000,
          created_by: SALE,
          order_owner_email: SALE,
          order_created_by: SALE,
          order_sale_email: SALE,
          relation_revision: 1,
          active: true,
          deleted: false,
          status: 'active',
        }),
      ]
    }))
  })

  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const snapshot = await assertSucceeds(getDocs(query(
    collection(db, 'invoices'),
    where('order_id', 'in', ids),
  )))
  assert.equal(snapshot.size, 5)
})

test('tạo order + invoice + 25 items + activity trong một transaction không vượt Rules access calls', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const orderId = 'order-access-create'
  const orderCode = 'SALE1-ABC001-0001'
  const operationId = 'operation-access-create'
  const timestamp = serverTimestamp()

  await assertSucceeds(runTransaction(db, async transaction => {
    const sequenceRef = doc(db, 'order_sequences', 'customer-access')
    const sequenceSnapshot = await transaction.get(sequenceRef)
    assert.equal(sequenceSnapshot.exists(), false)

    transaction.set(sequenceRef, {
      customer_id: 'customer-access',
      customer_code: 'ABC001',
      last_number: 1,
      updated_by: SALE,
      updated_at: timestamp,
      created_at: timestamp,
    })

    transaction.set(doc(db, 'orders', orderId), {
      id: orderId,
      order_code: orderCode,
      order_sequence: 1,
      user_code: 'SALE1',
      customer_id: 'customer-access',
      customer_code: 'ABC001',
      customer_name: 'Khách kiểm thử access limit',
      owner_email: SALE,
      created_by: SALE,
      sale_email: SALE,
      order_status: 'Mới tạo',
      warehouse_fulfillment_status: 'chua_xuat',
      warehouse_request_status: '',
      payable_amount: 1000,
      actual_revenue: 1000,
      invoice_status: 'Yêu cầu xuất',
      relation_lock_version: 1,
      payment_record_count: 0,
      invoice_record_count: 1,
      shipment_record_count: 0,
      payment_relation_revision: 0,
      invoice_relation_revision: 1,
      shipment_relation_revision: 0,
      relation_last_module: 'invoices',
      relation_last_action: 'create',
      relation_last_document_id: `inv_${orderId}`,
      relation_updated_by: SALE,
      relation_updated_at: timestamp,
      printing_lock_version: 1,
      printing_progress_count: 0,
      items_count: 25,
      revision: 1,
      last_operation_id: operationId,
      active: true,
      deleted: false,
      status: 'active',
      created_at: timestamp,
      updated_at: timestamp,
    })

    transaction.set(doc(db, 'invoices', `inv_${orderId}`), {
      id: `inv_${orderId}`,
      order_id: orderId,
      order_code: orderCode,
      invoice_number: '',
      invoice_date: '',
      invoice_amount: 1000,
      invoice_status: 'Yêu cầu xuất',
      tax_code: '',
      company_name: '',
      billing_address: '',
      note: '',
      created_by: SALE,
      order_owner_email: SALE,
      order_created_by: SALE,
      order_sale_email: SALE,
      relation_revision: 1,
      last_operation_id: operationId,
      active: true,
      deleted: false,
      status: 'active',
      created_at: timestamp,
      updated_at: timestamp,
    })

    for (let index = 0; index < 25; index += 1) {
      const itemId = `access-item-${index + 1}`
      transaction.set(doc(db, 'order_items', itemId), {
        id: itemId,
        order_id: orderId,
        order_code: orderCode,
        product_id: `product-${index + 1}`,
        product_code: `SP-${index + 1}`,
        product_name: `Sản phẩm ${index + 1}`,
        quantity: 1,
        unit_price: 40,
        owner_email: SALE,
        created_by: SALE,
        sale_email: SALE,
        order_revision: 1,
        last_operation_id: operationId,
        active: true,
        deleted: false,
        status: 'active',
        created_at: timestamp,
        updated_at: timestamp,
      })
    }

    transaction.set(doc(db, 'activity_logs', 'activity-access-create'), {
      module: 'orders',
      action: 'create',
      item_code: orderCode,
      item_name: 'Khách kiểm thử access limit',
      changed_by: SALE,
      operation_id: operationId,
      active: true,
      deleted: false,
      created_at: timestamp,
    })
  }))
})
