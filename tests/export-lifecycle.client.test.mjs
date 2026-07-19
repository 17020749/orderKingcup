import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  activeExportOrderId,
  appendExportLifecycleTimeline,
  buildCancelledReleaseRequestPatch,
  buildGeneratedExportLifecycleFields,
  buildReleasedRequestPatch,
  canCancelExportRequestRelease,
  canReleaseExportRequest,
  exportLifecycleLinkError,
  nextExportReleaseSequence,
  requestExportOrderId,
} from '../utils/exportLifecycle.mjs'

test('release đầu dùng ID ổn định, release lại sau hủy dùng sequence mới', () => {
  assert.equal(requestExportOrderId('request-a', 1), 'request_export__request-a')
  assert.equal(requestExportOrderId('request-a', 2), 'request_export__request-a__2')
  assert.equal(nextExportReleaseSequence({}), 1)
  assert.equal(nextExportReleaseSequence({ release_sequence: 1 }), 2)
  assert.equal(nextExportReleaseSequence({ export_order_id: 'legacy-export' }), 2)
})

test('chỉ yêu cầu đã tiếp nhận và chưa có phiếu active mới được release', () => {
  assert.equal(canReleaseExportRequest({ status: 'da_tiep_nhan' }), true)
  assert.equal(canReleaseExportRequest({ status: 'cho_xuat_kho' }), true)
  assert.equal(canReleaseExportRequest({ status: 'da_xuat', active_export_order_id: 'export-a' }), false)
  assert.equal(canReleaseExportRequest({ status: 'da_tiep_nhan', active_export_order_id: 'export-a' }), false)
})

test('patch release lưu đủ liên kết hai chiều và sequence', () => {
  const patch = buildReleasedRequestPatch({
    request: { id: 'request-a', release_sequence: 1 },
    exportOrderId: 'request_export__request-a__2',
    exportCode: 'PXK-YCXK-A-2',
    actor: 'Warehouse@Example.com',
    operationId: 'op-release-2',
    releaseSequence: 2,
    actualSummaryJson: '[{"quantity":2}]',
    stockMovementIds: ['move-a'],
    timelineJson: '[{"action":"warehouse_export"}]',
  })
  assert.equal(patch.status, 'da_xuat')
  assert.equal(patch.lifecycle_status, 'released')
  assert.equal(patch.release_sequence, 2)
  assert.equal(activeExportOrderId(patch), 'request_export__request-a__2')
  assert.equal(patch.last_released_by, 'warehouse@example.com')
})

test('hủy release mở lại yêu cầu, xóa active link và giữ audit phiếu đã hủy', () => {
  const request = {
    id: 'request-a', status: 'da_xuat', release_sequence: 1,
    active_export_order_id: 'request_export__request-a',
    export_order_id: 'request_export__request-a',
    cancel_count: 1,
  }
  const exportOrder = {
    id: 'request_export__request-a', code: 'PXK-A',
    source_request_id: 'request-a', source: 'kingcup_firestore',
  }
  assert.equal(canCancelExportRequestRelease(request), true)
  assert.equal(exportLifecycleLinkError(request, exportOrder), '')
  const patch = buildCancelledReleaseRequestPatch({
    request,
    exportOrder,
    actor: 'warehouse@example.com',
    reason: 'Khách đổi lịch giao',
    operationId: 'op-cancel-a',
    timelineJson: '[]',
  })
  assert.equal(patch.status, 'da_tiep_nhan')
  assert.equal(patch.lifecycle_status, 'release_cancelled')
  assert.equal(patch.active_export_order_id, '')
  assert.equal(patch.actual_export_summary_json, '[]')
  assert.equal(patch.last_cancelled_export_order_id, exportOrder.id)
  assert.equal(patch.cancel_count, 2)
})

test('không cho hủy khi request và export order lệch liên kết', () => {
  const request = { id: 'request-a', active_export_order_id: 'export-a' }
  assert.match(exportLifecycleLinkError(request, {
    id: 'export-b', source_request_id: 'request-a', source: 'kingcup_firestore',
  }), /không trỏ tới phiếu xuất/)
  assert.throws(() => buildCancelledReleaseRequestPatch({
    request,
    exportOrder: { id: 'export-a', source_request_id: 'request-b', source: 'kingcup_firestore' },
    actor: 'warehouse@example.com',
    reason: 'Sai liên kết',
  }), /không liên kết đúng/)
})

test('timeline và lifecycle export order lưu được phiếu, mã và operation', () => {
  const timeline = appendExportLifecycleTimeline([], {
    action: 'warehouse_export_cancel',
    title: 'Kho hủy xuất và hoàn tồn',
    actor: 'warehouse@example.com',
    actorName: 'Kho A',
    status: 'da_tiep_nhan',
    note: 'Khách hoãn',
    exportOrderId: 'export-a',
    exportCode: 'PXK-A',
    time: '2026-07-19T00:00:00.000Z',
  })
  assert.equal(timeline[0].export_order_id, 'export-a')
  assert.equal(timeline[0].note, 'Khách hoãn')
  assert.deepEqual(buildGeneratedExportLifecycleFields({
    requestId: 'request-a', requestRevision: 3, releaseSequence: 2, operationId: 'op-a',
  }), {
    lifecycle_status: 'released',
    release_sequence: 2,
    source_request_id: 'request-a',
    source_request_revision: 3,
    request_operation_id: 'op-a',
  })
})

test('source thật có cancel request release và UI không cho hủy từ trang phiếu xuất', () => {
  const transactions = readFileSync('composables/useWarehouseTransactions.ts', 'utf8')
  const requestPage = readFileSync('pages/warehouse-export-requests.vue', 'utf8')
  const exportPage = readFileSync('pages/exports.vue', 'utf8')
  assert.match(transactions, /cancelExportRequestRelease/)
  assert.match(transactions, /export_request_cancel/)
  assert.match(transactions, /buildCancelledReleaseRequestPatch/)
  assert.match(requestPage, /cancel_release/)
  assert.match(requestPage, /Hủy xuất và hoàn tồn/)
  assert.match(exportPage, /Phiếu sinh từ yêu cầu sale không được hủy tại trang Xuất kho thật/)
})
