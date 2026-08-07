const EPSILON = 0.0001
const ZERO_WIDTH_RE = /[\u200B-\u200D\u2060\uFEFF]/g

function normalizeId(value) {
  return String(value || '').trim()
}

function quantityOf(row) {
  const value = Number(row?.quantity || 0)
  return Number.isFinite(value) ? value : 0
}

export function canonicalWarehouseLogo(value) {
  return String(value || '')
    .replace(/\u00A0/g, ' ')
    .replace(ZERO_WIDTH_RE, '')
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .trim()
}

export function warehouseLogosEquivalent(left, right) {
  return canonicalWarehouseLogo(left) === canonicalWarehouseLogo(right)
}

export function warehouseLogoLookupVariants(value) {
  const raw = String(value || '').trim()
  const stripped = raw
    .replace(/\u00A0/g, ' ')
    .replace(ZERO_WIDTH_RE, '')
    .trim()
  const canonical = canonicalWarehouseLogo(raw)
  const variants = [
    raw,
    raw.normalize('NFC'),
    raw.normalize('NFD'),
    stripped,
    stripped.normalize('NFC'),
    stripped.normalize('NFD'),
    canonical,
    canonical.normalize('NFD'),
  ]
  if (!canonical) variants.push('')
  return Array.from(new Set(variants))
}

export function equivalentWarehouseBalanceRows(rows, input = {}) {
  const productId = normalizeId(input.productId)
  const warehouseId = normalizeId(input.warehouseId)
  return (Array.isArray(rows) ? rows : []).filter(row => (
    row
    && row.deleted !== true
    && row.active !== false
    && normalizeId(row.product_id) === productId
    && normalizeId(row.warehouse_id) === warehouseId
    && warehouseLogosEquivalent(row.logo, input.logo)
  ))
}

export function selectEquivalentWarehouseBalance(rows, input = {}) {
  const matches = equivalentWarehouseBalanceRows(rows, input)
  const positive = matches.filter(row => quantityOf(row) > EPSILON)
  if (positive.length > 1) {
    return {
      balance: null,
      ambiguous: true,
      matches,
      positive,
    }
  }

  if (positive.length === 1) {
    return {
      balance: positive[0],
      ambiguous: false,
      matches,
      positive,
    }
  }

  const requestedRaw = String(input.logo || '').trim()
  const exact = matches.find(row => String(row.logo || '').trim() === requestedRaw)
  return {
    balance: exact || matches[0] || null,
    ambiguous: false,
    matches,
    positive,
  }
}
