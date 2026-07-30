import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  EXPORT_REQUEST_HISTORY_PAGE_SIZE,
  EXPORT_REQUEST_HISTORY_STATUSES,
  EXPORT_REQUEST_WINDOW_OWNER_FIELDS,
  EXPORT_REQUEST_QUEUE_LIMIT,
  EXPORT_REQUEST_QUEUE_PAGE_SIZE,
  EXPORT_REQUEST_QUEUE_STATUSES,
  EXPORT_REQUEST_WINDOW_STATES,
  exportRequestWindowState,
  isExportRequestHistoryStatus,
  isExportRequestQueueStatus,
  mergeExportRequestWindows,
  safeExportRequestPageSize,
} from '../utils/exportRequestWindow.mjs'
import { buildExportRequestBackfillPatch } from '../utils/exportRequestBackfill.mjs'
import {
  buildExportRequestOrderMarker,
  exportRequestRevisionOf,
} from '../utils/exportRequestMutation.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

function timestamp(milliseconds) {
  return { toMillis: () => milliseconds }
}

function hasIndex(indexes, fields) {
  return indexes.some(index => (
    index.collectionGroup === 'order_export_requests'
    && index.queryScope === 'COLLECTION'
    && JSON.stringify(index.fields) === JSON.stringify(fields)
  ))
}

test('uses bounded queue and history windows', () => {
  assert.equal(EXPORT_REQUEST_WINDOW_OWNER_FIELDS.length, 4)
  assert.ok(EXPORT_REQUEST_QUEUE_STATUSES.length >= 7)
  assert.equal(EXPORT_REQUEST_QUEUE_LIMIT, 100)
  assert.equal(EXPORT_REQUEST_QUEUE_PAGE_SIZE, 50)
  assert.equal(EXPORT_REQUEST_HISTORY_PAGE_SIZE, 50)
})

test('separates realtime queue statuses from terminal history statuses', () => {
  for (const status of EXPORT_REQUEST_QUEUE_STATUSES) {
    assert.equal(isExportRequestQueueStatus(status), true)
    assert.equal(isExportRequestHistoryStatus(status), false)
  }
  for (const status of EXPORT_REQUEST_HISTORY_STATUSES) {
    assert.equal(isExportRequestHistoryStatus(status), true)
    assert.equal(isExportRequestQueueStatus(status), false)
  }
})

test('merges queue and history without duplicates and realtime row wins', () => {
  const history = [
    { id: 'same', status: 'da_xuat', updated_at: timestamp(100), active: true, deleted: false },
    { id: 'history', status: 'tu_choi', updated_at: timestamp(200), active: true, deleted: false },
    { id: 'deleted', status: 'deleted', updated_at: timestamp(400), active: false, deleted: true },
  ]
  const queue = [
    { id: 'same', status: 'da_tiep_nhan', updated_at: timestamp(300), active: true, deleted: false },
    { id: 'queue', status: 'cho_xu_ly', updated_at: timestamp(250), active: true, deleted: false },
  ]

  const olderQueuePage = [
    { id: 'older', status: 'pending', sort_at: timestamp(50), active: true, deleted: false },
    { id: 'same', status: 'pending', sort_at: timestamp(10), active: true, deleted: false },
  ]
  const merged = mergeExportRequestWindows(queue, history, olderQueuePage)
  assert.deepEqual(merged.map(row => row.id), ['same', 'queue', 'history', 'older'])
  assert.equal(merged.find(row => row.id === 'same')?.status, 'da_tiep_nhan')
})

test('classifies legacy statuses and hidden records deterministically', () => {
  assert.equal(exportRequestWindowState('ready-to-export'), EXPORT_REQUEST_WINDOW_STATES.queue)
  assert.equal(exportRequestWindowState('partial exported'), EXPORT_REQUEST_WINDOW_STATES.queue)
  assert.equal(exportRequestWindowState('completed'), EXPORT_REQUEST_WINDOW_STATES.history)
  assert.equal(exportRequestWindowState({ status: 'pending', active: false }), EXPORT_REQUEST_WINDOW_STATES.hidden)
  assert.equal(exportRequestWindowState({ status: 'unknown' }), EXPORT_REQUEST_WINDOW_STATES.hidden)
})

test('legacy backfill is idempotent and restores ownership from the order', () => {
  const request = {
    status: 'tu_choi',
    updated_at: '2026-01-02T03:04:05.000Z',
    requested_by: '',
  }
  const order = {
    owner_email: 'owner@example.com',
    created_by: 'creator@example.com',
    sale_email: 'sale@example.com',
  }
  const patch = buildExportRequestBackfillPatch(request, order)
  assert.deepEqual(patch, {
    window_state: 'history',
    sort_at: request.updated_at,
    requested_by: 'sale@example.com',
    order_owner_email: 'owner@example.com',
    order_created_by: 'creator@example.com',
    order_sale_email: 'sale@example.com',
  })
  assert.deepEqual(buildExportRequestBackfillPatch({ ...request, ...patch }, order), {})
})

test('parent marker increments exactly once and preserves request/action identity', () => {
  const marker = buildExportRequestOrderMarker(
    { export_request_revision: 4 },
    {
      action: 'update',
      requestId: 'request-a',
      actor: ' SALE@EXAMPLE.COM ',
      updatedAt: 'now',
    },
  )
  assert.equal(exportRequestRevisionOf(marker), 5)
  assert.equal(marker.export_request_last_request_id, 'request-a')
  assert.equal(marker.export_request_last_action, 'update')
  assert.equal(marker.export_request_updated_by, 'sale@example.com')
})

