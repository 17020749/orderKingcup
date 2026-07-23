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
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'

const projectId = 'demo-order-relations-step7'
const SALE = 'sale@example.com'
const MANAGER = 'manager@example.com'
const CASHIER = 'cashier@example.com'
let env

function baseOrder(id = 'order-a') {
  return {
    id,
    order_code: id,
    owner_email: SALE,
    created_by: SALE,
    sale_email: SALE,
    actual_revenue: 1000,
    paid_amount: 0,
    debt_amount: 1000,
    payment_status: 'Chưa thanh toán',
    computed_payment_status: 'Chưa thanh toán',
    payment_count: 0,
    deposit_count: 0,
    collect_count: 0,
    invoice_status: 'Không xuất',
    shipment_status: '',
    shipping_fee_total: 0,
    cod_amount_total: 0,
    relation_lock_version: 1,
    payment_record_count: 0,
    invoice_record_count: 0,
    shipment_record_count: 0,
    payment_relation_revision: 0,
    invoice_relation_revision: 0,
    shipment_relation_revision: 0,
    printing_lock_version: 1,
    printing_progress_count: 0,
    warehouse_fulfillment_status: 'chua_xuat',
    active: true,
    deleted: false,
    status: 'active',
  }
}

function ownership() {
  return {
    order_owner_email: SALE,
    order_created_by: SALE,
    order_sale_email: SALE,
  }
}

function relationMeta(module, action, documentId, actor = SALE) {
  return {
    relation_lock_version: 1,
    relation_last_module: module,
    relation_last_action: action,
    relation_last_document_id: documentId,
    relation_updated_by: actor,
    relation_updated_at: 'now',
    updated_at: 'now',
  }
}

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', SALE), {
        email: SALE,
        active: true,
        deleted: false,
        permissions_flat: [
          'orders.view', 'orders.delete',
          'payments.view', 'payments.create', 'payments.edit', 'payments.delete',
          'invoices.view', 'invoices.create', 'invoices.edit', 'invoices.delete',
          'shipments.view', 'shipments.create', 'shipments.edit', 'shipments.delete',
        ],
      }),
      setDoc(doc(db, 'users', MANAGER), {
        email: MANAGER,
        active: true,
        deleted: false,
        permissions_flat: [
          'orders.view_all',
          'payments.view_all', 'payments.create', 'payments.edit', 'payments.delete',
          'invoices.view', 'invoices.view_all', 'invoices.create', 'invoices.edit', 'invoices.delete',
          'shipments.view', 'shipments.view_all', 'shipments.create', 'shipments.edit', 'shipments.delete',
        ],
      }),
      setDoc(doc(db, 'users', CASHIER), {
        email: CASHIER,
        active: true,
        deleted: false,
        permissions_flat: [
          'orders.view_all',
          'payments.create',
        ],
      }),
      setDoc(doc(db, 'orders', 'order-a'), baseOrder('order-a')),
      setDoc(doc(db, 'orders', 'order-zero'), baseOrder('order-zero')),
      setDoc(doc(db, 'orders', 'order-legacy'), {
        ...baseOrder('order-legacy'),
        relation_lock_version: 0,
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

test('non-admin có orders.view_all được thêm thanh toán cho đơn của sale khác', async () => {
  const db = env.authenticatedContext(MANAGER, { email: MANAGER }).firestore()
  const batch = writeBatch(db)
  batch.set(doc(db, 'payments', 'pay-manager'), {
    id: 'pay-manager', order_id: 'order-a', order_code: 'order-a',
    payment_type: 'Cọc', payment_status: 'Đã nhận', amount: 200,
    created_by: MANAGER, ...ownership(), active: true, deleted: false, status: 'active',
  })
  batch.update(doc(db, 'orders', 'order-a'), {
    ...relationMeta('payments', 'create', 'pay-manager', MANAGER),
    payment_record_count: 1,
    payment_relation_revision: 1,
    paid_amount: 200,
    debt_amount: 800,
    payment_status: 'Đã cọc',
    computed_payment_status: 'Đã cọc',
    payment_count: 1,
    deposit_count: 1,
    collect_count: 0,
  })
  await assertSucceeds(batch.commit())
})

test('orders.view_all không thay thế payments.view_all khi đọc hoặc tạo payment ngoài phạm vi', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, 'payments', 'pay-existing'), {
      id: 'pay-existing', order_id: 'order-a', order_code: 'order-a',
      payment_type: 'Cọc', payment_status: 'Đã nhận', amount: 200,
      created_by: SALE, ...ownership(), active: true, deleted: false, status: 'active',
    })
    await updateDoc(doc(db, 'orders', 'order-a'), {
      payment_record_count: 1, payment_relation_revision: 1, paid_amount: 200, debt_amount: 800,
      payment_status: 'Đã cọc', computed_payment_status: 'Đã cọc', payment_count: 1, deposit_count: 1, collect_count: 0,
    })
  })

  const db = env.authenticatedContext(CASHIER, { email: CASHIER }).firestore()
  await assertFails(getDoc(doc(db, 'payments', 'pay-existing')))

  const batch = writeBatch(db)
  batch.set(doc(db, 'payments', 'pay-cashier'), {
    id: 'pay-cashier', order_id: 'order-a', order_code: 'order-a',
    payment_type: 'Thu 1', payment_status: 'Đã nhận', amount: 300,
    created_by: CASHIER, ...ownership(), active: true, deleted: false, status: 'active',
  })
  batch.update(doc(db, 'orders', 'order-a'), {
    ...relationMeta('payments', 'create', 'pay-cashier', CASHIER),
    payment_record_count: 2,
    payment_relation_revision: 2,
    paid_amount: 500,
    debt_amount: 500,
    payment_status: 'Đã cọc + thanh toán 1 phần',
    computed_payment_status: 'Đã cọc + thanh toán 1 phần',
    payment_count: 2,
    deposit_count: 1,
    collect_count: 1,
  })
  await assertFails(batch.commit())
})

