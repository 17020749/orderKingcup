import { readFileSync, writeFileSync, rmSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

function write(path, content) {
  writeFileSync(path, content, 'utf8')
}

function replaceOnce(source, search, replacement, label) {
  const index = source.indexOf(search)
  if (index < 0) throw new Error(`Không tìm thấy đoạn cần sửa: ${label}`)
  if (source.indexOf(search, index + search.length) >= 0) {
    throw new Error(`Đoạn cần sửa xuất hiện nhiều lần: ${label}`)
  }
  return source.slice(0, index) + replacement + source.slice(index + search.length)
}

function replaceFunction(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker)
  if (start < 0) throw new Error(`Không tìm thấy đầu hàm: ${label}`)
  const end = source.indexOf(endMarker, start)
  if (end < 0) throw new Error(`Không tìm thấy cuối hàm: ${label}`)
  return source.slice(0, start) + replacement.trimEnd() + '\n\n' + source.slice(end)
}

function patchWarehousePage() {
  const path = 'pages/warehouse-export-requests.vue'
  let source = read(path)

  source = replaceOnce(
    source,
    "import { formatDateTime, isActive, normalizeText, safeJsonParse, todayKey, toNumber } from '~/utils/format'",
    "import { formatDateTime, isActive, makeCode, makeId, normalizeText, safeJsonParse, todayKey, toNumber } from '~/utils/format'",
    'import format helpers',
  )

  source = replaceOnce(
    source,
    "async function updateRequestStatus(row: any, nextStatus: string, action: string, title: string, note = '', extra: Record<string, any> = {}, notification?: { type: string; title: string; message: string }) {",
    "async function updateRequestStatus(row: any, nextStatus: string, action: string, title: string, note = '', extra: Record<string, any> = {}, notification?: { type: string; title: string; message: string }, extendBatch?: (batch: any) => void) {",
    'extend updateRequestStatus batch',
  )

  source = replaceOnce(
    source,
    "  const notificationCount = notification ? addSaleNotifications(batch, row, notification) : 0\n  await batch.commit()\n  invalidateScopedCache('order_export_requests')\n  invalidateScopedCache('orders')\n  invalidateScopedCache('activity_logs')",
    "  const notificationCount = notification ? addSaleNotifications(batch, row, notification) : 0\n  extendBatch?.(batch)\n  await batch.commit()\n  invalidateScopedCache('order_export_requests')\n  invalidateScopedCache('orders')\n  invalidateScopedCache('activity_logs')\n  invalidateScopedCache('export_orders')\n  invalidateScopedCache('export_order_items')",
    'commit extended batch and invalidate export records',
  )

  const externalFunction = `async function submitExternalRelease(row: any) {
  const note = String(actionForm.note || '').trim()
  const exportDate = String(actionForm.export_date || '').trim()
  if (!exportDate) return showToast('Vui lòng chọn ngày đã xuất thực tế.', 'error')
  if (!note) return showToast('Vui lòng nhập lý do hoặc ghi chú xác nhận.', 'error')

  const lines = requestLineProgress(row).filter((line: any) => toNumber(line.requested_qty) > 0)
  if (!lines.length) return showToast('Yêu cầu xuất kho chưa có dòng hàng hợp lệ.', 'error')

  const confirmed = await askConfirm({
    title: 'Xác nhận đã xuất ngoài hệ thống',
    message: \`Yêu cầu \${row.request_id || row.id} sẽ chuyển thành Đã xuất kho và tạo phiếu ghi nhận trên trang Xuất kho. Phiếu này KHÔNG ghi biến động và KHÔNG trừ tồn. Bạn chắc chắn?\`,
    confirmLabel: 'Xác nhận đã xuất',
  })
  if (!confirmed) return

  const actor = String(appUser.value?.email || '').trim().toLowerCase()
  const operationId = \`export_request_external:\${row.id}:\${toNumber(row.revision)}\`
  const exportOrderId = makeId('exp_external')
  const exportCode = makeCode('PXK-NGOAI')
  const releaseSequence = Math.max(0, Math.floor(toNumber(row.release_sequence))) + 1
  const timelineJson = appendTimeline(row, 'external_release', 'Kho xác nhận đã xuất ngoài hệ thống', 'da_xuat', note)
  const actualSummaryJson = JSON.stringify(lines.map((line: any) => ({
    source_order_id: row.order_id || '',
    source_order_item_id: String(line.order_item_id || line.source_order_item_id || '').trim(),
    product_id: line.product_id || '',
    product_code: line.product_code || '',
    logo: line.logo || '',
    quantity: toNumber(line.requested_qty),
    unit: line.unit || '',
    release_mode: 'external_no_inventory',
  })))
  const externalPatch = buildExternalReleasedRequestPatch({
    request: row,
    actor,
    exportDate,
    note,
    operationId,
    timelineJson,
    actualSummaryJson,
  })

  const exportOrderPayload = {
    id: exportOrderId,
    code: exportCode,
    export_code: exportCode,
    export_date: exportDate,
    destination_type: 'customer',
    source_order_id: row.order_id || '',
    source_order_code: row.order_code || '',
    source_request_id: row.id,
    sync_source: 'kingcup_firestore:external_no_inventory',
    customer_name: row.customer_name || '',
    destination_name: row.customer_name || '',
    to_warehouse_id: '',
    to_warehouse_name: '',
    note,
    status: 'completed',
    lifecycle_status: 'released_external',
    release_mode: 'external_no_inventory',
    affects_inventory: false,
    stock_movement_ids: [],
    release_sequence: releaseSequence,
    source_request_revision: toNumber(row.revision),
    request_operation_id: operationId,
    active: true,
    deleted: false,
    created_by: actor,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    operation_id: operationId,
    last_operation_id: operationId,
    revision: 1,
    source: 'kingcup_firestore',
  }

  const exportItemPayloads = lines.map((line: any, index: number) => {
    const product = findProductByCode(line.product_code)
    const logo = String(line.logo || '').trim()
    return {
      id: makeId(\`exp_external_item_\${index + 1}\`),
      export_order_id: exportOrderId,
      source_order_id: row.order_id || '',
      source_order_item_id: String(line.order_item_id || line.source_order_item_id || '').trim(),
      product_id: line.product_id || product?.id || '',
      product_code: line.product_code || product?.product_code || '',
      product_name: line.product_name || product?.product_name || '',
      from_warehouse_id: '',
      from_warehouse_name: 'Xuất ngoài hệ thống',
      to_warehouse_id: '',
      to_warehouse_name: '',
      destination_name: row.customer_name || '',
      logo,
      source_logo: logo,
      target_logo: logo,
      quantity: toNumber(line.requested_qty),
      unit: line.unit || product?.unit || '',
      note: line.note || note,
      status: 'completed',
      lifecycle_status: 'released_external',
      release_mode: 'external_no_inventory',
      affects_inventory: false,
      active: true,
      deleted: false,
      created_by: actor,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      operation_id: operationId,
      last_operation_id: operationId,
      revision: 1,
      source: 'kingcup_firestore',
    }
  })

  const result = await updateRequestStatus(
    row,
    'da_xuat',
    'external_release',
    'Kho xác nhận đã xuất ngoài hệ thống',
    note,
    {
      ...externalPatch,
      release_sequence: releaseSequence,
      external_export_order_id: exportOrderId,
      external_export_code: exportCode,
      warehouse_handled_at: serverTimestamp(),
      external_exported_at: serverTimestamp(),
      exported_at: serverTimestamp(),
      actual_exported_at: serverTimestamp(),
    },
    {
      type: 'warehouse_export_request_released',
      title: 'Kho xác nhận đơn đã xuất ngoài hệ thống',
      message: \`\${row.request_id || row.id} · Đơn \${row.order_code || '-'} đã xuất thực tế ngoài hệ thống, đã tạo phiếu \${exportCode} và không trừ tồn kho.\`,
    },
    batch => {
      batch.set(doc(db, 'export_orders', exportOrderId), exportOrderPayload)
      exportItemPayloads.forEach(item => {
        batch.set(doc(db, 'export_order_items', item.id), item)
      })
    },
  )
  showToast(
    result.notificationCount
      ? \`Đã xác nhận xuất ngoài hệ thống và tạo phiếu ghi nhận \${exportCode}.\`
      : \`Đã tạo phiếu ghi nhận \${exportCode}, nhưng không xác định được Sale để gửi thông báo.\`,
    result.notificationCount ? 'success' : 'info',
  )
}`

  source = replaceFunction(
    source,
    'async function submitExternalRelease(row: any) {',
    'async function submitCancelRelease(row: any) {',
    externalFunction,
    'submitExternalRelease',
  )

  source = replaceOnce(
    source,
    '<td><span v-if="isExternalExportRequestRelease(row)" class="badge yellow">Xuất ngoài HT</span><template v-else>{{ row.warehouse_export_code || \'-\' }}</template></td>',
    '<td><template v-if="isExternalExportRequestRelease(row)"><span class="badge yellow">Xuất ngoài HT</span><div class="small subtle">{{ row.external_export_code || \'-\' }}</div></template><template v-else>{{ row.warehouse_export_code || \'-\' }}</template></td>',
    'external export code in request table',
  )

  source = replaceOnce(
    source,
    "<div class=\"detail-item\"><label>Phiếu kho</label><strong>{{ isExternalExportRequestRelease(selectedRequest) ? 'Không tạo phiếu - xuất ngoài HT' : (selectedRequest.warehouse_export_code || '-') }}</strong></div>",
    "<div class=\"detail-item\"><label>Phiếu kho</label><strong>{{ isExternalExportRequestRelease(selectedRequest) ? (selectedRequest.external_export_code || 'Phiếu ghi nhận xuất ngoài HT') : (selectedRequest.warehouse_export_code || '-') }}</strong></div>",
    'external export code in detail',
  )

  source = replaceOnce(
    source,
    'Chỉ dùng cho hàng đã xuất thực tế trước khi quản lý tồn trên hệ thống. Yêu cầu và đơn hàng vẫn chuyển sang trạng thái đã xuất, nhưng không tạo phiếu xuất, không ghi stock_movements và không thay đổi inventory_balances.',
    'Chỉ dùng cho hàng đã xuất thực tế trước khi quản lý tồn trên hệ thống. Hệ thống tạo một phiếu ghi nhận trên trang Xuất kho, nhưng không ghi stock_movements và không thay đổi inventory_balances.',
    'external release warning',
  )

  write(path, source)
}

