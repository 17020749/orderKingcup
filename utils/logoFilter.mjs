export const LOGO_FILTER_VALUES = Object.freeze({
  withLogo: 'with_logo',
  withoutLogo: 'without_logo',
})

export const LOGO_FILTER_OPTIONS = Object.freeze([
  { label: 'Có logo', value: LOGO_FILTER_VALUES.withLogo },
  { label: 'Không có logo', value: LOGO_FILTER_VALUES.withoutLogo },
])

const EMPTY_LOGO_VALUES = new Set([
  '',
  '-',
  'khong logo',
  'no logo',
  'none',
  'null',
  'undefined',
])

function normalizeLogoText(value) {
  return String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function hasMeaningfulLogo(value) {
  if (Array.isArray(value)) return value.some(item => hasMeaningfulLogo(item))
  if (value && typeof value === 'object') {
    return Object.values(value).some(item => hasMeaningfulLogo(item))
  }
  return !EMPTY_LOGO_VALUES.has(normalizeLogoText(value))
}

export function rowsHaveLogo(rows = [], resolveLogo = row => row?.logo) {
  const values = Array.isArray(rows) ? rows : []
  return values.some(row => hasMeaningfulLogo(resolveLogo(row)))
}

export function matchesLogoPresenceFilter(hasLogo, filterValue) {
  if (!filterValue) return true
  if (filterValue === LOGO_FILTER_VALUES.withLogo) return Boolean(hasLogo)
  if (filterValue === LOGO_FILTER_VALUES.withoutLogo) return !hasLogo
  return true
}
