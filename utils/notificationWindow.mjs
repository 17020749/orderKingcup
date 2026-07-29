export const NOTIFICATION_SOURCE_LIMIT = 100
export const NOTIFICATION_READ_STATE_LIMIT = 300
export const NOTIFICATION_VISIBLE_LIMIT = 100

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

export function notificationTimestamp(value) {
  if (!value) return 0
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.seconds === 'number') {
    return value.seconds * 1000 + Math.trunc(Number(value.nanoseconds || 0) / 1_000_000)
  }
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

export function buildNotificationWindow({
  directRows = [],
  audienceRows = [],
  readIds = [],
  activeEmail = '',
} = {}) {
  const email = normalizeEmail(activeEmail)
  const readSet = new Set(readIds.map(value => String(value || '')).filter(Boolean))
  const merged = new Map()

  for (const row of [...directRows, ...audienceRows]) {
    if (!row?.id || row.deleted === true || row.active === false) continue
    const recipient = normalizeEmail(row.to_email || '')
    if (normalizeEmail(row.created_by || '') === email && !recipient) continue
    merged.set(String(row.id), row)
  }

  return Array.from(merged.values())
    .map(row => ({
      ...row,
      is_read:
        readSet.has(String(row.id))
        || row.read === true
        || row.is_read === true
        || ['read', 'seen'].includes(String(row.status || '').toLowerCase()),
    }))
    .sort((a, b) => notificationTimestamp(b.created_at) - notificationTimestamp(a.created_at))
    .slice(0, NOTIFICATION_VISIBLE_LIMIT)
}
