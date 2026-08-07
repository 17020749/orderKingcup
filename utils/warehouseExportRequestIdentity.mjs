import { canonicalWarehouseLogo } from './warehouseLogoIdentity.mjs'

function normalizeId(value) {
  return String(value || '').trim()
}

function normalizeLogo(value) {
  return canonicalWarehouseLogo(value)
}

function safePayload(request) {
  if (request?.payload && typeof request.payload === 'object') return request.payload
  try {
    const parsed = JSON.parse(String(request?.payload_json || '{}'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function sourceItemsOf(request, payload) {
  const sourceItems = request?.source_items || payload?.source_items
  return sourceItems && typeof sourceItems === 'object' && !Array.isArray(sourceItems)
    ? sourceItems
    : {}
}

function requestItemsOf(request, payload) {
  if (Array.isArray(payload?.items)) return payload.items
  if (Array.isArray(request?.items)) return request.items
  return []
}

function sourceItemIdOf(line) {
  return normalizeId(line?.source_order_item_id || line?.order_item_id)
}

function itemSourceId(item) {
  return normalizeId(item?.source_order_item_id || item?.order_item_id)
}

function snapshotIdentity(item) {
  if (!item) return null
  const productId = normalizeId(item.product_id)
  if (!productId) return null
  return {
    productId,
    productCode: String(item.product_code || '').trim(),
    productName: String(item.product_name || '').trim(),
  }
}

export function requestProductIdentityForLine(request, line) {
  const sourceItemId = sourceItemIdOf(line)
  if (!sourceItemId) return null

  const payload = safePayload(request)
  const sourceItems = sourceItemsOf(request, payload)
  const direct = snapshotIdentity(sourceItems[sourceItemId])
  if (direct) return direct

  const items = requestItemsOf(request, payload)
  const lineLogo = normalizeLogo(line?.logo)
  const exact = items.find(item => (
    itemSourceId(item) === sourceItemId
    && normalizeLogo(item?.logo) === lineLogo
  ))
  const fallback = exact || items.find(item => itemSourceId(item) === sourceItemId)
  return snapshotIdentity(fallback)
}

export function alignExportRequestLineProduct(request, line) {
  const identity = requestProductIdentityForLine(request, line)
  if (!identity) return { ...line }

  const currentProduct = line?.product && typeof line.product === 'object'
    ? line.product
    : {}

  return {
    ...line,
    product: {
      ...currentProduct,
      id: identity.productId,
      firestore_id: identity.productId,
      product_id: identity.productId,
      product_code: identity.productCode || currentProduct.product_code || currentProduct.code || '',
      product_name: identity.productName || currentProduct.product_name || currentProduct.name || '',
    },
  }
}

export function alignExportRequestLineProducts(request, lines) {
  return (Array.isArray(lines) ? lines : []).map(line => alignExportRequestLineProduct(request, line))
}
