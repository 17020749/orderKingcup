import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  FIRESTORE_WRITE_LIMIT,
  assertAtomicOrderWriteLimit,
  assertExpectedOrderRevision,
  buildOrderOperationId,
  estimateAtomicOrderWrites,
  nextOrderRevision,
  planAtomicOrderItems,
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
  }), 5) // sequence + order + activity + 2 items

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
  assert.match(page, /saveOrderAtomic\(/)
  assert.doesNotMatch(page, /commitWriteChunks/)
  assert.doesNotMatch(page, /await orderBatch\.commit\(\)/)
})
