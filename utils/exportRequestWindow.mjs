export const EXPORT_REQUEST_OWNER_FIELDS = Object.freeze([
  'requested_by',
  'order_owner_email',
  'order_created_by',
  'order_sale_email',
])

// Keep the scoped OR query below Firestore's 30-disjunction limit:
// 4 ownership branches x 7 status values = 28 disjunctions.
export const EXPORT_REQUEST_QUEUE_STATUSES = Object.freeze([
  'cho_xu_ly',
  'pending',
  'dang_xu_ly',
  'da_tiep_nhan',
  'accepted',
  'cho_xuat_kho',
  'ready_to_export',
])

export const EXPORT_REQUEST_HISTORY_STATUSES = Object.freeze([
  'da_xuat',
  'exported',
  'completed',
  'hoan_thanh',
  'tu_choi',
  'rejected',
  'loi',
])

export const EXPORT_REQUEST_QUEUE_LIMIT = 100
export const EXPORT_REQUEST_HISTORY_PAGE_SIZE = 50
export const EXPORT_REQUEST_MAX_PAGE_SIZE = 100

export function canonicalExportRequestStatus(value) {
  return String(value || '').trim().toLowerCase()
}

export function isExportRequestQueueStatus(value) {
  return EXPORT_REQUEST_QUEUE_STATUSES.includes(canonicalExportRequestStatus(value))
}

export function isExportRequestHistoryStatus(value) {
  return EXPORT_REQUEST_HISTORY_STATUSES.includes(canonicalExportRequestStatus(value))
}

export function isVisibleExportRequest(row) {
  if (!row || row.deleted === true || row.active === false) return false
  return canonicalExportRequestStatus(row.status) !== 'deleted'
}

export function exportRequestTimeValue(row) {
  const value = row?.updated_at || row?.requested_at || row?.created_at
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

export function mergeExportRequestWindows(queueRows = [], historyRows = []) {
  const rows = new Map()

  // Historical rows are inserted first. A realtime queue copy of the same
  // request wins so a reopened/cancelled release is reflected immediately.
  for (const row of historyRows) {
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
