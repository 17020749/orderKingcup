import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDashboardSnapshot,
  DASHBOARD_ORDER_CLASSIFICATIONS,
} from '../utils/dashboardSnapshot.mjs'

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
  const revenue = number(order.actual_revenue || order.payable_amount || order.total_vat)
  return {
    payment_status: paid >= revenue ? 'Đã thanh toán' : paid > 0 ? 'Thanh toán một phần' : 'Chưa thanh toán',
    paid_amount: paid,
    debt_amount: Math.max(0, revenue - paid),
  }
}

function buildFixture() {
  return buildDashboardSnapshot({
    now: '2026-07-20T12:00:00+07:00',
    orders: [
      {
        id: 'o1', order_code: 'KC001', customer_id: 'c1', customer_name: 'Khách 1',
        sale_name: 'Sale A', sale_email: 'sale-a@kingcup.vn', order_classification: 'Số mới',
        actual_revenue: 1000, order_date: '2026-07-03', order_status: 'Đang sản xuất', active: true,
      },
      {
        id: 'o2', order_code: 'KC002', customer_id: 'c2', customer_name: 'Khách 2',
        sale_name: 'Sale A', sale_email: 'SALE-A@KINGCUP.VN', order_classification: 'Chăm sóc',
        actual_revenue: 500, order_date: '2026-07-05', order_status: 'Đã hoàn thành', active: true,
      },
      {
        id: 'o3', order_code: 'KC003', customer_id: 'c3', customer_name: 'Khách 3',
        sale_name: 'Sale B', sale_email: 'sale-b@kingcup.vn', order_classification: 'Đại lý',
        actual_revenue: 2000, order_date: '2026-07-08', order_status: 'Đang giao', active: true,
      },
      {
        id: 'o4', order_code: 'KC004', customer_id: 'c4', customer_name: 'Khách hủy',
        sale_name: 'Sale B', sale_email: 'sale-b@kingcup.vn', order_classification: 'Số mới',
        actual_revenue: 9000, order_date: '2026-07-10', order_status: 'Đã hủy', active: true,
      },
      {
        id: 'o5', order_code: 'KC005', customer_id: 'c5', customer_name: 'Khách cũ',
        sale_name: 'Sale C', sale_email: 'sale-c@kingcup.vn', order_classification: 'Chăm sóc',
        actual_revenue: 100, order_date: '2026-06-15', order_status: 'Đã hoàn thành', active: true,
      },
    ],
    customers: [],
    products: [{ id: 'p1', product_code: 'P1', category: 'Ly', active: true }],
    requests: [],
    payments: [
      { id: 'p1', order_id: 'o1', amount: 300, payment_status: 'Đã nhận', payment_date: '2026-07-04', active: true },
      { id: 'p2', order_id: 'o2', amount: 500, payment_status: 'Đã nhận', payment_date: '2026-07-06', active: true },
      { id: 'p3', order_id: 'o4', amount: 100, payment_status: 'Đã nhận', payment_date: '2026-07-11', active: true },
      { id: 'p4', order_id: 'o5', amount: 100, payment_status: 'Đã nhận', payment_date: '2026-06-16', active: true },
    ],
    items: [
      { id: 'i1', order_id: 'o1', product_id: 'p1', quantity: 1, line_total: 1000, line_profit: 100, active: true },
      { id: 'i2', order_id: 'o2', product_id: 'p1', quantity: 1, line_total: 500, line_profit: 50, active: true },
      { id: 'i3', order_id: 'o3', product_id: 'p1', quantity: 1, line_total: 2000, line_profit: 200, active: true },
      { id: 'i4', order_id: 'o4', product_id: 'p1', quantity: 1, line_total: 9000, line_profit: 900, active: true },
      { id: 'i5', order_id: 'o5', product_id: 'p1', quantity: 1, line_total: 100, line_profit: 10, active: true },
    ],
    shipments: [],
    printOrders: [],
    printItems: [],
    computePaymentStatus: paymentStatus,
    isActive: active,
    toNumber: number,
  })
}

test('business dashboard splits revenue by classification and excludes cancelled orders', () => {
  const month = buildFixture().periods.month

  assert.deepEqual(DASHBOARD_ORDER_CLASSIFICATIONS.map(row => row.label), ['Số mới', 'Chăm sóc', 'Đại lý'])
  assert.equal(month.stats.orders, 3)
  assert.equal(month.stats.revenue, 3500)
  assert.equal(month.stats.newRevenue, 1000)
  assert.equal(month.stats.careRevenue, 500)
  assert.equal(month.stats.agencyRevenue, 2000)
  assert.equal(month.stats.unclassifiedRevenue, 0)
  assert.equal(month.stats.profit, 350)
  assert.equal(month.stats.debt, 2700)
})

test('business dashboard separates collected-on-orders from cash received in period', () => {
  const month = buildFixture().periods.month

  assert.equal(month.stats.orderPaid, 800)
  assert.equal(month.stats.paid, 900)
  assert.equal(month.stats.cashReceived, 900)
  assert.equal(month.stats.collectionRate, 22.9)

  const saleA = month.salesKpis.find(row => row.key === 'sale-a@kingcup.vn')
  const saleB = month.salesKpis.find(row => row.key === 'sale-b@kingcup.vn')
  assert.equal(saleA.orderPaid, 800)
  assert.equal(saleA.cashReceived, 800)
  assert.equal(saleB.orderPaid, 0)
  assert.equal(saleB.cashReceived, 100)
})

test('sales KPI keeps every historical order owner and deduplicates email casing', () => {
  const month = buildFixture().periods.month

  assert.equal(month.salesKpis.length, 3)
  assert.equal(month.salesKpis.filter(row => row.key === 'sale-a@kingcup.vn').length, 1)

  const saleA = month.salesKpis.find(row => row.key === 'sale-a@kingcup.vn')
  const saleC = month.salesKpis.find(row => row.key === 'sale-c@kingcup.vn')
  assert.equal(saleA.orders, 2)
  assert.equal(saleA.newRevenue, 1000)
  assert.equal(saleA.careRevenue, 500)
  assert.equal(saleC.orders, 0)
  assert.equal(saleC.revenue, 0)
})