function patchExportsPage() {
  const path = 'pages/exports.vue'
  let source = read(path)

  source = replaceOnce(
    source,
    'function canEditRow(row: ExportOrderDoc) {',
    `function isExternalNoInventory(row: any) {
  return row?.affects_inventory === false
    || String(row?.release_mode || '') === 'external_no_inventory'
    || String(row?.lifecycle_status || '') === 'released_external'
}

function canEditRow(row: ExportOrderDoc) {`,
    'external record helper',
  )

  source = replaceOnce(
    source,
    'subtitle="Quản lý phiếu xuất kho và cập nhật tồn"',
    'subtitle="Quản lý phiếu xuất kho và phiếu ghi nhận xuất ngoài hệ thống"',
    'exports subtitle',
  )

  source = replaceOnce(
    source,
    '<div class="summary-card"><label>Ghi tồn</label><strong>Transaction</strong></div>',
    '<div class="summary-card"><label>Ghi tồn</label><strong>Theo loại phiếu</strong></div>',
    'exports inventory summary',
  )

  source = replaceOnce(
    source,
    '<td><b>{{ codeOf(row) }}</b><div class="small subtle">{{ row.source_order_code || row.sync_source || row.id }}</div></td>',
    '<td><b>{{ codeOf(row) }}</b><div v-if="isExternalNoInventory(row)" class="small"><span class="badge yellow">Không trừ tồn</span></div><div class="small subtle">{{ row.source_order_code || row.sync_source || row.id }}</div></td>',
    'external badge in exports table',
  )

  source = replaceOnce(
    source,
    '<td>{{ destinationLabel(row.destination_type) }}</td>',
    '<td>{{ isExternalNoInventory(row) ? "Xuất ngoài hệ thống" : destinationLabel(row.destination_type) }}</td>',
    'external destination label',
  )

  source = replaceOnce(
    source,
    '<td><span class="badge blue">{{ row.status || "active" }}</span></td>',
    '<td><span class="badge" :class="isExternalNoInventory(row) ? \'yellow\' : \'blue\'">{{ isExternalNoInventory(row) ? \'Đã ghi nhận - không trừ tồn\' : (row.status || \'active\') }}</span></td>',
    'external status badge',
  )

  write(path, source)
}

