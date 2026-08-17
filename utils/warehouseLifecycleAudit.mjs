import { orderWarehouseFulfillmentSummaryFromRequests } from './warehouseFulfillment.mjs'

const text = value => String(value || '').trim()
const active = row => row?.active !== false && row?.deleted !== true

export function expectedLifecycleForStatus(request = {}) {
  const status = text(request.status)
  if (status === 'cho_xu_ly') return 'requested'
  if (['da_tiep_nhan', 'cho_xuat_kho'].includes(status)) {
    return ['release_cancelled', 'external_release_cancelled'].includes(text(request.lifecycle_status))
      ? text(request.lifecycle_status)
      : 'accepted'
  }
  if (status === 'tu_choi') return 'rejected'
  if (status === 'loi') return 'error'
  if (status === 'da_xuat') return request.release_mode === 'external_no_inventory' ? 'released_external' : 'released'
  return ''
}

export function auditWarehouseLifecycle(snapshot = {}, now = Date.now()) {
  const requests = (snapshot.requests || []).filter(active)
  const exportOrders = snapshot.exportOrders || []
  const exportItems = snapshot.exportItems || []
  const operations = snapshot.operations || []
  const orders = snapshot.orders || []
  const exportById = new Map(exportOrders.map(row => [text(row.id), row]))
  const itemsByExport = new Map()
  for (const item of exportItems.filter(active)) {
    const id = text(item.export_order_id)
    itemsByExport.set(id, [...(itemsByExport.get(id) || []), item])
  }
  const findings = []
  const add = (type, collection, id, detail) => findings.push({ type, collection, id, detail })

  for (const request of requests) {
    const requestId = text(request.id || request.request_id)
    const expectedLifecycle = expectedLifecycleForStatus(request)
    if (expectedLifecycle && text(request.lifecycle_status) !== expectedLifecycle) {
      add('status_lifecycle_mismatch', 'order_export_requests', requestId, { status: request.status, lifecycle_status: request.lifecycle_status, expected_lifecycle: expectedLifecycle })
    }
    const activeExportId = text(request.active_export_order_id)
    const externalExportId = text(request.external_export_order_id)
    const linkedId = activeExportId || externalExportId
    if (text(request.status) === 'da_xuat' && (!linkedId || !exportById.has(linkedId))) {
      add('released_request_missing_export', 'order_export_requests', requestId, { linked_export_id: linkedId })
    }
    if (externalExportId && !(itemsByExport.get(externalExportId) || []).length) {
      add('external_export_missing_items', 'order_export_requests', requestId, { export_order_id: externalExportId })
    }
    if (linkedId && exportById.get(linkedId)?.deleted === true) {
      add('cancelled_export_still_linked', 'order_export_requests', requestId, { export_order_id: linkedId })
    }
  }

  for (const exportOrder of exportOrders.filter(active)) {
    const requestId = text(exportOrder.source_request_id)
    if (!requestId) continue
    const request = requests.find(row => text(row.id || row.request_id) === requestId)
    const exportId = text(exportOrder.id)
    if (!request || ![text(request.active_export_order_id), text(request.external_export_order_id)].includes(exportId)) {
      add('active_export_missing_request_link', 'export_orders', exportId, { source_request_id: requestId })
    }
  }

  for (const operation of operations) {
    const processingAt = Date.parse(operation.processing_at || operation.created_at || '')
    if (operation.status === 'processing' && Number.isFinite(processingAt) && now - processingAt > 5 * 60_000) {
      add('operation_stuck_processing', 'warehouse_operations', text(operation.id || operation.operation_id), { processing_at: operation.processing_at || operation.created_at })
    }
  }

  for (const order of orders.filter(active)) {
    const related = requests.filter(request => text(request.order_id) === text(order.id))
    if (!related.length) continue
    const expected = orderWarehouseFulfillmentSummaryFromRequests(related)
    if (text(order.warehouse_request_status) !== expected.warehouse_request_status
      || text(order.warehouse_fulfillment_status) !== expected.warehouse_fulfillment_status) {
      add('order_summary_mismatch', 'orders', text(order.id), {
        actual_request_status: order.warehouse_request_status,
        actual_fulfillment_status: order.warehouse_fulfillment_status,
        ...expected,
      })
    }
  }

  return { inspected: { requests: requests.length, exportOrders: exportOrders.length, exportItems: exportItems.length, operations: operations.length, orders: orders.length }, findings }
}
