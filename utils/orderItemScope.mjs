function text(value) {
  return String(value || '').trim()
}

// Keep relation queries below Firestore Rules' per-request access-call limit.
// A query can evaluate both the user's permission document and each parent
// order, so using five IDs leaves room for those rule lookups.
export const SAFE_RELATION_QUERY_CHUNK_SIZE = 5

export function uniqueOrderIds(orders = []) {
  return Array.from(new Set(
    (Array.isArray(orders) ? orders : [])
      .map(order => text(order?.id || order?.firestore_id))
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right))
}

export function chunkOrderIds(orderIds = [], size = SAFE_RELATION_QUERY_CHUNK_SIZE) {
  const ids = Array.from(new Set((Array.isArray(orderIds) ? orderIds : []).map(text).filter(Boolean)))
  const requestedSize = Number(size) || SAFE_RELATION_QUERY_CHUNK_SIZE
  const safeSize = Math.max(1, Math.min(SAFE_RELATION_QUERY_CHUNK_SIZE, requestedSize))
  const chunks = []
  for (let index = 0; index < ids.length; index += safeSize) {
    chunks.push(ids.slice(index, index + safeSize))
  }
  return chunks
}

export function filterItemsForVisibleOrders(items = [], orderIds = []) {
  const visible = new Set((Array.isArray(orderIds) ? orderIds : []).map(text).filter(Boolean))
  const map = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const id = text(item?.id || item?.firestore_id)
    const orderId = text(item?.order_id)
    const status = text(item?.status).toLowerCase()
    if (!id || !visible.has(orderId)) continue
    if (item?.deleted === true || item?.active === false || ['deleted', 'inactive', 'đã xóa'].includes(status)) continue
    map.set(id, item)
  }
  return Array.from(map.values())
}

export function orderItemQueryKey(email, orderIds = []) {
  return `${text(email).toLowerCase()}::${uniqueOrderIds(orderIds.map(id => ({ id }))).join('|')}`
}
