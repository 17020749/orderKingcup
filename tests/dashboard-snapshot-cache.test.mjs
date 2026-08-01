import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildDashboardSnapshot,
  DASHBOARD_ALERT_LIMIT,
  DASHBOARD_PERIODS,
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
    paid_amount: paid,
    debt_amount: Math.max(0, revenue - paid),
  }
}

function buildFixture() {
  return buildDashboardSnapshot({
    now: '2026-07-04T12:00:00+07:00',
    orders: [
      {
        id: 'o1',
        order_code: 'KC001',
        customer_id: 'c1',
        customer_name: 'Khách A',
        sale_name: 'Sale A',
        sale_email: 'sale-a@kingcup.vn',
        actual_revenue: '1,000',
        order_date: '2026-07-01',
        order_status: 'Đang sản xuất',
        expected_delivery_date: '2026-07-03',
        active: true,
      },
      { id: 'o2', order_code: 'KC002', actual_revenue: 9000, order_date: '2026-07-03', active: false },
      {
        id: 'o3',
        order_code: 'KC003',
        customer_id: 'c2',
        customer_name: 'Khách B',
        sale_name: 'Sale B',
        sale_email: 'sale-b@kingcup.vn',
        total_vat: 500,
        order_date: '2026-07-02',
        order_status: 'Đã hoàn thành',
        active: true,
      },
    ],
    customers: [{ id: 'c1', active: true }, { id: 'c2', deleted: true }],
    products: [
      { id: 'p1', product_code: 'LY', category: 'Ly giấy', active: true },
      { id: 'p2', status: 'inactive' },
    ],
    requests: [{ id: 'r1', order_id: 'o1' }, { id: 'r2', deleted: true }],
    payments: [
      { id: 'pay1', order_id: 'o1', amount: 300, payment_status: 'Đã nhận', payment_date: '2026-07-03' },
      { id: 'pay2', order_id: 'o1', amount: 200, payment_status: 'Chờ xác nhận', payment_date: '2026-07-01' },
      { id: 'pay3', order_id: 'o3', amount: 500, payment_status: 'Đã nhận', payment_date: '2026-07-02' },
      { id: 'pay4', order_id: 'o2', amount: 9000, payment_status: 'Đã nhận', active: false },
    ],
    items: [
      {
        id: 'i1',
        order_id: 'o1',
        product_id: 'p1',
        product_code: 'LY',
        quantity: 100,
        line_total: 1000,
        line_profit: 100,
        logo_json: '[{"logo":"Kingcup"}]',
      },
      { id: 'i2', order_id: 'o3', product_id: 'p1', product_code: 'LY', quantity: 50, line_total: 500, line_profit: '50' },
      { id: 'i3', order_id: 'o2', line_profit: 9999 },
      { id: 'i4', order_id: 'o1', line_profit: 9999, deleted: true },
    ],
    shipments: [],
    printOrders: [{ id: 'print1', order_id: 'o1', order_code: 'KC001' }],
    printItems: [{ id: 'print-item-1', print_order_id: 'print1', expected_done_at: '2026-07-02', is_completed: false }],
    computePaymentStatus: paymentStatus,
    isActive: active,
    toNumber: number,
  })
}

test('dashboard snapshot preserves KPI formulas and excludes inactive records', () => {
  const snapshot = buildFixture()

  assert.deepEqual({
    orders: snapshot.stats.orders,
    customers: snapshot.stats.customers,
    products: snapshot.stats.products,
    revenue: snapshot.stats.revenue,
    paid: snapshot.stats.paid,
    debt: snapshot.stats.debt,
    profit: snapshot.stats.profit,
    exportRequests: snapshot.stats.exportRequests,
  }, {
    orders: 2,
    customers: 1,
    products: 1,
    revenue: 1500,
    paid: 800,
    debt: 700,
    profit: 150,
    exportRequests: 1,
  })
  assert.equal(snapshot.stats.overdueOrders, 1)
  assert.equal(snapshot.stats.inProduction, 1)
  assert.deepEqual(snapshot.recentOrders.map(row => row.id), ['o3', 'o1'])
  assert.deepEqual(snapshot.recentPayments.map(row => row.id), ['pay1', 'pay3', 'pay2'])
  assert.equal(snapshot.recentOrders[0].payment_status, 'Đã thanh toán')
})

