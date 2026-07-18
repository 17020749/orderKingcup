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
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-printing-owner-rules'
const SALE_OWNER = 'sale-owner@example.com'
const OTHER_SALE = 'other-sale@example.com'
const OPERATOR_A = 'print-operator-a@example.com'
const OPERATOR_B = 'print-operator-b@example.com'
const SELF_OPERATOR = 'print-self@example.com'
let env

function user(email, permissions) {
  return {
    email,
    active: true,
    deleted: false,
    permissions_flat: permissions,
  }
}

function sourceOrder(id, code, owner) {
  return {
    id,
    order_code: code,
    owner_email: owner,
    created_by: owner,
    sale_email: owner,
    active: true,
    deleted: false,
  }
}

function printOrder(id, createdBy, sourceOrderId, orderCode) {
  return {
    id,
    order_id: sourceOrderId,
    order_code: orderCode,
    am_code: 'AM01',
    created_by: createdBy,
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false,
    status: 'active',
    source: 'nuxt',
  }
}

function printItem(id, printOrderId, createdBy) {
  return {
    id,
    print_order_id: printOrderId,
    product_id: 'product-a',
    product_code: 'SP-A',
    product_name: 'Sản phẩm A',
    logo: 'LOGO-A',
    print_quantity: 10,
    actual_print_quantity: 0,
    is_completed: false,
    created_by: createdBy,
    created_at: 'now',
    updated_at: 'now',
    active: true,
    deleted: false,
    status: 'active',
    source: 'nuxt',
  }
}

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    const operatorPermissions = [
      'page.printing',
      'printing.view',
      'printing.view_all',
      'printing.create',
      'printing.edit',
      'printing.delete',
    ]
    await Promise.all([
      setDoc(doc(db, 'users', SALE_OWNER), user(SALE_OWNER, ['page.printing', 'printing.orders_view'])),
      setDoc(doc(db, 'users', OTHER_SALE), user(OTHER_SALE, ['page.printing', 'printing.orders_view'])),
      setDoc(doc(db, 'users', OPERATOR_A), user(OPERATOR_A, operatorPermissions)),
      setDoc(doc(db, 'users', OPERATOR_B), user(OPERATOR_B, operatorPermissions)),
      setDoc(doc(db, 'users', SELF_OPERATOR), user(SELF_OPERATOR, ['page.printing', 'printing.view', 'printing.create', 'printing.edit', 'printing.delete'])),
      setDoc(doc(db, 'orders', 'source-order-a'), sourceOrder('source-order-a', 'DH-A', SALE_OWNER)),
      setDoc(doc(db, 'orders', 'source-order-b'), sourceOrder('source-order-b', 'DH-B', OTHER_SALE)),
      setDoc(doc(db, 'products', 'product-a'), {
        id: 'product-a',
        product_code: 'SP-A',
        product_name: 'Sản phẩm A',
        active: true,
        deleted: false,
      }),
      setDoc(doc(db, 'print_orders', 'print-order-a'), printOrder('print-order-a', OPERATOR_B, 'source-order-a', 'DH-A')),
      setDoc(doc(db, 'print_orders', 'print-order-b'), printOrder('print-order-b', OPERATOR_A, 'source-order-b', 'DH-B')),
      setDoc(doc(db, 'print_orders', 'print-self'), printOrder('print-self', SELF_OPERATOR, 'source-order-b', 'DH-B')),
      setDoc(doc(db, 'print_order_items', 'item-order-a'), printItem('item-order-a', 'print-order-a', OPERATOR_B)),
      setDoc(doc(db, 'print_order_items', 'item-order-b'), printItem('item-order-b', 'print-order-b', OPERATOR_A)),
      setDoc(doc(db, 'print_order_items', 'item-self'), printItem('item-self', 'print-self', SELF_OPERATOR)),
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

test('người tạo đơn chỉ xem tiến độ gắn với đơn hàng của mình', async () => {
  const db = env.authenticatedContext(SALE_OWNER, { email: SALE_OWNER }).firestore()

  await assertSucceeds(getDoc(doc(db, 'orders', 'source-order-a')))
  await assertFails(getDoc(doc(db, 'orders', 'source-order-b')))
  await assertSucceeds(getDoc(doc(db, 'print_orders', 'print-order-a')))
  await assertFails(getDoc(doc(db, 'print_orders', 'print-order-b')))
  await assertSucceeds(getDoc(doc(db, 'print_order_items', 'item-order-a')))
  await assertFails(getDoc(doc(db, 'print_order_items', 'item-order-b')))
})

test('query của người tạo đơn phải giới hạn theo order_id thuộc đơn của mình', async () => {
  const db = env.authenticatedContext(SALE_OWNER, { email: SALE_OWNER }).firestore()

  await assertSucceeds(getDocs(query(
    collection(db, 'orders'),
    where('created_by', '==', SALE_OWNER),
  )))
  await assertSucceeds(getDocs(query(
    collection(db, 'print_orders'),
    where('order_id', '==', 'source-order-a'),
  )))
  await assertSucceeds(getDocs(query(
    collection(db, 'print_order_items'),
    where('print_order_id', '==', 'print-order-a'),
  )))
  await assertFails(getDocs(query(collection(db, 'print_orders'))))
  await assertFails(getDocs(query(collection(db, 'print_order_items'))))
})

test('người tạo đơn chỉ có quyền xem, không thể tạo sửa hoặc xóa tiến độ', async () => {
  const db = env.authenticatedContext(SALE_OWNER, { email: SALE_OWNER }).firestore()

  await assertFails(setDoc(
    doc(db, 'print_orders', 'sale-created-progress'),
    printOrder('sale-created-progress', SALE_OWNER, 'source-order-a', 'DH-A'),
  ))
  await assertFails(updateDoc(doc(db, 'print_orders', 'print-order-a'), {
    note: 'Sale không được sửa',
    updated_at: 'later',
  }))
  await assertFails(updateDoc(doc(db, 'print_orders', 'print-order-a'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: 'later',
    deleted_by: SALE_OWNER,
    updated_by: SALE_OWNER,
    updated_at: 'later',
  }))
})

test('vận hành có view_all và edit/delete thao tác được tiến độ do người khác lập', async () => {
  const db = env.authenticatedContext(OPERATOR_A, { email: OPERATOR_A }).firestore()

  await assertSucceeds(getDocs(query(collection(db, 'print_orders'))))
  await assertSucceeds(getDocs(query(collection(db, 'print_order_items'))))
  await assertSucceeds(updateDoc(doc(db, 'print_orders', 'print-order-a'), {
    note: 'Vận hành cập nhật',
    updated_by: OPERATOR_A,
    updated_at: 'later',
  }))
  await assertSucceeds(updateDoc(doc(db, 'print_order_items', 'item-order-a'), {
    actual_print_quantity: 4,
    updated_by: OPERATOR_A,
    updated_at: 'later',
  }))
  await assertSucceeds(updateDoc(doc(db, 'print_orders', 'print-order-a'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: 'later',
    deleted_by: OPERATOR_A,
    updated_by: OPERATOR_A,
    updated_at: 'later',
  }))
})

test('printing.view vẫn chỉ đọc tiến độ do chính người đó lập', async () => {
  const db = env.authenticatedContext(SELF_OPERATOR, { email: SELF_OPERATOR }).firestore()

  await assertSucceeds(getDoc(doc(db, 'print_orders', 'print-self')))
  await assertFails(getDoc(doc(db, 'print_orders', 'print-order-a')))
  await assertSucceeds(getDoc(doc(db, 'print_order_items', 'item-self')))
  await assertFails(getDoc(doc(db, 'print_order_items', 'item-order-a')))
})

test('vận hành tạo đơn in và dòng in trong cùng batch vẫn hợp lệ', async () => {
  const db = env.authenticatedContext(OPERATOR_A, { email: OPERATOR_A }).firestore()
  const batch = writeBatch(db)
  batch.set(
    doc(db, 'print_orders', 'print-new'),
    printOrder('print-new', OPERATOR_A, 'source-order-a', 'DH-A'),
  )
  batch.set(
    doc(db, 'print_order_items', 'item-new'),
    printItem('item-new', 'print-new', OPERATOR_A),
  )
  await assertSucceeds(batch.commit())
})
