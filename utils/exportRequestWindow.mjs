export const EXPORT_REQUEST_WINDOW_OWNER_FIELDS = Object.freeze([
  'requested_by',
  'order_owner_email',
  'order_created_by',
  'order_sale_email',
])

export const EXPORT_REQUEST_QUEUE_STATUSES = Object.freeze([
  'cho_xu_ly',
  'pending',
  'dang_xu_ly',
  'processing',
  'da_tiep_nhan',
  'accepted',
  'cho_xuat_kho',
  'ready_to_export',
  'cho_xac_nhan',
  'da_xuat_1_phan',
  'da_xuat_mot_phan',
  'partial_exported',
])

export const EXPORT_REQUEST_HISTORY_STATUSES = Object.freeze([
  'da_xuat',
  'da_xuat_kho',
  'da_xuat_du',
  'exported',
  'completed',
  'hoan_thanh',
  'tu_choi',
  'rejected',
  'cancelled',
  'canceled',
  'da_huy',
  'loi',
])

export const EXPORT_REQUEST_QUEUE_LIMIT = 100
export const EXPORT_REQUEST_QUEUE_PAGE_SIZE = 50
export const EXPORT_REQUEST_HISTORY_PAGE_SIZE = 50
export const EXPORT_REQUEST_MAX_PAGE_SIZE = 100
export const EXPORT_REQUEST_WINDOW_STATES = Object.freeze({
  queue: 'queue',
  history: 'history',
  hidden: 'hidden',
})

export function canonicalExportRequestWindowStatus(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function isExportRequestQueueStatus(value) {
  return EXPORT_REQUEST_QUEUE_STATUSES.includes(canonicalExportRequestWindowStatus(value))
}

export function isExportRequestHistoryStatus(value) {
  return EXPORT_REQUEST_HISTORY_STATUSES.includes(canonicalExportRequestWindowStatus(value))
}

export function exportRequestWindowState(rowOrStatus) {
  const row = rowOrStatus && typeof rowOrStatus === 'object' ? rowOrStatus : null
  if (row && (row.deleted === true || row.active === false)) {
    return EXPORT_REQUEST_WINDOW_STATES.hidden
  }
  const status = canonicalExportRequestWindowStatus(row ? row.status : rowOrStatus)
  if (isExportRequestQueueStatus(status)) return EXPORT_REQUEST_WINDOW_STATES.queue
  if (isExportRequestHistoryStatus(status)) return EXPORT_REQUEST_WINDOW_STATES.history
  return EXPORT_REQUEST_WINDOW_STATES.hidden
}

export function exportRequestSortValue(row) {
  return row?.sort_at || row?.updated_at || row?.requested_at || row?.created_at || null
}

export function exportRequestWindowFields(row, sortAt) {
  const value = sortAt || exportRequestSortValue(row)
  return {
    window_state: exportRequestWindowState(row),
    ...(value ? { sort_at: value } : {}),
  }
}

export function isVisibleExportRequest(row) {
  if (!row || row.deleted === true || row.active === false) return false
  return canonicalExportRequestWindowStatus(row.status) !== 'deleted'
}

export function exportRequestTimeValue(row) {
  const value = exportRequestSortValue(row)
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0
  }
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1_000_000)
  }
  const time = new Date(value || 0).getTime()
  return Number.isFinite(time) ? time : 0
}

export function safeExportRequestPageSize(value, fallback = EXPORT_REQUEST_HISTORY_PAGE_SIZE) {
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(EXPORT_REQUEST_MAX_PAGE_SIZE, Math.max(10, parsed))
}

export function mergeExportRequestWindows(queueRows = [], historyRows = [], queuePageRows = []) {
  const rows = new Map()

  // Historical rows are inserted first. A realtime queue copy of the same
  // request wins so a reopened/cancelled release is reflected immediately.
  for (const row of historyRows) {
    if (isVisibleExportRequest(row) && row.id) rows.set(String(row.id), row)
  }
  for (const row of queuePageRows) {
    if (isVisibleExportRequest(row) && row.id) rows.set(String(row.id), row)
  }
  for (const row of queueRows) {
    if (isVisibleExportRequest(row) && row.id) rows.set(String(row.id), row)
  }

  return Array.from(rows.values()).sort((left, right) => {
    const timeCompare = exportRequestTimeValue(right) - exportRequestTimeValue(left)
    if (timeCompare) return timeCompare
    return String(right.id || '').localeCompare(String(left.id || ''))
  })
}
