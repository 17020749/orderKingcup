export const EXPORT_REQUEST_STATUSES = Object.freeze({
  pending: 'cho_xu_ly',
  accepted: 'da_tiep_nhan',
  ready: 'cho_xuat_kho',
  released: 'da_xuat',
  rejected: 'tu_choi',
  error: 'loi',
})

function text(value) {
  return String(value || '').trim()
}

function integer(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

export function canonicalExportRequestStatus(value) {
  return text(value).toLowerCase().replace(/[\s-]+/g, '_')
}

export function activeExportOrderId(request = {}) {
  return text(
    request.active_export_order_id
    || request.export_order_id
    || request.warehouse_export_order_id
    || request.warehouse_export_id
  )
}

export function exportReleaseSequence(request = {}) {
  return integer(request.release_sequence, activeExportOrderId(request) ? 1 : 0)
}

export function nextExportReleaseSequence(request = {}) {
  return exportReleaseSequence(request) + 1
}

export function requestExportOrderId(requestId, sequence = 1) {
  const safeRequestId = text(requestId).replace(/[\/?#\[\]]/g, '_').replace(/\s+/g, '_')
  if (!safeRequestId) throw new Error('Thiếu ID yêu cầu xuất kho.')
  const base = `request_export__${safeRequestId}`
  return integer(sequence, 1) <= 1 ? base : `${base}__${integer(sequence, 1)}`
}

export function canReleaseExportRequest(request = {}) {
  const status = canonicalExportRequestStatus(request.status)
  return [
    EXPORT_REQUEST_STATUSES.accepted,
    EXPORT_REQUEST_STATUSES.ready,
    EXPORT_REQUEST_STATUSES.error,
  ].includes(status) && !activeExportOrderId(request)
}

export function canCancelExportRequestRelease(request = {}) {
  return canonicalExportRequestStatus(request.status) === EXPORT_REQUEST_STATUSES.released
    && Boolean(activeExportOrderId(request))
}

export function exportLifecycleLinkError(request = {}, exportOrder = {}) {
  const requestId = text(request.id || request.request_id)
  const exportId = text(exportOrder.id)
  if (!requestId) return 'Yêu cầu xuất kho thiếu ID hệ thống.'
  if (!exportId) return 'Phiếu xuất kho thiếu ID hệ thống.'
  if (text(exportOrder.source_request_id) !== requestId) {
    return 'Phiếu xuất không liên kết đúng với yêu cầu xuất kho.'
  }
  if (activeExportOrderId(request) !== exportId) {
    return 'Yêu cầu xuất kho không trỏ tới phiếu xuất đang xử lý.'
  }
  if (text(exportOrder.source) !== 'kingcup_firestore'
    && !text(exportOrder.sync_source).startsWith('kingcup_firestore:')) {
    return 'Phiếu xuất không phải phiếu sinh từ yêu cầu Sale.'
  }
  return ''
}

export function appendExportLifecycleTimeline(timeline = [], input = {}) {
  const rows = Array.isArray(timeline) ? timeline : []
  return [...rows, {
    action: text(input.action),
    title: text(input.title),
    actor: text(input.actor).toLowerCase(),
    actor_name: text(input.actorName || input.actor),
    time: input.time || new Date().toISOString(),
    status: text(input.status),
    note: text(input.note),
    export_order_id: text(input.exportOrderId),
    export_code: text(input.exportCode),
  }]
}

export function buildReleasedRequestPatch(input = {}) {
  const request = input.request || {}
  const exportOrderId = text(input.exportOrderId)
  const exportCode = text(input.exportCode)
  const actor = text(input.actor).toLowerCase()
  const sequence = integer(input.releaseSequence, nextExportReleaseSequence(request))
  if (!exportOrderId || !exportCode || !actor) {
    throw new Error('Thiếu dữ liệu liên kết khi cho xuất kho.')
  }
  return {
    status: EXPORT_REQUEST_STATUSES.released,
    lifecycle_status: 'released',
    release_sequence: sequence,
    active_export_order_id: exportOrderId,
    warehouse_export_code: exportCode,
    warehouse_export_id: exportOrderId,
    warehouse_export_order_id: exportOrderId,
    export_order_id: exportOrderId,
    warehouse_handled_by: actor,
    warehouse_note: text(input.note),
    actual_export_summary_json: input.actualSummaryJson || '[]',
    stock_movement_ids: Array.isArray(input.stockMovementIds) ? input.stockMovementIds : [],
    request_timeline_json: input.timelineJson || '[]',
    operation_id: text(input.operationId),
    last_operation_id: text(input.operationId),
    last_released_export_order_id: exportOrderId,
    last_released_export_code: exportCode,
    last_released_by: actor,
  }
}

export function buildCancelledReleaseRequestPatch(input = {}) {
  const request = input.request || {}
  const exportOrder = input.exportOrder || {}
  const actor = text(input.actor).toLowerCase()
  const reason = text(input.reason)
  const linkError = exportLifecycleLinkError(request, exportOrder)
  if (linkError) throw new Error(linkError)
  if (!actor) throw new Error('Không xác định được người hủy xuất.')
  if (!reason) throw new Error('Vui lòng nhập lý do hủy xuất kho.')

  return {
    status: EXPORT_REQUEST_STATUSES.accepted,
    lifecycle_status: 'release_cancelled',
    active_export_order_id: '',
    warehouse_export_code: '',
    warehouse_export_id: '',
    warehouse_export_order_id: '',
    export_order_id: '',
    exported_at: null,
    actual_exported_at: null,
    actual_export_summary_json: '[]',
    stock_movement_ids: [],
    warehouse_handled_by: actor,
    warehouse_note: reason,
    request_timeline_json: input.timelineJson || '[]',
    operation_id: text(input.operationId),
    last_operation_id: text(input.operationId),
    last_cancelled_export_order_id: text(exportOrder.id),
    last_cancelled_export_code: text(exportOrder.code || exportOrder.export_code),
    last_cancelled_by: actor,
    last_cancel_reason: reason,
    cancel_count: integer(request.cancel_count) + 1,
  }
}

export function buildGeneratedExportLifecycleFields(input = {}) {
  return {
    lifecycle_status: input.cancelled ? 'cancelled' : 'released',
    release_sequence: integer(input.releaseSequence, 1),
    source_request_id: text(input.requestId),
    source_request_revision: integer(input.requestRevision),
    request_operation_id: text(input.operationId),
  }
}
