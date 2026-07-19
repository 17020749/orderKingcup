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
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'

const projectId = 'demo-order-printing-delete-lock'
const OWNER = 'owner@example.com'
const PRINTER = 'printer@example.com'
let env

function user(email, permissions) {
  return { email, active: true, deleted: false, permissions_flat: permissions }
}

function sourceOrder(id, { legacy = false } = {}) {
  return {
    id,
    order_code: `SALE1-ABC001-${id === 'order-ready' ? '0001' : '0002'}`,
    order_sequence: id === 'order-ready' ? 1 : 2,
    user_code: 'SALE1',
    customer_id: 'customer-a',
    customer_code: 'ABC001',
    customer_name: 'Khách khóa in',
    owner_email: OWNER,
    created_by: OWNER,
    sale_email: OWNER,
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: '',
    status: 'active',
    active: true,
    deleted: false,
    created_at: 'now',
    ...(legacy ? {} : {
      printing_progress_count: 0,
      printing_lock_version: 1,
      printing_last_action: 'reconcile',
      printing_last_print_order_id: '',
      printing_lock_updated_by: OWNER,
      printing_lock_updated_at: 'now',
      relation_lock_version: 1,
      payment_record_count: 0,
      invoice_record_count: 0,
      shipment_record_count: 0,
      payment_relation_revision: 0,
      invoice_relation_revision: 0,
      shipment_relation_revision: 0,
      relation_last_module: 'all',
      relation_last_action: 'reconcile',
      relation_last_document_id: '',
      relation_updated_by: OWNER,
      relation_updated_at: 'now',
    }),
  }
}

function printOrder(id, orderId, orderCode) {
  return {
    id,
    order_id: orderId,
    order_code: orderCode,
    created_by: PRINTER,
    created_at: 'now',
    updated_by: PRINTER,
    updated_at: 'now',
    status: 'active',
    active: true,
    deleted: false,
    source: 'nuxt',
  }
}

function printingPatch(count, action, printOrderId) {
  return {
    printing_progress_count: count,
    printing_lock_version: 1,
    printing_last_action: action,
    printing_last_print_order_id: printOrderId,
    printing_lock_updated_by: PRINTER,
    printing_lock_updated_at: 'later',
  }
}

function softDeletePatch(actor = OWNER) {
  return {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: 'later',
    updated_at: 'later',
    ...(actor === OWNER ? {} : { deleted_by: actor, updated_by: actor }),
  }
}

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', OWNER), user(OWNER, ['orders.view', 'orders.delete'])),
      setDoc(doc(db, 'users', PRINTER), user(PRINTER, [
        'printing.view_all',
        'printing.create',
        'printing.edit',
        'printing.delete',
      ])),
      setDoc(doc(db, 'customers', 'customer-a'), {
        id: 'customer-a',
        customer_code: 'ABC001',
        customer_name: 'Khách khóa in',
        created_by: OWNER,
        active: true,
        deleted: false,
      }),
      setDoc(doc(db, 'orders', 'order-ready'), sourceOrder('order-ready')),
      setDoc(doc(db, 'orders', 'order-legacy'), sourceOrder('order-legacy', { legacy: true })),
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

test('tạo tiến độ phải tăng khóa parent trong cùng batch', async () => {
  const db = env.authenticatedContext(PRINTER, { email: PRINTER }).firestore()
  const orderRef = doc(db, 'orders', 'order-ready')
  const printRef = doc(db, 'print_orders', 'print-a')
  const batch = writeBatch(db)
  batch.update(orderRef, printingPatch(1, 'create', 'print-a'))
  batch.set(printRef, printOrder('print-a', 'order-ready', 'SALE1-ABC001-0001'))
  await assertSucceeds(batch.commit())
})

test('không thể tạo tiến độ nếu thiếu cập nhật khóa parent', async () => {
  const db = env.authenticatedContext(PRINTER, { email: PRINTER }).firestore()
  await assertFails(setDoc(
    doc(db, 'print_orders', 'print-a'),
    printOrder('print-a', 'order-ready', 'SALE1-ABC001-0001'),
  ))
})

test('không thể tự tăng hoặc giảm count nếu không có print order tương ứng', async () => {
  const db = env.authenticatedContext(PRINTER, { email: PRINTER }).firestore()
  await assertFails(updateDoc(
    doc(db, 'orders', 'order-ready'),
    printingPatch(1, 'create', 'missing-print'),
  ))
})

test('owner bị chặn xóa khi count còn tiến độ và được đọc tiến độ theo order_id', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, 'orders', 'order-ready'), {
      ...sourceOrder('order-ready'),
      ...printingPatch(1, 'create', 'print-a'),
    })
    await setDoc(doc(db, 'print_orders', 'print-a'), printOrder('print-a', 'order-ready', 'SALE1-ABC001-0001'))
  })

  const db = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  await assertFails(updateDoc(doc(db, 'orders', 'order-ready'), softDeletePatch()))
  await assertSucceeds(getDocs(query(
    collection(db, 'print_orders'),
    where('order_id', '==', 'order-ready'),
  )))
  await assertFails(getDocs(query(collection(db, 'print_orders'))))
})

test('xóa tiến độ phải giảm khóa parent; sau đó owner mới xóa được đơn', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, 'orders', 'order-ready'), {
      ...sourceOrder('order-ready'),
      ...printingPatch(1, 'create', 'print-a'),
    })
    await setDoc(doc(db, 'print_orders', 'print-a'), printOrder('print-a', 'order-ready', 'SALE1-ABC001-0001'))
  })

  const printerDb = env.authenticatedContext(PRINTER, { email: PRINTER }).firestore()
  const batch = writeBatch(printerDb)
  batch.update(doc(printerDb, 'orders', 'order-ready'), printingPatch(0, 'delete', 'print-a'))
  batch.update(doc(printerDb, 'print_orders', 'print-a'), softDeletePatch(PRINTER))
  await assertSucceeds(batch.commit())

  const ownerDb = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  await assertSucceeds(updateDoc(doc(ownerDb, 'orders', 'order-ready'), softDeletePatch()))
})

test('đơn legacy thiếu lock version bị fail closed', async () => {
  const db = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  await assertFails(updateDoc(doc(db, 'orders', 'order-legacy'), softDeletePatch()))
})
