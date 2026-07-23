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
import assert from 'node:assert/strict'

const projectId = 'demo-orderkingcup-atomic-order-save'
const CREATOR = 'atomic-create@example.com'
const EDITOR = 'atomic-edit@example.com'
const ADMIN = 'atomic-admin@example.com'
const OTHER = 'other@example.com'
let env

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', CREATOR), {
        email: CREATOR,
        user_code: 'SALE1',
        active: true,
        deleted: false,
        permissions_flat: ['page.orders', 'orders.view', 'orders.create', 'orders.edit'],
      }),
      setDoc(doc(db, 'users', EDITOR), {
        email: EDITOR,
        user_code: 'EDIT1',
        active: true,
        deleted: false,
        permissions_flat: ['page.orders', 'orders.view', 'orders.edit'],
      }),
      setDoc(doc(db, 'users', ADMIN), {
        email: ADMIN,
        user_code: 'ADMIN1',
        is_admin: true,
        active: true,
        deleted: false,
        permissions_flat: ['*'],
      }),
      setDoc(doc(db, 'customers', 'customer-create'), {
        id: 'customer-create',
        customer_code: 'ABC001',
        customer_name: 'Khách tạo nguyên tử',
        created_by: CREATOR,
        active: true,
        deleted: false,
      }),
      setDoc(doc(db, 'customers', 'customer-edit'), {
        id: 'customer-edit',
        customer_code: 'DEF002',
        customer_name: 'Khách sửa nguyên tử',
        created_by: EDITOR,
        active: true,
        deleted: false,
      }),
      setDoc(doc(db, 'orders', 'order-edit'), {
        id: 'order-edit',
        order_code: 'EDIT1-DEF002-0001',
        order_sequence: 1,
        user_code: 'EDIT1',
        customer_id: 'customer-edit',
        customer_code: 'DEF002',
        customer_name: 'Khách sửa nguyên tử',
        owner_email: EDITOR,
        created_by: EDITOR,
        sale_email: EDITOR,
        order_status: 'Mới tạo',
        warehouse_fulfillment_status: 'chua_xuat',
        warehouse_request_status: '',
        invoice_status: 'Không xuất',
        paid_amount: 0,
        debt_amount: 100,
        computed_payment_status: 'Chưa thanh toán',
        payment_status: 'Chưa thanh toán',
        payment_count: 0,
        deposit_count: 0,
        collect_count: 0,
        items_count: 2,
        revision: 1,
        active: true,
        deleted: false,
        status: 'active',
        created_at: '2026-07-19T00:00:00.000Z',
      }),
      setDoc(doc(db, 'order_items', 'item-keep'), {
        id: 'item-keep',
        order_id: 'order-edit',
        order_code: 'EDIT1-DEF002-0001',
        product_id: 'product-a',
        product_code: 'SP-A',
        product_name: 'Sản phẩm cũ A',
        quantity: 10,
        unit_price: 10,
        owner_email: EDITOR,
        created_by: EDITOR,
        sale_email: EDITOR,
        active: true,
        deleted: false,
        status: 'active',
        created_at: '2026-07-19T00:00:00.000Z',
      }),
      setDoc(doc(db, 'order_items', 'item-remove'), {
        id: 'item-remove',
        order_id: 'order-edit',
        order_code: 'EDIT1-DEF002-0001',
        product_id: 'product-b',
        product_code: 'SP-B',
        product_name: 'Sản phẩm cần bỏ',
        quantity: 5,
        unit_price: 20,
        owner_email: EDITOR,
        created_by: EDITOR,
        sale_email: EDITOR,
        active: true,
        deleted: false,
        status: 'active',
        created_at: '2026-07-19T00:00:00.000Z',
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
  await seed()
})

after(async () => env.cleanup())

