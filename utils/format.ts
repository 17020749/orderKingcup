export function normalizeText(value: any) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeEmail(value: any) {
  return String(value || '').trim().toLowerCase()
}

export function toNumber(value: any) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const cleaned = String(value || '').replace(/,/g, '').trim()
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : 0
}

export function round2(value: any) {
  return Math.round(toNumber(value) * 100) / 100
}

export function money(value: any) {
  return toNumber(value).toLocaleString('vi-VN') + ' ₫'
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

export function nowDateTimeLocal() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function dateTimeLocal(value: any) {
  if (!value) return ''
  const raw = String(value)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return raw.slice(0, 16)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw)) return raw.replace(' ', 'T').slice(0, 16)
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.length >= 16 ? raw.replace(' ', 'T').slice(0, 16) : ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDateTime(value: any) {
  if (!value) return ''
  if (value?.toDate) return value.toDate().toLocaleString('vi-VN', { hour12: false })
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).replace('T', ' ')
  return d.toLocaleString('vi-VN', { hour12: false })
}

export function monthKey(dateValue?: any) {
  const raw = String(dateValue || todayKey())
  if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7)
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return todayKey().slice(0, 7)
  return d.toISOString().slice(0, 7)
}

export function makeId(prefix = 'id') {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14)
  return `${prefix}_${Date.now()}_${rand}`
}

export function makeCode(prefix: string) {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${prefix}-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${Math.floor(Math.random() * 900 + 100)}`
}

export function isActive(doc: any) {
  if (!doc) return false
  if (doc.deleted === true) return false
  if (doc.active === false) return false
  const status = normalizeText(doc.status)
  if (status === 'deleted') return false
  if (status === 'inactive') return false
  if (status === 'da xoa') return false
  if (status === 'ngung hoat dong') return false
  return true
}

export function safeJsonParse(value: any, fallback: any = []) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value
  try {
    return JSON.parse(String(value || ''))
  } catch {
    return fallback
  }
}
