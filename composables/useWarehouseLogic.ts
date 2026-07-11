import type { OrderItemDoc } from '~/types/models'
import { normalizeText, safeJsonParse, toNumber } from '~/utils/format'

export type FulfillmentRow = {
  product_code: string
  product_name: string
  logo: string
  unit: string
  ordered_qty: number
  requested_qty: number
  processed_qty: number
  exported_qty: number
  pending_qty: number
  remaining_qty: number
  available_to_request_qty: number
  status: string
}

const REQUESTED_STATUSES = new Set([
  'cho_xu_ly', 'dang_xu_ly', 'da_tiep_nhan', 'cho_xuat_kho', 'cho_xac_nhan',
  'pending', 'processing', 'accepted', 'ready_to_export',
  'da_xuat_1_phan', 'da_xuat_mot_phan', 'partial_exported'
])
const PROCESSED_STATUSES = new Set([
  'da_tiep_nhan', 'cho_xuat_kho', 'cho_xac_nhan', 'accepted', 'ready_to_export',
  'da_xuat_1_phan', 'da_xuat_mot_phan', 'partial_exported'
])
const EXPORTED_STATUSES = new Set([
  'da_xuat', 'da_xuat_kho', 'da_xuat_du', 'exported', 'completed', 'hoan_thanh'
])
const REJECTED_STATUSES = new Set(['tu_choi', 'rejected', 'cancelled', 'da_huy', 'loi'])

function canonicalStatus(value: any) {
  return normalizeText(value).replace(/\s+/g, '_')
}

function key(code: any, logo: any) {
  return `${String(code || '').trim().toUpperCase()}|${String(logo || '').trim().toUpperCase()}`
}

function requestItems(request: any) {
  const payload = typeof request?.payload === 'object'
    ? request.payload
    : safeJsonParse(request?.payload_json, {})
  if (Array.isArray(payload?.items)) return payload.items
  if (Array.isArray(request?.items)) return request.items
  return []
}

function requestedQuantity(item: any) {
  return toNumber(
    item?.export_quantity
    ?? item?.request_quantity
    ?? item?.requested_quantity
    ?? item?.quantity
    ?? item?.qty
  )
}

function actualExportedQuantity(item: any, status: string, requested: number) {
  const explicit = toNumber(
    item?.actual_export_quantity
    ?? item?.actual_exported_quantity
    ?? item?.exported_quantity
    ?? item?.exported_qty
    ?? item?.warehouse_export_quantity
    ?? item?.warehouse_exported_quantity
    ?? item?.stock_out_quantity
    ?? item?.fulfilled_quantity
    ?? item?.actual_quantity
  )
  if (explicit > 0) return Math.min(requested || explicit, explicit)
  return EXPORTED_STATUSES.has(status) ? requested : 0
}

function processedQuantity(item: any, status: string, requested: number, exported: number) {
  const explicit = toNumber(
    item?.processed_quantity
    ?? item?.processed_qty
    ?? item?.approved_quantity
    ?? item?.approved_qty
    ?? item?.accepted_quantity
    ?? item?.accepted_qty
    ?? item?.warehouse_processed_quantity
    ?? item?.warehouse_accepted_quantity
    ?? item?.handled_quantity
    ?? item?.confirmed_quantity
  )
  if (explicit > 0) return Math.min(requested || explicit, Math.max(explicit, exported))
  if (EXPORTED_STATUSES.has(status)) return Math.max(requested, exported)
  return PROCESSED_STATUSES.has(status) ? requested : 0
}

function expandOrderItems(items: OrderItemDoc[]) {
  return items.flatMap(item => {
    const logos = safeJsonParse(item.logo_json, [])
    if (Array.isArray(logos) && logos.length) {
      return logos.map(line => ({
        product_code: item.product_code || '',
        product_name: item.product_name || '',
        unit: item.unit || '',
        logo: String(line.logo || ''),
        quantity: toNumber(line.quantity ?? line.qty)
      }))
    }
    return [{
      product_code: item.product_code || '',
      product_name: item.product_name || '',
      unit: item.unit || '',
      logo: '',
      quantity: toNumber(item.quantity)
    }]
  })
}

type QuantityMaps = {
  requested: Map<string, number>
  processed: Map<string, number>
  exported: Map<string, number>
  requestedCodeOnly: Map<string, number>
  processedCodeOnly: Map<string, number>
  exportedCodeOnly: Map<string, number>
}

function add(map: Map<string, number>, mapKey: string, quantity: number) {
  if (!mapKey || quantity <= 0) return
  map.set(mapKey, (map.get(mapKey) || 0) + quantity)
}

function allocateCodeOnly(rows: FulfillmentRow[], code: string, quantity: number, field: 'requested_qty' | 'processed_qty' | 'exported_qty') {
  let remaining = quantity
  for (const row of rows.filter(item => item.product_code.trim().toUpperCase() === code)) {
    if (remaining <= 0) break
    const capacity = Math.max(0, row.ordered_qty - row[field])
    const allocated = Math.min(capacity, remaining)
    row[field] += allocated
    remaining -= allocated
  }
}