test('dashboard builds period KPIs, sale KPIs and product profitability', () => {
  const snapshot = buildFixture()
  const month = snapshot.periods.month

  assert.equal(month.stats.revenue, 1500)
  assert.equal(month.stats.paid, 800)
  assert.equal(month.stats.profit, 150)
  assert.equal(month.stats.newCustomers, 2)
  assert.equal(month.stats.conversionRate, 100)
  assert.equal(month.salesKpis.length, 2)
  assert.equal(month.salesKpis[0].orders, 1)
  assert.equal(month.productProfit[0].name, 'Ly giấy')
  assert.equal(month.productProfit[0].profit, 150)
})

test('dashboard derives order pipeline, production stages, design gaps and automatic alerts', () => {
  const snapshot = buildFixture()

  assert.equal(snapshot.pipeline.find(row => row.key === 'production').count, 1)
  assert.equal(snapshot.pipeline.find(row => row.key === 'completed').count, 1)
  assert.equal(snapshot.productionStages.find(row => row.key === 'printing').count, 1)
  assert.equal(snapshot.designSummary.requiredOrders, 1)
  assert.equal(snapshot.designSummary.missingOrders, 1)
  assert.ok(snapshot.alerts.some(alert => alert.id === 'delivery-overdue:o1'))
  assert.ok(snapshot.alerts.some(alert => alert.id === 'printing:print-item-1'))
  assert.ok(snapshot.alerts.length <= DASHBOARD_ALERT_LIMIT)
})

test('dashboard timestamp comparison supports Firestore and persisted cache values', () => {
  assert.equal(dashboardTimestampValue({ toMillis: () => 1234 }), 1234)
  assert.equal(dashboardTimestampValue({ seconds: 2 }), 2000)
  assert.equal(dashboardTimestampValue(4321), 4321)
  assert.equal(dashboardTimestampValue('2026-07-29T00:00:00.000Z'), Date.parse('2026-07-29T00:00:00.000Z'))
  assert.equal(dashboardTimestampValue('invalid'), 0)
})