test('payment create phải ghi child và summary parent trong cùng batch', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const batch = writeBatch(db)
  batch.set(doc(db, 'payments', 'pay-a'), {
    id: 'pay-a', order_id: 'order-a', order_code: 'order-a',
    payment_type: 'Cọc', payment_status: 'Đã nhận', amount: 300,
    created_by: SALE, ...ownership(), active: true, deleted: false, status: 'active',
  })
  batch.update(doc(db, 'orders', 'order-a'), {
    ...relationMeta('payments', 'create', 'pay-a'),
    payment_record_count: 1,
    payment_relation_revision: 1,
    paid_amount: 300,
    debt_amount: 700,
    payment_status: 'Đã cọc',
    computed_payment_status: 'Đã cọc',
    payment_count: 1,
    deposit_count: 1,
    collect_count: 0,
  })
  await assertSucceeds(batch.commit())
})

test('payment child hoặc parent summary ghi riêng đều bị từ chối', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertFails(setDoc(doc(db, 'payments', 'pay-alone'), {
    id: 'pay-alone', order_id: 'order-a', order_code: 'order-a',
    payment_type: 'Cọc', payment_status: 'Đã nhận', amount: 100,
    created_by: SALE, ...ownership(), active: true, deleted: false,
  }))
  await assertFails(updateDoc(doc(db, 'orders', 'order-a'), {
    ...relationMeta('payments', 'create', 'missing-payment'),
    payment_record_count: 1,
    payment_relation_revision: 1,
    paid_amount: 100,
    debt_amount: 900,
    payment_status: 'Đã cọc',
    computed_payment_status: 'Đã cọc',
    payment_count: 1,
    deposit_count: 1,
    collect_count: 0,
  }))
})

test('payment update và delete đổi revision/count nguyên tử', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, 'payments', 'pay-a'), {
      id: 'pay-a', order_id: 'order-a', order_code: 'order-a', payment_type: 'Cọc',
      payment_status: 'Đã nhận', amount: 300, created_by: SALE, ...ownership(), active: true, deleted: false,
    })
    await updateDoc(doc(db, 'orders', 'order-a'), {
      payment_record_count: 1, payment_relation_revision: 1, paid_amount: 300, debt_amount: 700,
      payment_status: 'Đã cọc', computed_payment_status: 'Đã cọc', payment_count: 1, deposit_count: 1,
    })
  })
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()

  const editBatch = writeBatch(db)
  editBatch.update(doc(db, 'payments', 'pay-a'), { amount: 500, updated_at: 'edit' })
  editBatch.update(doc(db, 'orders', 'order-a'), {
    ...relationMeta('payments', 'update', 'pay-a'), payment_record_count: 1, payment_relation_revision: 2,
    paid_amount: 500, debt_amount: 500, payment_status: 'Đã cọc', computed_payment_status: 'Đã cọc',
    payment_count: 1, deposit_count: 1, collect_count: 0,
  })
  await assertSucceeds(editBatch.commit())

  const deleteBatch = writeBatch(db)
  deleteBatch.update(doc(db, 'payments', 'pay-a'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now',
  })
  deleteBatch.update(doc(db, 'orders', 'order-a'), {
    ...relationMeta('payments', 'delete', 'pay-a'), payment_record_count: 0, payment_relation_revision: 3,
    paid_amount: 0, debt_amount: 1000, payment_status: 'Chưa thanh toán', computed_payment_status: 'Chưa thanh toán',
    payment_count: 0, deposit_count: 0, collect_count: 0,
  })
  await assertSucceeds(deleteBatch.commit())
})

