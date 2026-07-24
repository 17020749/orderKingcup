import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  buildOrderRelationPatch,
  buildReconciledOrderRelationPatch,
  computeInvoiceRelationSummary,
  computePaymentRelationSummary,
  computeShipmentRelationSummary,
  orderRelationDeleteBlocker,
  relationLockReady,
  relationReconcileNeeded,
  removeRelationRecord,
  replaceRelationRecord,
  selectCanonicalInvoice,
} from '../utils/orderRelationState.mjs'

const readyOrder = {
  id: 'order-a',
  actual_revenue: 1000,
  relation_lock_version: 1,
  payment_record_count: 0,
  invoice_record_count: 0,
  shipment_record_count: 0,
  payment_relation_revision: 0,
  invoice_relation_revision: 0,
  shipment_relation_revision: 0,
}

test('tạo thanh toán đã nhận cập nhật count, công nợ và revision', () => {
  const records = [{ id: 'pay-a', order_id: 'order-a', payment_type: 'Cọc', payment_status: 'Đã nhận', amount: 300, active: true, deleted: false }]
  const patch = buildOrderRelationPatch({
    module: 'payments', order: readyOrder, records, action: 'create', documentId: 'pay-a', actor: 'Sale@Example.com', updatedAt: 'now'
  })
  assert.equal(patch.payment_record_count, 1)
  assert.equal(patch.paid_amount, 300)
  assert.equal(patch.debt_amount, 700)
  assert.equal(patch.payment_status, 'Đã cọc')
  assert.equal(patch.payment_relation_revision, 1)
  assert.equal(patch.relation_updated_by, 'sale@example.com')
})

test('công nợ trừ số tiền giảm giá trước khi trừ thanh toán', () => {
  const summary = computePaymentRelationSummary({ ...readyOrder, discount_amount: 150 }, [
    { id: 'pay-a', payment_status: 'Đã nhận', amount: 300 },
  ])
  assert.equal(summary.paid_amount, 300)
  assert.equal(summary.debt_amount, 550)
})

test('sửa trạng thái thanh toán tính lại tổng hợp từ toàn bộ phiếu hoạt động', () => {
  const summary = computePaymentRelationSummary(readyOrder, [
    { id: 'pay-a', payment_type: 'Cọc', payment_status: 'Đã nhận', amount: 200 },
    { id: 'pay-b', payment_type: 'Thu 1', payment_status: 'Đã nhận', amount: 300 },
    { id: 'pay-c', payment_type: 'Thu 2', payment_status: 'Giao dịch lỗi', amount: 900 },
  ])
  assert.deepEqual(summary, {
    payment_record_count: 3,
    paid_amount: 500,
    debt_amount: 500,
    payment_status: 'Đã cọc + thanh toán 1 phần',
    computed_payment_status: 'Đã cọc + thanh toán 1 phần',
    payment_count: 2,
    deposit_count: 1,
    collect_count: 1,
  })
})

test('xóa phiếu khỏi tập tính toán trả công nợ về đúng giá trị', () => {
  const rows = [
    { id: 'pay-a', payment_status: 'Đã nhận', amount: 400 },
    { id: 'pay-b', payment_status: 'Đã nhận', amount: 100 },
  ]
  const next = removeRelationRecord(rows, 'pay-a')
  assert.equal(computePaymentRelationSummary(readyOrder, next).paid_amount, 100)
  assert.equal(computePaymentRelationSummary(readyOrder, next).payment_record_count, 1)
})

test('dữ liệu trùng legacy chọn hóa đơn mới nhất để migration giữ lại', () => {
  const invoices = [
    { id: 'inv-a', invoice_date: '2026-07-01', updated_at: '2026-07-03', invoice_status: 'HĐ nháp' },
    { id: 'inv-b', invoice_date: '2026-07-02', updated_at: '2026-07-02', invoice_status: 'Đã xuất' },
  ]
  const summary = computeInvoiceRelationSummary(invoices)
  assert.equal(selectCanonicalInvoice(invoices)?.id, 'inv-b')
  assert.deepEqual(summary, { invoice_record_count: 2, invoice_status: 'Đã xuất' })
  assert.deepEqual(computeInvoiceRelationSummary([]), { invoice_record_count: 0, invoice_status: 'Không xuất' })
})

test('hóa đơn cùng ngày ưu tiên updated_at rồi ID', () => {
  const invoices = [
    { id: 'inv-a', invoice_date: '2026-07-02', updated_at: '2026-07-03' },
    { id: 'inv-b', invoice_date: '2026-07-02', updated_at: '2026-07-04' },
  ]
  assert.equal(selectCanonicalInvoice(invoices)?.id, 'inv-b')
})

test('vận chuyển tổng hợp phí, COD và trạng thái bản ghi mới nhất', () => {
  const summary = computeShipmentRelationSummary([
    { id: 'shp-a', shipped_date: '2026-07-01', shipping_fee: 20, cod_amount: 100, shipping_status: 'Đang giao' },
    { id: 'shp-b', shipped_date: '2026-07-02', shipping_fee: 30, cod_amount: 200, shipping_status: 'Đã giao' },
  ])
  assert.deepEqual(summary, {
    shipment_record_count: 2,
    shipment_status: 'Đã giao',
    shipping_fee_total: 50,
    cod_amount_total: 300,
  })
})

