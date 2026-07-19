// Pure helpers used by both the Nuxt client flow and Node business-flow tests.
export const FIRESTORE_WRITE_LIMIT = 500

function text(value) {
  return String(value || '').trim()
}

export function numericRevision(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

export function uniqueDocumentIds(rows = []) {
  const seen = new Set()
  const result = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = text(row?.id || row?.firestore_id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

export function planAtomicOrderItems(existingItems = [], nextItems = []) {
  const existingIds = new Set(uniqueDocumentIds(existingItems))
  const nextIds = uniqueDocumentIds(nextItems)
  if (nextIds.length !== (Array.isArray(nextItems) ? nextItems.length : 0)) {
    throw new Error('Dòng sản phẩm thiếu ID hoặc bị trùng ID; chưa thể lưu đơn an toàn.')
  }
  const nextIdSet = new Set(nextIds)
  return {
    upsertItems: nextItems.map(item => ({
      ...item,
      id: text(item.id || item.firestore_id),
      isNew: !existingIds.has(text(item.id || item.firestore_id)),
    })),
    removedItems: (Array.isArray(existingItems) ? existingItems : [])
      .filter(item => {
        const id = text(item?.id || item?.firestore_id)
        return id && !nextIdSet.has(id)
      }),
  }
}

export function estimateAtomicOrderWrites({ mode, existingItems = [], nextItems = [] } = {}) {
  const plan = planAtomicOrderItems(existingItems, nextItems)
  const sequenceWrites = mode === 'create' ? 1 : 0
  return sequenceWrites + 1 + 1 + plan.upsertItems.length + plan.removedItems.length
}

export function assertAtomicOrderWriteLimit(input = {}) {
  const writes = estimateAtomicOrderWrites(input)
  if (writes > FIRESTORE_WRITE_LIMIT) {
    throw new Error(`Đơn hàng cần ${writes} thao tác ghi, vượt giới hạn ${FIRESTORE_WRITE_LIMIT} của Firestore. Hãy giảm số dòng sản phẩm trước khi lưu.`)
  }
  return writes
}

export function nextOrderRevision(currentRevision) {
  return numericRevision(currentRevision) + 1
}

export function assertExpectedOrderRevision(expectedRevision, actualRevision) {
  const expected = numericRevision(expectedRevision)
  const actual = numericRevision(actualRevision)
  if (expected !== actual) {
    throw new Error('Đơn hàng đã được cập nhật ở một thiết bị hoặc phiên khác. Hãy tải lại dữ liệu trước khi lưu tiếp.')
  }
  return actual
}

export function buildOrderOperationId(orderId, now = Date.now(), randomValue = Math.random()) {
  const cleanId = text(orderId).replace(/[^a-zA-Z0-9_-]/g, '') || 'order'
  const random = Math.floor(Math.abs(Number(randomValue) || 0) * 1_000_000)
    .toString(36)
    .padStart(4, '0')
  return `order_${cleanId}_${Number(now).toString(36)}_${random}`
}