async function atomicCreate(
  db,
  {
    invalidSecondItem = false,
    actor = CREATOR,
    userCode = 'SALE1',
  } = {},
) {
  const orderCode = `${userCode}-ABC001-0001`
  const orderRef = doc(db, 'orders', 'order-create')
  const sequenceRef = doc(db, 'order_sequences', 'customer-create')
  const itemARef = doc(db, 'order_items', 'create-item-a')
  const itemBRef = doc(db, 'order_items', 'create-item-b')
  const activityRef = doc(db, 'activity_logs', 'activity-create')

  await runTransaction(db, async transaction => {
    const sequenceSnapshot = await transaction.get(sequenceRef)
    assert.equal(sequenceSnapshot.exists(), false)

    transaction.set(sequenceRef, {
      customer_id: 'customer-create',
      customer_code: 'ABC001',
      last_number: 1,
      updated_by: actor,
      updated_at: '2026-07-19T01:00:00.000Z',
      created_at: '2026-07-19T01:00:00.000Z',
    })
    transaction.set(orderRef, {
      id: 'order-create',
      order_code: orderCode,
      order_sequence: 1,
      user_code: userCode,
      customer_id: 'customer-create',
      customer_code: 'ABC001',
      customer_name: 'Khách tạo nguyên tử',
      owner_email: actor,
      created_by: actor,
      sale_email: actor,
      order_status: 'Mới tạo',
      warehouse_fulfillment_status: 'chua_xuat',
      warehouse_request_status: '',
      invoice_status: 'Không xuất',
      items_count: 2,
      revision: 1,
      last_operation_id: 'operation-create',
      active: true,
      deleted: false,
      status: 'active',
      created_at: '2026-07-19T01:00:00.000Z',
      updated_at: '2026-07-19T01:00:00.000Z',
    })
    transaction.set(itemARef, {
      id: 'create-item-a',
      order_id: 'order-create',
      order_code: orderCode,
      product_id: 'product-a',
      product_code: 'SP-A',
      product_name: 'Sản phẩm A',
      quantity: 10,
      unit_price: 10,
      owner_email: actor,
      created_by: actor,
      sale_email: actor,
      order_revision: 1,
      last_operation_id: 'operation-create',
      active: true,
      deleted: false,
      status: 'active',
      created_at: '2026-07-19T01:00:00.000Z',
      updated_at: '2026-07-19T01:00:00.000Z',
    })
    transaction.set(itemBRef, {
      id: 'create-item-b',
      order_id: 'order-create',
      order_code: orderCode,
      product_id: 'product-b',
      product_code: 'SP-B',
      product_name: 'Sản phẩm B',
      quantity: 5,
      unit_price: 20,
      owner_email: invalidSecondItem ? OTHER : actor,
      created_by: actor,
      sale_email: actor,
      order_revision: 1,
      last_operation_id: 'operation-create',
      active: true,
      deleted: false,
      status: 'active',
      created_at: '2026-07-19T01:00:00.000Z',
      updated_at: '2026-07-19T01:00:00.000Z',
    })
    transaction.set(activityRef, {
      module: 'orders',
      action: 'create',
      item_code: orderCode,
      item_name: 'Khách tạo nguyên tử',
      changed_by: actor,
      operation_id: 'operation-create',
      active: true,
      deleted: false,
      created_at: serverTimestamp(),
    })
  })
}

test('tạo đơn ghi sequence, order, items và activity trong một transaction', async () => {
  const db = env.authenticatedContext(CREATOR, { email: CREATOR }).firestore()
  await assertSucceeds(atomicCreate(db))

  assert.equal((await getDoc(doc(db, 'orders', 'order-create'))).data().items_count, 2)
  assert.equal((await getDoc(doc(db, 'order_items', 'create-item-a'))).data().order_id, 'order-create')
  assert.equal((await getDoc(doc(db, 'order_sequences', 'customer-create'))).data().last_number, 1)
  await env.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore()
    assert.equal((await getDoc(doc(adminDb, 'activity_logs', 'activity-create'))).data().operation_id, 'operation-create')
  })
})

