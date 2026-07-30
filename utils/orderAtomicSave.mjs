// Pure helpers used by both the Nuxt client flow and Node business-flow tests.
export const FIRESTORE_WRITE_LIMIT = 500

export const ORDER_EDIT_SYSTEM_FIELDS = Object.freeze([
  'paid_amount', 'debt_amount', 'computed_payment_status', 'payment_status',
  'payment_count', 'deposit_count', 'collect_count',
  'warehouse_fulfillment_status', 'warehouse_request_status',
  'printing_progress_count', 'printing_lock_version', 'printing_last_action',
  'printing_last_print_order_id', 'printing_lock_updated_by', 'printing_lock_updated_at',
  'relation_lock_version', 'payment_record_count', 'invoice_record_count',
  'shipment_record_count', 'payment_relation_revision', 'invoice_relation_revision',
  'shipment_relation_revision', 'relation_last_module', 'relation_last_action',
  'relation_last_document_id', 'relation_updated_by', 'relation_updated_at',
  'invoice_status', 'shipment_status', 'shipping_fee_total', 'cod_amount_total',
  'deleted', 'active', 'status', 'deleted_at', 'created_at',
])

export const ORDER_IMMUTABLE_IDENTITY_FIELDS = Object.freeze([
  'order_code',
  'order_sequence',
  'user_code',
  'customer_id',
  'customer_code',
  'owner_email',
  'created_by',
  'sale_email',
  'created_at',
])

export function stripOrderEditSystemFields(payload = {}) {
  const clean = { ...(payload || {}) }
  ORDER_EDIT_SYSTEM_FIELDS.forEach(field => delete clean[field])
  return clean
}

function text(value) {
  return String(value ?? '').trim()
}

function persistedText(value) {
  return String(value ?? '')
}

export function preservePersistedOrderIdentityForEdit(payload = {}, persistedOrder = {}, options = {}) {
  const next = { ...(payload || {}) }
  const immutableFields = options.allowCustomerChange
    ? ORDER_IMMUTABLE_IDENTITY_FIELDS.filter(field => !['customer_id', 'customer_code'].includes(field))
    : ORDER_IMMUTABLE_IDENTITY_FIELDS
  for (const field of immutableFields) {
    if (Object.prototype.hasOwnProperty.call(persistedOrder || {}, field)) {
      next[field] = persistedOrder[field]
    } else {
      delete next[field]
    }
  }
  return next
}

function zeroRelationCounter(value) {
  return Number.isInteger(Number(value)) && Number(value) === 0
}

export function orderCustomerReassignmentBlocker(order = {}) {
  if (!zeroRelationCounter(order.payment_record_count)) {
    return 'Không thể đổi khách hàng khi đơn đã có thanh toán hoặc khóa thanh toán chưa sẵn sàng.'
  }
  if (String(order.warehouse_fulfillment_status || '') !== 'chua_xuat'
    || String(order.warehouse_request_status || '').trim()) {
    return 'Không thể đổi khách hàng khi đơn đã có yêu cầu hoặc dữ liệu xuất kho.'
  }
  if (!zeroRelationCounter(order.printing_progress_count)) {
    return 'Không thể đổi khách hàng khi đơn đã có tiến độ in.'
  }
  if (!zeroRelationCounter(order.shipment_record_count)) {
    return 'Không thể đổi khách hàng khi đơn đã có vận chuyển.'
  }
  if (String(order.invoice_status || '').trim() === 'Đã xuất') {
    return 'Không thể đổi khách hàng khi hóa đơn đã xuất.'
  }
  if (!Number.isInteger(Number(order.relation_lock_version))
    || Number(order.relation_lock_version) !== 1
    || !Number.isInteger(Number(order.invoice_record_count))
    || Number(order.invoice_record_count) !== 1) {
    return 'Không thể đổi khách hàng khi khóa liên kết của đơn chưa sẵn sàng. Vui lòng nhờ quản trị viên đồng bộ dữ liệu đơn.'
  }
  return ''
}

export function resolveOrderOwnershipForSave({
  mode,
  persistedOrder = {},
  requestedOwnership = {},
} = {}) {
  if (mode === 'edit') {
    return {
      ownerEmail: persistedText(persistedOrder.owner_email),
      createdBy: persistedText(persistedOrder.created_by),
      saleEmail: persistedText(persistedOrder.sale_email),
    }
  }
  return {
    ownerEmail: text(requestedOwnership.ownerEmail),
    createdBy: text(requestedOwnership.createdBy),
    saleEmail: text(requestedOwnership.saleEmail),
  }
}