export function useWarehouseLogic() {
  function quantityMaps(requests: any[], excludeRequestId = ''): QuantityMaps {
    const maps: QuantityMaps = {
      requested: new Map(), processed: new Map(), exported: new Map(),
      requestedCodeOnly: new Map(), processedCodeOnly: new Map(), exportedCodeOnly: new Map()
    }

    requests
      .filter(request => String(request.request_id || request.id) !== excludeRequestId)
      .forEach(request => {
        const status = canonicalStatus(request.status)
        if (REJECTED_STATUSES.has(status)) return
        const isActiveRequest = REQUESTED_STATUSES.has(status) || PROCESSED_STATUSES.has(status) || EXPORTED_STATUSES.has(status)
        if (!isActiveRequest) return

        requestItems(request).forEach((item: any) => {
          const code = String(item.product_code || '').trim().toUpperCase()
          const logo = String(item.logo || '').trim()
          const requested = requestedQuantity(item)
          if (!code || requested <= 0) return
          const exported = actualExportedQuantity(item, status, requested)
          const processed = processedQuantity(item, status, requested, exported)
          const targetKey = key(code, logo)

          if (logo) {
            add(maps.requested, targetKey, requested)
            add(maps.processed, targetKey, processed)
            add(maps.exported, targetKey, exported)
          } else {
            add(maps.requestedCodeOnly, code, requested)
            add(maps.processedCodeOnly, code, processed)
            add(maps.exportedCodeOnly, code, exported)
          }
        })
      })

    return maps
  }

  function buildFulfillmentRows(items: OrderItemDoc[], requests: any[], excludeRequestId = ''): FulfillmentRow[] {
    const maps = quantityMaps(requests, excludeRequestId)
    const rows = expandOrderItems(items).map(line => {
      const ordered = toNumber(line.quantity)
      const rowKey = key(line.product_code, line.logo)
      const requested = Math.min(ordered, maps.requested.get(rowKey) || 0)
      const processed = Math.min(requested, maps.processed.get(rowKey) || 0)
      const exported = Math.min(processed || requested, maps.exported.get(rowKey) || 0)
      return {
        product_code: line.product_code,
        product_name: line.product_name,
        logo: line.logo,
        unit: line.unit,
        ordered_qty: ordered,
        requested_qty: requested,
        processed_qty: Math.max(processed, exported),
        exported_qty: exported,
        pending_qty: Math.max(0, requested - Math.max(processed, exported)),
        remaining_qty: Math.max(0, ordered - exported),
        available_to_request_qty: Math.max(0, ordered - requested),
        status: 'Chưa xuất'
      }
    })

    for (const [code, quantity] of maps.requestedCodeOnly) allocateCodeOnly(rows, code, quantity, 'requested_qty')
    for (const [code, quantity] of maps.processedCodeOnly) allocateCodeOnly(rows, code, quantity, 'processed_qty')
    for (const [code, quantity] of maps.exportedCodeOnly) allocateCodeOnly(rows, code, quantity, 'exported_qty')

    rows.forEach(row => {
      row.requested_qty = Math.min(row.ordered_qty, row.requested_qty)
      row.processed_qty = Math.min(row.requested_qty, Math.max(row.processed_qty, row.exported_qty))
      row.exported_qty = Math.min(row.processed_qty || row.requested_qty, row.exported_qty)
      row.pending_qty = Math.max(0, row.requested_qty - row.processed_qty)
      row.remaining_qty = Math.max(0, row.ordered_qty - row.exported_qty)
      row.available_to_request_qty = Math.max(0, row.ordered_qty - row.requested_qty)
      row.status = row.remaining_qty <= 0
        ? 'Đã xuất đủ'
        : row.exported_qty > 0
          ? 'Đã xuất 1 phần'
          : row.processed_qty > 0
            ? 'Đã xử lý, chờ xuất'
            : row.requested_qty > 0
              ? 'Chờ xử lý'
              : 'Chưa xuất'
    })
    return rows
  }

  function orderSummary(rows: FulfillmentRow[], requests: any[]) {
    const exported = rows.reduce((sum, row) => sum + row.exported_qty, 0)
    const requested = rows.reduce((sum, row) => sum + row.requested_qty, 0)
    const processed = rows.reduce((sum, row) => sum + row.processed_qty, 0)
    const fulfillment = rows.length && rows.every(row => row.remaining_qty <= 0)
      ? 'da_xuat_du'
      : exported > 0
        ? 'da_xuat_1_phan'
        : requested > 0
          ? 'cho_xu_ly'
          : 'chua_xuat'

    const statuses = requests.filter(request => !REJECTED_STATUSES.has(canonicalStatus(request.status))).map(request => canonicalStatus(request.status))
    const requestStatus = statuses.some(status => REQUESTED_STATUSES.has(status) && !PROCESSED_STATUSES.has(status))
      ? 'cho_xu_ly'
      : processed > exported
        ? 'da_tiep_nhan'
        : statuses.some(status => EXPORTED_STATUSES.has(status))
          ? 'da_xuat'
          : requests.some(request => REJECTED_STATUSES.has(canonicalStatus(request.status)))
            ? 'co_tu_choi'
            : ''

    return { warehouse_fulfillment_status: fulfillment, warehouse_request_status: requestStatus }
  }

  function requestLineProgress(request: any) {
    const status = canonicalStatus(request?.status)
    return requestItems(request).map((item: any) => {
      const requested = requestedQuantity(item)
      const exported = actualExportedQuantity(item, status, requested)
      const processed = processedQuantity(item, status, requested, exported)
      return {
        ...item,
        requested_qty: requested,
        processed_qty: Math.max(processed, exported),
        exported_qty: exported
      }
    })
  }

  return { buildFulfillmentRows, orderSummary, requestItems, requestLineProgress }
}
