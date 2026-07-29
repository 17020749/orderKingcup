export const DASHBOARD_RECENT_LIMIT = 8

export const DASHBOARD_SOURCE_COLLECTIONS = [
  'orders',
  'order_items',
  'payments',
  'order_export_requests',
  'customers',
  'products',
]

export function dashboardTimestampValue(value) {
  if (!value) return 0
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0
  }
  if (typeof value?.seconds === 'number') return value.seconds * 1000
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 0 : value.getTime()
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

export function buildDashboardSnapshot({
  orders = [],
  customers = [],
  products = [],
  requests = [],
  payments = [],
  items = [],
  computePaymentStatus,
  isActive,
  toNumber,
}) {
  if (typeof computePaymentStatus !== 'function') throw new Error('computePaymentStatus is required.')
  if (typeof isActive !== 'function') throw new Error('isActive is required.')
  if (typeof toNumber !== 'function') throw new Error('toNumber is required.')

  const activeOrders = orders.filter(isActive)
  const activePayments = payments.filter(isActive)
  const receivedPayments = activePayments.filter(payment =>
    String(payment.payment_status || '').trim() === 'Đã nhận'
  )
  const paymentMap = activePayments.reduce((map, payment) => {
    const orderId = String(payment.order_id || '').trim()
    if (!orderId) return map
    if (!map[orderId]) map[orderId] = []
    map[orderId].push(payment)
    return map
  }, {})
  const ordersWithPayment = activeOrders.map(order => ({
    ...order,
    ...computePaymentStatus(order, paymentMap[order.id] || []),
  }))
  const activeOrderIds = new Set(ordersWithPayment.map(order => order.id).filter(Boolean))
  const validItems = items.filter(item => isActive(item) && activeOrderIds.has(item.order_id))

  return {
    stats: {
      orders: ordersWithPayment.length,
      customers: customers.filter(isActive).length,
      products: products.filter(isActive).length,
      revenue: ordersWithPayment.reduce((sum, order) => sum + toNumber(order.actual_revenue || order.total_vat), 0),
      paid: receivedPayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0),
      debt: ordersWithPayment.reduce((sum, order) => sum + toNumber(order.debt_amount), 0),
      profit: validItems.reduce((sum, item) => sum + toNumber(item.line_profit), 0),
      exportRequests: requests.filter(isActive).length,
    },
    recentOrders: [...ordersWithPayment]
      .sort((a, b) => dashboardTimestampValue(b.created_at || b.order_date) - dashboardTimestampValue(a.created_at || a.order_date))
      .slice(0, DASHBOARD_RECENT_LIMIT),
    recentPayments: [...activePayments]
      .sort((a, b) => dashboardTimestampValue(b.payment_date || b.created_at) - dashboardTimestampValue(a.payment_date || a.created_at))
      .slice(0, DASHBOARD_RECENT_LIMIT),
  }
}
