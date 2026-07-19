import { normalizeText } from './format.ts'

export type DateLike = string | number | Date | null | undefined | { toDate?: () => Date; seconds?: number }

export function toDateKey(value: DateLike): string {
  if (!value) return ''
  const date = typeof (value as any)?.toDate === 'function'
    ? (value as any).toDate()
    : typeof (value as any)?.seconds === 'number'
      ? new Date((value as any).seconds * 1000)
      : new Date(value as any)
  if (!date || Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

export function isDateInRange(value: DateLike, from?: string, to?: string): boolean {
  const key = toDateKey(value)
  if (from && (!key || key < from)) return false
  if (to && (!key || key > to)) return false
  return true
}

export function matchesKeyword(values: unknown[], keyword?: string): boolean {
  const normalizedKeyword = normalizeText(keyword)
  if (!normalizedKeyword) return true
  return normalizeText(values.map(value => String(value ?? '')).join(' ')).includes(normalizedKeyword)
}

export function uniqueOptions<T extends Record<string, any>>(rows: T[], field: keyof T | string): string[] {
  return Array.from(new Set(rows.map(row => String(row?.[field as keyof T] ?? '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'vi'))
}
