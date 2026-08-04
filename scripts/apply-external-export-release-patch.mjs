import { readFileSync, writeFileSync, rmSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

function write(path, content) {
  writeFileSync(path, content)
}

function replaceOnce(path, before, after, label) {
  const source = read(path)
  const count = source.split(before).length - 1
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match in ${path}, found ${count}`)
  }
  write(path, source.replace(before, after))
}

function insertBefore(path, marker, block, label) {
  replaceOnce(path, marker, `${block}\n\n${marker}`, label)
}

const page = 'pages/warehouse-export-requests.vue'
const lifecycle = 'utils/exportLifecycle.mjs'
const rules = 'firestore.rules'

insertBefore(
  lifecycle,
  'export function buildGeneratedExportLifecycleFields(input = {}) {',
  [
    'export function isExternalExportRequestRelease(request = {}) {',
    "  return canonicalExportRequestStatus(request.lifecycle_status) === 'released_external'",
    "    || text(request.release_mode) === 'external_no_inventory'",
    '    || request.external_exported === true',
    '}',
    '',
    'export function canReleaseExportRequestExternally(request = {}) {',
    '  return canReleaseExportRequest(request)',
    '}',
    '',
    'export function buildExternalReleasedRequestPatch(input = {}) {',
    '  const request = input.request || {}',
    "  const actor = text(input.actor).toLowerCase()",
    '  const exportDate = text(input.exportDate)',
    '  const note = text(input.note)',
    '  const operationId = text(input.operationId)',
    "  if (!actor) throw new Error('Không xác định được người xác nhận xuất ngoài hệ thống.')",
    "  if (!exportDate) throw new Error('Vui lòng chọn ngày đã xuất thực tế.')",
    "  if (!note) throw new Error('Vui lòng nhập lý do hoặc ghi chú xác nhận.')",
    "  if (!operationId) throw new Error('Thiếu mã thao tác xuất ngoài hệ thống.')",
    '',
    '  return {',
    '    status: EXPORT_REQUEST_STATUSES.released,',
    "    lifecycle_status: 'released_external',",
    "    release_mode: 'external_no_inventory',",
    '    external_exported: true,',
    '    external_export_date: exportDate,',
    '    external_exported_by: actor,',
    '    active_export_order_id: \'\',',
    '    warehouse_export_code: \'\',',
    '    warehouse_export_id: \'\',',
    '    warehouse_export_order_id: \'\',',
    '    export_order_id: \'\',',
    '    warehouse_handled_by: actor,',
    '    warehouse_note: note,',
    "    actual_export_summary_json: input.actualSummaryJson || '[]',",
    '    stock_movement_ids: [],',
    "    request_timeline_json: input.timelineJson || '[]',",
    '    operation_id: operationId,',
    '    last_operation_id: operationId,',
    '    revision: integer(request.revision) + 1,',
    '  }',
    '}',
  ].join('\n'),
  'insert external lifecycle helpers',
)

replaceOnce(
  page,
  "import { canCancelExportRequestRelease, canReleaseExportRequest } from '~/utils/exportLifecycle.mjs'",
  [
    'import {',
    '  buildExternalReleasedRequestPatch,',
    '  canCancelExportRequestRelease,',
    '  canReleaseExportRequest,',
    '  canReleaseExportRequestExternally,',
    "  isExternalExportRequestRelease,",
    "} from '~/utils/exportLifecycle.mjs'",
  ].join('\n'),
  'extend lifecycle imports',
)

replaceOnce(
  page,
  "const actionType = ref<'accept' | 'reject' | 'release' | 'cancel_release' | ''>('')",
  "const actionType = ref<'accept' | 'reject' | 'release' | 'external_release' | 'cancel_release' | ''>('')",
  'extend action type',
)

replaceOnce(
  page,
  [
    'function canReleaseRequest(row: any) {',
    '  return canReleaseAction.value && canReleaseExportRequest(row) && !requestHasExported(row)',
    '}',
  ].join('\n'),
  [
    'function canReleaseRequest(row: any) {',
    '  return canReleaseAction.value && canReleaseExportRequest(row) && !requestHasExported(row)',
    '}',
    '',
    'function canExternalReleaseRequest(row: any) {',
    '  return canReleaseAction.value && canReleaseExportRequestExternally(row) && !requestHasExported(row)',
    '}',
  ].join('\n'),
  'add external release decision',
)

replaceOnce(
  page,
  "  if (actionType.value === 'release') return canReleaseRequest(row)\n  if (actionType.value === 'cancel_release') return canCancelReleasedRequest(row)",
  "  if (actionType.value === 'release') return canReleaseRequest(row)\n  if (actionType.value === 'external_release') return canExternalReleaseRequest(row)\n  if (actionType.value === 'cancel_release') return canCancelReleasedRequest(row)",
  'validate external action freshness',
)

replaceOnce(
  page,
  "function openAction(row: any, type: 'accept' | 'reject' | 'release' | 'cancel_release') {",
  "function openAction(row: any, type: 'accept' | 'reject' | 'release' | 'external_release' | 'cancel_release') {",
  'extend open action type',
)

replaceOnce(
  page,
  "  if (type === 'release' && !canReleaseRequest(row)) return showToast('Yêu cầu phải được tiếp nhận trước khi cho xuất kho.', 'error')\n  if (type === 'cancel_release' && !canCancelReleasedRequest(row)) return showToast('Yêu cầu không có phiếu xuất đang hoạt động để hủy.', 'error')",
  "  if (type === 'release' && !canReleaseRequest(row)) return showToast('Yêu cầu phải được tiếp nhận trước khi cho xuất kho.', 'error')\n  if (type === 'external_release' && !canExternalReleaseRequest(row)) return showToast('Yêu cầu này không còn ở trạng thái có thể xác nhận đã xuất ngoài hệ thống.', 'error')\n  if (type === 'cancel_release' && !canCancelReleasedRequest(row)) return showToast('Yêu cầu không có phiếu xuất đang hoạt động để hủy.', 'error')",
  'validate external action opening',
)

replaceOnce(
  page,
  "  if (actionType.value === 'release') return 'Cho xuất kho'\n  if (actionType.value === 'cancel_release') return 'Hủy xuất và hoàn tồn'",
  "  if (actionType.value === 'release') return 'Cho xuất kho'\n  if (actionType.value === 'external_release') return 'Xác nhận đã xuất ngoài hệ thống'\n  if (actionType.value === 'cancel_release') return 'Hủy xuất và hoàn tồn'",
  'external action title',
)

replaceOnce(
  page,
  "  if (actionType.value === 'release') return 'Cho xuất kho'\n  if (actionType.value === 'cancel_release') return 'Hủy xuất và hoàn tồn'\n  return 'Xác nhận'",
  "  if (actionType.value === 'release') return 'Cho xuất kho'\n  if (actionType.value === 'external_release') return 'Xác nhận đã xuất'\n  if (actionType.value === 'cancel_release') return 'Hủy xuất và hoàn tồn'\n  return 'Xác nhận'",
  'external action save label',
)

insertBefore(
  page,
  'async function submitCancelRelease(row: any) {',
  [
    'async function submitExternalRelease(row: any) {',
    "  const note = String(actionForm.note || '').trim()",
    "  const exportDate = String(actionForm.export_date || '').trim()",
    "  if (!exportDate) return showToast('Vui lòng chọn ngày đã xuất thực tế.', 'error')",
    "  if (!note) return showToast('Vui lòng nhập lý do hoặc ghi chú xác nhận.', 'error')",
    '',
    '  const lines = requestLineProgress(row).filter((line: any) => toNumber(line.requested_qty) > 0)',
    "  if (!lines.length) return showToast('Yêu cầu xuất kho chưa có dòng hàng hợp lệ.', 'error')",
    '',
    '  const confirmed = await askConfirm({',
    "    title: 'Xác nhận đã xuất ngoài hệ thống',",
    "    message: `Yêu cầu ${row.request_id || row.id} sẽ chuyển thành Đã xuất kho nhưng KHÔNG tạo phiếu xuất, không ghi biến động và không trừ tồn. Bạn chắc chắn?`,",
    "    confirmLabel: 'Xác nhận đã xuất',",
    '  })',
    '  if (!confirmed) return',
    '',
    '  const operationId = `export_request_external:${row.id}:${toNumber(row.revision)}`',
    "  const timelineJson = appendTimeline(row, 'external_release', 'Kho xác nhận đã xuất ngoài hệ thống', 'da_xuat', note)",
    '  const actualSummaryJson = JSON.stringify(lines.map((line: any) => ({',
    "    source_order_id: row.order_id || '',",
    "    source_order_item_id: String(line.order_item_id || line.source_order_item_id || '').trim(),",
    "    product_id: line.product_id || '',",
    "    product_code: line.product_code || '',",
    "    logo: line.logo || '',",
    '    quantity: toNumber(line.requested_qty),',
    "    unit: line.unit || '',",
    "    release_mode: 'external_no_inventory',",
    '  })))',
    '  const externalPatch = buildExternalReleasedRequestPatch({',
    '    request: row,',
    "    actor: appUser.value?.email || '',",
    '    exportDate,',
    '    note,',
    '    operationId,',
    '    timelineJson,',
    '    actualSummaryJson,',
    '  })',
    '',
    '  const result = await updateRequestStatus(',
    '    row,',
    "    'da_xuat',",
    "    'external_release',",
    "    'Kho xác nhận đã xuất ngoài hệ thống',",
    '    note,',
    '    {',
    '      ...externalPatch,',
    '      warehouse_handled_at: serverTimestamp(),',
    '      external_exported_at: serverTimestamp(),',
    '      exported_at: serverTimestamp(),',
    '      actual_exported_at: serverTimestamp(),',
    '    },',
    '    {',
    "      type: 'warehouse_export_request_released',",
    "      title: 'Kho xác nhận đơn đã xuất ngoài hệ thống',",
    "      message: `${row.request_id || row.id} · Đơn ${row.order_code || '-'} đã xuất thực tế ngoài hệ thống và không trừ tồn kho.`,",
    '    },',
    '  )',
    '  showToast(',
    '    result.notificationCount',
    "      ? 'Đã xác nhận xuất ngoài hệ thống và cập nhật trạng thái đơn hàng.'",
    "      : 'Đã xác nhận xuất ngoài hệ thống nhưng không xác định được Sale để gửi thông báo.',",
    "    result.notificationCount ? 'success' : 'info',",
    '  )',
    '}',
  ].join('\n'),
  'insert external submit handler',
)

replaceOnce(
  page,
  "    if (actionType.value === 'release') await submitRelease(row)\n    if (actionType.value === 'cancel_release') await submitCancelRelease(row)",
  "    if (actionType.value === 'release') await submitRelease(row)\n    if (actionType.value === 'external_release') await submitExternalRelease(row)\n    if (actionType.value === 'cancel_release') await submitCancelRelease(row)",
  'dispatch external action',
)

replaceOnce(
  page,
  "              <td>{{ row.warehouse_export_code || '-' }}</td>",
  "              <td><span v-if=\"isExternalExportRequestRelease(row)\" class=\"badge yellow\">Xuất ngoài HT</span><template v-else>{{ row.warehouse_export_code || '-' }}</template></td>",
  'external release table label',
)

replaceOnce(
  page,
  "                  <button v-if=\"canReleaseRequest(row)\" class=\"btn-sm btn-view\" @click=\"openAction(row, 'release')\">Cho xuất kho</button>\n                  <button v-if=\"canCancelReleasedRequest(row)\" class=\"btn-sm btn-delete\" @click=\"openAction(row, 'cancel_release')\">Hủy xuất/Hoàn tồn</button>",
  "                  <button v-if=\"canReleaseRequest(row)\" class=\"btn-sm btn-view\" @click=\"openAction(row, 'release')\">Cho xuất kho</button>\n                  <button v-if=\"canExternalReleaseRequest(row)\" class=\"btn-sm\" @click=\"openAction(row, 'external_release')\">Đã xuất ngoài HT</button>\n                  <button v-if=\"canCancelReleasedRequest(row)\" class=\"btn-sm btn-delete\" @click=\"openAction(row, 'cancel_release')\">Hủy xuất/Hoàn tồn</button>",
  'external release button',
)

replaceOnce(
  page,
  "                  <button v-if=\"!canAcceptRequest(row) && !canReleaseRequest(row) && !canCancelReleasedRequest(row) && !canRejectRequest(row)\" class=\"btn-sm\" disabled>Khóa</button>",
  "                  <button v-if=\"!canAcceptRequest(row) && !canReleaseRequest(row) && !canExternalReleaseRequest(row) && !canCancelReleasedRequest(row) && !canRejectRequest(row)\" class=\"btn-sm\" disabled>Khóa</button>",
  'include external action in lock state',
)

replaceOnce(
  page,
  "        <div class=\"detail-item\"><label>Phiếu kho</label><strong>{{ selectedRequest.warehouse_export_code || '-' }}</strong></div>\n        <div class=\"detail-item\"><label>Ghi chú kho</label><strong>{{ selectedRequest.warehouse_note || '-' }}</strong></div>",
  "        <div class=\"detail-item\"><label>Phiếu kho</label><strong>{{ isExternalExportRequestRelease(selectedRequest) ? 'Không tạo phiếu - xuất ngoài HT' : (selectedRequest.warehouse_export_code || '-') }}</strong></div>\n        <div class=\"detail-item\"><label>Hình thức xuất</label><strong>{{ isExternalExportRequestRelease(selectedRequest) ? 'Xuất ngoài hệ thống - không trừ tồn' : 'Xuất kho chuẩn' }}</strong></div>\n        <div v-if=\"isExternalExportRequestRelease(selectedRequest)\" class=\"detail-item\"><label>Ngày xuất thực tế</label><strong>{{ selectedRequest.external_export_date || '-' }}</strong></div>\n        <div class=\"detail-item\"><label>Ghi chú kho</label><strong>{{ selectedRequest.warehouse_note || '-' }}</strong></div>",
  'external release detail fields',
)

replaceOnce(
  page,
  "      <div v-if=\"actionType === 'release'\" class=\"form-grid\">",
  "      <div v-if=\"actionType === 'release' || actionType === 'external_release'\" class=\"form-grid\">",
  'show date for external release',
)

replaceOnce(
  page,
  "        <table :style=\"{ minWidth: actionType === 'release' ? '980px' : '720px' }\">",
  "        <table :style=\"{ minWidth: actionType === 'release' ? '980px' : '720px' }\">",
  'keep action table sizing stable',
)

replaceOnce(
  page,
  "        <label>{{ actionType === 'reject' ? 'Lý do từ chối' : actionType === 'cancel_release' ? 'Lý do hủy xuất' : 'Ghi chú kho' }}</label>",
  "        <label>{{ actionType === 'reject' ? 'Lý do từ chối' : actionType === 'cancel_release' ? 'Lý do hủy xuất' : actionType === 'external_release' ? 'Lý do / ghi chú xác nhận' : 'Ghi chú kho' }}</label>",
  'external release note label',
)

replaceOnce(
  page,
  "      <p v-if=\"actionType === 'release'\" class=\"small subtle\">Khi cho xuất kho, hệ thống sẽ check tồn, tạo export_orders/export_order_items, ghi stock_movements và trừ inventory_balances bằng transaction.</p>\n      <p v-if=\"actionType === 'cancel_release'\" class=\"small subtle\">Hệ thống sẽ hủy mềm phiếu xuất liên kết, hoàn inventory_balances, ghi stock_movements đảo và mở lại yêu cầu trong cùng transaction.</p>",
  "      <p v-if=\"actionType === 'release'\" class=\"small subtle\">Khi cho xuất kho, hệ thống sẽ check tồn, tạo export_orders/export_order_items, ghi stock_movements và trừ inventory_balances bằng transaction.</p>\n      <p v-if=\"actionType === 'external_release'\" class=\"small\" style=\"color:#b45309\">Chỉ dùng cho hàng đã xuất thực tế trước khi quản lý tồn trên hệ thống. Yêu cầu và đơn hàng vẫn chuyển sang trạng thái đã xuất, nhưng không tạo phiếu xuất, không ghi stock_movements và không thay đổi inventory_balances.</p>\n      <p v-if=\"actionType === 'cancel_release'\" class=\"small subtle\">Hệ thống sẽ hủy mềm phiếu xuất liên kết, hoàn inventory_balances, ghi stock_movements đảo và mở lại yêu cầu trong cùng transaction.</p>",
  'external release warning',
)

replaceOnce(
  rules,
  "        'status', 'lifecycle_status', 'release_sequence', 'active_export_order_id',",
  "        'status', 'lifecycle_status', 'release_mode', 'external_exported',\n        'external_export_date', 'external_exported_by', 'external_exported_at',\n        'release_sequence', 'active_export_order_id',",
  'allow external lifecycle fields',
)

insertBefore(
  rules,
  '    function exportRequestCancelAllowed(requestId) {',
  [
    '    function exportRequestExternalReleaseAllowed() {',
    "      let operationId = request.resource.data.get('operation_id', '');",
    "      let stockMovementIds = request.resource.data.get('stock_movement_ids', []);",
    "      let exportDate = request.resource.data.get('external_export_date', '');",
    "      return request.resource.data.get('lifecycle_status', '') == 'released_external'",
    "        && request.resource.data.get('status', '') == 'da_xuat'",
    "        && resource.data.get('status', '') in ['da_tiep_nhan', 'cho_xuat_kho', 'loi']",
    '        && exportRequestLifecycleFieldsOnly()',
    "        && hasAnyPerm(['export_requests.release', 'export_requests.process'])",
    "        && request.resource.data.get('release_mode', '') == 'external_no_inventory'",
    "        && request.resource.data.get('external_exported', false) == true",
    '        && exportDate is string',
    '        && exportDate.size() == 10',
    "        && ownEmailField(request.resource.data, 'warehouse_handled_by')",
    "        && ownEmailField(request.resource.data, 'external_exported_by')",
    "        && request.resource.data.get('warehouse_handled_at', null) is timestamp",
    "        && request.resource.data.get('warehouse_handled_at', null) == request.time",
    "        && request.resource.data.get('external_exported_at', null) is timestamp",
    "        && request.resource.data.get('external_exported_at', null) == request.time",
    "        && request.resource.data.get('exported_at', null) is timestamp",
    "        && request.resource.data.get('exported_at', null) == request.time",
    "        && request.resource.data.get('actual_exported_at', null) is timestamp",
    "        && request.resource.data.get('actual_exported_at', null) == request.time",
    "        && request.resource.data.get('active_export_order_id', '') == ''",
    "        && request.resource.data.get('warehouse_export_code', '') == ''",
    "        && request.resource.data.get('warehouse_export_id', '') == ''",
    "        && request.resource.data.get('warehouse_export_order_id', '') == ''",
    "        && request.resource.data.get('export_order_id', '') == ''",
    '        && stockMovementIds is list',
    '        && stockMovementIds.size() == 0',
    '        && operationId is string',
    "        && operationId != ''",
    "        && request.resource.data.get('last_operation_id', '') == operationId",
    "        && request.resource.data.get('revision', 0) == resource.data.get('revision', 0) + 1;",
    '    }',
  ].join('\n'),
  'insert external release rule',
)

replaceOnce(
  rules,
  "          || type == 'warehouse_export_request_released'\n          && status == 'da_xuat'\n          && requestData.get('lifecycle_status', '') == 'released'",
  "          || type == 'warehouse_export_request_released'\n          && status == 'da_xuat'\n          && requestData.get('lifecycle_status', '') in ['released', 'released_external']",
  'allow external release notification',
)

replaceOnce(
  rules,
  "        : request.resource.data.get('lifecycle_status', '') == 'released'\n          ? exportRequestReleaseAllowed(docId)\n          : request.resource.data.get('lifecycle_status', '') == 'release_cancelled'\n            ? exportRequestCancelAllowed(docId)\n            : (exportOwnerEditAllowed() || exportWarehouseProcessAllowed() || isAdmin());",
  "        : request.resource.data.get('lifecycle_status', '') == 'released'\n          ? exportRequestReleaseAllowed(docId)\n          : request.resource.data.get('lifecycle_status', '') == 'released_external'\n            ? exportRequestExternalReleaseAllowed()\n            : request.resource.data.get('lifecycle_status', '') == 'release_cancelled'\n              ? exportRequestCancelAllowed(docId)\n              : (exportOwnerEditAllowed() || exportWarehouseProcessAllowed() || isAdmin());",
  'route external lifecycle rule',
)

const clientTest = `import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildExternalReleasedRequestPatch,
  canReleaseExportRequestExternally,
  isExternalExportRequestRelease,
} from '../utils/exportLifecycle.mjs'

test('external release dùng trạng thái cũ nhưng không tạo liên kết kho', () => {
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

test('client external release không gọi transaction trừ tồn', () => {
  const source = readFileSync('pages/warehouse-export-requests.vue', 'utf8')
  const start = source.indexOf('async function submitExternalRelease')
  const end = source.indexOf('async function submitCancelRelease', start)
  assert.ok(start >= 0 && end > start)
  const block = source.slice(start, end)
  assert.match(block, /updateRequestStatus\(/)
  assert.doesNotMatch(block, /processExportRequestToExportOrder\(/)
  assert.doesNotMatch(block, /inventory_balances/)
  assert.doesNotMatch(block, /stock_movements/)

  const fallback = readFileSync('utils/fallbackOrderPatch.ts', 'utf8')
  assert.match(fallback, /warehouse_fulfillment_status:\s*'da_xuat_1_phan'/)
  assert.match(fallback, /warehouse_request_status:\s*'da_xuat'/)
})
`
write('tests/external-export-release.client.test.mjs', clientTest)

const rulesTest = `import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'

const projectId = 'demo-external-export-release'
const WAREHOUSE = 'warehouse@example.com'
const SALE = 'sale@example.com'
let env

function requestData(overrides = {}) {
  return {
    id: 'request-a', request_id: 'YCXK-A', order_id: 'order-a', order_code: 'ORDER-A',
    customer_name: 'Khách A', requested_by: SALE, order_owner_email: SALE,
    order_created_by: SALE, order_sale_email: SALE, status: 'da_tiep_nhan',
    lifecycle_status: 'accepted', release_sequence: 0, active_export_order_id: '',
    warehouse_export_code: '', warehouse_export_id: '', warehouse_export_order_id: '',
    export_order_id: '', request_timeline_json: '[]',
    payload_json: JSON.stringify({ items: [{ order_item_id: 'item-a', product_id: 'product-a', product_code: 'SP-A', logo: '', export_quantity: 4 }] }),
    actual_export_summary_json: '[]', stock_movement_ids: [], revision: 0,
    active: true, deleted: false, ...overrides,
  }
}

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', WAREHOUSE), { email: WAREHOUSE, active: true, deleted: false, permissions_flat: ['page.warehouse_export_requests', 'export_requests.release'] }),
      setDoc(doc(db, 'users', SALE), { email: SALE, active: true, deleted: false, permissions_flat: ['orders.view', 'export_requests.view'] }),
      setDoc(doc(db, 'orders', 'order-a'), {
        id: 'order-a', order_code: 'ORDER-A', owner_email: SALE, created_by: SALE, sale_email: SALE,
        warehouse_fulfillment_status: 'cho_xu_ly', warehouse_request_status: 'da_tiep_nhan',
        active: true, deleted: false, status: 'active',
      }),
      setDoc(doc(db, 'order_export_requests', 'request-a'), requestData()),
    ])
  })
}

