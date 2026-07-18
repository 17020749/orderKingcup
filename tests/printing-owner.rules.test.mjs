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
const OWNER = 'print-owner@example.com'
const OTHER = 'print-other@example.com'
const VIEWER = 'print-viewer@example.com'
const VIEW_ALL = 'print-view-all@example.com'
let env

function user(email, permissions) {
  return {
    email,
    active: true,
    deleted: false,
    permissions_flat: permissions,
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
    logo: '',
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
    const fullPermissions = [
      'page.printing',
      'printing.view',
      'printing.create',
      'printing.edit',
      'printing.delete',
    ]
    await Promise.all([
      setDoc(doc(db, 'users', OWNER), user(OWNER, fullPermissions)),
      setDoc(doc(db, 'users', OTHER), user(OTHER, fullPermissions)),
      setDoc(doc(db, 'users', VIEWER), user(VIEWER, ['page.printing', 'printing.view'])),
      setDoc(doc(db, 'users', VIEW_ALL), user(VIEW_ALL, ['page.printing', 'printing.view', 'printing.view_all'])),
      setDoc(doc(db, 'orders', 'source-order-a'), {
        id: 'source-order-a',
        order_code: 'DH-A',
        owner_email: OWNER,
        created_by: OWNER,
        sale_email: OWNER,
        active: true,
        deleted: false,
      }),
      setDoc(doc(db, 'products', 'product-a'), {
        id: 'product-a',
        product_code: 'SP-A',
        product_name: 'Sản phẩm A',
        active: true,
        deleted: false,
      }),
      setDoc(doc(db, 'print_orders', 'print-owner-a'), printOrder('print-owner-a', OWNER, 'source-order-a', 'DH-A')),
      setDoc(doc(db, 'print_orders', 'print-other-a'), printOrder('print-other-a', OTHER, 'source-order-a', 'DH-A')),
      setDoc(doc(db, 'print_order_items', 'item-owner-a'), printItem('item-owner-a', 'print-owner-a', OWNER)),
      setDoc(doc(db, 'print_order_items', 'item-other-a'), printItem('item-other-a', 'print-other-a', OTHER)),
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

test('printing.view chỉ đọc được đơn in và dòng in do chính mình tạo', async () => {
  const db = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  await assertSucceeds(getDoc(doc(db, 'print_orders', 'print-owner-a')))
  await assertFails(getDoc(doc(db, 'print_orders', 'print-other-a')))
  await assertSucceeds(getDoc(doc(db, 'print_order_items', 'item-owner-a')))
  await assertFails(getDoc(doc(db, 'print_order_items', 'item-other-a')))
})

test('query tiến độ in của mình phải lọc created_by, query toàn bộ bị chặn', async () => {
  const db = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  await assertSucceeds(getDocs(query(
    collection(db, 'print_orders'),
    where('created_by', '==', OWNER),
  )))
  await assertSucceeds(getDocs(query(
    collection(db, 'print_order_items'),
    where('created_by', '==', OWNER),
  )))
  await assertFails(getDocs(query(collection(db, 'print_orders'))))
  await assertFails(getDocs(query(collection(db, 'print_order_items'))))
})

test('printing.view_all đọc được toàn bộ tiến độ in', async () => {
  const db = env.authenticatedContext(VIEW_ALL, { email: VIEW_ALL }).firestore()
  await assertSucceeds(getDocs(query(collection(db, 'print_orders'))))
  await assertSucceeds(getDocs(query(collection(db, 'print_order_items'))))
})

test('người có quyền sửa xóa vẫn không thao tác được đơn in của người khác', async () => {
  const ownerDb = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  const otherDb = env.authenticatedContext(OTHER, { email: OTHER }).firestore()

  await assertSucceeds(updateDoc(doc(ownerDb, 'print_orders', 'print-owner-a'), {
    note: 'Chủ đơn cập nhật',
    updated_by: OWNER,
    updated_at: 'later',
  }))
  await assertSucceeds(updateDoc(doc(ownerDb, 'print_order_items', 'item-owner-a'), {
    actual_print_quantity: 4,
    updated_by: OWNER,
    updated_at: 'later',
  }))

  await assertFails(updateDoc(doc(otherDb, 'print_orders', 'print-owner-a'), {
    note: 'Không được sửa',
    updated_by: OTHER,
    updated_at: 'later',
  }))
  await assertFails(updateDoc(doc(otherDb, 'print_order_items', 'item-owner-a'), {
    actual_print_quantity: 9,
    updated_by: OTHER,
    updated_at: 'later',
  }))
  await assertFails(updateDoc(doc(otherDb, 'print_orders', 'print-owner-a'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: 'later',
    deleted_by: OTHER,
    updated_by: OTHER,
    updated_at: 'later',
  }))
})

test('tạo đơn in và dòng in của mình trong cùng batch vẫn hợp lệ', async () => {
  const db = env.authenticatedContext(OWNER, { email: OWNER }).firestore()
  const batch = writeBatch(db)
  batch.set(
    doc(db, 'print_orders', 'print-owner-new'),
    printOrder('print-owner-new', OWNER, 'source-order-a', 'DH-A'),
  )
  batch.set(
    doc(db, 'print_order_items', 'item-owner-new'),
    printItem('item-owner-new', 'print-owner-new', OWNER),
  )
  await assertSucceeds(batch.commit())
})

test('tài khoản chỉ có printing.view không thể tạo hoặc sửa dữ liệu', async () => {
  const db = env.authenticatedContext(VIEWER, { email: VIEWER }).firestore()
  await assertFails(setDoc(
    doc(db, 'print_orders', 'print-viewer-new'),
    printOrder('print-viewer-new', VIEWER, 'source-order-a', 'DH-A'),
  ))
  await assertFails(updateDoc(doc(db, 'print_orders', 'print-owner-a'), {
    note: 'Không được sửa',
    updated_at: 'later',
  }))
})