test('Sale sở hữu đơn có thể sửa ngay sau create mà không cần orders.view_all', async () => {
  const db = env.authenticatedContext(CREATOR, { email: CREATOR }).firestore()
  await assertSucceeds(atomicCreate(db))

  await assertSucceeds(runTransaction(db, async transaction => {
    const orderRef = doc(db, 'orders', 'order-create')
    const itemRef = doc(db, 'order_items', 'create-item-a')
    const activityRef = doc(db, 'activity_logs', 'activity-immediate-edit')
    const orderSnapshot = await transaction.get(orderRef)
    assert.equal(orderSnapshot.data().revision, 1)

    transaction.update(orderRef, {
      customer_name: 'Khách sửa ngay sau khi tạo',
      revision: 2,
      last_operation_id: 'operation-immediate-edit',
      updated_at: serverTimestamp(),
    })
    transaction.update(itemRef, {
      product_name: 'Sản phẩm sửa ngay sau khi tạo',
      owner_email: CREATOR,
      created_by: CREATOR,
      sale_email: CREATOR,
      order_revision: 2,
      last_operation_id: 'operation-immediate-edit',
      updated_at: serverTimestamp(),
    })
    transaction.set(activityRef, {
      module: 'orders',
      action: 'update',
      item_code: 'SALE1-ABC001-0001',
      item_name: 'Khách sửa ngay sau khi tạo',
      changed_by: CREATOR,
      operation_id: 'operation-immediate-edit',
      active: true,
      deleted: false,
      created_at: serverTimestamp(),
    })
  }))

  assert.equal((await getDoc(doc(db, 'orders', 'order-create'))).data().revision, 2)
  assert.equal(
    (await getDoc(doc(db, 'order_items', 'create-item-a'))).data().order_revision,
    2,
  )
})

test('Admin có thể sửa ngay sau create mà không cần tải lại đơn', async () => {
  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  await assertSucceeds(atomicCreate(db, {
    actor: ADMIN,
    userCode: 'ADMIN1',
  }))

  await assertSucceeds(runTransaction(db, async transaction => {
    const orderRef = doc(db, 'orders', 'order-create')
    const itemRef = doc(db, 'order_items', 'create-item-a')
    const activityRef = doc(db, 'activity_logs', 'activity-admin-immediate-edit')
    const orderSnapshot = await transaction.get(orderRef)
    assert.equal(orderSnapshot.data().revision, 1)

    transaction.update(orderRef, {
      customer_name: 'Khách Admin sửa ngay sau khi tạo',
      revision: 2,
      last_operation_id: 'operation-admin-immediate-edit',
      updated_at: serverTimestamp(),
    })
    transaction.update(itemRef, {
      product_name: 'Sản phẩm Admin sửa ngay sau khi tạo',
      owner_email: ADMIN,
      created_by: ADMIN,
      sale_email: ADMIN,
      order_revision: 2,
      last_operation_id: 'operation-admin-immediate-edit',
      updated_at: serverTimestamp(),
    })
    transaction.set(activityRef, {
      module: 'orders',
      action: 'update',
      item_code: 'ADMIN1-ABC001-0001',
      item_name: 'Khách Admin sửa ngay sau khi tạo',
      changed_by: ADMIN,
      operation_id: 'operation-admin-immediate-edit',
      active: true,
      deleted: false,
      created_at: serverTimestamp(),
    })
  }))

  assert.equal((await getDoc(doc(db, 'orders', 'order-create'))).data().revision, 2)
  assert.equal(
    (await getDoc(doc(db, 'order_items', 'create-item-a'))).data().order_revision,
    2,
  )
})

test('một item sai quyền làm rollback toàn bộ transaction tạo đơn', async () => {
  const db = env.authenticatedContext(CREATOR, { email: CREATOR }).firestore()
  await assertFails(atomicCreate(db, { invalidSecondItem: true }))

  await env.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore()
    assert.equal((await getDoc(doc(adminDb, 'orders', 'order-create'))).exists(), false)
    assert.equal((await getDoc(doc(adminDb, 'order_items', 'create-item-a'))).exists(), false)
    assert.equal((await getDoc(doc(adminDb, 'order_items', 'create-item-b'))).exists(), false)
    assert.equal((await getDoc(doc(adminDb, 'order_sequences', 'customer-create'))).exists(), false)
    assert.equal((await getDoc(doc(adminDb, 'activity_logs', 'activity-create'))).exists(), false)
  })
})

