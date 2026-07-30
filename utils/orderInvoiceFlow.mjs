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

export function planOrderEditInvoiceMutation({
  orderId,
  persistedStatus,
  requestedStatus,
  currentInvoice = null,
  activeInvoiceCount = currentInvoice ? 1 : 0,
  payload = {},
  customerChanged = false,
} = {}) {
  if (Number(activeInvoiceCount) > 1) {
    throw new Error('Đơn hàng có nhiều hóa đơn đang hoạt động. Hãy xử lý trùng trước khi lưu.')
  }

  const normalizedRequestedStatus = normalizeInvoiceStatus(requestedStatus)
  if (customerChanged) {
    if (normalizeInvoiceStatus(persistedStatus) === 'Đã xuất') {
      throw new Error('Không thể đổi khách hàng khi hóa đơn đã xuất.')
    }
    if (invoiceStatusChangeRequested(persistedStatus, normalizedRequestedStatus)) {
      throw new Error('Vui lòng lưu thay đổi trạng thái hóa đơn trước hoặc sau khi đổi khách hàng.')
    }
    if (!currentInvoice) {
      throw new Error('Đơn hàng chưa có hóa đơn hoạt động để đồng bộ thông tin khách hàng. Vui lòng nhờ quản trị viên kiểm tra dữ liệu.')
    }
    return {
      mode: 'customer_update',
      invoiceId: currentInvoice.id,
      requestedStatus: normalizedRequestedStatus,
      expectedStatus: currentInvoice.invoice_status,
      expectedRelationRevision: Number(currentInvoice.relation_revision) || 0,
      payload: { ...payload },
    }
  }
  if (!currentInvoice) {
    return {
      mode: 'legacy_create',
      invoiceId: buildOrderInvoiceId(orderId),
      requestedStatus: normalizedRequestedStatus,
      payload: { ...payload },
    }
  }

  const statusChanged = normalizeInvoiceStatus(persistedStatus) !== 'Đã xuất'
    && invoiceStatusChangeRequested(persistedStatus, normalizedRequestedStatus)
  if (!statusChanged) return undefined

  return {
    mode: 'status_update',
    invoiceId: currentInvoice.id,
    requestedStatus: normalizedRequestedStatus,
    expectedStatus: currentInvoice.invoice_status,
    expectedRelationRevision: Number(currentInvoice.relation_revision) || 0,
  }
}

export function validateAccountingInvoice(input = {}) {
  const status = normalizeInvoiceStatus(input.invoice_status)
  if (!ACCOUNTING_INVOICE_STATUSES.includes(status)) {
    return 'Trạng thái hóa đơn không hợp lệ.'
  }
  return ''
}
