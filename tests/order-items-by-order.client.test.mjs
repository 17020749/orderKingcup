import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  chunkOrderIds,
  filterItemsForVisibleOrders,
  orderItemQueryKey,
  uniqueOrderIds,
} from '../utils/orderItemScope.mjs'

test('lấy danh sách order id duy nhất và ổn định từ các đơn đã được phép xem', () => {
  assert.deepEqual(uniqueOrderIds([
    { id: 'order-b' },
    { firestore_id: 'order-a' },
    { id: 'order-b' },
    { id: '' },
  ]), ['order-a', 'order-b'])
})

test('chia query order_id thành nhóm an toàn cho Firestore in query', () => {
  const ids = Array.from({ length: 23 }, (_, index) => `order-${index + 1}`)
  const chunks = chunkOrderIds(ids)
  assert.deepEqual(chunks.map(group => group.length), [5, 5, 5, 5, 3])
  assert.deepEqual(chunks.flat(), ids)
})

test('relation query chunks are capped at the safe size', () => {
  const chunks = chunkOrderIds(Array.from({ length: 11 }, (_, index) => `order-${index + 1}`), 30)
  assert.deepEqual(chunks.map(group => group.length), [5, 5, 1])
})

test('dòng sản phẩm legacy không cần owner_email vẫn được giữ theo order_id', () => {
  const rows = filterItemsForVisibleOrders([
    {
      id: 'item-legacy',
      order_id: 'order-owned',
      product_code: 'SP-LEGACY',
      active: true,
      deleted: false,
    },
    {
      id: 'item-other',
      order_id: 'order-other',
      active: true,
      deleted: false,
    },
    {
      id: 'item-deleted',
      order_id: 'order-owned',
      active: false,
      deleted: true,
    },
  ], ['order-owned'])

  assert.deepEqual(rows.map(row => row.id), ['item-legacy'])
})

test('khóa in-flight query phân tách theo email và tập order id', () => {
  assert.equal(
    orderItemQueryKey('SALE@EXAMPLE.COM', ['order-b', 'order-a']),
    'sale@example.com::order-a|order-b',
  )
})

test('client thực tế query order_items theo order_id thay vì email sao chép', () => {
  const source = readFileSync('composables/useScopedQueriesClient.ts', 'utf8')
  const moduleSource = readFileSync('modules/scoped-order-items.ts', 'utf8')
  const nuxtConfig = readFileSync('nuxt.config.ts', 'utf8')

  assert.match(source, /where\('order_id', 'in', group\)/)
  assert.match(source, /Promise\.allSettled/)
  assert.match(source, /SAFE_RELATION_QUERY_CHUNK_SIZE/)
  assert.match(source, /failed_order_ids/)
  assert.match(source, /uniqueOrderIds\(orders\)/)
  assert.match(source, /filterItemsForVisibleOrders\(rows, orderIds\)/)
  assert.doesNotMatch(source, /listByEmailFields<OrderItemDoc>/)
  assert.doesNotMatch(source, /\['owner_email', 'created_by', 'sale_email'\]/)
  assert.match(moduleSource, /as: 'useScopedQueries'/)
  assert.match(moduleSource, /priority: 110/)
  assert.match(nuxtConfig, /'~\/modules\/scoped-order-items'/)
})

test('màn hình đơn và yêu cầu xuất cùng dùng auto-import useScopedQueries đã override', () => {
  const ordersPage = readFileSync('pages/orders.vue', 'utf8')
  const requestsPage = readFileSync('pages/export-requests.vue', 'utf8')

  assert.match(ordersPage, /loadScopedOrderItems\(pageOrders, force\)/)
  assert.match(requestsPage, /loadScopedOrderItems\(orders\.value, force\)/)
})

test('related pages use the shared order_items loader', () => {
  for (const page of [
    'pages/dashboard.vue',
    'pages/shipments.vue',
    'pages/export-requests.vue',
    'pages/warehouse-export-requests.vue',
  ]) {
    assert.match(readFileSync(page, 'utf8'), /loadScopedOrderItems/)
  }
})
