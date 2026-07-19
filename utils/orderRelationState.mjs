export const ORDER_RELATION_LOCK_VERSION = 1

export const RELATION_MODULES = ['payments', 'invoices', 'shipments']

function text(value) {
  return String(value || '').trim()
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function round2(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100
}

export function isActiveOrderRelation(record = {}) {
  const status = text(record.status).toLowerCase()
  return record.deleted !== true
    && record.active !== false
    && status !== 'deleted'
    && status !== 'đã xóa'
}

export function relationCountField(module) {
  if (module === 'payments') return 'payment_record_count'
  if (module === 'invoices') return 'invoice_record_count'
  if (module === 'shipments') return 'shipment_record_count'
  throw new Error(`Module liên kết không hợp lệ: ${module}`)
}

export function relationRevisionField(module) {
  if (module === 'payments') return 'payment_relation_revision'
  if (module === 'invoices') return 'invoice_relation_revision'
  if (module === 'shipments') return 'shipment_relation_revision'
  throw new Error(`Module liên kết không hợp lệ: ${module}`)
}

function normalizePaymentType(value) {
  return text(value).toLowerCase().replace(/[\s_-]+/g, ' ')
}

export function computePaymentRelationSummary(order = {}, records = []) {
  const active = records.filter(isActiveOrderRelation)
  const received = active.filter(record => text(record.payment_status) === 'Đã nhận')
  const paid = round2(received.reduce((sum, record) => sum + number(record.amount), 0))
  const debtBase = number(order.actual_revenue) > 0
    ? number(order.actual_revenue)
    : number(order.total_vat) || number(order.subtotal_no_vat)
  const debt = round2(debtBase - paid)
  let depositCount = 0
  let collectCount = 0
  for (const record of received) {
    const type = normalizePaymentType(record.payment_type)
    if (type === 'cọc' || type === 'coc') depositCount += 1
    else if (/^thu(\s|\d|$)/.test(type)) collectCount += 1
  }

  let status = 'Chưa thanh toán'
  if (!received.length || paid <= 0) status = 'Chưa thanh toán'
  else if (debt === 0) status = 'Đã thanh toán'
  else if (debt < 0) status = 'Thanh toán thừa'
  else if (depositCount > 0 && collectCount > 0) status = 'Đã cọc + thanh toán 1 phần'
  else if (depositCount > 0) status = 'Đã cọc'
  else status = 'Thanh toán một phần'

  return {
    payment_record_count: active.length,
    paid_amount: paid,
    debt_amount: debt,
    payment_status: status,
    computed_payment_status: status,
    payment_count: received.length,
    deposit_count: depositCount,
    collect_count: collectCount,
  }
}

function sortableDate(record, fields) {
  for (const field of fields) {
    const value = record?.[field]
    if (value && typeof value?.toMillis === 'function') return value.toMillis()
    const parsed = Date.parse(String(value || ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function latestRecord(records, fields) {
  return [...records].sort((left, right) => {
    const dateDiff = sortableDate(right, fields) - sortableDate(left, fields)
    if (dateDiff) return dateDiff
    return text(right.id).localeCompare(text(left.id))
  })[0] || null
}

export function computeInvoiceRelationSummary(records = []) {
  const active = records.filter(isActiveOrderRelation)
  const latest = latestRecord(active, ['invoice_date', 'updated_at', 'created_at'])
  return {
    invoice_record_count: active.length,
    invoice_status: latest?.invoice_status || 'Không xuất',
  }
}

export function computeShipmentRelationSummary(records = []) {
  const active = records.filter(isActiveOrderRelation)
  const latest = latestRecord(active, ['delivered_date', 'shipped_date', 'updated_at', 'created_at'])
  return {
    shipment_record_count: active.length,
    shipment_status: latest?.shipping_status || '',
    shipping_fee_total: round2(active.reduce((sum, record) => sum + number(record.shipping_fee), 0)),
    cod_amount_total: round2(active.reduce((sum, record) => sum + number(record.cod_amount), 0)),
  }
}

export function computeRelationModuleSummary(module, order, records) {
  if (module === 'payments') return computePaymentRelationSummary(order, records)
  if (module === 'invoices') return computeInvoiceRelationSummary(records)
  if (module === 'shipments') return computeShipmentRelationSummary(records)
  throw new Error(`Module liên kết không hợp lệ: ${module}`)
}

export function replaceRelationRecord(records, nextRecord, previousId = '') {
  const id = text(nextRecord?.id)
  const replacedId = text(previousId || id)
  const next = (Array.isArray(records) ? records : [])
    .filter(record => text(record?.id) !== replacedId && text(record?.id) !== id)
  next.push(nextRecord)
  return next
}

export function removeRelationRecord(records, recordId) {
  return (Array.isArray(records) ? records : []).filter(record => text(record?.id) !== text(recordId))
}

export function buildOrderRelationPatch({
  module,
  order = {},
  records = [],
  action,
  documentId,
  actor,
  updatedAt,
  revision,
}) {
  const revisionField = relationRevisionField(module)
  const nextRevision = revision == null
    ? number(order[revisionField]) + 1
    : number(revision)
  return {
    relation_lock_version: ORDER_RELATION_LOCK_VERSION,
    ...computeRelationModuleSummary(module, order, records),
    [revisionField]: nextRevision,
    relation_last_module: module,
    relation_last_action: action,
    relation_last_document_id: text(documentId),
    relation_updated_by: text(actor).toLowerCase(),
    relation_updated_at: updatedAt,
  }
}

export function relationLockReady(order = {}) {
  return number(order.relation_lock_version) === ORDER_RELATION_LOCK_VERSION
    && RELATION_MODULES.every(module => {
      const count = order[relationCountField(module)]
      const revision = order[relationRevisionField(module)]
      return Number.isInteger(Number(count)) && Number(count) >= 0
        && Number.isInteger(Number(revision)) && Number(revision) >= 0
    })
}

export function orderRelationDeleteBlocker(order = {}) {
  if (!relationLockReady(order)) {
    return 'Đơn hàng cũ chưa được đồng bộ khóa thanh toán, hóa đơn và vận chuyển. Quản trị viên cần chạy “Đồng bộ khóa liên kết đơn”.'
  }
  const payments = number(order.payment_record_count)
  const invoices = number(order.invoice_record_count)
  const shipments = number(order.shipment_record_count)
  const reasons = []
  if (payments > 0) reasons.push(`${payments} phiếu thanh toán`)
  if (invoices > 0) reasons.push(`${invoices} hóa đơn`)
  if (shipments > 0) reasons.push(`${shipments} bản ghi vận chuyển`)
  return reasons.length
    ? `Không thể xóa đơn hàng vì còn ${reasons.join(', ')} đang hoạt động.`
    : ''
}

export function relationRecordsByOrder(records = []) {
  const map = new Map()
  for (const record of records.filter(isActiveOrderRelation)) {
    const orderId = text(record.order_id)
    if (!orderId) continue
    if (!map.has(orderId)) map.set(orderId, [])
    map.get(orderId).push(record)
  }
  return map
}

export function buildReconciledOrderRelationPatch({ order, payments = [], invoices = [], shipments = [], actor, updatedAt }) {
  return {
    relation_lock_version: ORDER_RELATION_LOCK_VERSION,
    ...computePaymentRelationSummary(order, payments),
    ...computeInvoiceRelationSummary(invoices),
    ...computeShipmentRelationSummary(shipments),
    payment_relation_revision: Math.max(0, number(order.payment_relation_revision)),
    invoice_relation_revision: Math.max(0, number(order.invoice_relation_revision)),
    shipment_relation_revision: Math.max(0, number(order.shipment_relation_revision)),
    relation_last_module: 'all',
    relation_last_action: 'reconcile',
    relation_last_document_id: '',
    relation_updated_by: text(actor).toLowerCase(),
    relation_updated_at: updatedAt,
  }
}