test('invoice create/delete cập nhật invoice_status và count cùng giao dịch', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const createBatch = writeBatch(db)
  createBatch.set(doc(db, 'invoices', 'inv-a'), {
    id: 'inv-a', order_id: 'order-a', order_code: 'order-a', invoice_number: 'HD-01',
    invoice_status: 'Đã xuất', created_by: SALE, ...ownership(), active: true, deleted: false,
  })
  createBatch.update(doc(db, 'orders', 'order-a'), {
    ...relationMeta('invoices', 'create', 'inv-a'), invoice_record_count: 1,
    invoice_relation_revision: 1, invoice_status: 'Đã xuất',
  })
  await assertSucceeds(createBatch.commit())

  const deleteBatch = writeBatch(db)
  deleteBatch.update(doc(db, 'invoices', 'inv-a'), {
    deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now',
  })
  deleteBatch.update(doc(db, 'orders', 'order-a'), {
    ...relationMeta('invoices', 'delete', 'inv-a'), invoice_record_count: 0,
    invoice_relation_revision: 2, invoice_status: 'Không xuất',
  })
  await assertSucceeds(deleteBatch.commit())
})

test('shipment create/update/delete cập nhật count và tổng phí/COD', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const createBatch = writeBatch(db)
  createBatch.set(doc(db, 'shipments', 'shp-a'), {
    id: 'shp-a', order_id: 'order-a', order_code: 'order-a', shipping_status: 'Đang giao',
    shipping_fee: 20, cod_amount: 200, created_by: SALE, ...ownership(), active: true, deleted: false,
  })
  createBatch.update(doc(db, 'orders', 'order-a'), {
    ...relationMeta('shipments', 'create', 'shp-a'), shipment_record_count: 1,
    shipment_relation_revision: 1, shipment_status: 'Đang giao', shipping_fee_total: 20, cod_amount_total: 200,
  })
  await assertSucceeds(createBatch.commit())

  const editBatch = writeBatch(db)
  editBatch.update(doc(db, 'shipments', 'shp-a'), { shipping_status: 'Đã giao', updated_at: 'edit' })
  editBatch.update(doc(db, 'orders', 'order-a'), {
    ...relationMeta('shipments', 'update', 'shp-a'), shipment_record_count: 1,
    shipment_relation_revision: 2, shipment_status: 'Đã giao', shipping_fee_total: 20, cod_amount_total: 200,
  })
  await assertSucceeds(editBatch.commit())
})

test('xóa đơn bị chặn khi còn relation, đơn zero được xóa và legacy fail-closed', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await updateDoc(doc(db, 'orders', 'order-a'), { payment_record_count: 1 })
  })
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const deletedPatch = { deleted: true, active: false, status: 'deleted', deleted_at: 'now', updated_at: 'now' }
  await assertFails(updateDoc(doc(db, 'orders', 'order-a'), deletedPatch))
  await assertFails(updateDoc(doc(db, 'orders', 'order-legacy'), deletedPatch))
  await assertSucceeds(updateDoc(doc(db, 'orders', 'order-zero'), deletedPatch))
})

test('batch lỗi một phía rollback cả child và parent', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const batch = writeBatch(db)
  batch.set(doc(db, 'payments', 'pay-forged'), {
    id: 'pay-forged', order_id: 'order-a', order_code: 'order-a', amount: 100,
    payment_status: 'Đã nhận', payment_type: 'Cọc', created_by: SALE,
    order_owner_email: 'other@example.com', order_created_by: SALE, order_sale_email: SALE,
    active: true, deleted: false,
  })
  batch.update(doc(db, 'orders', 'order-a'), {
    ...relationMeta('payments', 'create', 'pay-forged'), payment_record_count: 1, payment_relation_revision: 1,
    paid_amount: 100, debt_amount: 900, payment_status: 'Đã cọc', computed_payment_status: 'Đã cọc',
    payment_count: 1, deposit_count: 1, collect_count: 0,
  })
  await assertFails(batch.commit())
  await env.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore()
    const [paymentSnap, orderSnap] = await Promise.all([
      getDoc(doc(adminDb, 'payments', 'pay-forged')),
      getDoc(doc(adminDb, 'orders', 'order-a')),
    ])
    if (paymentSnap.exists()) throw new Error('Payment giả không được tồn tại sau rollback')
    if (orderSnap.data()?.payment_record_count !== 0) throw new Error('Parent summary phải rollback')
  })
})
