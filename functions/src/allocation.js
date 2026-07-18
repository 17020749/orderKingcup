'use strict'

function number(value) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function epoch(value, fallback = Number.MAX_SAFE_INTEGER) {
  if (!value) return fallback
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : fallback
}

function stableText(value) {
  return String(value || '')
}

function compareFifo(left, right) {
  return epoch(left.import_date, 0) - epoch(right.import_date, 0)
    || epoch(left.created_at, 0) - epoch(right.created_at, 0)
    || stableText(left.id).localeCompare(stableText(right.id))
}

function sortLots(lots, strategy = 'fifo') {
  const rows = [...lots]
  if (strategy === 'fefo') {
    return rows.sort((left, right) =>
      epoch(left.expiry_date) - epoch(right.expiry_date)
      || compareFifo(left, right)
    )
  }
  if (strategy === 'smallest_lot_first') {
    return rows.sort((left, right) =>
      number(left.available_quantity) - number(right.available_quantity)
      || compareFifo(left, right)
    )
  }
  return rows.sort(compareFifo)
}

function allocateCandidateLots(lots, requestedQuantity, strategy = 'fifo', maxLots = 100) {
  let remaining = number(requestedQuantity)
  if (remaining <= 0) throw new Error('Số lượng xuất phải lớn hơn 0.')

  const allocations = []
  for (const lot of sortLots(lots, strategy)) {
    const available = number(lot.available_quantity)
    if (available <= 0) continue
    const quantity = Math.min(remaining, available)
    allocations.push({ lot, quantity })
    remaining = Math.round((remaining - quantity) * 1000) / 1000
    if (allocations.length > maxLots) throw new Error(`Một dòng xuất vượt quá ${maxLots} lô tồn.`)
    if (remaining <= 0) break
  }

  if (remaining > 0) {
    const error = new Error(`Không đủ tồn theo lô. Còn thiếu ${remaining}.`)
    error.code = 'INSUFFICIENT_LOT_STOCK'
    throw error
  }
  return allocations
}

module.exports = { allocateCandidateLots, sortLots }
