export const BUSINESS_TIME_ZONE = 'Asia/Ho_Chi_Minh'

const businessDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function toValidDate(value) {
  if (value?.toDate && typeof value.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null
  }
  if (typeof value?.seconds === 'number') {
    const date = new Date(value.seconds * 1000)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function businessDateKey(value = new Date()) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const date = toValidDate(value)
  if (!date) return ''

  const parts = Object.fromEntries(
    businessDateFormatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function todayKey(value = new Date()) {
  return businessDateKey(value) || businessDateKey(new Date())
}

export function monthKey(dateValue = new Date()) {
  const raw = typeof dateValue === 'string' ? dateValue.trim() : ''
  if (/^\d{4}-\d{2}$/.test(raw)) return raw
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7)

  const key = businessDateKey(dateValue)
  return (key || todayKey()).slice(0, 7)
}

export function toDateKey(value) {
  if (!value) return ''
  return businessDateKey(value)
}

export function isDateInRange(value, from, to) {
  const key = toDateKey(value)
  if (from && (!key || key < from)) return false
  if (to && (!key || key > to)) return false
  return true
}
