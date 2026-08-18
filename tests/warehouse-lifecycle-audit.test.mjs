import assert from 'node:assert/strict'
import test from 'node:test'
import { auditWarehouseLifecycle } from '../utils/warehouseLifecycleAudit.mjs'

test('warehouse audit reports broken links, lifecycle mismatches, stale operations and summaries without mutating input', () => {
  const snapshot = {
    requests: [{ id: 'request-a', order_id: 'order-a', status: 'da_xuat', lifecycle_status: 'accepted', external_export_order_id: 'export-a', release_mode: 'external_no_inventory' }],
    exportOrders: [{ id: 'export-a', source_request_id: 'request-a', active: true }],
    exportItems: [],
    operations: [{ id: 'operation-a', status: 'processing', processing_at: '2026-01-01T00:00:00.000Z' }],
    orders: [{ id: 'order-a', warehouse_request_status: 'cho_xu_ly', warehouse_fulfillment_status: 'chua_xuat' }],
  }
  const before = structuredClone(snapshot)
  const report = auditWarehouseLifecycle(snapshot, Date.parse('2026-01-01T00:06:00.000Z'))
  assert.deepEqual(snapshot, before)
  assert.deepEqual(new Set(report.findings.map(row => row.type)), new Set([
    'status_lifecycle_mismatch',
    'external_export_missing_items',
    'operation_stuck_processing',
    'order_summary_mismatch',
  ]))
})

test('warehouse audit accepts a consistent external release snapshot', () => {
  const report = auditWarehouseLifecycle({
    requests: [{ id: 'request-a', order_id: 'order-a', status: 'da_xuat', lifecycle_status: 'released_external', external_export_order_id: 'export-a', release_mode: 'external_no_inventory', payload_json: JSON.stringify({ items: [{ source_order_item_id: 'item-a', product_code: 'SP-A', export_quantity: 1, order_quantity: 1 }] }) }],
    exportOrders: [{ id: 'export-a', source_request_id: 'request-a', release_mode: 'external_no_inventory', active: true }],
    exportItems: [{ id: 'item-a', export_order_id: 'export-a', active: true }],
    operations: [],
    orders: [{ id: 'order-a', warehouse_request_status: 'da_xuat', warehouse_fulfillment_status: 'da_xuat_du', active: true }],
  })
  assert.deepEqual(report.findings, [])
})