test('khóa xóa fail-closed cho đơn legacy và nêu từng dữ liệu còn hoạt động', () => {
  assert.match(orderRelationDeleteBlocker({ id: 'legacy' }), /chưa hoàn tất đồng bộ khóa/)
  assert.equal(relationLockReady(readyOrder), true)
  assert.equal(orderRelationDeleteBlocker(readyOrder), '')
  assert.match(orderRelationDeleteBlocker({
    ...readyOrder,
    payment_record_count: 2,
    invoice_record_count: 1,
    shipment_record_count: 1,
  }), /2 phiếu thanh toán, 1 hóa đơn, 1 bản ghi vận chuyển/)
})

test('đối soát khởi tạo đủ ba count và giữ revision không âm', () => {
  const patch = buildReconciledOrderRelationPatch({
    order: { ...readyOrder, payment_relation_revision: -2 },
    payments: [{ id: 'pay-a', payment_status: 'Đã nhận', amount: 100 }],
    invoices: [{ id: 'inv-a', invoice_status: 'HĐ nháp' }],
    shipments: [{ id: 'shp-a', shipping_status: 'Chờ giao', shipping_fee: 10 }],
    actor: 'admin@example.com',
    updatedAt: 'now',
  })
  assert.equal(patch.relation_lock_version, 1)
  assert.equal(patch.payment_record_count, 1)
  assert.equal(patch.invoice_record_count, 1)
  assert.equal(patch.shipment_record_count, 1)
  assert.equal(patch.payment_relation_revision, 0)
})

test('đối soát chạy ngầm chỉ ghi khi dữ liệu khóa thực sự lệch', () => {
  const patch = buildReconciledOrderRelationPatch({
    order: readyOrder,
    actor: 'admin@example.com',
    updatedAt: 'now',
  })
  assert.equal(relationReconcileNeeded(readyOrder, patch), true)
  assert.equal(relationReconcileNeeded({ ...readyOrder, ...patch }, patch), false)
})

test('thay chứng từ theo ID không làm trùng dữ liệu client', () => {
  const next = replaceRelationRecord([{ id: 'a', amount: 1 }, { id: 'b', amount: 2 }], { id: 'a', amount: 3 })
  assert.deepEqual(next, [{ id: 'b', amount: 2 }, { id: 'a', amount: 3 }])
})

test('source thật dùng transaction nguyên tử cho ba collection quan hệ đơn', () => {
  const composable = readFileSync('composables/useAtomicOrderRelations.ts', 'utf8')
  const payments = readFileSync('pages/payments.vue', 'utf8')
  const invoices = readFileSync('pages/invoices.vue', 'utf8')
  const shipments = readFileSync('pages/shipments.vue', 'utf8')
  const orders = readFileSync('pages/orders.vue', 'utf8')
  const scopedQueries = readFileSync('composables/useScopedQueries.ts', 'utf8')
  const migration = readFileSync('scripts/dedupe-order-invoices.mjs', 'utf8')

  assert.match(composable, /runTransaction/)
  assert.match(composable, /transaction\.update\(orderRef/)
  assert.match(composable, /transaction\.set\(activityRef/)
  for (const { source, collectionName } of [
    { source: payments, collectionName: 'payments' },
    { source: invoices, collectionName: 'invoices' },
    { source: shipments, collectionName: 'shipments' },
  ]) {
    assert.match(source, /mutateOrderRelation/)
    assert.doesNotMatch(source, new RegExp(`saveDoc\\(['\"]${collectionName}['\"]`))
    assert.doesNotMatch(source, new RegExp(`softDeleteDoc\\(['\"]${collectionName}['\"]`))
  }
  assert.match(orders, /orderRelationDeleteBlocker/)
  assert.match(orders, /reconcileRelationLocksInBackground/)
  assert.doesNotMatch(orders, /@click="reconcileRelationLocks"/)
  assert.doesNotMatch(orders, />Đồng bộ khóa liên kết đơn</)
  assert.match(composable, /relationReconcileNeeded/)
  assert.match(orders, /relation_lock_version: 1/)
  assert.match(orders, /discount_amount/)
  assert.doesNotMatch(orders, /v-model="form\.invoice_status"/)
  assert.match(orders, /invoice_status: 'Không xuất'/)
  assert.match(invoices, /availableOrders/)
  assert.match(invoices, /invoice_record_count/)
  assert.match(composable, /DUPLICATE_ACTIVE_INVOICE_MESSAGE/)
  assert.match(migration, /Dry-run only/)
  assert.match(migration, /--apply/)
  assert.match(orders, /loadScopedExportRequestsForOrders,\s*loadScopedExportRequests,/)
  assert.match(scopedQueries, /payments\.create[\s\S]*fetchByFieldValues<PaymentDoc>\('payments', 'order_id', orderIds\)/)
  assert.match(shipments, /SearchableSelect/)
  assert.match(shipments, /customer_pays_shipping/)
  assert.match(shipments, /company_shipping_revenue_mode/)
  assert.match(shipments, /receiver_address/)
})
