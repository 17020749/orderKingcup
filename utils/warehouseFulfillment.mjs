function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeJsonParse(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === 'object')) return value
  try {
    return JSON.parse(String(value || ''))
  } catch {
    return fallback
  }
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const number = Number(String(value || '').replace(/,/g, '').trim())
  return Number.isFinite(number) ? number : 0
}

const REQUESTED_STATUSES = new Set([
  'cho_xu_ly', 'dang_xu_ly', 'da_tiep_nhan', 'cho_xuat_kho', 'cho_xac_nhan',
  'pending', 'processing', 'accepted', 'ready_to_export',
  'da_xuat_1_phan', 'da_xuat_mot_phan', 'partial_exported',
])
const PROCESSED_STATUSES = new Set([
  'da_tiep_nhan', 'cho_xuat_kho', 'cho_xac_nhan', 'accepted', 'ready_to_export',
  'da_xuat_1_phan', 'da_xuat_mot_phan', 'partial_exported',
])
const EXPORTED_STATUSES = new Set([
  'da_xuat', 'da_xuat_kho', 'da_xuat_du', 'exported', 'completed', 'hoan_thanh',
])
const REJECTED_STATUSES = new Set(['tu_choi', 'rejected', 'cancelled', 'da_huy', 'loi'])

function canonicalStatus(value) {
  return normalizeText(value).replace(/\s+/g, '_')
}

function logoKey(value) {
  return String(value || '').trim().toUpperCase()
}

function productLogoKey(code, logo) {
  return `${String(code || '').trim().toUpperCase()}|${logoKey(logo)}`
}

function referenceKey(orderItemId, logo) {
  return `${String(orderItemId || '').trim()}|${logoKey(logo)}`
}

export function requestWarehouseItems(request) {
  const payload = typeof request?.payload === 'object'
    ? request.payload
    : safeJsonParse(request?.payload_json, {})
  if (Array.isArray(payload?.items)) return payload.items
  if (Array.isArray(request?.items)) return request.items
  return []
}

function requestedQuantity(item) {
  return toNumber(
    item?.export_quantity
    ?? item?.request_quantity
    ?? item?.requested_quantity
    ?? item?.quantity
    ?? item?.qty,
  )
}

function actualExportedQuantity(item, status, requested) {
  const explicit = toNumber(
    item?.actual_export_quantity
    ?? item?.actual_exported_quantity
    ?? item?.exported_quantity
    ?? item?.exported_qty
    ?? item?.warehouse_export_quantity
    ?? item?.warehouse_exported_quantity
    ?? item?.stock_out_quantity
    ?? item?.fulfilled_quantity
    ?? item?.actual_quantity,
  )
  if (explicit > 0) return Math.min(requested || explicit, explicit)
  return EXPORTED_STATUSES.has(status) ? requested : 0
}

function processedQuantity(item, status, requested, exported) {
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
    ?? item?.confirmed_quantity,
  )
  if (explicit > 0) return Math.min(requested || explicit, Math.max(explicit, exported))
  if (EXPORTED_STATUSES.has(status)) return Math.max(requested, exported)
  return PROCESSED_STATUSES.has(status) ? requested : 0
}

function expandOrderItems(items) {
  return (Array.isArray(items) ? items : []).flatMap(item => {
    const logos = safeJsonParse(item.logo_json, [])
    if (Array.isArray(logos) && logos.length) {
      return logos.map(line => ({
        order_item_id: item.id || '',
        product_id: item.product_id || '',
        product_code: item.product_code || '',
        product_name: item.product_name || '',
        unit: item.unit || '',
        logo: String(line.logo || ''),
        quantity: toNumber(line.quantity ?? line.qty),
      }))
    }
    return [{
      order_item_id: item.id || '',
      product_id: item.product_id || '',
      product_code: item.product_code || '',
      product_name: item.product_name || '',
      unit: item.unit || '',
      logo: '',
      quantity: toNumber(item.quantity),
    }]
  })
}

