function text(value) {
  return String(value || '').trim()
}

export function uniqueOrderIds(orders = []) {
  return Array.from(new Set(
    (Array.isArray(orders) ? orders : [])
      .map(order => text(order?.id || order?.firestore_id))
      .filter(Boolean),
  )).sort((left, right) => left.localeCompare(right))
}

export function chunkOrderIds(orderIds = [], size = 10) {
  const ids = Array.from(new Set((Array.isArray(orderIds) ? orderIds : []).map(text).filter(Boolean)))
  const safeSize = Math.max(1, Math.min(30, Number(size) || 10))
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