function externalPatch(overrides = {}) {
  return {
    status: 'da_xuat', lifecycle_status: 'released_external', release_mode: 'external_no_inventory',
    external_exported: true, external_export_date: '2026-08-04', external_exported_by: WAREHOUSE,
    external_exported_at: serverTimestamp(), active_export_order_id: '', warehouse_export_code: '',
    warehouse_export_id: '', warehouse_export_order_id: '', export_order_id: '',
    warehouse_handled_by: WAREHOUSE, warehouse_handled_at: serverTimestamp(),
    warehouse_note: 'Đã xuất thực tế trước khi nhập tồn', exported_at: serverTimestamp(),
    actual_exported_at: serverTimestamp(), actual_export_summary_json: '[{"quantity":4,"release_mode":"external_no_inventory"}]',
    stock_movement_ids: [], request_timeline_json: '[{"action":"external_release"}]',
    operation_id: 'external-release:request-a:0', last_operation_id: 'external-release:request-a:0',
    revision: 1, updated_at: serverTimestamp(), ...overrides,
  }
}

function notificationData() {
  return {
    type: 'warehouse_export_request_released', title: 'Kho xác nhận đơn đã xuất ngoài hệ thống',
    message: 'YCXK-A · Đơn ORDER-A đã xuất thực tế ngoài hệ thống và không trừ tồn kho.',
    route: '/export-requests', entity_collection: 'order_export_requests', entity_id: 'request-a',
    entity_code: 'YCXK-A', created_by: WAREHOUSE, to_email: SALE, audience: '',
    audience_permissions: [], metadata_json: JSON.stringify({ order_id: 'order-a', order_code: 'ORDER-A' }),
    status: 'unread', read: false, active: true, deleted: false,
    created_at: serverTimestamp(), updated_at: serverTimestamp(),
  }
}

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } })
})
beforeEach(async () => { await env.clearFirestore(); await seed() })
after(async () => env.cleanup())

