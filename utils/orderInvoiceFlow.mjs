export const SALE_INVOICE_STATUSES = Object.freeze(['Không xuất', 'Yêu cầu xuất'])
export const ACCOUNTING_INVOICE_STATUSES = Object.freeze([...SALE_INVOICE_STATUSES, 'Đã xuất'])

const LEGACY_STATUS_MAP = Object.freeze({
  'Khách lẻ': 'Không xuất',
  'HĐ nháp': 'Yêu cầu xuất',
})

function text(value) {
  return String(value ?? '').trim()
}

export function normalizeInvoiceStatus(value) {
  const status = text(value)
  return LEGACY_STATUS_MAP[status] || status || 'Không xuất'
}

export function isSaleInvoiceStatus(value) {
  return SALE_INVOICE_STATUSES.includes(normalizeInvoiceStatus(value))
}

export function isAccountingInvoiceStatus(value) {
  return ACCOUNTING_INVOICE_STATUSES.includes(normalizeInvoiceStatus(value))
}

export function assertSaleInvoiceStatus(value) {
  const status = normalizeInvoiceStatus(value)
  if (!SALE_INVOICE_STATUSES.includes(status)) {
    throw new Error('Sale chỉ được chọn Không xuất hoặc Yêu cầu xuất.')
  }
  return status
}

export function canSaleTransitionInvoiceStatus(currentValue, nextValue) {
  const current = normalizeInvoiceStatus(currentValue)
  const next = normalizeInvoiceStatus(nextValue)
  return current !== 'Đã xuất'
    && SALE_INVOICE_STATUSES.includes(current)
    && SALE_INVOICE_STATUSES.includes(next)
}

export function invoiceStatusChangeRequested(currentValue, nextValue) {
  return normalizeInvoiceStatus(currentValue) !== normalizeInvoiceStatus(nextValue)
}

export function buildOrderInvoiceId(orderId) {
  const cleanOrderId = text(orderId).replace(/[^a-zA-Z0-9_-]/g, '')
  if (!cleanOrderId) throw new Error('Thiếu ID đơn hàng để tạo hóa đơn.')
  return `inv_${cleanOrderId}`
}

export function validateAccountingInvoice(input = {}) {
  const status = normalizeInvoiceStatus(input.invoice_status)
  if (!ACCOUNTING_INVOICE_STATUSES.includes(status)) {
    return 'Trạng thái hóa đơn không hợp lệ.'
  }
  const amount = Number(input.invoice_amount)
  if (!Number.isFinite(amount) || amount < 0) {
    return 'Giá trị hóa đơn không được âm.'
  }
  if (status === 'Đã xuất') {
    if (!text(input.invoice_number)) return 'Vui lòng nhập số hóa đơn trước khi chuyển sang Đã xuất.'
    if (!text(input.invoice_date)) return 'Vui lòng nhập ngày hóa đơn trước khi chuyển sang Đã xuất.'
  }
  return ''
}