function add(map, mapKey, quantity) {
  if (!mapKey || quantity <= 0) return
  map.set(mapKey, (map.get(mapKey) || 0) + quantity)
}

function allocate(rows, predicate, quantity, field) {
  let remaining = quantity
  for (const row of rows.filter(predicate)) {
    if (remaining <= 0) break
    const capacity = Math.max(0, row.ordered_qty - row[field])
    const allocated = Math.min(capacity, remaining)
    row[field] += allocated
    remaining -= allocated
  }
}

function quantityMaps(requests, excludeRequestId = '') {
  const maps = {
    requestedByReference: new Map(), processedByReference: new Map(), exportedByReference: new Map(),
    requestedLegacyByProductLogo: new Map(), processedLegacyByProductLogo: new Map(), exportedLegacyByProductLogo: new Map(),
    requestedLegacyNoLogo: new Map(), processedLegacyNoLogo: new Map(), exportedLegacyNoLogo: new Map(),
  }

  ;(Array.isArray(requests) ? requests : [])
    .filter(request => String(request.request_id || request.id) !== excludeRequestId)
    .forEach(request => {
      const status = canonicalStatus(request.status)
      if (REJECTED_STATUSES.has(status)) return
      const active = REQUESTED_STATUSES.has(status) || PROCESSED_STATUSES.has(status) || EXPORTED_STATUSES.has(status)
      if (!active) return

      requestWarehouseItems(request).forEach(item => {
        const code = String(item.product_code || '').trim().toUpperCase()
        const logo = String(item.logo || '').trim()
        const sourceOrderItemId = String(item.source_order_item_id || item.order_item_id || '').trim()
        const requested = requestedQuantity(item)
        if (!code || requested <= 0) return
        const exported = actualExportedQuantity(item, status, requested)
        const processed = processedQuantity(item, status, requested, exported)

        if (sourceOrderItemId) {
          const target = referenceKey(sourceOrderItemId, logo)
          add(maps.requestedByReference, target, requested)
          add(maps.processedByReference, target, processed)
          add(maps.exportedByReference, target, exported)
        } else if (logo) {
          const target = productLogoKey(code, logo)
          add(maps.requestedLegacyByProductLogo, target, requested)
          add(maps.processedLegacyByProductLogo, target, processed)
          add(maps.exportedLegacyByProductLogo, target, exported)
        } else {
          add(maps.requestedLegacyNoLogo, code, requested)
          add(maps.processedLegacyNoLogo, code, processed)
          add(maps.exportedLegacyNoLogo, code, exported)
        }
      })
    })

  return maps
}

function applyAllocations(rows, maps, field, byReference, legacyByProductLogo, legacyNoLogo) {
  for (const [target, quantity] of maps[byReference]) {
    allocate(rows, row => referenceKey(row.order_item_id, row.logo) === target, quantity, field)
  }
  for (const [target, quantity] of maps[legacyByProductLogo]) {
    allocate(rows, row => productLogoKey(row.product_code, row.logo) === target, quantity, field)
  }
  for (const [code, quantity] of maps[legacyNoLogo]) {
    allocate(rows, row => String(row.product_code || '').trim().toUpperCase() === code && !logoKey(row.logo), quantity, field)
  }
}