test('external release cập nhật request + order nhưng không sinh dữ liệu kho', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  batch.update(doc(db, 'orders', 'order-a'), {
    warehouse_fulfillment_status: 'da_xuat_1_phan', warehouse_request_status: 'da_xuat', updated_at: serverTimestamp(),
  })
  batch.set(doc(db, 'notifications', 'notification-a'), notificationData())
  await assertSucceeds(batch.commit())

  await env.withSecurityRulesDisabled(async context => {
    const adminDb = context.firestore()
    const requestRows = await getDocs(collection(adminDb, 'order_export_requests'))
    const orderRows = await getDocs(collection(adminDb, 'orders'))
    const exports = await getDocs(collection(adminDb, 'export_orders'))
    const exportItems = await getDocs(collection(adminDb, 'export_order_items'))
    const movements = await getDocs(collection(adminDb, 'stock_movements'))
    const balances = await getDocs(collection(adminDb, 'inventory_balances'))
    const request = requestRows.docs[0].data()
    const order = orderRows.docs[0].data()
    assert.equal(request.status, 'da_xuat')
    assert.equal(request.lifecycle_status, 'released_external')
    assert.equal(request.release_mode, 'external_no_inventory')
    assert.equal(order.warehouse_request_status, 'da_xuat')
    assert.equal(order.warehouse_fulfillment_status, 'da_xuat_1_phan')
    assert.equal(exports.empty, true)
    assert.equal(exportItems.empty, true)
    assert.equal(movements.empty, true)
    assert.equal(balances.empty, true)
  })
})

