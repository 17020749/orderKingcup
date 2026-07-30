import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  EXPORT_REQUEST_HISTORY_PAGE_SIZE,
  EXPORT_REQUEST_HISTORY_STATUSES,
  EXPORT_REQUEST_OWNER_FIELDS,
  EXPORT_REQUEST_QUEUE_LIMIT,
  EXPORT_REQUEST_QUEUE_STATUSES,
  isExportRequestHistoryStatus,
  isExportRequestQueueStatus,
  mergeExportRequestWindows,
  safeExportRequestPageSize,
} from '../utils/exportRequestWindow.mjs'

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

test('keeps scoped queue query under Firestore disjunction limit', () => {
  assert.equal(EXPORT_REQUEST_OWNER_FIELDS.length, 4)
  assert.equal(EXPORT_REQUEST_QUEUE_STATUSES.length, 7)
  assert.ok(EXPORT_REQUEST_OWNER_FIELDS.length * EXPORT_REQUEST_QUEUE_STATUSES.length <= 30)
  assert.equal(EXPORT_REQUEST_QUEUE_LIMIT, 100)
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

  const merged = mergeExportRequestWindows(queue, history)
  assert.deepEqual(merged.map(row => row.id), ['same', 'queue', 'history'])
  assert.equal(merged.find(row => row.id === 'same')?.status, 'da_tiep_nhan')
})

test('bounds history page size', () => {
  assert.equal(safeExportRequestPageSize(undefined), 50)
  assert.equal(safeExportRequestPageSize(1), 10)
  assert.equal(safeExportRequestPageSize(75), 75)
  assert.equal(safeExportRequestPageSize(1000), 100)
})

test('runtime export request queries are bounded and have no unbounded fallback listener', () => {
  const source = read('composables/useExportRequestQueries.ts')
  assert.match(source, /where\('status', 'in', \[\.\.\.EXPORT_REQUEST_QUEUE_STATUSES\]\)/)
  assert.match(source, /orderBy\('updated_at', 'desc'\)/)
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
  assert.match(sale, /loadExportRequestsForOrder/)
  assert.match(sale, /Tải thêm 50 phiếu lịch sử/)
  assert.match(sale, /ensureOrderRequests\(selectedOrder\.value\.id\)/)

  assert.match(warehouse, /loadWarehouseExportRequestHistoryPage/)
  assert.match(warehouse, /Tải thêm 50 phiếu lịch sử/)
  assert.match(warehouse, /mergeExportRequestWindows\(queueRows\.value, historyRows\.value\)/)
})

test('runtime bridge overrides only export request list methods', () => {
  const bridge = read('runtime/useScopedQueriesBridge.ts')
  assert.match(bridge, /useLegacyScopedQueries/)
  assert.match(bridge, /useExportRequestQueries/)
  assert.match(bridge, /\.\.\.useLegacyScopedQueries\(\)/)
  assert.match(bridge, /\.\.\.useExportRequestQueries\(\)/)
  assert.match(bridge, /invalidateScopedCache/)
})

test('declares all bounded export request composite indexes', () => {
  const document = JSON.parse(read('firestore.indexes.json'))
  const indexes = document.indexes || []

  assert.equal(hasIndex(indexes, [
    { fieldPath: 'status', order: 'ASCENDING' },
    { fieldPath: 'updated_at', order: 'DESCENDING' },
  ]), true)

  for (const fieldPath of EXPORT_REQUEST_OWNER_FIELDS) {
    assert.equal(hasIndex(indexes, [
      { fieldPath, order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'updated_at', order: 'DESCENDING' },
    ]), true, `missing index for ${fieldPath}`)
  }
})
