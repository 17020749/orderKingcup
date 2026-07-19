const ACTIVE_REQUEST_STATUSES = new Set([
  'cho_xu_ly', 'dang_xu_ly', 'da_tiep_nhan', 'cho_xuat_kho', 'cho_xac_nhan',
  'pending', 'processing', 'accepted', 'ready', 'ready_to_export', 'loi', 'error',
  'da_xuat_1_phan', 'da_xuat_mot_phan', 'partial_exported',
])

const RELEASED_REQUEST_STATUSES = new Set([
  'da_xuat', 'da_xuat_kho', 'da_xuat_du', 'exported', 'completed', 'hoan_thanh',
])

const IGNORED_REQUEST_STATUSES = new Set([
  'tu_choi', 'rejected', 'cancelled', 'canceled', 'da_huy', 'deleted',
])

const FULFILLED_ORDER_STATUSES = new Set([
  'da_xuat_du', 'exported', 'completed', 'hoan_thanh',
])

function text(value) {
  return String(value ?? '').trim()
}

function canonical(value) {
  return text(value).toLowerCase().replace(/[\s-]+/g, '_')
}

function normalizedIdentity(value) {
  return text(value).toUpperCase()
}

function quantity(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function parseArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
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

function isActiveDocument(value = {}) {
  return value.deleted !== true
    && value.active !== false
    && canonical(value.status) !== 'deleted'
}

function productIdentity(value = {}) {
  const productId = normalizedIdentity(value.product_id)
  return productId ? `ID:${productId}` : `CODE:${normalizedIdentity(value.product_code)}`
}

function lineKey(orderItemId, logo) {
  return `${text(orderItemId)}|${normalizedIdentity(logo)}`
}

function lineLabel(line = {}) {
  return [text(line.product_code || line.product_name || line.product_id), text(line.logo)]
    .filter(Boolean)
    .join(' / ') || 'Dòng sản phẩm'
}

export function expandOrderItemLines(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter(isActiveDocument)
    .flatMap(item => {
      const logos = Array.isArray(item.logo_lines) && item.logo_lines.length
        ? item.logo_lines
        : parseArray(item.logo_json || item.logos_json || item.logos)
      const rows = logos.length ? logos : [{ logo: '', quantity: item.quantity }]
      return rows.map(row => ({
        order_item_id: text(item.id || item.order_item_id),
        product_id: text(item.product_id),
        product_code: text(item.product_code),
        product_name: text(item.product_name),
        logo: text(row.logo),
        quantity: quantity(row.quantity ?? row.qty),
        identity: productIdentity(item),
      }))
    })
}

function requestPayloadLines(request = {}) {
  const payload = parseObject(request.payload || request.payload_json)
  return Array.isArray(payload.items)
    ? payload.items
    : (Array.isArray(request.items) ? request.items : [])
}

function releasedRequestLines(request = {}) {
  const actual = parseArray(request.actual_export_summary_json)
  return actual.length ? actual : requestPayloadLines(request)
}

function requestedQuantity(line = {}) {
  return quantity(
    line.export_quantity
    ?? line.request_quantity
    ?? line.requested_quantity
    ?? line.quantity
    ?? line.qty,
  )
}

function releasedQuantity(line = {}) {
  return quantity(
    line.actual_export_quantity
    ?? line.actual_exported_quantity
    ?? line.exported_quantity
    ?? line.exported_qty
    ?? line.quantity
    ?? line.export_quantity
    ?? line.qty,
  )
}

function referenceOrderItemId(value = {}) {
  return text(value.source_order_item_id || value.order_item_id)
}

function matchingLegacyLines(lines, reference) {
  const referenceProductId = normalizedIdentity(reference.product_id)
  const referenceProductCode = normalizedIdentity(reference.product_code)
  const logo = normalizedIdentity(reference.logo ?? reference.target_logo ?? reference.source_logo)
  return lines.filter(line => (
    (referenceProductId
      ? normalizedIdentity(line.product_id) === referenceProductId
      : normalizedIdentity(line.product_code) === referenceProductCode)
    && normalizedIdentity(line.logo) === logo
  ))
}

function resolveReference(lines, reference = {}) {
  const sourceId = referenceOrderItemId(reference)
  if (sourceId) {
    const logo = normalizedIdentity(reference.logo ?? reference.target_logo ?? reference.source_logo)
    const matches = lines.filter(line => (
      line.order_item_id === sourceId
      && normalizedIdentity(line.logo) === logo
    ))
    return matches.length === 1
      ? { line: matches[0], error: '' }
      : { line: null, error: `Không tìm thấy dòng đơn hàng được tham chiếu (${sourceId}${logo ? ` / ${logo}` : ''}).` }
  }

  const matches = matchingLegacyLines(lines, reference)
  if (matches.length === 1) return { line: matches[0], error: '' }
  if (matches.length > 1) {
    return { line: null, error: `${lineLabel(reference)} bị trùng trong đơn hàng cũ; không thể đối chiếu tham chiếu an toàn.` }
  }
  return { line: null, error: `${lineLabel(reference)} không còn khớp với dòng nào trong đơn hàng.` }
}

export function resolveOrderItemReference(items = [], reference = {}) {
  return resolveReference(expandOrderItemLines(items), reference)
}

export function collectOrderItemDependencies(input = {}) {
  const previousLines = expandOrderItemLines(input.previousItems)
  const commitments = new Map()
  const warehouseReferences = new Set()
  const printingReferences = new Set()
  const errors = []

  for (const request of Array.isArray(input.exportRequests) ? input.exportRequests : []) {
    if (!isActiveDocument(request)) continue
    const status = canonical(request.status)
    if (IGNORED_REQUEST_STATUSES.has(status)) continue
    const released = RELEASED_REQUEST_STATUSES.has(status)
    if (!released && !ACTIVE_REQUEST_STATUSES.has(status)) continue

    const rows = released ? releasedRequestLines(request) : requestPayloadLines(request)
    for (const reference of rows) {
      const committed = released ? releasedQuantity(reference) : requestedQuantity(reference)
      if (committed <= 0) continue
      const resolved = resolveReference(previousLines, reference)
      if (!resolved.line) {
        errors.push(resolved.error)
        continue
      }
      const key = lineKey(resolved.line.order_item_id, resolved.line.logo)
      warehouseReferences.add(key)
      commitments.set(key, (commitments.get(key) || 0) + committed)
    }
  }

  const activePrintOrderIds = new Set(
    (Array.isArray(input.printOrders) ? input.printOrders : [])
      .filter(isActiveDocument)
      .map(row => text(row.id))
      .filter(Boolean),
  )
  for (const reference of Array.isArray(input.printItems) ? input.printItems : []) {
    if (!isActiveDocument(reference) || !activePrintOrderIds.has(text(reference.print_order_id))) continue
    const resolved = resolveReference(previousLines, reference)
    if (!resolved.line) {
      errors.push(resolved.error)
      continue
    }
    printingReferences.add(lineKey(resolved.line.order_item_id, resolved.line.logo))
  }

  return { previousLines, commitments, warehouseReferences, printingReferences, errors }
}

function aggregateNextLines(items = []) {
  const result = new Map()
  for (const line of expandOrderItemLines(items)) {
    const key = lineKey(line.order_item_id, line.logo)
    const current = result.get(key)
    if (current) current.quantity += line.quantity
    else result.set(key, { ...line })
  }
  return result
}

export function validateOrderItemEdit(input = {}) {
  if (FULFILLED_ORDER_STATUSES.has(canonical(input.order?.warehouse_fulfillment_status))) {
    return 'Đơn hàng đã xuất đủ nên toàn bộ nội dung đơn đã bị khóa.'
  }

  const dependencies = collectOrderItemDependencies(input)
  if (dependencies.errors.length) return dependencies.errors[0]
  const nextLines = aggregateNextLines(input.nextItems)

  for (const previous of dependencies.previousLines) {
    const key = lineKey(previous.order_item_id, previous.logo)
    const next = nextLines.get(key)
    const referencedByWarehouse = dependencies.warehouseReferences.has(key)
    const referencedByPrinting = dependencies.printingReferences.has(key)
    const isSameProduct = next?.identity === previous.identity

    if ((!next || !isSameProduct) && (referencedByWarehouse || referencedByPrinting)) {
      const source = referencedByWarehouse && referencedByPrinting
        ? 'phiếu xuất kho và tiến độ in'
        : (referencedByWarehouse ? 'phiếu xuất kho' : 'tiến độ in')
      return `${lineLabel(previous)} đang nằm trong ${source}, không thể xóa hoặc thay sản phẩm/logo.`
    }

    const committed = dependencies.commitments.get(key) || 0
    const nextQuantity = next && isSameProduct ? next.quantity : 0
    if (nextQuantity < committed) {
      return `${lineLabel(previous)} đang xử lý hoặc đã xuất ${committed}, không thể giảm số lượng xuống ${nextQuantity}.`
    }
  }

  return ''
}

export function validateWarehouseReleaseSources(input = {}) {
  const request = input.request || {}
  const order = input.order || {}
  if (!isActiveDocument(order) || text(order.id) !== text(request.order_id)) {
    return 'Đơn hàng nguồn không còn tồn tại hoặc không khớp với yêu cầu xuất kho.'
  }

  const currentItems = Array.isArray(input.orderItems) ? input.orderItems : []
  const currentLines = expandOrderItemLines(currentItems)
  const requestedLines = requestPayloadLines(request).filter(line => requestedQuantity(line) > 0)
  const releaseLines = Array.isArray(input.releaseLines) ? input.releaseLines : []
  if (!requestedLines.length || releaseLines.length !== requestedLines.length) {
    return 'Chi tiết xuất kho không còn khớp với chi tiết của yêu cầu.'
  }

  const unusedReleaseIndexes = new Set(releaseLines.map((_, index) => index))
  for (const requested of requestedLines) {
    const resolved = resolveReference(currentLines, requested)
    if (!resolved.line) return resolved.error
    const expectedQuantity = requestedQuantity(requested)
    const expectedLogo = normalizedIdentity(resolved.line.logo)
    const releaseIndex = releaseLines.findIndex((line, index) => (
      unusedReleaseIndexes.has(index)
      && text(line.source_order_id) === text(request.order_id)
      && text(line.source_order_item_id) === resolved.line.order_item_id
      && normalizedIdentity(line.logo ?? line.target_logo ?? line.source_logo) === expectedLogo
      && quantity(line.quantity) === expectedQuantity
      && productIdentity({
        product_id: line.product?.id || line.product_id,
        product_code: line.product?.product_code || line.product?.code || line.product_code,
      }) === resolved.line.identity
    ))
    if (releaseIndex < 0) {
      return `${lineLabel(resolved.line)} trên phiếu xuất không khớp sản phẩm, logo hoặc số lượng trong yêu cầu.`
    }
    unusedReleaseIndexes.delete(releaseIndex)
    if (resolved.line.quantity < expectedQuantity) {
      return `${lineLabel(resolved.line)} chỉ còn ${resolved.line.quantity} trong đơn hàng, không đủ để xuất ${expectedQuantity}.`
    }
  }

  return unusedReleaseIndexes.size ? 'Phiếu xuất có dòng không thuộc yêu cầu xuất kho.' : ''
}