async function atomicEdit(db, { invalidNewItem = false } = {}) {
  const orderRef = doc(db, 'orders', 'order-edit')
  const keepRef = doc(db, 'order_items', 'item-keep')
  const removeRef = doc(db, 'order_items', 'item-remove')
  const newRef = doc(db, 'order_items', 'item-new')
  const activityRef = doc(db, 'activity_logs', invalidNewItem ? 'activity-edit-invalid' : 'activity-edit')

  await runTransaction(db, async transaction => {
    const orderSnapshot = await transaction.get(orderRef)
    assert.equal(orderSnapshot.data().revision, 1)

    transaction.update(orderRef, {
      customer_name: 'Khách đã sửa nguyên tử',
      items_count: 2,
      revision: 2,
      last_operation_id: 'operation-edit',
      updated_at: '2026-07-19T02:00:00.000Z',
    })
    transaction.update(keepRef, {
      product_name: 'Sản phẩm A đã sửa',
      owner_email: EDITOR,
      created_by: EDITOR,
      sale_email: EDITOR,
      order_revision: 2,
      last_operation_id: 'operation-edit',
      updated_at: '2026-07-19T02:00:00.000Z',
    })
    transaction.set(newRef, {
      id: 'item-new',
      order_id: 'order-edit',
      order_code: 'EDIT1-DEF002-0001',
      product_id: 'product-c',
      product_code: 'SP-C',
      product_name: 'Sản phẩm mới C',
      quantity: 3,
      unit_price: 30,
      owner_email: invalidNewItem ? OTHER : EDITOR,
      created_by: EDITOR,
      sale_email: EDITOR,
      order_revision: 2,
      last_operation_id: 'operation-edit',
      active: true,
      deleted: false,
      status: 'active',
      created_at: '2026-07-19T02:00:00.000Z',
      updated_at: '2026-07-19T02:00:00.000Z',
    })
    transaction.update(removeRef, {
      deleted: true,
      active: false,
      status: 'deleted',
      deleted_at: '2026-07-19T02:00:00.000Z',
      updated_at: '2026-07-19T02:00:00.000Z',
    })
    transaction.set(activityRef, {
      module: 'orders',
      action: 'update',
      item_code: 'EDIT1-DEF002-0001',
      item_name: 'Khách đã sửa nguyên tử',
      changed_by: EDITOR,
      operation_id: 'operation-edit',
      active: true,
      deleted: false,
      created_at: serverTimestamp(),
    })
  })
}

test('người chỉ có orders.edit vẫn thêm, sửa và bỏ dòng sản phẩm trong transaction', async () => {
  const db = env.authenticatedContext(EDITOR, { email: EDITOR }).firestore()
  await assertSucceeds(atomicEdit(db))

  assert.equal((await getDoc(doc(db, 'orders', 'order-edit'))).data().revision, 2)
  assert.equal((await getDoc(doc(db, 'order_items', 'item-keep'))).data().product_name, 'Sản phẩm A đã sửa')
  assert.equal((await getDoc(doc(db, 'order_items', 'item-new'))).data().product_code, 'SP-C')
  assert.equal((await getDoc(doc(db, 'order_items', 'item-remove'))).data().deleted, true)
})

test('một item mới sai ownership làm rollback toàn bộ transaction sửa đơn', async () => {
  const db = env.authenticatedContext(EDITOR, { email: EDITOR }).firestore()
  await assertFails(atomicEdit(db, { invalidNewItem: true }))

  const order = (await getDoc(doc(db, 'orders', 'order-edit'))).data()
  const keep = (await getDoc(doc(db, 'order_items', 'item-keep'))).data()
  const remove = (await getDoc(doc(db, 'order_items', 'item-remove'))).data()
  assert.equal(order.customer_name, 'Khách sửa nguyên tử')
  assert.equal(order.revision, 1)
  assert.equal(keep.product_name, 'Sản phẩm cũ A')
  assert.equal(remove.deleted, false)

  await env.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore()
    assert.equal((await getDoc(doc(adminDb, 'order_items', 'item-new'))).exists(), false)
    assert.equal((await getDoc(doc(adminDb, 'activity_logs', 'activity-edit-invalid'))).exists(), false)
  })
})
