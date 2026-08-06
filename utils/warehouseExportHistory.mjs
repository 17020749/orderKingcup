function text(value) {
  return String(value ?? '').trim()
}

function normalized(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .trim()
}

function parseObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isActive(row = {}) {
  const status = normalized(row.status)
  return row.deleted !== true
    && row.active !== false
    && !['deleted', 'cancelled', 'canceled', 'da_huy'].includes(status)
}

function uniqueMap(rows = []) {
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = text(row?.id || row?.firestore_id)
    if (id) map.set(id, row)
  }
  return map
}

function orderCodeMap(rows = []) {
  const map = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = normalized(row?.order_code)
    if (code && !map.has(code)) map.set(code, row)
  }
  return map
}

function firstText(...values) {
  return values.map(text).find(Boolean) || ''
}

function saleIdentity(name, email) {
  const cleanName = text(name)
  const cleanEmail = text(email).toLowerCase()
  return {
    sale_name: cleanName,
    sale_email: cleanEmail,
    sale_key: cleanEmail || normalized(cleanName),
    sale_label: cleanName && cleanEmail && normalized(cleanName) !== normalized(cleanEmail)
      ? `${cleanName} · ${cleanEmail}`
      : (cleanName || cleanEmail || '-'),
  }
}

export function toDateTimeMillis(value) {
  if (value == null || value === '') return Number.NaN
  if (typeof value?.toMillis === 'function') return Number(value.toMillis())
  if (typeof value?.seconds === 'number') {
    return Number(value.seconds) * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1_000_000)
  }
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN
  const parsed = new Date(String(value)).getTime()
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

export function isDateTimeInRange(value, from = '', to = '') {
  if (!from && !to) return true
  const current = toDateTimeMillis(value)
  if (!Number.isFinite(current)) return false
  const fromTime = from ? toDateTimeMillis(from) : Number.NEGATIVE_INFINITY
  const toTime = to ? toDateTimeMillis(to) : Number.POSITIVE_INFINITY
  if (from && !Number.isFinite(fromTime)) return false
  if (to && !Number.isFinite(toTime)) return false
  return current >= fromTime && current <= toTime
}

export function buildWarehouseExportHistoryRows(input = {}) {
  const exportOrders = (Array.isArray(input.exportOrders) ? input.exportOrders : []).filter(isActive)
  const exportOrderMap = uniqueMap(exportOrders)
  const requestMap = uniqueMap((Array.isArray(input.requests) ? input.requests : []).filter(isActive))
  const orderMap = uniqueMap((Array.isArray(input.orders) ? input.orders : []).filter(isActive))
  const orderByCode = orderCodeMap(Array.from(orderMap.values()))

  return (Array.isArray(input.exportItems) ? input.exportItems : [])
    .filter(isActive)
    .flatMap(item => {
      const exportOrder = exportOrderMap.get(text(item.export_order_id))
      if (!exportOrder) return []

      const request = requestMap.get(text(exportOrder.source_request_id)) || {}
      const requestPayload = parseObject(request.payload_json || request.payload)
      const sourceOrderId = firstText(item.source_order_id, request.order_id)
      const sourceOrderCode = firstText(exportOrder.source_order_code, request.order_code)
      const sourceOrder = orderMap.get(sourceOrderId)
        || orderByCode.get(normalized(sourceOrderCode))
        || {}
      const orderCode = firstText(sourceOrder.order_code, sourceOrderCode)
      const customerName = firstText(
        exportOrder.customer_name,
        exportOrder.destination_type === 'customer' ? exportOrder.destination_name : '',
        request.customer_name,
        requestPayload.customer_name,
        sourceOrder.customer_name,
      )
      const sale = saleIdentity(
        firstText(sourceOrder.sale_name, request.sale_name, requestPayload.sale_name, requestPayload.requested_by_name),
        firstText(sourceOrder.sale_email, request.order_sale_email, request.requested_by),
      )
      const orderCreatedBy = firstText(request.order_created_by, sourceOrder.created_by)
      const exportedAt = request.actual_exported_at
        || request.external_exported_at
        || request.exported_at
        || exportOrder.created_at
        || exportOrder.export_date
      const logo = firstText(item.source_logo, item.logo, item.target_logo)
      const warehouseId = firstText(item.from_warehouse_id)
      const warehouseName = firstText(item.from_warehouse_name, warehouseId, 'Không xác định')
      const exportCode = firstText(exportOrder.code, exportOrder.export_code, item.export_order_id)
      const requestCode = firstText(request.request_id, exportOrder.source_request_id)

      return [{
        id: `${text(exportOrder.id)}__${text(item.id)}`,
        export_order_id: text(exportOrder.id),
        export_item_id: text(item.id),
        export_code: exportCode,
        request_id: text(exportOrder.source_request_id),
        request_code: requestCode,
        order_id: firstText(sourceOrder.id, sourceOrderId),
        order_code: orderCode,
        customer_name: customerName,
        order_created_by: orderCreatedBy,
        exported_by: firstText(exportOrder.created_by, item.created_by),
        exported_at: exportedAt,
        exported_at_ms: toDateTimeMillis(exportedAt),
        export_date: text(exportOrder.export_date),
        warehouse_id: warehouseId,
        warehouse_name: warehouseName,
        warehouse_key: warehouseId || normalized(warehouseName),
        product_id: text(item.product_id),
        product_code: text(item.product_code),
        product_name: text(item.product_name),
        logo,
        logo_key: logo ? normalized(logo) : '__NO_LOGO__',
        quantity: Math.abs(Number(item.quantity || 0)),
        unit: text(item.unit),
        destination_name: firstText(item.destination_name, exportOrder.destination_name),
        destination_type: text(exportOrder.destination_type),
        release_mode: text(exportOrder.release_mode || item.release_mode),
        affects_inventory: exportOrder.affects_inventory !== false && item.affects_inventory !== false,
        ...sale,
      }]
    })
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.exported_at_ms) ? left.exported_at_ms : 0
      const rightTime = Number.isFinite(right.exported_at_ms) ? right.exported_at_ms : 0
      return rightTime - leftTime || right.export_code.localeCompare(left.export_code, 'vi')
    })
}

export function matchesWarehouseExportHistoryFilters(row = {}, filters = {}) {
  const keyword = normalized(filters.keyword)
  const matchedKeyword = !keyword || normalized([
    row.export_code,
    row.request_code,
    row.order_code,
    row.customer_name,
    row.product_code,
    row.product_name,
    row.logo,
    row.warehouse_name,
    row.sale_name,
    row.sale_email,
    row.order_created_by,
  ].join(' ')).includes(keyword)
  const matchedWarehouse = !filters.warehouse || row.warehouse_key === filters.warehouse
  const matchedSale = !filters.sale || row.sale_key === filters.sale
  const matchedLogo = !filters.logo || row.logo_key === filters.logo
  const matchedDate = isDateTimeInRange(row.exported_at, filters.from, filters.to)
  return matchedKeyword && matchedWarehouse && matchedSale && matchedLogo && matchedDate
}

export function uniqueHistoryOptions(rows = [], key, labelKey, subLabelKey = '') {
  const values = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = text(row?.[key])
    if (!value || values.has(value)) continue
    values.set(value, {
      value,
      label: text(row?.[labelKey]) || value,
      subLabel: subLabelKey ? text(row?.[subLabelKey]) : '',
      search: [row?.[labelKey], row?.[subLabelKey], value].map(text).filter(Boolean).join(' '),
    })
  }
  return Array.from(values.values()).sort((left, right) => left.label.localeCompare(right.label, 'vi'))
}