function patchRules() {
  const path = 'firestore.rules'
  let source = read(path)

  source = replaceOnce(
    source,
    "        'external_export_date', 'external_exported_by', 'external_exported_at',\n        'release_sequence', 'active_export_order_id',",
    "        'external_export_date', 'external_exported_by', 'external_exported_at',\n        'external_export_order_id', 'external_export_code',\n        'release_sequence', 'active_export_order_id',",
    'external lifecycle fields',
  )

  const externalOrderHelper = `    function externalGeneratedExportCreateMatchesRequest(exportOrderId) {
      let requestId = request.resource.data.get('source_request_id', '');
      let path = exportRequestPath(requestId);
      return generatedExportOrderData(request.resource.data)
        && request.resource.data.get('lifecycle_status', '') == 'released_external'
        && request.resource.data.get('release_mode', '') == 'external_no_inventory'
        && request.resource.data.get('affects_inventory', true) == false
        && request.resource.data.get('request_operation_id', '') != ''
        && request.resource.data.get('stock_movement_ids', []) is list
        && request.resource.data.get('stock_movement_ids', []).size() == 0
        && exists(path)
        && existsAfter(path)
        && getAfter(path).data.get('status', '') == 'da_xuat'
        && getAfter(path).data.get('lifecycle_status', '') == 'released_external'
        && getAfter(path).data.get('release_mode', '') == 'external_no_inventory'
        && getAfter(path).data.get('external_export_order_id', '') == exportOrderId
        && getAfter(path).data.get('external_export_code', '') == request.resource.data.get('export_code', '')
        && getAfter(path).data.get('release_sequence', 0) == request.resource.data.get('release_sequence', -1)
        && request.resource.data.get('source_request_revision', -1) == get(path).data.get('revision', 0)
        && getAfter(path).data.get('operation_id', '') == request.resource.data.get('request_operation_id', '');
    }

`
  source = replaceOnce(
    source,
    '    function generatedExportCancelMatchesRequest(exportOrderId) {',
    externalOrderHelper + '    function generatedExportCancelMatchesRequest(exportOrderId) {',
    'external generated export order helper',
  )

  const externalItemHelper = `    function externalGeneratedExportItemCreateAllowed() {
      let exportOrderId = request.resource.data.get('export_order_id', '');
      let path = exportOrderPath(exportOrderId);
      let exportData = getAfter(path).data;
      let requestPath = exportRequestPath(exportData.get('source_request_id', ''));
      let requestData = getAfter(requestPath).data;
      return exportOrderId is string
        && exportOrderId != ''
        && existsAfter(path)
        && generatedExportOrderData(exportData)
        && exportData.get('lifecycle_status', '') == 'released_external'
        && exportData.get('release_mode', '') == 'external_no_inventory'
        && exportData.get('affects_inventory', true) == false
        && exportData.get('deleted', false) != true
        && exportData.get('active', true) != false
        && existsAfter(requestPath)
        && requestData.get('status', '') == 'da_xuat'
        && requestData.get('lifecycle_status', '') == 'released_external'
        && requestData.get('external_export_order_id', '') == exportOrderId
        && request.resource.data.get('source_order_id', '') == requestData.get('order_id', '')
        && request.resource.data.get('release_mode', '') == 'external_no_inventory'
        && request.resource.data.get('affects_inventory', true) == false;
    }

`
  source = replaceOnce(
    source,
    '    function generatedExportItemCreateAllowed() {',
    externalItemHelper + '    function generatedExportItemCreateAllowed() {',
    'external generated export item helper',
  )

  source = replaceOnce(
    source,
    '          && generatedExportCreateMatchesRequest(docId)',
    '          && (generatedExportCreateMatchesRequest(docId) || externalGeneratedExportCreateMatchesRequest(docId))',
    'allow external generated export order create',
  )

  source = replaceOnce(
    source,
    '        && generatedExportItemCreateAllowed()\n        || (',
    '        && (generatedExportItemCreateAllowed() || externalGeneratedExportItemCreateAllowed())\n        || (',
    'allow external generated export item create',
  )

  const externalReleaseRule = `    function exportRequestExternalReleaseAllowed(requestId) {
      let operationId = request.resource.data.get('operation_id', '');
      let stockMovementIds = request.resource.data.get('stock_movement_ids', []);
      let exportDate = request.resource.data.get('external_export_date', '');
      let externalExportOrderId = request.resource.data.get('external_export_order_id', '');
      let externalExportCode = request.resource.data.get('external_export_code', '');
      let exportPath = exportOrderPath(externalExportOrderId);
      return request.resource.data.get('lifecycle_status', '') == 'released_external'
        && request.resource.data.get('status', '') == 'da_xuat'
        && resource.data.get('status', '') in ['da_tiep_nhan', 'cho_xuat_kho', 'loi']
        && exportRequestLifecycleFieldsOnly()
        && hasAnyPerm(['export_requests.release', 'export_requests.process'])
        && request.resource.data.get('release_mode', '') == 'external_no_inventory'
        && request.resource.data.get('external_exported', false) == true
        && exportDate is string
        && exportDate.size() == 10
        && externalExportOrderId is string
        && externalExportOrderId != ''
        && externalExportCode is string
        && externalExportCode != ''
        && ownEmailField(request.resource.data, 'warehouse_handled_by')
        && ownEmailField(request.resource.data, 'external_exported_by')
        && request.resource.data.get('warehouse_handled_at', null) is timestamp
        && request.resource.data.get('warehouse_handled_at', null) == request.time
        && request.resource.data.get('external_exported_at', null) is timestamp
        && request.resource.data.get('external_exported_at', null) == request.time
        && request.resource.data.get('exported_at', null) is timestamp
        && request.resource.data.get('exported_at', null) == request.time
        && request.resource.data.get('actual_exported_at', null) is timestamp
        && request.resource.data.get('actual_exported_at', null) == request.time
        && request.resource.data.get('active_export_order_id', '') == ''
        && request.resource.data.get('warehouse_export_code', '') == ''
        && request.resource.data.get('warehouse_export_id', '') == ''
        && request.resource.data.get('warehouse_export_order_id', '') == ''
        && request.resource.data.get('export_order_id', '') == ''
        && stockMovementIds is list
        && stockMovementIds.size() == 0
        && operationId is string
        && operationId != ''
        && request.resource.data.get('last_operation_id', '') == operationId
        && request.resource.data.get('revision', 0) == resource.data.get('revision', 0) + 1
        && request.resource.data.get('release_sequence', 0) == resource.data.get('release_sequence', 0) + 1
        && existsAfter(exportPath)
        && getAfter(exportPath).data.get('source_request_id', '') == requestId
        && getAfter(exportPath).data.get('export_code', '') == externalExportCode
        && getAfter(exportPath).data.get('lifecycle_status', '') == 'released_external'
        && getAfter(exportPath).data.get('release_mode', '') == 'external_no_inventory'
        && getAfter(exportPath).data.get('affects_inventory', true) == false
        && getAfter(exportPath).data.get('request_operation_id', '') == operationId
        && getAfter(exportPath).data.get('source_request_revision', -1) == resource.data.get('revision', 0)
        && getAfter(exportPath).data.get('stock_movement_ids', []) is list
        && getAfter(exportPath).data.get('stock_movement_ids', []).size() == 0
        && externalReleaseOrderSummaryMatches();
    }`

  source = replaceFunction(
    source,
    '    function exportRequestExternalReleaseAllowed() {',
    '    function exportRequestCancelAllowed(requestId) {',
    externalReleaseRule,
    'external release rule',
  )

  source = replaceOnce(
    source,
    '? exportRequestExternalReleaseAllowed()',
    '? exportRequestExternalReleaseAllowed(docId)',
    'external release rule call',
  )

  write(path, source)
}

