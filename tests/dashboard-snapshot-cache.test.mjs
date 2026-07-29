import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildDashboardSnapshot,
  DASHBOARD_RECENT_LIMIT,
  DASHBOARD_SOURCE_COLLECTIONS,
  dashboardTimestampValue,
} from '../utils/dashboardSnapshot.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8')

function active(row) {
  return row?.deleted !== true && row?.active !== false && !['deleted', 'inactive'].includes(String(row?.status || '').toLowerCase())
}

function number(value) {
  const parsed = Number(String(value ?? '').replaceAll(',', ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function paymentStatus(order, payments) {
  const paid = payments
    .filter(payment => payment.payment_status === 'Đã nhận')
    .reduce((sum, payment) => sum + number(payment.amount), 0)
  const revenue = number(order.actual_revenue || order.total_vat)
  return {
    payment_status: paid >= revenue ? 'Đã thanh toán' : paid > 0 ? 'Thanh toán một phần' : 'Chưa thanh toán',
    debt_amount: Math.max(0, revenue - paid),
  }
}

test('dashboard snapshot preserves KPI formulas and excludes inactive records', () => {
  const snapshot = buildDashboardSnapshot({
    orders: [
      { id: 'o1', actual_revenue: '1,000', order_date: '2026-07-01', active: true },
      { id: 'o2', actual_revenue: 9000, order_date: '2026-07-03', active: false },
      { id: 'o3', total_vat: 500, order_date: '2026-07-02', active: true },
    ],
    customers: [{ id: 'c1', active: true }, { id: 'c2', deleted: true }],
    products: [{ id: 'p1' }, { id: 'p2', status: 'inactive' }],
    requests: [{ id: 'r1' }, { id: 'r2', deleted: true }],
    payments: [
      { id: 'pay1', order_id: 'o1', amount: 300, payment_status: 'Đã nhận', payment_date: '2026-07-03' },
      { id: 'pay2', order_id: 'o1', amount: 200, payment_status: 'Chờ xác nhận', payment_date: '2026-07-01' },
      { id: 'pay3', order_id: 'o3', amount: 500, payment_status: 'Đã nhận', payment_date: '2026-07-02' },
      { id: 'pay4', order_id: 'o2', amount: 9000, payment_status: 'Đã nhận', active: false },
    ],
    items: [
      { id: 'i1', order_id: 'o1', line_profit: 100 },
      { id: 'i2', order_id: 'o3', line_profit: '50' },
      { id: 'i3', order_id: 'o2', line_profit: 9999 },
      { id: 'i4', order_id: 'o1', line_profit: 9999, deleted: true },
    ],
    computePaymentStatus: paymentStatus,
    isActive: active,
    toNumber: number,
  })

  assert.deepEqual(snapshot.stats, {
    orders: 2,
    customers: 1,
    products: 1,
    revenue: 1500,
    paid: 800,
    debt: 700,
    profit: 150,
    exportRequests: 1,
  })
  assert.deepEqual(snapshot.recentOrders.map(row => row.id), ['o3', 'o1'])
  assert.deepEqual(snapshot.recentPayments.map(row => row.id), ['pay1', 'pay3', 'pay2'])
  assert.equal(snapshot.recentOrders[0].payment_status, 'Đã thanh toán')
})

test('dashboard timestamp comparison supports Firestore and persisted cache values', () => {
  assert.equal(dashboardTimestampValue({ toMillis: () => 1234 }), 1234)
  assert.equal(dashboardTimestampValue({ seconds: 2 }), 2000)
  assert.equal(dashboardTimestampValue('2026-07-29T00:00:00.000Z'), Date.parse('2026-07-29T00:00:00.000Z'))
  assert.equal(dashboardTimestampValue('invalid'), 0)
})

test('dashboard cache policy and source tags are explicit and bounded', () => {
  assert.equal(DASHBOARD_RECENT_LIMIT, 8)
  assert.deepEqual(DASHBOARD_SOURCE_COLLECTIONS, [
    'orders',
    'order_items',
    'payments',
    'order_export_requests',
    'customers',
    'products',
  ])

  const policies = read('constants/cachePolicies.ts')
  assert.match(policies, /dashboardSnapshot:\s*\{[\s\S]*freshMs:\s*60_000,[\s\S]*staleMs:\s*5 \* 60_000/)
})

test('dashboard composable scopes cache by authorization and forces real refreshes', () => {
  const source = read('composables/useDashboardSnapshot.ts')
  assert.match(source, /authorizationCacheKey/)
  assert.match(source, /namespace:\s*DASHBOARD_CACHE_NAMESPACE/)
  assert.match(source, /tags:\s*DASHBOARD_CACHE_TAGS/)
  assert.match(source, /policy:\s*QUERY_CACHE_POLICIES\.dashboardSnapshot/)
  assert.match(source, /force,/)
  assert.match(source, /loadScopedOrders\(true\)/)
  assert.match(source, /loadScopedPayments\(orders, true\)/)
  assert.match(source, /loadScopedOrderItems\(orders, true\)/)
  for (const collectionName of DASHBOARD_SOURCE_COLLECTIONS) {
    assert.match(source, new RegExp(`collection:\\$\\{collectionName\\}`))
  }
})

test('dashboard page uses cached snapshot and refresh button bypasses it', () => {
  const source = read('pages/dashboard.vue')
  assert.match(source, /useDashboardSnapshot\(\)/)
  assert.match(source, /loadDashboardSnapshot\(force\)/)
  assert.match(source, /@click="loadDashboard\(true\)"/)
  assert.doesNotMatch(source, /loadScopedOrders/)
  assert.doesNotMatch(source, /loadScopedPayments/)
})

test('repository writes invalidate every dashboard collection tag they touch', () => {
  const source = read('composables/useRepo.ts')
  assert.match(source, /function collectionTags\(name: string\)/)
  assert.match(source, /`collection:\$\{name\}`/)
  assert.match(source, /invalidateQueryCacheTags\(/)
  assert.match(source, /invalidateCollectionCaches\(name, docId\)/)
})

test('public scoped invalidation clears legacy v2 and shared v3 cache generations', () => {
  const bridge = read('composables/useScopedQueries.ts')
  const legacy = read('runtime/useScopedQueriesLegacy.ts')

  assert.match(bridge, /invalidateLegacyScopedCache\(collectionName\)/)
  assert.match(bridge, /invalidateQueryCacheTags\(\[/)
  assert.match(bridge, /`collection:\$\{collectionName\}`/)
  assert.match(bridge, /`collection:\$\{collectionName\}:list`/)
  assert.match(bridge, /if \(!collectionName\)[\s\S]*clearSharedQueryCache\(\)/)
  assert.match(bridge, /export \* from '~\/runtime\/useScopedQueriesLegacy'/)

  assert.match(legacy, /kingcup\.query-cache\.v2\./)
  assert.match(legacy, /memoryCache\.delete\(key\)/)
  assert.match(legacy, /sessionStorage\.removeItem\(key\)/)
})

test('atomic Order, Payment and Export Request writes route through the unified bridge', () => {
  const ordersPage = read('pages/orders.vue')
  const relations = read('composables/useAtomicOrderRelations.ts')
  const warehouseRequests = read('pages/warehouse-export-requests.vue')

  assert.match(ordersPage, /invalidateScopedCache\('orders'\)/)
  assert.match(ordersPage, /invalidateScopedCache\('order_items'\)/)

  assert.match(relations, /invalidateScopedCache\(module\)/)
  assert.match(relations, /invalidateScopedCache\('orders'\)/)

  assert.match(warehouseRequests, /invalidateScopedCache\('order_export_requests'\)/)
  assert.match(warehouseRequests, /invalidateScopedCache\('orders'\)/)
})

test('cache invalidation bridge adds no polling, listener or Firestore read', () => {
  const bridge = read('composables/useScopedQueries.ts')

  assert.doesNotMatch(bridge, /firebase\/firestore/)
  assert.doesNotMatch(bridge, /onSnapshot/)
  assert.doesNotMatch(bridge, /setInterval|setTimeout/)
  assert.doesNotMatch(bridge, /getDoc|getDocs|query\(/)
})
