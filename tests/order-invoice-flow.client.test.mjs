import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ACCOUNTING_INVOICE_STATUSES,
  SALE_INVOICE_STATUSES,
  assertSaleInvoiceStatus,
  buildOrderInvoiceId,
  canSaleTransitionInvoiceStatus,
  invoiceStatusChangeRequested,
  normalizeInvoiceStatus,
  validateAccountingInvoice,
} from '../utils/orderInvoiceFlow.mjs'
import { estimateAtomicOrderWrites } from '../utils/orderAtomicSave.mjs'

test('chuẩn hóa đúng trạng thái legacy và giới hạn trạng thái của Sale', () => {
  assert.deepEqual(SALE_INVOICE_STATUSES, ['Không xuất', 'Yêu cầu xuất'])
  assert.deepEqual(ACCOUNTING_INVOICE_STATUSES, ['Không xuất', 'Yêu cầu xuất', 'Đã xuất'])
  assert.equal(normalizeInvoiceStatus('Khách lẻ'), 'Không xuất')
  assert.equal(normalizeInvoiceStatus('HĐ nháp'), 'Yêu cầu xuất')
  assert.equal(assertSaleInvoiceStatus('Không xuất'), 'Không xuất')
  assert.equal(assertSaleInvoiceStatus('Yêu cầu xuất'), 'Yêu cầu xuất')
  assert.throws(() => assertSaleInvoiceStatus('Đã xuất'), /Sale chỉ được chọn/)
})

test('Sale chỉ chuyển hai chiều trước khi hóa đơn đã xuất', () => {
  assert.equal(canSaleTransitionInvoiceStatus('Không xuất', 'Yêu cầu xuất'), true)
  assert.equal(canSaleTransitionInvoiceStatus('Yêu cầu xuất', 'Không xuất'), true)
  assert.equal(canSaleTransitionInvoiceStatus('Đã xuất', 'Không xuất'), false)
  assert.equal(canSaleTransitionInvoiceStatus('Đã xuất', 'Yêu cầu xuất'), false)
  assert.equal(invoiceStatusChangeRequested('Khách lẻ', 'Không xuất'), false)
  assert.equal(invoiceStatusChangeRequested('HĐ nháp', 'Yêu cầu xuất'), false)
})

test('ID hóa đơn tự động ổn định và an toàn theo order', () => {
  assert.equal(buildOrderInvoiceId('ord-001'), 'inv_ord-001')
  assert.equal(buildOrderInvoiceId('ord/001'), 'inv_ord001')
  assert.throws(() => buildOrderInvoiceId('///'), /Thiếu ID đơn hàng/)
})

test('validation kế toán bắt buộc dữ liệu khi chuyển Đã xuất', () => {
  assert.equal(validateAccountingInvoice({ invoice_status: 'Không xuất', invoice_amount: 0 }), '')
  assert.equal(validateAccountingInvoice({ invoice_status: 'Yêu cầu xuất', invoice_amount: 100 }), '')
  assert.match(validateAccountingInvoice({ invoice_status: 'Đã xuất', invoice_amount: 100 }), /số hóa đơn/)
  assert.match(validateAccountingInvoice({ invoice_status: 'Đã xuất', invoice_amount: 100, invoice_number: 'HD-01' }), /ngày hóa đơn/)
  assert.equal(validateAccountingInvoice({
    invoice_status: 'Đã xuất', invoice_amount: 100, invoice_number: 'HD-01', invoice_date: '2026-07-27',
  }), '')
  assert.match(validateAccountingInvoice({ invoice_status: 'Yêu cầu xuất', invoice_amount: -1 }), /không được âm/)
})

test('ước lượng write tính thêm invoice nhưng không tăng đường sửa order bình thường', () => {
  assert.equal(estimateAtomicOrderWrites({
    mode: 'create', existingItems: [], nextItems: [{ id: 'a' }, { id: 'b' }],
  }), 6)
  assert.equal(estimateAtomicOrderWrites({
    mode: 'edit', existingItems: [{ id: 'a' }], nextItems: [{ id: 'a' }],
  }), 3)
  assert.equal(estimateAtomicOrderWrites({
    mode: 'edit', existingItems: [{ id: 'a' }], nextItems: [{ id: 'a' }], updateInvoiceStatus: true,
  }), 4)
})

test('source order tạo invoice nguyên tử và chỉ update invoice khi có mutation', () => {
  const composable = readFileSync('composables/useAtomicOrderSave.ts', 'utf8')
  const orders = readFileSync('pages/orders.vue', 'utf8')

  assert.match(composable, /Đơn hàng mới phải tạo kèm một bản ghi hóa đơn/)
  assert.match(composable, /transaction\.set\(invoiceRef/)
  assert.match(composable, /transaction\.update\(invoiceRef/)
  assert.match(composable, /invoiceMutation\?\.mode === 'status_update'/)
  assert.match(composable, /canSaleTransitionInvoiceStatus/)
  assert.match(orders, /v-model="form\.invoice_status"/)
  assert.match(orders, /:disabled="invoiceStatusLocked"/)
  assert.match(orders, /loadScopedInvoicesForOrders/)
  assert.match(orders, /invoiceMutation,/)
  assert.match(orders, /buildOrderInvoiceId\(form\.id\)/)
})

test('trang hóa đơn chỉ sửa/xóa và không còn luồng tạo thủ công', () => {
  const invoices = readFileSync('pages/invoices.vue', 'utf8')
  assert.doesNotMatch(invoices, /\+ Thêm hóa đơn/)
  assert.doesNotMatch(invoices, /invoices\.create/)
  assert.doesNotMatch(invoices, /availableOrders/)
  assert.doesNotMatch(invoices, /openModal\(\)/)
  assert.match(invoices, /action: 'edit'/)
  assert.match(invoices, /mode: 'delete'/)
  assert.match(invoices, /validateAccountingInvoice/)
  assert.match(invoices, /INVOICE_STATUS_OPTIONS/)
})

test('xóa order cascade invoice nhưng vẫn dùng blocker payment và shipment', () => {
  const orders = readFileSync('pages/orders.vue', 'utf8')
  const relationState = readFileSync('utils/orderRelationState.mjs', 'utf8')
  assert.match(orders, /latestInvoices/)
  assert.match(orders, /batch\.update\(doc\(db, 'invoices'/)
  assert.match(orders, /invalidateScopedCache\('invoices'\)/)
  assert.doesNotMatch(relationState, /reasons\.push\(`\$\{invoices\} hóa đơn`\)/)
  assert.match(relationState, /payment_record_count/)
  assert.match(relationState, /shipment_record_count/)
})

test('Sale được tải invoice của order mình chỉ để đổi trạng thái hoặc cascade xóa', () => {
  const scopedQueries = readFileSync('composables/useScopedQueries.ts', 'utf8')
  assert.match(scopedQueries, /invoices\.delete', 'orders\.edit', 'orders\.delete'/)
})
