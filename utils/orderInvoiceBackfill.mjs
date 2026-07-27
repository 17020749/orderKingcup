import {
  ACCOUNTING_INVOICE_STATUSES,
  buildOrderInvoiceId,
  normalizeInvoiceStatus,
} from './orderInvoiceFlow.mjs'
import {
  isActiveOrderRelation,
  relationRecordsByOrder,
} from './orderRelationState.mjs'

function text(value) {
  return String(value ?? '').trim()
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nonNegativeInteger(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

function isActiveOrder(order = {}) {
  const status = text(order.status).toLowerCase()
  return order.deleted !== true
    && order.active !== false
    && status !== 'deleted'
    && status !== 'đã xóa'
}

export function normalizeBackfillInvoiceStatus(value) {
  const status = normalizeInvoiceStatus(value)
  return ACCOUNTING_INVOICE_STATUSES.includes(status) ? status : 'Không xuất'
}

export function planOrderInvoiceBackfill({ orders = [], invoices = [] } = {}) {
  const activeInvoiceMap = relationRecordsByOrder(invoices)
  const invoiceById = new Map(
    (Array.isArray(invoices) ? invoices : [])
      .filter(invoice => text(invoice?.id))
      .map(invoice => [text(invoice.id), invoice]),
  )
  const candidates = []
  const alreadyCovered = []
  const duplicateOrders = []
  const idConflicts = []

  for (const order of (Array.isArray(orders) ? orders : []).filter(isActiveOrder)) {
    const orderId = text(order.id)
    if (!orderId) continue
    const activeInvoices = activeInvoiceMap.get(orderId) || []
    if (activeInvoices.length > 1) {
      duplicateOrders.push({
        orderId,
        invoiceIds: activeInvoices.map(invoice => text(invoice.id)).filter(Boolean),
      })
      continue
    }
    if (activeInvoices.length === 1) {
      alreadyCovered.push({ orderId, invoiceId: text(activeInvoices[0].id) })
      continue
    }

    const invoiceId = buildOrderInvoiceId(orderId)
    const conflictingInvoice = invoiceById.get(invoiceId)
    if (conflictingInvoice) {
      idConflicts.push({
        orderId,
        invoiceId,
        conflictingOrderId: text(conflictingInvoice.order_id),
        conflictingActive: isActiveOrderRelation(conflictingInvoice),
      })
      continue
    }
    candidates.push({ orderId, invoiceId, order })
  }

  return { candidates, alreadyCovered, duplicateOrders, idConflicts }
}

export function buildBackfillInvoice({ order = {}, actor = '', now = new Date() } = {}) {
  const orderId = text(order.id)
  const invoiceId = buildOrderInvoiceId(orderId)
  const relationRevision = Math.max(1, nonNegativeInteger(order.invoice_relation_revision) + 1)
  return {
    id: invoiceId,
    order_id: orderId,
    order_code: text(order.order_code),
    invoice_number: text(order.invoice_number),
    invoice_date: text(order.invoice_date),
    invoice_amount: number(order.payable_amount),
    invoice_status: normalizeBackfillInvoiceStatus(order.invoice_status),
    tax_code: text(order.tax_code),
    company_name: text(order.company_name),
    billing_address: text(order.billing_address),
    note: '',
    created_by: text(actor).toLowerCase(),
    order_owner_email: text(order.owner_email).toLowerCase(),
    order_created_by: text(order.created_by).toLowerCase(),
    order_sale_email: text(order.sale_email).toLowerCase(),
    relation_revision: relationRevision,
    last_operation_id: `backfill_${invoiceId}`,
    active: true,
    deleted: false,
    status: 'active',
    created_at: now,
    updated_at: now,
  }
}

export function buildBackfillOrderPatch({
  order = {},
  invoice = {},
  payments = [],
  shipments = [],
  actor = '',
  now = new Date(),
} = {}) {
  const activePaymentCount = (Array.isArray(payments) ? payments : []).filter(isActiveOrderRelation).length
  const activeShipmentCount = (Array.isArray(shipments) ? shipments : []).filter(isActiveOrderRelation).length
  return {
    relation_lock_version: 1,
    payment_record_count: activePaymentCount,
    invoice_record_count: 1,
    shipment_record_count: activeShipmentCount,
    payment_relation_revision: nonNegativeInteger(order.payment_relation_revision),
    invoice_relation_revision: Math.max(1, nonNegativeInteger(invoice.relation_revision, 1)),
    shipment_relation_revision: nonNegativeInteger(order.shipment_relation_revision),
    invoice_status: normalizeBackfillInvoiceStatus(invoice.invoice_status),
    relation_last_module: 'invoices',
    relation_last_action: 'create',
    relation_last_document_id: text(invoice.id),
    relation_updated_by: text(actor).toLowerCase(),
    relation_updated_at: now,
    updated_at: now,
  }
}