export function numericRevision(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

export function uniqueDocumentIds(rows = []) {
  const seen = new Set()
  const result = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = text(row?.id || row?.firestore_id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

export function planAtomicOrderItems(existingItems = [], nextItems = []) {
  const existingIds = new Set(uniqueDocumentIds(existingItems))
  const nextIds = uniqueDocumentIds(nextItems)
  if (nextIds.length !== (Array.isArray(nextItems) ? nextItems.length : 0)) {
    throw new Error('Dòng sản phẩm thiếu ID hoặc bị trùng ID; chưa thể lưu đơn an toàn.')
  }
  const nextIdSet = new Set(nextIds)
  return {
    upsertItems: nextItems.map(item => ({
      ...item,
      id: text(item.id || item.firestore_id),
      isNew: !existingIds.has(text(item.id || item.firestore_id)),
    })),
    removedItems: (Array.isArray(existingItems) ? existingItems : [])
      .filter(item => {
        const id = text(item?.id || item?.firestore_id)
        return id && !nextIdSet.has(id)
      }),
  }
}

// Existing order_items created before lifecycle fields were introduced may not
// have status/active/deleted at all. Editing such an item must not add those
// fields implicitly, because Firestore Rules correctly treat lifecycle changes
// as a separate operation. New items still receive the canonical active state.
export function buildOrderItemLifecyclePatch(isNew) {
  return isNew
    ? {
        status: 'active',
        active: true,
        deleted: false,
      }
    : {}
}

// A missing invoice document cannot satisfy scoped read rules because
// resource.data does not exist. Read only when the document must already
// exist: a status update, or an explicit restore after a soft delete.
export function shouldReadExistingInvoiceSnapshot({
  mode,
  invoiceMutation,
  persistedOrder = {},
} = {}) {
  if (mode !== 'edit' || !invoiceMutation) return false
  if (invoiceMutation.mode === 'status_update' || invoiceMutation.mode === 'customer_update') return true
  if (invoiceMutation.mode !== 'legacy_create') return false
  return String(persistedOrder.relation_last_module || '') === 'invoices'
    && String(persistedOrder.relation_last_action || '') === 'delete'
    && text(persistedOrder.relation_last_document_id) === text(invoiceMutation.invoiceId)
}

export function estimateAtomicOrderWrites({
  mode,
  existingItems = [],
  nextItems = [],
  updateInvoiceStatus = false,
} = {}) {
  const plan = planAtomicOrderItems(existingItems, nextItems)
  const sequenceWrites = mode === 'create' ? 1 : 0
  const invoiceWrites = mode === 'create' || updateInvoiceStatus ? 1 : 0
  return sequenceWrites + 1 + 1 + invoiceWrites + plan.upsertItems.length + plan.removedItems.length
}

export function assertAtomicOrderWriteLimit(input = {}) {
  const writes = estimateAtomicOrderWrites(input)
  if (writes > FIRESTORE_WRITE_LIMIT) {
    throw new Error(`Đơn hàng cần ${writes} thao tác ghi, vượt giới hạn ${FIRESTORE_WRITE_LIMIT} của Firestore. Hãy giảm số dòng sản phẩm trước khi lưu.`)
  }
  return writes
}

export function nextOrderRevision(currentRevision) {
  return numericRevision(currentRevision) + 1
}

export function assertExpectedOrderRevision(expectedRevision, actualRevision) {
  const expected = numericRevision(expectedRevision)
  const actual = numericRevision(actualRevision)
  if (expected !== actual) {
    throw new Error('Đơn hàng đã được cập nhật ở một thiết bị hoặc phiên khác. Hãy tải lại dữ liệu trước khi lưu tiếp.')
  }
  return actual
}

export function buildOrderOperationId(orderId, now = Date.now(), randomValue = Math.random()) {
  const cleanId = text(orderId).replace(/[^a-zA-Z0-9_-]/g, '') || 'order'
  const random = Math.floor(Math.abs(Number(randomValue) || 0) * 1_000_000)
    .toString(36)
    .padStart(4, '0')
  return `order_${cleanId}_${Number(now).toString(36)}_${random}`
}
