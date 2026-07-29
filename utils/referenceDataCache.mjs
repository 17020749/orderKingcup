export const REFERENCE_DATA_COLLECTIONS = Object.freeze([
  'products',
  'warehouses',
  'suppliers',
  'units',
])

export const REFERENCE_VERSION_QUERY_LIMIT = 5
export const REFERENCE_VERSION_STORAGE_PREFIX = 'kingcup.reference-version.v1.'

function timestampToken(value) {
  if (value == null) return ''
  if (typeof value.toMillis === 'function') return String(value.toMillis())
  if (typeof value.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && !Number.isNaN(date.getTime())
      ? date.toISOString()
      : String(value)
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const seconds = Number(value.seconds ?? value._seconds)
    const nanoseconds = Number(value.nanoseconds ?? value._nanoseconds ?? 0)
    if (Number.isFinite(seconds)) return `${seconds}:${Number.isFinite(nanoseconds) ? nanoseconds : 0}`
  }
  return String(value)
}

export function referenceSnapshotSignature(rows = []) {
  return rows
    .map(row => {
      const data = typeof row?.data === 'function' ? row.data() : row || {}
      const id = String(row?.id || data?.id || '')
      return `${id}:${timestampToken(data?.updated_at)}`
    })
    .sort()
    .join('|')
}

export function referenceVersionStorageKey(authKey, collectionName) {
  return `${REFERENCE_VERSION_STORAGE_PREFIX}${encodeURIComponent(String(authKey || 'anonymous'))}.${collectionName}`
}

export function isReferenceDataCollection(collectionName) {
  return REFERENCE_DATA_COLLECTIONS.includes(String(collectionName || ''))
}