test('bounds history page size', () => {
  assert.equal(safeExportRequestPageSize(undefined), 50)
  assert.equal(safeExportRequestPageSize(1), 10)
  assert.equal(safeExportRequestPageSize(75), 75)
  assert.equal(safeExportRequestPageSize(1000), 100)
})

test('runtime export request queries are bounded and have no unbounded fallback listener', () => {
  const source = read('composables/useExportRequestQueries.ts')
  assert.match(source, /where\('window_state', '==', EXPORT_REQUEST_WINDOW_STATES\.queue\)/)
  assert.match(source, /orderBy\('sort_at', 'desc'\)/)
  assert.match(source, /queryLimit\(EXPORT_REQUEST_QUEUE_LIMIT\)/)
  assert.match(source, /startAfter\(input\.cursor\)/)
  assert.match(source, /queryLimit\(safeSize \+ 1\)/)
  assert.match(source, /where\('order_id', '==', id\)/)
  assert.doesNotMatch(source, /query\(collection\(db, 'order_export_requests'\)\s*\)/)
  assert.doesNotMatch(source, /fallbackUnsubscribes/)
})

test('Sale and Warehouse pages combine realtime queue with cursor history', () => {
  const sale = read('pages/export-requests.vue')
  const warehouse = read('pages/warehouse-export-requests.vue')

  assert.match(sale, /loadScopedExportRequestHistoryPage/)
  assert.match(sale, /loadScopedExportRequestQueuePage/)
  assert.match(sale, /loadExportRequestsForOrder/)
  assert.match(sale, /Tải thêm 50 phiếu lịch sử/)
  assert.match(sale, /ensureOrderRequests\(selectedOrder\.value\.id, true\)/)
  assert.match(sale, /validationOrderBefore/)
  assert.match(sale, /validationOrderAfter/)
  assert.match(sale, /runTransaction\(db/)
  assert.match(sale, /exportRequestRevisionOf\(currentOrder\) !== expectedOrderRevision/)

  assert.match(warehouse, /loadWarehouseExportRequestHistoryPage/)
  assert.match(warehouse, /loadWarehouseExportRequestQueuePage/)
  assert.match(warehouse, /Tải thêm 50 phiếu lịch sử/)
  assert.match(warehouse, /mergeExportRequestWindows\(queueRows\.value, historyRows\.value, queuePageRows\.value\)/)
})

test('all request write paths update the derived window and parent marker', () => {
  const sale = read('pages/export-requests.vue')
  const warehouse = read('pages/warehouse-export-requests.vue')
  const costTransactions = read('composables/useWarehouseCostTransactions.ts')
  const legacyTransactions = read('composables/useWarehouseTransactions.ts')
  const orderDelete = read('pages/orders.vue')
  const rules = read('firestore.rules')

  assert.match(sale, /buildExportRequestOrderMarker/)
  assert.match(sale, /window_state: "hidden"/)
  assert.match(warehouse, /export_request_revision: increment\(1\)/)
  assert.match(costTransactions, /export_request_last_action: 'warehouse_export'/)
  assert.match(costTransactions, /export_request_last_action: 'warehouse_export_cancel'/)
  assert.match(legacyTransactions, /export_request_last_action: 'warehouse_export'/)
  assert.match(orderDelete, /window_state: 'hidden'/)
  assert.match(rules, /validExportRequestWindowMutation/)
  assert.match(rules, /exportRequestHasParentMarker/)
})

test('backfill script is dry-run by default and requires explicit project confirmation', () => {
  const script = read('scripts/backfill-export-request-window.mjs')
  assert.match(script, /process\.argv\.includes\('--apply'\)/)
  assert.match(script, /--confirm-project=/)
  assert.match(script, /index \+= 400/)
  assert.match(script, /Dry-run only/)
})

test('runtime bridge overrides only export request list methods', () => {
  const bridge = read('runtime/useScopedQueriesBridge.ts')
  assert.match(bridge, /useLegacyScopedQueries/)
  assert.match(bridge, /useExportRequestQueries/)
  assert.match(bridge, /\.\.\.useLegacyScopedQueries\(\)/)
  assert.match(bridge, /\.\.\.useExportRequestQueries\(\)/)
  assert.match(bridge, /invalidateScopedCache/)
  assert.match(bridge, /clearExportRequestOrderCache/)
})

test('export request pages explicitly import the scoped query runtime bridge', () => {
  const sale = read('pages/export-requests.vue')
  const warehouse = read('pages/warehouse-export-requests.vue')
  const explicitBridgeImport = /import \{ useScopedQueries \} from ['"]~\/runtime\/useScopedQueriesBridge['"]/

  assert.match(sale, explicitBridgeImport)
  assert.match(warehouse, explicitBridgeImport)
})

test('declares all bounded export request composite indexes', () => {
  const document = JSON.parse(read('firestore.indexes.json'))
  const indexes = document.indexes || []

  assert.equal(hasIndex(indexes, [
    { fieldPath: 'window_state', order: 'ASCENDING' },
    { fieldPath: 'sort_at', order: 'DESCENDING' },
  ]), true)

  for (const fieldPath of EXPORT_REQUEST_WINDOW_OWNER_FIELDS) {
    assert.equal(hasIndex(indexes, [
      { fieldPath, order: 'ASCENDING' },
      { fieldPath: 'window_state', order: 'ASCENDING' },
      { fieldPath: 'sort_at', order: 'DESCENDING' },
    ]), true, `missing index for ${fieldPath}`)
  }
})
