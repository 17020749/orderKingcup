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
  updateDoc,
  writeBatch,
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-order-invoice-flow'
const SALE = 'sale-invoice-flow@example.com'
const ACCOUNTANT = 'accountant-invoice-flow@example.com'
const NO_EDIT = 'invoice-viewer@example.com'
const OTHER = 'other-sale@example.com'
let env

function baseOrder(overrides = {}) {
  return {
    id: 'order-existing',
    order_code: 'SALE1-ABC001-0001',
    order_sequence: 1,
    user_code: 'SALE1',
    customer_id: 'customer-new',
    customer_code: 'ABC001',
    customer_name: 'Khách kiểm thử hóa đơn',
    owner_email: SALE,
    created_by: SALE,
    sale_email: SALE,
    order_status: 'Mới tạo',
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: '',
    payable_amount: 1000,
    actual_revenue: 1000,
    paid_amount: 0,
    debt_amount: 1000,
    payment_status: 'Chưa thanh toán',
    computed_payment_status: 'Chưa thanh toán',
    payment_count: 0,
    deposit_count: 0,
    collect_count: 0,
    invoice_status: 'Không xuất',
    relation_lock_version: 1,
    payment_record_count: 0,
    invoice_record_count: 1,
    shipment_record_count: 0,
    payment_relation_revision: 0,
    invoice_relation_revision: 1,
    shipment_relation_revision: 0,
    printing_lock_version: 1,
    printing_progress_count: 0,
    revision: 1,
    last_operation_id: 'seed-order',
    active: true,
    deleted: false,
    status: 'active',
    created_at: '2026-07-27T00:00:00.000Z',
    updated_at: '2026-07-27T00:00:00.000Z',
    ...overrides,
  }
}

function baseInvoice(overrides = {}) {
  return {
    id: 'inv-existing',
    order_id: 'order-existing',
    order_code: 'SALE1-ABC001-0001',
    invoice_number: '',
    invoice_date: '',
    invoice_amount: 1000,
    invoice_status: 'Không xuất',
    tax_code: '',
    company_name: '',
    billing_address: '',
    note: '',
    created_by: SALE,
    order_owner_email: SALE,
    order_created_by: SALE,
    order_sale_email: SALE,
    relation_revision: 1,
    last_operation_id: 'seed-order',
    active: true,
    deleted: false,
    status: 'active',
    created_at: '2026-07-27T00:00:00.000Z',
    updated_at: '2026-07-27T00:00:00.000Z',
    ...overrides,
  }
}

