import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  warehouseOrderDeleteBlocker,
  warehouseRequestsForDeleteCascade,
} from '../utils/orderWarehouseDeleteLock.mjs'

test('khóa xóa khi yêu cầu kho đã tiếp nhận hoặc chờ xuất dù client chưa tải request', () => {
  assert.match(
    warehouseOrderDeleteBlocker({ warehouse_request_status: 'da_tiep_nhan' }, []),
    /đã tiếp nhận|chờ xuất/i,
  )
  assert.match(
    warehouseOrderDeleteBlocker({ warehouse_request_status: 'cho_xuat_kho' }, []),
    /đã tiếp nhận|chờ xuất/i,
  )
})

test('khóa xóa khi đơn đã cho xuất hoặc có mã phiếu Warehouse', () => {
  assert.match(
    warehouseOrderDeleteBlocker({ warehouse_fulfillment_status: 'da_xuat_1_phan' }, []),
    /đã xuất/i,
  )
  assert.match(
    warehouseOrderDeleteBlocker({}, [{ status: 'da_xuat', warehouse_export_code: 'PX-001' }]),
    /đã xuất|phiếu Warehouse/i,
  )
})

test('yêu cầu bị từ chối không còn ràng buộc và được cascade khi xóa đơn', () => {
  const rejected = [{ id: 'req-rejected', status: 'tu_choi', active: true, deleted: false }]
  assert.equal(warehouseOrderDeleteBlocker({ warehouse_request_status: 'co_tu_choi' }, rejected), '')
  assert.deepEqual(warehouseRequestsForDeleteCascade(rejected).map(row => row.id), ['req-rejected'])
})

test('yêu cầu đang chờ vẫn được cascade, nhưng yêu cầu đã tiếp nhận không được đưa vào batch xóa', () => {
  const requests = [
    { id: 'req-pending', status: 'cho_xu_ly', active: true, deleted: false },
    { id: 'req-accepted', status: 'da_tiep_nhan', active: true, deleted: false },
  ]
  assert.deepEqual(warehouseRequestsForDeleteCascade(requests).map(row => row.id), ['req-pending'])
  assert.match(warehouseOrderDeleteBlocker({}, requests), /đã tiếp nhận|chờ xuất/i)
})

test('page đơn hàng dùng preflight mới nhất và không thay đổi luồng save/edit', () => {
  const page = readFileSync('pages/orders.vue', 'utf8')
  const scopedQueries = readFileSync('composables/useScopedQueries.ts', 'utf8')

  assert.match(page, /warehouseOrderDeleteBlocker/)
  assert.match(page, /warehouseRequestsForDeleteCascade/)
  assert.match(page, /loadScopedExportRequests\(\[row\], true\)/)
  assert.match(scopedQueries, /hasPermission\('orders\.delete'\)/)

  assert.match(page, /async function saveOrder\(\)/)
  assert.match(page, /saveOrderAtomic\(/)
})