test('không có quyền release thì external release bị chặn', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', WAREHOUSE), { email: WAREHOUSE, active: true, deleted: false, permissions_flat: ['page.warehouse_export_requests'] })
  })
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'request-a'), externalPatch()))
})

test('external release không được gắn phiếu xuất hoặc movement giả', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'request-a'), externalPatch({
    active_export_order_id: 'export-fake', export_order_id: 'export-fake', stock_movement_ids: ['move-fake'],
  })))
})
`
write('tests/external-export-release.rules.test.mjs', rulesTest)

const packageJson = JSON.parse(read('package.json'))
const rulesCommand = packageJson.scripts['test:rules']
if (!rulesCommand.includes('tests/external-export-release.client.test.mjs')) {
  packageJson.scripts['test:rules'] = rulesCommand
    .replace('tests/export-lifecycle.client.test.mjs', 'tests/export-lifecycle.client.test.mjs tests/external-export-release.client.test.mjs')
    .replace('tests/export-lifecycle.rules.test.mjs', 'tests/export-lifecycle.rules.test.mjs tests/external-export-release.rules.test.mjs')
}
write('package.json', `${JSON.stringify(packageJson, null, 2)}\n`)

rmSync('scripts/apply-external-export-release-patch.mjs')
rmSync('.github/workflows/apply-external-export-release-patch.yml')

console.log('External export release patch applied.')