async function seed() {
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
      setDoc(doc(db, 'users', ACCOUNTANT), {
        email: ACCOUNTANT,
        user_code: 'ACC1',
        active: true,
        deleted: false,
        permissions_flat: [
          'page.invoices', 'orders.view_all',
          'invoices.view', 'invoices.view_all', 'invoices.edit', 'invoices.delete',
        ],
      }),
      setDoc(doc(db, 'users', NO_EDIT), {
        email: NO_EDIT,
        user_code: 'VIEW1',
        active: true,
        deleted: false,
        permissions_flat: ['page.invoices', 'orders.view_all', 'invoices.view_all'],
      }),
      setDoc(doc(db, 'users', OTHER), {
        email: OTHER,
        user_code: 'SALE2',
        active: true,
        deleted: false,
        permissions_flat: ['page.orders', 'orders.view', 'orders.edit', 'orders.delete'],
      }),
      setDoc(doc(db, 'customers', 'customer-new'), {
        id: 'customer-new',
        customer_code: 'ABC001',
        customer_name: 'Khách kiểm thử hóa đơn',
        created_by: SALE,
        active: true,
        deleted: false,
      }),
      setDoc(doc(db, 'orders', 'order-existing'), baseOrder()),
      setDoc(doc(db, 'invoices', 'inv-existing'), baseInvoice()),
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

async function createOrderWithInvoice(db, {
  invoiceStatus = 'Không xuất',
  invoiceNumber = '',
  invoiceOwnership = SALE,
  invoiceAmount = 900,
} = {}) {
  const sequenceRef = doc(db, 'order_sequences', 'customer-new')
  const orderRef = doc(db, 'orders', 'order-new')
  const invoiceRef = doc(db, 'invoices', 'inv_order-new')
  await runTransaction(db, async transaction => {
    const sequenceSnapshot = await transaction.get(sequenceRef)
    assert.equal(sequenceSnapshot.exists(), false)
    const timestamp = serverTimestamp()
    transaction.set(sequenceRef, {
      customer_id: 'customer-new',
      customer_code: 'ABC001',
      last_number: 1,
      updated_by: SALE,
      updated_at: timestamp,
      created_at: timestamp,
    })
    transaction.set(orderRef, {
      id: 'order-new',
      order_code: 'SALE1-ABC001-0001',
      order_sequence: 1,
      user_code: 'SALE1',
      customer_id: 'customer-new',
      customer_code: 'ABC001',
      customer_name: 'Khách kiểm thử hóa đơn',
      owner_email: SALE,
      created_by: SALE,
      sale_email: SALE,
      order_status: 'Mới tạo',
      warehouse_fulfillment_status: 'chua_xuat',
      warehouse_request_status: '',
      payable_amount: invoiceAmount,
      actual_revenue: 1000,
      invoice_status: invoiceStatus,
      relation_lock_version: 1,
      payment_record_count: 0,
      invoice_record_count: 1,
      shipment_record_count: 0,
      payment_relation_revision: 0,
      invoice_relation_revision: 1,
      shipment_relation_revision: 0,
      relation_last_module: 'invoices',
      relation_last_action: 'create',
      relation_last_document_id: 'inv_order-new',
      relation_updated_by: SALE,
      relation_updated_at: timestamp,
      printing_lock_version: 1,
      printing_progress_count: 0,
      revision: 1,
      last_operation_id: 'operation-create-order-new',
      active: true,
      deleted: false,
      status: 'active',
      created_at: timestamp,
      updated_at: timestamp,
    })
    transaction.set(invoiceRef, {
      id: 'inv_order-new',
      order_id: 'order-new',
      order_code: 'SALE1-ABC001-0001',
      invoice_number: invoiceNumber,
      invoice_date: '',
      invoice_amount: invoiceAmount,
      invoice_status: invoiceStatus,
      tax_code: '',
      company_name: '',
      billing_address: '',
      note: '',
      created_by: SALE,
      order_owner_email: invoiceOwnership,
      order_created_by: SALE,
      order_sale_email: SALE,
      relation_revision: 1,
      last_operation_id: 'operation-create-order-new',
      active: true,
      deleted: false,
      status: 'active',
      created_at: timestamp,
      updated_at: timestamp,
    })
  })
}

function saleStatusBatch(db, nextStatus, {
  includeParent = true,
  includeChild = true,
  childExtra = {},
  operationId = 'operation-sale-status',
} = {}) {
  const batch = writeBatch(db)
  const timestamp = serverTimestamp()
  if (includeChild) {
    batch.update(doc(db, 'invoices', 'inv-existing'), {
      invoice_status: nextStatus,
      relation_revision: 2,
      last_operation_id: operationId,
      updated_at: timestamp,
      ...childExtra,
    })
  }
  if (includeParent) {
    batch.update(doc(db, 'orders', 'order-existing'), {
      invoice_status: nextStatus,
      invoice_record_count: 1,
      invoice_relation_revision: 2,
      relation_lock_version: 1,
      relation_last_module: 'invoices',
      relation_last_action: 'update',
      relation_last_document_id: 'inv-existing',
      relation_updated_by: SALE,
      relation_updated_at: timestamp,
      revision: 2,
      last_operation_id: operationId,
      updated_at: timestamp,
    })
  }
  return batch
}

function accountantStatusBatch(db, {
  nextStatus = 'Đã xuất',
  invoiceNumber = 'HD-0001',
  invoiceDate = '2026-07-27',
  amount = 1000,
  actor = ACCOUNTANT,
} = {}) {
  const batch = writeBatch(db)
  const timestamp = serverTimestamp()
  batch.update(doc(db, 'invoices', 'inv-existing'), {
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    invoice_amount: amount,
    invoice_status: nextStatus,
    relation_revision: 2,
    last_operation_id: 'operation-accounting-status',
    updated_at: timestamp,
  })
  batch.update(doc(db, 'orders', 'order-existing'), {
    invoice_status: nextStatus,
    invoice_record_count: 1,
    invoice_relation_revision: 2,
    relation_lock_version: 1,
    relation_last_module: 'invoices',
    relation_last_action: 'update',
    relation_last_document_id: 'inv-existing',
    relation_updated_by: actor,
    relation_updated_at: timestamp,
    updated_at: timestamp,
  })
  return batch
}

test('Sale có orders.create nhưng không có invoices.create vẫn tạo order kèm invoice', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertSucceeds(createOrderWithInvoice(db, { invoiceStatus: 'Yêu cầu xuất' }))
  assert.equal((await getDoc(doc(db, 'orders', 'order-new'))).data().invoice_record_count, 1)
  assert.equal((await getDoc(doc(db, 'invoices', 'inv_order-new'))).data().invoice_status, 'Yêu cầu xuất')
})

