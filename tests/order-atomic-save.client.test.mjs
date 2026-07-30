import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  FIRESTORE_WRITE_LIMIT,
  assertAtomicOrderWriteLimit,
  assertExpectedOrderRevision,
  buildOrderItemLifecyclePatch,
  buildOrderOperationId,
  estimateAtomicOrderWrites,
  nextOrderRevision,
  orderCustomerReassignmentBlocker,
  planAtomicOrderItems,
  preservePersistedOrderIdentityForEdit,
} from '../utils/orderAtomicSave.mjs'

test('lập kế hoạch upsert và xóa mềm item trong cùng giao dịch', () => {
  const plan = planAtomicOrderItems(
    [
      { id: 'item-keep', product_code: 'SP-A' },
      { id: 'item-remove', product_code: 'SP-B' },
    ],
    [
      { id: 'item-keep', product_code: 'SP-A2' },
      { id: 'item-new', product_code: 'SP-C' },
    ],
  )

  assert.deepEqual(plan.upsertItems.map(item => [item.id, item.isNew]), [
    ['item-keep', false],
    ['item-new', true],
  ])
  assert.deepEqual(plan.removedItems.map(item => item.id), ['item-remove'])
})

test('item legacy đang tồn tại không bị tự thêm lifecycle khi Sale sửa đơn', () => {
  assert.deepEqual(buildOrderItemLifecyclePatch(false), {})
  assert.deepEqual(buildOrderItemLifecyclePatch(true), {
    status: 'active',
    active: true,
    deleted: false,
  })
})

test('chặn dòng sản phẩm thiếu ID hoặc trùng ID trước khi gọi Firestore', () => {
  assert.throws(
    () => planAtomicOrderItems([], [{ id: 'item-a' }, { id: 'item-a' }]),
    /thiếu ID hoặc bị trùng ID/,
  )
  assert.throws(
    () => planAtomicOrderItems([], [{ id: '' }]),
    /thiếu ID hoặc bị trùng ID/,
  )
})

test('tính đúng số write cho tạo và sửa đơn', () => {
  assert.equal(estimateAtomicOrderWrites({
    mode: 'create',
    existingItems: [],
    nextItems: [{ id: 'a' }, { id: 'b' }],
  }), 6) // sequence + order + invoice + activity + 2 items

  assert.equal(estimateAtomicOrderWrites({
    mode: 'edit',
    existingItems: [{ id: 'a' }, { id: 'remove' }],
    nextItems: [{ id: 'a' }, { id: 'new' }],
  }), 5) // order + activity + 2 upsert + 1 soft delete
})

test('chặn đơn vượt giới hạn write thay vì chia batch gây lưu dở dang', () => {
  const tooManyItems = Array.from({ length: FIRESTORE_WRITE_LIMIT }, (_, index) => ({ id: `item-${index}` }))
  assert.throws(
    () => assertAtomicOrderWriteLimit({ mode: 'create', existingItems: [], nextItems: tooManyItems }),
    /vượt giới hạn 500/,
  )
})

test('revision tăng đúng một lần và phát hiện form đã cũ', () => {
  assert.equal(nextOrderRevision(undefined), 1)
  assert.equal(nextOrderRevision(4), 5)
  assert.equal(assertExpectedOrderRevision(3, 3), 3)
  assert.throws(
    () => assertExpectedOrderRevision(3, 4),
    /đã được cập nhật ở một thiết bị hoặc phiên khác/,
  )
})

test('operation id ổn định theo tham số và không chứa ký tự không an toàn', () => {
  assert.equal(
    buildOrderOperationId('ord/ABC', 1_000, 0.25),
    'order_ordABC_rs_5cwg',
  )
})

test('đổi khách chỉ được phép khi toàn bộ khóa quan hệ của đơn ở trạng thái an toàn', () => {
  const safeOrder = {
    payment_record_count: 0,
    warehouse_fulfillment_status: 'chua_xuat',
    warehouse_request_status: '',
    printing_progress_count: 0,
    shipment_record_count: 0,
    invoice_status: 'Không xuất',
    relation_lock_version: 1,
    invoice_record_count: 1,
  }
  assert.equal(orderCustomerReassignmentBlocker(safeOrder), '')
  assert.match(orderCustomerReassignmentBlocker({ ...safeOrder, payment_record_count: 1 }), /thanh toán/)
  assert.match(orderCustomerReassignmentBlocker({ ...safeOrder, shipment_record_count: 1 }), /vận chuyển/)
  assert.match(orderCustomerReassignmentBlocker({ ...safeOrder, invoice_status: 'Đã xuất' }), /hóa đơn đã xuất/)
})