test('dashboard cache policy and source tags are explicit and bounded', () => {
  assert.equal(DASHBOARD_RECENT_LIMIT, 8)
  assert.equal(DASHBOARD_ALERT_LIMIT, 12)
  assert.deepEqual(DASHBOARD_PERIODS.map(row => row.key), ['today', '7d', 'month', 'quarter', 'year', 'all'])
  assert.deepEqual(DASHBOARD_SOURCE_COLLECTIONS, [
    'orders',
    'order_items',
    'payments',
    'order_export_requests',
    'customers',
    'products',
    'shipments',
    'print_orders',
    'print_order_items',
  ])

  const policies = read('constants/cachePolicies.ts')
  assert.match(policies, /dashboardSnapshot:\s*\{[\s\S]*freshMs:\s*5 \* 60_000,[\s\S]*staleMs:\s*30 \* 60_000/)
})

test('dashboard scopes printing reads and only forces Firestore on manual refresh', () => {
  const source = read('composables/useDashboardSnapshot.ts')
  assert.match(source, /authorizationCacheKey/)
  assert.match(source, /namespace:\s*DASHBOARD_CACHE_NAMESPACE/)
  assert.match(source, /params:\s*\{ schema: 3 \}/)
  assert.match(source, /tags:\s*DASHBOARD_CACHE_TAGS/)
  assert.match(source, /policy:\s*QUERY_CACHE_POLICIES\.dashboardSnapshot/)
  assert.match(source, /fetchSnapshot\(forceSources = false\)/)
  assert.match(source, /fetcher:\s*\(\) => fetchSnapshot\(force\)/)
  assert.match(source, /loadScopedOrders\(forceSources\)/)
  assert.match(source, /loadScopedPayments\(orders, forceSources\)/)
  assert.match(source, /loadScopedOrderItems\(orders, forceSources\)/)
  assert.match(source, /loadScopedShipments\(forceSources\)/)
  assert.match(source, /loadPrintingDependenciesForOrders\(orders\)/)
  assert.match(source, /loadOptionalSource/)
  assert.doesNotMatch(source, /loadPrintOrders\(true\)/)
  assert.doesNotMatch(source, /loadPrintOrderItems\(true\)/)
  for (const collectionName of DASHBOARD_SOURCE_COLLECTIONS) {
    assert.match(source, new RegExp(`collection:\\$\\{collectionName\\}`))
  }
})

test('printing dependency loader avoids an unbounded print item scan', () => {
  const source = read('composables/useOrderPrintingDeleteGuard.ts')
  const rules = read('firestore.rules')

  assert.match(source, /loadPrintingDependenciesForOrders\(orders: OrderDoc\[\]\)/)
  assert.match(source, /const printOrders = \(await loadPrintingProgressForOrders\(orders\)\)\.filter\(isActive\)/)
  assert.match(source, /where\('print_order_id', 'in', ids\)/)
  assert.match(rules, /match \/print_order_items\/\{docId\} \{[\s\S]*resource\.data\.print_order_id is string/)
})

test('dashboard page uses cached snapshot, period views and refresh button bypasses cache', () => {
  const source = read('pages/dashboard.vue')
  assert.match(source, /useDashboardSnapshot\(\)/)
  assert.match(source, /loadDashboardSnapshot\(force\)/)
  assert.match(source, /@click="loadDashboard\(true\)"/)
  assert.match(source, /selectedPeriod/)
  assert.match(source, /dashboard\.pipeline/)
  assert.match(source, /dashboard\.productionStages/)
  assert.match(source, /dashboard\.alerts/)
  assert.match(source, /currentPeriod\.salesKpis/)
  assert.match(source, /dashboard\.designSummary/)
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

test('runtime alias routes public scoped invalidation through both cache generations', () => {
  const bridge = read('runtime/useScopedQueriesBridge.ts')
  const legacy = read('composables/useScopedQueries.ts')
  const nuxtConfig = read('nuxt.config.ts')

  assert.match(nuxtConfig, /['"]~\/composables\/useScopedQueries['"]/)
  assert.match(nuxtConfig, /runtime\/useScopedQueriesBridge\.ts/)

  assert.match(bridge, /invalidateLegacyScopedCache\(collectionName\)/)
  assert.match(bridge, /invalidateQueryCacheTags\(\[/)
  assert.match(bridge, /`collection:\$\{collectionName\}`/)
  assert.match(bridge, /`collection:\$\{collectionName\}:list`/)
  assert.match(bridge, /if \(!collectionName\)[\s\S]*clearSharedQueryCache\(\)/)
  assert.match(bridge, /export \* from '\.\.\/composables\/useScopedQueries'/)

  assert.match(legacy, /kingcup\.query-cache\.v2\./)
  assert.match(legacy, /memoryCache\.delete\(key\)/)
  assert.match(legacy, /sessionStorage\.removeItem\(key\)/)
})

test('atomic Order, Payment and Export Request writes use the aliased public invalidator', () => {
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
  const bridge = read('runtime/useScopedQueriesBridge.ts')

  assert.doesNotMatch(bridge, /firebase\/firestore/)
  assert.doesNotMatch(bridge, /onSnapshot/)
  assert.doesNotMatch(bridge, /setInterval|setTimeout/)
  assert.doesNotMatch(bridge, /getDoc|getDocs|query\(/)
})
