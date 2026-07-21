const ACCEPTED_REQUEST_STATUSES = new Set([
  'da_tiep_nhan',
  'cho_xuat_kho',
  'cho_xac_nhan',
  'accepted',
  'ready_to_export',
])

const EXPORTED_REQUEST_STATUSES = new Set([
  'da_xuat',
  'da_xuat_kho',
  'da_xuat_1_phan',
  'da_xuat_mot_phan',
  'da_xuat_du',
  'partial_exported',
  'exported',
  'completed',
  'hoan_thanh',
])

const CASCADE_REQUEST_STATUSES = new Set([
  'cho_xu_ly',
  'dang_xu_ly',
  'pending',
  'processing',
  'tu_choi',
  'rejected',
])

const EXPORTED_FULFILLMENT_STATUSES = new Set([
  'da_xuat_1_phan',
  'da_xuat_du',
  'partial_exported',
  'exported',
])

function canonicalStatus(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '_')
}

function isActiveRequest(request) {
  return request?.deleted !== true && request?.active !== false && request?.status !== 'deleted'
}

function hasWarehouseExportLink(request) {
  return [
    request?.warehouse_export_code,
    request?.active_export_order_id,
    request?.export_order_id,
    request?.warehouse_export_order_id,
    request?.warehouse_export_id,
  ].some(value => String(value || '').trim())
}

export function warehouseRequestsForDeleteCascade(requests = []) {
  return (Array.isArray(requests) ? requests : []).filter(request => {
    if (!isActiveRequest(request) || hasWarehouseExportLink(request)) return false
    return CASCADE_REQUEST_STATUSES.has(canonicalStatus(request?.status))
  })
}

export function warehouseOrderDeleteBlocker(order = {}, requests = []) {
  const fulfillmentStatus = canonicalStatus(order?.warehouse_fulfillment_status)
  const requestSummaryStatus = canonicalStatus(order?.warehouse_request_status)

  if (EXPORTED_FULFILLMENT_STATUSES.has(fulfillmentStatus) || requestSummaryStatus === 'da_xuat') {
    return 'Đơn hàng đã xuất kho nên không thể xóa.'
  }
  if (ACCEPTED_REQUEST_STATUSES.has(requestSummaryStatus)) {
    return 'Yêu cầu xuất kho đã tiếp nhận hoặc đang chờ xuất nên không thể xóa đơn hàng.'
  }

  for (const request of (Array.isArray(requests) ? requests : []).filter(isActiveRequest)) {
    const status = canonicalStatus(request?.status)
    if (hasWarehouseExportLink(request) || EXPORTED_REQUEST_STATUSES.has(status)) {
      return 'Đơn hàng đã có số lượng xuất kho hoặc mã phiếu Warehouse nên không thể xóa.'
    }
    if (ACCEPTED_REQUEST_STATUSES.has(status)) {
      return 'Yêu cầu xuất kho đã tiếp nhận hoặc đang chờ xuất nên không thể xóa đơn hàng.'
    }
    if (!CASCADE_REQUEST_STATUSES.has(status)) {
      return 'Yêu cầu xuất kho đang ở trạng thái chưa thể xóa cùng đơn hàng.'
    }
  }

  return ''
}