test('đổi khách giữ nguyên mã đơn và ownership nhưng thay customer identity đã xác nhận', () => {
  const persisted = {
    order_code: 'SALE1-OLD001-0001',
    order_sequence: 1,
    user_code: 'SALE1',
    customer_id: 'customer-old',
    customer_code: 'OLD001',
    owner_email: 'sale@example.com',
    created_by: 'sale@example.com',
    sale_email: 'sale@example.com',
    created_at: 'old-time',
  }
  const payload = preservePersistedOrderIdentityForEdit({
    ...persisted,
    customer_id: 'customer-new',
    customer_code: 'NEW002',
    customer_name: 'Khách mới',
  }, persisted, { allowCustomerChange: true })

  assert.equal(payload.customer_id, 'customer-new')
  assert.equal(payload.customer_code, 'NEW002')
  assert.equal(payload.customer_name, 'Khách mới')
  assert.equal(payload.order_code, persisted.order_code)
  assert.equal(payload.owner_email, persisted.owner_email)
})

test('client thực tế dùng một transaction cho order, items, sequence và activity', () => {
  const composable = readFileSync('composables/useAtomicOrderSave.ts', 'utf8')
  const page = readFileSync('pages/orders.vue', 'utf8')

  assert.match(composable, /await runTransaction\(db, async transaction =>/)
  assert.match(composable, /transaction\.set\(sequenceRef/)
  assert.match(composable, /transaction\.set\(orderRef/)
  assert.match(composable, /transaction\.set\(doc\(db, 'order_items'/)
  assert.match(composable, /transaction\.update\(doc\(db, 'order_items'/)
  assert.match(composable, /transaction\.set\(activityRef/)
  assert.match(composable, /assertExpectedOrderRevision/)
  assert.match(composable, /buildOrderItemLifecyclePatch\(item\.isNew\)/)
  assert.match(page, /saveOrderAtomic\(/)
  assert.doesNotMatch(page, /commitWriteChunks/)
  assert.doesNotMatch(page, /await orderBatch\.commit\(\)/)
})

test('sau commit client đọc lại order và order_items chuẩn trước khi cho sửa tiếp', () => {
  const page = readFileSync('pages/orders.vue', 'utf8')
  const scopedQueries = readFileSync('composables/useScopedQueries.ts', 'utf8')

  assert.match(scopedQueries, /async function loadPersistedOrder\(orderId: string\)/)
  assert.match(scopedQueries, /getDocFromServer\(doc\(db, 'orders', id\)\)/)
  assert.match(scopedQueries, /getDocsFromServer\(query\(/)
  assert.match(scopedQueries, /where\('order_id', '==', id\)/)

  const commitIndex = page.indexOf('await saveOrderAtomic({')
  const syncIndex = page.indexOf('await synchronizePersistedOrder(form.id)')
  const successIndex = page.indexOf("showToast(editing.value ? 'Đã cập nhật đơn hàng' : 'Đã thêm đơn hàng'")
  assert.ok(commitIndex >= 0)
  assert.ok(syncIndex > commitIndex)
  assert.ok(successIndex > syncIndex)
  assert.match(page, /commitSucceeded = true/)
  assert.doesNotMatch(page, /itemsByOrder\.value\[form\.id\]\s*=/)
  assert.doesNotMatch(page, /const localOrder\s*=/)
})

test('lỗi đồng bộ sau commit không bị báo thành lưu thất bại hoặc cho sửa row tạm', () => {
  const page = readFileSync('pages/orders.vue', 'utf8')

  assert.match(page, /markOrderSyncPending\(form\.id, true\)/)
  assert.match(page, /synchronized = await loadRows\(true\)/)
  assert.match(page, /commitSucceeded\s*\?\s*'Đơn đã được lưu\. Vui lòng làm mới dữ liệu trước khi sửa\.'/)
  assert.match(page, /return !isOrderSyncPending\(row\) && orderActionDecision\('edit', row\)\.allowed/)
  assert.match(page, /scopeSatisfied: editing\.value[\s\S]*orderActionDecision\('edit', editing\.value\)\.allowed/)
})
