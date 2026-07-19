import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  buildPrintingLockFields,
  isActivePrintingProgress,
  printingDeleteBlocker,
  printingCountsByOrder,
  printingLockReady,
} from '../utils/orderPrintingDeleteLock.mjs'

const readyOrder = {
  id: 'order-a',
  printing_lock_version: 1,
  printing_progress_count: 0,
}

test('tiến độ in còn hiệu lực chặn xóa và nêu rõ số tiến độ', () => {
  const message = printingDeleteBlocker(readyOrder, [
    { id: 'print-a', order_id: 'order-a', active: true, deleted: false },
  ])
  assert.match(message, /1 tiến độ in ấn còn hiệu lực/)
})

test('tiến độ đã xóa mềm không còn khóa đơn', () => {
  assert.equal(isActivePrintingProgress({ active: false, deleted: true, status: 'deleted' }), false)
  assert.equal(printingDeleteBlocker(readyOrder, [
    { id: 'print-a', order_id: 'order-a', active: false, deleted: true, status: 'deleted' },
  ]), '')
})

test('đơn legacy thiếu phiên bản khóa bị fail closed', () => {
  const message = printingDeleteBlocker({ id: 'legacy-order' }, [])
  assert.match(message, /chưa được đồng bộ khóa tiến độ in/)
  assert.equal(printingLockReady({ id: 'legacy-order' }), false)
})

test('count lưu trên đơn lớn hơn không vẫn chặn dù query chưa thấy tiến độ', () => {
  const message = printingDeleteBlocker({
    id: 'order-a',
    printing_lock_version: 1,
    printing_progress_count: 2,
  }, [])
  assert.match(message, /ghi nhận 2 tiến độ/)
})

test('đếm tiến độ hoạt động theo từng đơn để đối soát', () => {
  const counts = printingCountsByOrder(
    [{ id: 'order-a' }, { id: 'order-b' }],
    [
      { id: 'a1', order_id: 'order-a', active: true, deleted: false },
      { id: 'a2', order_id: 'order-a', active: false, deleted: true },
      { id: 'b1', order_id: 'order-b', status: 'active' },
    ],
  )
  assert.equal(counts.get('order-a'), 1)
  assert.equal(counts.get('order-b'), 1)
})

test('payload khóa chỉ chấp nhận count không âm và thao tác hợp lệ', () => {
  assert.deepEqual(buildPrintingLockFields({
    count: 1,
    action: 'create',
    printOrderId: 'print-a',
    actor: 'Printer@Example.com',
    updatedAt: 'now',
  }), {
    printing_progress_count: 1,
    printing_lock_version: 1,
    printing_last_action: 'create',
    printing_last_print_order_id: 'print-a',
    printing_lock_updated_by: 'printer@example.com',
    printing_lock_updated_at: 'now',
  })
  assert.throws(() => buildPrintingLockFields({ count: -1, action: 'delete' }), /không hợp lệ/)
})

test('trang đơn tải print_orders theo order_id và kiểm tra lại ngay trước xóa', () => {
  const page = readFileSync('pages/orders.vue', 'utf8')
  const loader = readFileSync('composables/useOrderPrintingDeleteGuard.ts', 'utf8')
  assert.match(page, /loadPrintingProgressForOrders/)
  assert.match(page, /loadPrintingProgressForOrder\(row\.id\)/)
  assert.match(page, /printingDeleteBlocker/)
  assert.match(loader, /where\('order_id', 'in', orderIds\)/)
})

test('luồng in cập nhật khóa parent khi tạo, xóa và có đối soát admin', () => {
  const progress = readFileSync('composables/usePrintingProgress.ts', 'utf8')
  const printingPage = readFileSync('pages/printing.vue', 'utf8')
  assert.match(progress, /buildPrintingLockFields/)
  assert.match(progress, /runTransaction/)
  assert.match(progress, /action: 'create'/)
  assert.match(progress, /action: 'delete'/)
  assert.match(progress, /reconcilePrintingLocks/)
  assert.match(printingPage, /Đồng bộ khóa xóa đơn/)
})

test('Rules ưu tiên nhánh rẻ để không vượt giới hạn biểu thức', () => {
  const rules = readFileSync('firestore.rules', 'utf8')
  assert.match(rules, /allow update: if orderPrintingSummaryUpdateAllowed\(docId\)\s+\|\| orderWarehouseSummaryUpdateAllowed\(\)/)
  assert.match(rules, /Normal edits are evaluated before the more expensive atomic delete path/)
  assert.match(rules, /Normal item edits are evaluated before the atomic soft-delete path/)
})
