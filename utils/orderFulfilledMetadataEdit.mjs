import {
  ACCOUNTING_INVOICE_STATUSES,
  SALE_INVOICE_STATUSES,
  normalizeInvoiceStatus,
} from './orderInvoiceFlow.mjs'

export const FULFILLED_ORDER_STATUS = 'da_xuat_du'

export const FULFILLED_ORDER_METADATA_FIELDS = Object.freeze([
  'order_date',
  'order_status',
  'invoice_status',
])

// invoice_status is written only when the matching invoice relation is updated
// in the same transaction. The base metadata patch intentionally excludes it.
export const FULFILLED_ORDER_METADATA_WRITE_FIELDS = Object.freeze([
  'order_date',
  'order_status',
  'revision',
  'last_operation_id',
  'updated_at',
])

function text(value) {
  return String(value ?? '').trim()
}

function revision(value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('Phiên bản đơn hàng không hợp lệ.')
  }
  return parsed
}

export function isFulfilledOrder(order = {}) {
  return text(order.warehouse_fulfillment_status) === FULFILLED_ORDER_STATUS
}

export function normalizeFulfilledOrderMetadata(input = {}) {
  const orderDate = text(input.orderDate ?? input.order_date)
  const orderStatus = text(input.orderStatus ?? input.order_status)
  const invoiceStatus = normalizeInvoiceStatus(input.invoiceStatus ?? input.invoice_status)

  if (!orderDate) throw new Error('Ngày giờ đơn không được để trống.')
  if (!orderStatus) throw new Error('Trạng thái đơn không được để trống.')
  if (!ACCOUNTING_INVOICE_STATUSES.includes(invoiceStatus)) {
    throw new Error('Trạng thái hóa đơn không hợp lệ.')
  }

  return {
    order_date: orderDate,
    order_status: orderStatus,
    invoice_status: invoiceStatus,
  }
}

export function validateFulfilledInvoiceStatusTransition(currentValue, nextValue) {
  const current = normalizeInvoiceStatus(currentValue)
  const next = normalizeInvoiceStatus(nextValue)

  if (!ACCOUNTING_INVOICE_STATUSES.includes(current) || !ACCOUNTING_INVOICE_STATUSES.includes(next)) {
    throw new Error('Trạng thái hóa đơn không hợp lệ.')
  }
  if (current === 'Đã xuất' && next !== 'Đã xuất') {
    throw new Error('Hóa đơn đã xuất. Sale không được thay đổi trạng thái từ đơn hàng.')
  }
  if (current !== 'Đã xuất' && !SALE_INVOICE_STATUSES.includes(next)) {
    throw new Error('Sale chỉ được chọn Không xuất hoặc Yêu cầu xuất.')
  }
  return next
}

export function fulfilledOrderMetadataChanged(current = {}, next = {}) {
  const normalized = normalizeFulfilledOrderMetadata(next)
  return text(current.order_date) !== normalized.order_date
    || text(current.order_status) !== normalized.order_status
    || normalizeInvoiceStatus(current.invoice_status) !== normalized.invoice_status
}

export function buildFulfilledOrderMetadataPatch(input = {}) {
  const normalized = normalizeFulfilledOrderMetadata(input)
  const operationId = text(input.operationId ?? input.last_operation_id)

  if (!operationId) throw new Error('Thiếu mã thao tác cập nhật đơn.')
  if (input.updatedAt === undefined || input.updatedAt === null) {
    throw new Error('Thiếu thời gian cập nhật đơn.')
  }

  return {
    order_date: normalized.order_date,
    order_status: normalized.order_status,
    revision: revision(input.currentRevision ?? input.revision) + 1,
    last_operation_id: operationId,
    updated_at: input.updatedAt,
  }
}
