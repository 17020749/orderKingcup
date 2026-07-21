export const ORDER_PRINTING_LOCK_VERSION = 1

function text(value) {
  return String(value || '').trim()
}

function normalizedStatus(value) {
  return text(value).toLowerCase().replace(/\s+/g, '_')
}

export function isActivePrintingProgress(row = {}) {
  if (row?.deleted === true || row?.active === false) return false
  return !['deleted', 'cancelled', 'canceled', 'da_xoa', 'đã_xóa'].includes(normalizedStatus(row?.status))
}

export function activePrintingProgressForOrder(orderId, rows = []) {
  const id = text(orderId)
  if (!id) return []
  return (Array.isArray(rows) ? rows : []).filter(row =>
    text(row?.order_id) === id && isActivePrintingProgress(row),
  )
}

export function normalizedPrintingProgressCount(order = {}) {
  const value = Number(order?.printing_progress_count)
  return Number.isInteger(value) && value >= 0 ? value : -1
}

export function printingLockReady(order = {}) {
  return Number(order?.printing_lock_version) === ORDER_PRINTING_LOCK_VERSION
    && normalizedPrintingProgressCount(order) >= 0
}

export function printingDeleteBlocker(order = {}, progressRows = []) {
  const activeRows = activePrintingProgressForOrder(order?.id, progressRows)
  if (activeRows.length > 0) {
    return `Đơn hàng đang có ${activeRows.length} tiến độ in ấn còn hiệu lực. Hãy xóa tiến độ in trước khi xóa đơn.`
  }

  if (!printingLockReady(order)) {
    return 'Đơn hàng cũ chưa hoàn tất đồng bộ khóa tiến độ in. Vui lòng tải lại sau khi hệ thống xử lý.'
  }

  const storedCount = normalizedPrintingProgressCount(order)
  if (storedCount > 0) {
    return `Khóa in đang ghi nhận ${storedCount} tiến độ còn hiệu lực. Hãy làm mới dữ liệu hoặc xóa tiến độ in trước khi xóa đơn.`
  }

  return ''
}

export function printingCountsByOrder(sourceOrders = [], printOrders = []) {
  const result = new Map()
  for (const order of Array.isArray(sourceOrders) ? sourceOrders : []) {
    const orderId = text(order?.id)
    if (orderId) result.set(orderId, 0)
  }
  for (const progress of Array.isArray(printOrders) ? printOrders : []) {
    const orderId = text(progress?.order_id)
    if (!orderId || !isActivePrintingProgress(progress)) continue
    result.set(orderId, (result.get(orderId) || 0) + 1)
  }
  return result
}

export function buildPrintingLockFields({
  count,
  action,
  printOrderId = '',
  actor = '',
  updatedAt,
} = {}) {
  const normalizedCount = Number(count)
  if (!Number.isInteger(normalizedCount) || normalizedCount < 0) {
    throw new Error('Số khóa tiến độ in không hợp lệ.')
  }
  const normalizedAction = text(action)
  if (!['create', 'delete', 'reconcile'].includes(normalizedAction)) {
    throw new Error('Thao tác khóa tiến độ in không hợp lệ.')
  }
  return {
    printing_progress_count: normalizedCount,
    printing_lock_version: ORDER_PRINTING_LOCK_VERSION,
    printing_last_action: normalizedAction,
    printing_last_print_order_id: text(printOrderId),
    printing_lock_updated_by: text(actor).toLowerCase(),
    ...(updatedAt === undefined ? {} : { printing_lock_updated_at: updatedAt }),
  }
}
