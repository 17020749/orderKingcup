import { toNumber } from '~/utils/format'

export type WarehouseIssueStrategy = 'fifo' | 'fefo' | 'smallest_lot_first'

export type InventoryLotState = {
  id: string
  import_order_id?: string
  import_order_item_id?: string
  import_code?: string
  import_date?: string
  expiry_date?: string
  product_id?: string
  warehouse_id?: string
  logo?: string
  unit?: string
  supplier_id?: string
  supplier_name?: string
  received_quantity: number
  available_quantity: number
  cost_item_id?: string
  source_lot_id?: string
  transfer_export_order_id?: string
  transfer_export_item_id?: string
  source?: string
  status?: string
}

export type LotAllocation = {
  lot_id: string
  quantity: number
  import_order_id?: string
  import_order_item_id?: string
  import_code?: string
  import_date?: string
  expiry_date?: string
  cost_item_id?: string
  source_lot_id?: string
  destination_lot_id?: string
  source?: string
}

export function roundQuantity(value: any) {
  return Math.round(toNumber(value) * 1000) / 1000
}

function epoch(value: any, fallback = Number.MAX_SAFE_INTEGER) {
  if (!value) return fallback
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : fallback
}

function fifoCompare(left: InventoryLotState, right: InventoryLotState) {
  return epoch(left.import_date, 0) - epoch(right.import_date, 0)
    || String(left.id || '').localeCompare(String(right.id || ''))
}

export function sortInventoryLots(lots: InventoryLotState[], strategy: WarehouseIssueStrategy = 'fifo') {
  const rows = [...lots]
  if (strategy === 'fefo') {
    return rows.sort((left, right) =>
      epoch(left.expiry_date) - epoch(right.expiry_date)
      || fifoCompare(left, right)
    )
  }
  if (strategy === 'smallest_lot_first') {
    return rows.sort((left, right) =>
      roundQuantity(left.available_quantity) - roundQuantity(right.available_quantity)
      || fifoCompare(left, right)
    )
  }
  return rows.sort(fifoCompare)
}

export function normalizeLots(value: any): InventoryLotState[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(row => row && String(row.id || '').trim())
    .map(row => ({
      ...row,
      id: String(row.id || '').trim(),
      received_quantity: roundQuantity(row.received_quantity),
      available_quantity: roundQuantity(row.available_quantity),
    }))
    .filter(row => row.available_quantity > 0)
}

export function reconcileOpeningLot(input: {
  balanceId: string
  balanceQuantity: number
  lots: InventoryLotState[]
  productId?: string
  warehouseId?: string
  logo?: string
  unit?: string
}) {
  const lots = normalizeLots(input.lots)
  const tracked = roundQuantity(lots.reduce((sum, lot) => sum + roundQuantity(lot.available_quantity), 0))
  const balanceQuantity = roundQuantity(input.balanceQuantity)
  const missing = roundQuantity(balanceQuantity - tracked)
  if (missing < -0.0001) {
    throw new Error(`Dữ liệu lô đang lớn hơn tồn tổng ${Math.abs(missing)}. Cần đối soát tồn kho trước khi xuất.`)
  }
  if (missing > 0.0001) {
    const lotId = `opening__${input.balanceId}`
    const existing = lots.find(lot => lot.id === lotId)
    if (existing) {
      existing.received_quantity = roundQuantity(existing.received_quantity + missing)
      existing.available_quantity = roundQuantity(existing.available_quantity + missing)
    } else {
      lots.push({
        id: lotId,
        import_order_id: '',
        import_order_item_id: '',
        import_code: 'OPENING',
        import_date: '1970-01-01',
        product_id: input.productId || '',
        warehouse_id: input.warehouseId || '',
        logo: input.logo || '',
        unit: input.unit || '',
        received_quantity: missing,
        available_quantity: missing,
        cost_item_id: '',
        source: 'legacy_opening',
        status: 'available',
      })
    }
  }
  return lots
}

export function allocateInventoryLots(input: {
  lots: InventoryLotState[]
  quantity: number
  strategy?: WarehouseIssueStrategy
  maxLots?: number
}) {
  let remaining = roundQuantity(input.quantity)
  if (remaining <= 0) throw new Error('Số lượng xuất phải lớn hơn 0.')
  const maxLots = Math.max(1, Math.min(100, Math.floor(toNumber(input.maxLots) || 50)))
  const working = normalizeLots(input.lots)
  const allocations: LotAllocation[] = []

  for (const lot of sortInventoryLots(working, input.strategy || 'fifo')) {
    const available = roundQuantity(lot.available_quantity)
    if (available <= 0) continue
    const quantity = roundQuantity(Math.min(remaining, available))
    lot.available_quantity = roundQuantity(available - quantity)
    lot.status = lot.available_quantity > 0 ? 'available' : 'depleted'
    allocations.push({
      lot_id: lot.id,
      quantity,
      import_order_id: lot.import_order_id || '',
      import_order_item_id: lot.import_order_item_id || '',
      import_code: lot.import_code || '',
      import_date: lot.import_date || '',
      expiry_date: lot.expiry_date || '',
      cost_item_id: lot.cost_item_id || lot.import_order_item_id || '',
      source_lot_id: lot.source_lot_id || '',
      source: lot.source || '',
    })
    remaining = roundQuantity(remaining - quantity)
    if (allocations.length > maxLots) throw new Error(`Một dòng xuất vượt quá giới hạn ${maxLots} lô.`)
    if (remaining <= 0) break
  }

  if (remaining > 0.0001) throw new Error(`Không đủ tồn theo lô. Còn thiếu ${remaining}.`)
  return {
    allocations,
    lots: working.filter(lot => roundQuantity(lot.available_quantity) > 0),
  }
}

export function restoreInventoryLots(lotsValue: any, allocationsValue: any) {
  const lots = normalizeLots(lotsValue)
  const allocations = Array.isArray(allocationsValue) ? allocationsValue : []
  allocations.forEach((allocation: any) => {
    const quantity = roundQuantity(allocation.quantity)
    if (quantity <= 0) return
    const lotId = String(allocation.lot_id || '').trim()
    if (!lotId) throw new Error('Thiếu mã lô khi hoàn tồn.')
    const existing = lots.find(lot => lot.id === lotId)
    if (existing) {
      existing.available_quantity = roundQuantity(existing.available_quantity + quantity)
      existing.received_quantity = Math.max(roundQuantity(existing.received_quantity), existing.available_quantity)
      existing.status = 'available'
      return
    }
    lots.push({
      id: lotId,
      import_order_id: allocation.import_order_id || '',
      import_order_item_id: allocation.import_order_item_id || '',
      import_code: allocation.import_code || '',
      import_date: allocation.import_date || '',
      expiry_date: allocation.expiry_date || '',
      cost_item_id: allocation.cost_item_id || allocation.import_order_item_id || '',
      source_lot_id: allocation.source_lot_id || '',
      source: allocation.source || '',
      received_quantity: quantity,
      available_quantity: quantity,
      status: 'available',
    })
  })
  return lots
}

export function parseLotAllocations(value: any): LotAllocation[] {
  if (Array.isArray(value)) return value
  if (!value) return []
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