test('auto invoice từ order từ chối Đã xuất, số hóa đơn có sẵn và ownership giả; toàn bộ transaction rollback', async () => {
  for (const invalid of [
    { invoiceStatus: 'Đã xuất' },
    { invoiceNumber: 'HD-KHONG-DUOC-TAO' },
    { invoiceOwnership: OTHER },
  ]) {
    await env.clearFirestore()
    await seed()
    const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
    await assertFails(createOrderWithInvoice(db, invalid))
    await env.withSecurityRulesDisabled(async context => {
      const adminDb = context.firestore()
      assert.equal((await getDoc(doc(adminDb, 'orders', 'order-new'))).exists(), false)
      assert.equal((await getDoc(doc(adminDb, 'invoices', 'inv_order-new'))).exists(), false)
      assert.equal((await getDoc(doc(adminDb, 'order_sequences', 'customer-new'))).exists(), false)
    })
  }
})

test('Sale đổi Không xuất sang Yêu cầu xuất bằng parent-child transaction', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertSucceeds(saleStatusBatch(db, 'Yêu cầu xuất').commit())
  assert.equal((await getDoc(doc(db, 'orders', 'order-existing'))).data().invoice_status, 'Yêu cầu xuất')
  assert.equal((await getDoc(doc(db, 'invoices', 'inv-existing'))).data().invoice_status, 'Yêu cầu xuất')
})

test('Sale đổi Yêu cầu xuất về Không xuất', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await updateDoc(doc(db, 'orders', 'order-existing'), { invoice_status: 'Yêu cầu xuất' })
    await updateDoc(doc(db, 'invoices', 'inv-existing'), { invoice_status: 'Yêu cầu xuất' })
  })
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertSucceeds(saleStatusBatch(db, 'Không xuất').commit())
})

test('Sale không được ghi child hoặc parent riêng, sửa field kế toán hay chuyển Đã xuất', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertFails(saleStatusBatch(db, 'Yêu cầu xuất', { includeParent: false }).commit())
  await assertFails(saleStatusBatch(db, 'Yêu cầu xuất', { includeChild: false }).commit())
  await assertFails(saleStatusBatch(db, 'Yêu cầu xuất', { childExtra: { invoice_number: 'FORGED' } }).commit())
  await assertFails(saleStatusBatch(db, 'Đã xuất').commit())
})

test('hóa đơn Đã xuất khóa hoàn toàn nhánh cập nhật trạng thái của Sale', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await updateDoc(doc(db, 'orders', 'order-existing'), { invoice_status: 'Đã xuất' })
    await updateDoc(doc(db, 'invoices', 'inv-existing'), {
      invoice_status: 'Đã xuất', invoice_number: 'HD-LOCK', invoice_date: '2026-07-27',
    })
  })
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertFails(saleStatusBatch(db, 'Không xuất').commit())
  await assertFails(saleStatusBatch(db, 'Yêu cầu xuất').commit())
})