export function buildWarehouseFulfillmentRows(items, requests, excludeRequestId = '') {
  const maps = quantityMaps(requests, excludeRequestId)
  const rows = expandOrderItems(items).map(line => ({
    order_item_id: line.order_item_id,
    product_id: line.product_id,
    product_code: line.product_code,
    product_name: line.product_name,
    logo: line.logo,
    unit: line.unit,
    ordered_qty: toNumber(line.quantity),
    requested_qty: 0,
    processed_qty: 0,
    exported_qty: 0,
    pending_qty: 0,
    remaining_qty: 0,
    available_to_request_qty: 0,
    status: 'Chưa xuất',
  }))

  applyAllocations(rows, maps, 'requested_qty', 'requestedByReference', 'requestedLegacyByProductLogo', 'requestedLegacyNoLogo')
  applyAllocations(rows, maps, 'processed_qty', 'processedByReference', 'processedLegacyByProductLogo', 'processedLegacyNoLogo')
  applyAllocations(rows, maps, 'exported_qty', 'exportedByReference', 'exportedLegacyByProductLogo', 'exportedLegacyNoLogo')

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

export function buildWarehouseOrderItemsFromRequestSnapshots(requests) {
  const lines = new Map()
  ;(Array.isArray(requests) ? requests : []).forEach(request => {
    requestWarehouseItems(request).forEach(item => {
      const sourceOrderItemId = String(item?.source_order_item_id || item?.order_item_id || '').trim()
      const productCode = String(item?.product_code || '').trim()
      const productId = String(item?.product_id || '').trim()
      const logo = String(item?.logo || '').trim()
      const requested = requestedQuantity(item)
      const ordered = toNumber(
        item?.order_quantity
        ?? item?.ordered_quantity
        ?? item?.ordered_qty
        ?? item?.source_quantity
        ?? requested,
      )
      if ((!sourceOrderItemId && !productCode) || ordered <= 0) return
      const key = sourceOrderItemId
        ? `${sourceOrderItemId}|${logoKey(logo)}`
        : `${productCode.toUpperCase()}|${logoKey(logo)}`
      const previous = lines.get(key)
      const quantity = Math.max(ordered, toNumber(previous?.quantity))
      lines.set(key, {
        id: sourceOrderItemId || `legacy:${productCode}:${logoKey(logo)}`,
        product_id: productId || previous?.product_id || '',
        product_code: productCode || previous?.product_code || '',
        product_name: String(item?.product_name || previous?.product_name || '').trim(),
        unit: String(item?.unit || previous?.unit || '').trim(),
        quantity,
        logo_json: logo ? JSON.stringify([{ logo, quantity }]) : '',
      })
    })
  })
  return Array.from(lines.values())
}

export function orderWarehouseFulfillmentSummaryFromRequests(requests) {
  const activeRequests = (Array.isArray(requests) ? requests : []).filter(request => (
    request?.deleted !== true && request?.active !== false
  ))
  const items = buildWarehouseOrderItemsFromRequestSnapshots(activeRequests)
  return orderWarehouseFulfillmentSummary(
    buildWarehouseFulfillmentRows(items, activeRequests),
    activeRequests,
  )
}

export function orderWarehouseFulfillmentSummary(rows, requests) {
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

  const statuses = (Array.isArray(requests) ? requests : [])
    .filter(request => !REJECTED_STATUSES.has(canonicalStatus(request.status)))
    .map(request => canonicalStatus(request.status))
  const requestStatus = statuses.some(status => REQUESTED_STATUSES.has(status) && !PROCESSED_STATUSES.has(status))
    ? 'cho_xu_ly'
    : processed > exported
      ? 'da_tiep_nhan'
      : statuses.some(status => EXPORTED_STATUSES.has(status))
        ? 'da_xuat'
        : (Array.isArray(requests) ? requests : []).some(request => REJECTED_STATUSES.has(canonicalStatus(request.status)))
          ? 'co_tu_choi'
          : ''

  return { warehouse_fulfillment_status: fulfillment, warehouse_request_status: requestStatus }
}

export function requestWarehouseLineProgress(request) {
  const status = canonicalStatus(request?.status)
  return requestWarehouseItems(request).map(item => {
    const requested = requestedQuantity(item)
    const exported = actualExportedQuantity(item, status, requested)
    const processed = processedQuantity(item, status, requested, exported)
    return {
      ...item,
      requested_qty: requested,
      processed_qty: Math.max(processed, exported),
      exported_qty: exported,
    }
  })
}
