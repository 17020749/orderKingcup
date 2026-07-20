import { normalizeText } from './format.ts'
// @ts-ignore Shared ESM helpers are executed directly by Node tests.
import { isDateInRange, toDateKey } from '../lib/businessDate.mjs'

export type DateLike = string | number | Date | null | undefined | { toDate?: () => Date; seconds?: number }

export { isDateInRange, toDateKey }

export function matchesKeyword(values: unknown[], keyword?: string): boolean {
  const normalizedKeyword = normalizeText(keyword)
  if (!normalizedKeyword) return true
  return normalizeText(values.map(value => String(value ?? '')).join(' ')).includes(normalizedKeyword)
}

export function uniqueOptions<T extends Record<string, any>>(rows: T[], field: keyof T | string): string[] {
  return Array.from(new Set(rows.map(row => String(row?.[field as keyof T] ?? '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'vi'))
}
