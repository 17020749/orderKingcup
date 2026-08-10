import { canonicalWarehouseLogo } from './warehouseLogoIdentity.mjs'

const EPSILON = 0.0001

function normalizeId(value) {
  return String(value || '').trim()
}

function quantityOf(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function activeRows(rows, item) {
  const productId = normalizeId(item?.product_id)
  const warehouseId = normalizeId(item?.warehouse_id)
  return (Array.isArray(rows) ? rows : []).filter(row => (
    row
    && row.deleted !== true
    && row.active !== false
    && normalizeId(row.product_id) === productId
    && normalizeId(row.warehouse_id) === warehouseId
  ))
}

function lotsOf(row) {
  return Array.isArray(row?.lots)
    ? row.lots.filter(lot => lot && normalizeId(lot.id))
    : []
}

function uniqueLotMatches(rows, predicate) {
  const matches = []
  rows.forEach(balance => {
    lotsOf(balance).forEach(lot => {
      if (predicate(lot, balance)) matches.push({ balance, lot })
    })
  })
  return matches
}

function legacyImportItem(item) {
  const source = String(item?.source || '').trim().toLowerCase()
  return Boolean(String(item?.legacy_line_key || '').trim()) || !source || source !== 'nuxt'
}

export function resolveImportItemLotIdentity(rows, item) {
  const candidates = activeRows(rows, item)
  const lotId = normalizeId(item?.lot_id)
  const itemId = normalizeId(item?.id)
  const importOrderId = normalizeId(item?.import_order_id)

  if (lotId) {
    const exact = uniqueLotMatches(candidates, lot => normalizeId(lot.id) === lotId)
    if (exact.length > 1) return { ambiguous: true, reason: 'lot_id', matches: exact }
    if (exact.length === 1) return { ambiguous: false, mode: 'lot_id', ...exact[0] }
  }

  if (itemId) {
    const provenance = uniqueLotMatches(candidates, lot => (
      normalizeId(lot.import_order_item_id) === itemId
      || normalizeId(lot.cost_item_id) === itemId
    ))
    if (provenance.length > 1) return { ambiguous: true, reason: 'item_id', matches: provenance }
    if (provenance.length === 1) return { ambiguous: false, mode: 'item_id', ...provenance[0] }
  }

  if (importOrderId) {
    const orderMatches = uniqueLotMatches(candidates, lot => (
      normalizeId(lot.import_order_id) === importOrderId
      && (!item?.product_id || normalizeId(lot.product_id) === normalizeId(item.product_id))
    ))
    if (orderMatches.length === 1) return { ambiguous: false, mode: 'import_order', ...orderMatches[0] }
  }

  if (legacyImportItem(item)) {
    const requestedLogo = canonicalWarehouseLogo(item?.logo)
    const equivalent = candidates.filter(row => canonicalWarehouseLogo(row.logo) === requestedLogo)
    const usable = equivalent.filter(row => quantityOf(row.quantity) > EPSILON)
    if (usable.length === 1) {
      const positiveLots = lotsOf(usable[0]).filter(lot => quantityOf(lot.available_quantity) > EPSILON)
      const onlyOpening = positiveLots.length > 0 && positiveLots.every(lot => lot.source === 'legacy_opening')
      if (onlyOpening && quantityOf(usable[0].quantity) + EPSILON >= quantityOf(item?.quantity)) {
        return {
          ambiguous: false,
          mode: 'legacy_opening',
          balance: usable[0],
          lot: null,
          clearLotId: true,
        }
      }
    }
  }

  return { ambiguous: false, mode: 'unresolved', balance: null, lot: null }
}