test('sửa nội dung order bình thường không cần ghi invoice và không làm đổi Đã xuất', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await updateDoc(doc(db, 'orders', 'order-existing'), { invoice_status: 'Đã xuất' })
    await updateDoc(doc(db, 'invoices', 'inv-existing'), {
      invoice_status: 'Đã xuất', invoice_number: 'HD-LOCK', invoice_date: '2026-07-27',
    })
  })
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'orders', 'order-existing'), {
    note: 'Sale vẫn được sửa nội dung đơn',
    revision: 2,
    last_operation_id: 'normal-order-edit',
    updated_at: serverTimestamp(),
  }))
  assert.equal((await getDoc(doc(db, 'orders', 'order-existing'))).data().invoice_status, 'Đã xuất')
  assert.equal((await getDoc(doc(db, 'invoices', 'inv-existing'))).data().invoice_status, 'Đã xuất')
})

test('kế toán có invoices.edit và view_all được chuyển Đã xuất', async () => {
  const db = env.authenticatedContext(ACCOUNTANT, { email: ACCOUNTANT }).firestore()
  await assertSucceeds(accountantStatusBatch(db).commit())
  const invoice = (await getDoc(doc(db, 'invoices', 'inv-existing'))).data()
  assert.equal(invoice.invoice_status, 'Đã xuất')
  assert.equal(invoice.invoice_number, 'HD-0001')
})

test('kế toán thiếu invoices.edit bị chặn nhưng dữ liệu số tiền, số và ngày không còn bắt buộc', async () => {
  const viewerDb = env.authenticatedContext(NO_EDIT, { email: NO_EDIT }).firestore()
  await assertFails(accountantStatusBatch(viewerDb, { actor: NO_EDIT }).commit())

  const accountantDb = env.authenticatedContext(ACCOUNTANT, { email: ACCOUNTANT }).firestore()
  await assertSucceeds(accountantStatusBatch(accountantDb, { invoiceNumber: '', invoiceDate: '', amount: -1 }).commit())
})

test('Sale chỉ đọc invoice thuộc order mình; kế toán view_all đọc được toàn bộ', async () => {
  const saleDb = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertSucceeds(getDoc(doc(saleDb, 'invoices', 'inv-existing')))

  const otherDb = env.authenticatedContext(OTHER, { email: OTHER }).firestore()
  await assertFails(getDoc(doc(otherDb, 'invoices', 'inv-existing')))

  const accountantDb = env.authenticatedContext(ACCOUNTANT, { email: ACCOUNTANT }).firestore()
  await assertSucceeds(getDoc(doc(accountantDb, 'invoices', 'inv-existing')))
})

test('xóa order có invoice được phép khi cascade invoice trong cùng batch', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const batch = writeBatch(db)
  const timestamp = serverTimestamp()
  batch.update(doc(db, 'invoices', 'inv-existing'), {
    deleted: true, active: false, status: 'deleted', deleted_at: timestamp, updated_at: timestamp,
  })
  batch.update(doc(db, 'orders', 'order-existing'), {
    deleted: true, active: false, status: 'deleted', deleted_at: timestamp, updated_at: timestamp,
  })
  await assertSucceeds(batch.commit())
})

test('invoice cascade không tự cấp quyền xóa độc lập và blocker payment vẫn giữ nguyên', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertFails(updateDoc(doc(db, 'invoices', 'inv-existing'), {
    deleted: true, active: false, status: 'deleted', deleted_at: serverTimestamp(), updated_at: serverTimestamp(),
  }))

  await env.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'orders', 'order-existing'), { payment_record_count: 1 })
  })
  const batch = writeBatch(db)
  const timestamp = serverTimestamp()
  batch.update(doc(db, 'invoices', 'inv-existing'), {
    deleted: true, active: false, status: 'deleted', deleted_at: timestamp, updated_at: timestamp,
  })
  batch.update(doc(db, 'orders', 'order-existing'), {
    deleted: true, active: false, status: 'deleted', deleted_at: timestamp, updated_at: timestamp,
  })
  await assertFails(batch.commit())
})
