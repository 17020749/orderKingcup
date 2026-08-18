import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildExternalReleasedRequestPatch,
  canReleaseExportRequestExternally,
  isExternalExportRequestRelease,
} from '../utils/exportLifecycle.mjs'

test('external release dùng trạng thái cũ nhưng giữ liên kết xuất chuẩn rỗng', () => {
  const patch = buildExternalReleasedRequestPatch({
    request: { status: 'da_tiep_nhan', revision: 4 },
    actor: 'Warehouse@Example.com',
    exportDate: '2026-08-04',
    note: 'Hàng đã xuất thực tế trước khi nhập tồn',
    operationId: 'external-release:request-a:4',
    timelineJson: '[{"action":"external_release"}]',
    actualSummaryJson: '[{"quantity":10}]',
  })

  assert.equal(patch.status, 'da_xuat')
  assert.equal(patch.lifecycle_status, 'released_external')
  assert.equal(patch.release_mode, 'external_no_inventory')
  assert.equal(patch.external_exported_by, 'warehouse@example.com')
  assert.equal(patch.active_export_order_id, '')
  assert.equal(patch.export_order_id, '')
  assert.deepEqual(patch.stock_movement_ids, [])
  assert.equal(patch.revision, 5)
  assert.equal(isExternalExportRequestRelease(patch), true)
})

test('external release chỉ mở ở cùng trạng thái với release chuẩn', () => {
  assert.equal(canReleaseExportRequestExternally({ status: 'da_tiep_nhan' }), true)
  assert.equal(canReleaseExportRequestExternally({ status: 'cho_xuat_kho' }), true)
  assert.equal(canReleaseExportRequestExternally({ status: 'loi' }), true)
  assert.equal(canReleaseExportRequestExternally({ status: 'da_xuat' }), false)
  assert.equal(canReleaseExportRequestExternally({ status: 'da_tiep_nhan', active_export_order_id: 'export-a' }), false)
})

test('client tạo phiếu ghi nhận nhưng không gọi transaction trừ tồn', () => {
  const source = readFileSync('pages/warehouse-export-requests.vue', 'utf8')
  const start = source.indexOf('async function submitExternalRelease')
  const end = source.indexOf('async function submitCancelRelease', start)
  assert.ok(start >= 0 && end > start)
  const block = source.slice(start, end)
  assert.equal(block.includes('runTransaction(db'), true)
  assert.equal(block.includes("tx.set(exportRef"), true)
  assert.equal(block.includes("tx.set(doc(db, 'export_order_items'"), true)
  assert.equal(block.includes('requestExternalExportOrderId('), true)
  assert.equal(block.includes("affects_inventory: false"), true)
  assert.equal(block.includes('processExportRequestToExportOrder('), false)
  assert.equal(block.includes('inventory_balances'), false)
  assert.equal(block.includes('stock_movements'), false)

  const exportsPage = readFileSync('pages/exports.vue', 'utf8')
  assert.equal(exportsPage.includes('isExternalNoInventory'), true)
  assert.equal(exportsPage.includes('Không trừ tồn'), true)

  const fallback = readFileSync('utils/fallbackOrderPatch.ts', 'utf8')
  assert.equal(fallback.includes("warehouse_fulfillment_status: 'da_xuat_1_phan'"), true)
  assert.equal(fallback.includes("warehouse_request_status: 'da_xuat'"), true)
})