const clientTest = `import { readFileSync } from 'node:fs'
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
  assert.equal(block.includes("batch.set(doc(db, 'export_orders'"), true)
  assert.equal(block.includes("batch.set(doc(db, 'export_order_items'"), true)
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
`

const rulesTest = `import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, doc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'

const projectId = 'demo-external-export-release'
const WAREHOUSE = 'warehouse@example.com'
const SALE = 'sale@example.com'
const EXPORT_ID = 'external-export-a'
const EXPORT_CODE = 'PXK-NGOAI-A'
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
    external_exported_at: serverTimestamp(), external_export_order_id: EXPORT_ID,
    external_export_code: EXPORT_CODE, release_sequence: 1,
    active_export_order_id: '', warehouse_export_code: '', warehouse_export_id: '',
    warehouse_export_order_id: '', export_order_id: '', warehouse_handled_by: WAREHOUSE,
    warehouse_handled_at: serverTimestamp(), warehouse_note: 'Đã xuất thực tế trước khi nhập tồn',
    exported_at: serverTimestamp(), actual_exported_at: serverTimestamp(),
    actual_export_summary_json: '[{"quantity":4,"release_mode":"external_no_inventory"}]',
    stock_movement_ids: [], request_timeline_json: '[{"action":"external_release"}]',
    operation_id: 'external-release:request-a:0', last_operation_id: 'external-release:request-a:0',
    revision: 1, updated_at: serverTimestamp(), ...overrides,
  }
}

function externalExportOrder(overrides = {}) {
  return {
    id: EXPORT_ID, code: EXPORT_CODE, export_code: EXPORT_CODE, export_date: '2026-08-04',
    destination_type: 'customer', source_order_id: 'order-a', source_order_code: 'ORDER-A',
    source_request_id: 'request-a', sync_source: 'kingcup_firestore:external_no_inventory',
    customer_name: 'Khách A', destination_name: 'Khách A', to_warehouse_id: '', to_warehouse_name: '',
    note: 'Đã xuất thực tế trước khi nhập tồn', status: 'completed', lifecycle_status: 'released_external',
    release_mode: 'external_no_inventory', affects_inventory: false, stock_movement_ids: [],
    release_sequence: 1, source_request_revision: 0,
    request_operation_id: 'external-release:request-a:0', active: true, deleted: false,
    created_by: WAREHOUSE, created_at: serverTimestamp(), updated_at: serverTimestamp(),
    operation_id: 'external-release:request-a:0', last_operation_id: 'external-release:request-a:0',
    revision: 1, source: 'kingcup_firestore', ...overrides,
  }
}

function externalExportItem(overrides = {}) {
  return {
    id: 'external-item-a', export_order_id: EXPORT_ID, source_order_id: 'order-a',
    source_order_item_id: '', product_id: 'product-a', product_code: 'SP-A', product_name: 'Sản phẩm A',
    from_warehouse_id: '', from_warehouse_name: 'Xuất ngoài hệ thống', to_warehouse_id: '', to_warehouse_name: '',
    destination_name: 'Khách A', logo: '', source_logo: '', target_logo: '', quantity: 4, unit: 'cái',
    note: 'Đã xuất ngoài hệ thống', status: 'completed', lifecycle_status: 'released_external',
    release_mode: 'external_no_inventory', affects_inventory: false, active: true, deleted: false,
    created_by: WAREHOUSE, created_at: serverTimestamp(), updated_at: serverTimestamp(),
    operation_id: 'external-release:request-a:0', last_operation_id: 'external-release:request-a:0',
    revision: 1, source: 'kingcup_firestore', ...overrides,
  }
}

function updateOrderSummary(db, batch, fulfillment = 'da_xuat_1_phan', requestStatus = 'da_xuat') {
  batch.update(doc(db, 'orders', 'order-a'), {
    warehouse_fulfillment_status: fulfillment, warehouse_request_status: requestStatus, updated_at: serverTimestamp(),
  })
}

function addExternalRecord(db, batch, orderOverrides = {}, itemOverrides = {}) {
  batch.set(doc(db, 'export_orders', EXPORT_ID), externalExportOrder(orderOverrides))
  batch.set(doc(db, 'export_order_items', 'external-item-a'), externalExportItem(itemOverrides))
}

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync('firestore.rules', 'utf8') } })
})
beforeEach(async () => { await env.clearFirestore(); await seed() })
after(async () => env.cleanup())

test('external release tạo phiếu hiển thị ở exports nhưng không sinh biến động tồn', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(db, batch)
  addExternalRecord(db, batch)
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
    const exportOrder = exports.docs[0].data()
    assert.equal(request.status, 'da_xuat')
    assert.equal(request.external_export_order_id, EXPORT_ID)
    assert.equal(order.warehouse_request_status, 'da_xuat')
    assert.equal(order.warehouse_fulfillment_status, 'da_xuat_1_phan')
    assert.equal(exports.size, 1)
    assert.equal(exportItems.size, 1)
    assert.equal(exportOrder.affects_inventory, false)
    assert.equal(exportOrder.release_mode, 'external_no_inventory')
    assert.equal(movements.empty, true)
    assert.equal(balances.empty, true)
  })
})

test('external release cho phép đơn hàng chuyển thẳng sang đã xuất đủ', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(db, batch, 'da_xuat_du')
  addExternalRecord(db, batch)
  await assertSucceeds(batch.commit())
})

test('không có quyền release thì bị chặn dù payload đầy đủ', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'users', WAREHOUSE), { email: WAREHOUSE, active: true, deleted: false, permissions_flat: ['page.warehouse_export_requests'] })
  })
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(db, batch)
  addExternalRecord(db, batch)
  await assertFails(batch.commit())
})

test('chỉ tạo phiếu exports mà không cập nhật request bị chặn', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  addExternalRecord(db, batch)
  await assertFails(batch.commit())
})

test('external release thiếu phiếu exports bị chặn', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(db, batch)
  await assertFails(batch.commit())
})

test('external release không được gắn liên kết xuất chuẩn hoặc movement giả', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch({
    active_export_order_id: EXPORT_ID, export_order_id: EXPORT_ID, stock_movement_ids: ['move-fake'],
  }))
  updateOrderSummary(db, batch)
  addExternalRecord(db, batch)
  await assertFails(batch.commit())
})

test('phiếu ghi nhận bắt buộc affects_inventory false', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(db, batch)
  addExternalRecord(db, batch, { affects_inventory: true })
  await assertFails(batch.commit())
})

test('external release cập nhật order sai trạng thái bị chặn', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch())
  updateOrderSummary(db, batch, 'cho_xu_ly', 'da_tiep_nhan')
  addExternalRecord(db, batch)
  await assertFails(batch.commit())
})

test('external release bắt buộc có lý do xác nhận', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'order_export_requests', 'request-a'), externalPatch({ warehouse_note: '' }))
  updateOrderSummary(db, batch)
  addExternalRecord(db, batch)
  await assertFails(batch.commit())
})
`

function patchTests() {
  write('tests/external-export-release.client.test.mjs', clientTest)
  write('tests/external-export-release.rules.test.mjs', rulesTest)
}

patchWarehousePage()
patchExportsPage()
patchRules()
patchTests()
rmSync('.github/workflows/apply-external-export-record.yml', { force: true })
rmSync('scripts/apply-external-export-record.mjs', { force: true })
console.log('External export record patch applied.')
