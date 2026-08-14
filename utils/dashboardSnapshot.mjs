export const DASHBOARD_RECENT_LIMIT = 8
export const DASHBOARD_ALERT_LIMIT = 12

export const DASHBOARD_SOURCE_COLLECTIONS = [
  'orders',
  'order_items',
  'payments',
  'order_export_requests',
  'customers',
  'products',
  'shipments',
  'print_orders',
  'print_order_items',
]

export const DASHBOARD_PERIODS = [
  { key: 'today', label: 'Hôm nay' },
  { key: '7d', label: '7 ngày' },
  { key: 'month', label: 'Tháng này' },
  { key: 'quarter', label: 'Quý này' },
  { key: 'year', label: 'Năm nay' },
  { key: 'all', label: 'Tất cả' },
]

export const DASHBOARD_ORDER_CLASSIFICATIONS = [
  { key: 'new', label: 'Số mới' },
  { key: 'care', label: 'Chăm sóc' },
  { key: 'agency', label: 'Đại lý' },
]

const DAY_MS = 24 * 60 * 60 * 1000
const COMPLETED_ORDER_STATUSES = new Set(['da hoan thanh', 'hoan thanh'])
const CANCELLED_ORDER_STATUSES = new Set(['da huy', 'huy'])
const RECEIVED_PAYMENT_STATUS = 'Đã nhận'
const DESIGN_FILE_TYPES = ['AI', 'PDF', 'Demo', 'Mockup']
const CLASSIFICATION_KEYS = ['new', 'care', 'agency', 'unclassified']

export function dashboardTimestampValue(value) {
  if (!value) return 0
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
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

function normalizedText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim()
    .toLowerCase()
}

function startOfDay(value) {
  const timestamp = dashboardTimestampValue(value)
  const date = timestamp ? new Date(timestamp) : new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function startOfPeriod(periodKey, nowValue) {
  const timestamp = dashboardTimestampValue(nowValue) || Date.now()
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  if (periodKey === 'today') return date.getTime()
  if (periodKey === '7d') {
    date.setDate(date.getDate() - 6)
    return date.getTime()
  }
  if (periodKey === 'month') {
    date.setDate(1)
    return date.getTime()
  }
  if (periodKey === 'quarter') {
    date.setMonth(Math.floor(date.getMonth() / 3) * 3, 1)
    return date.getTime()
  }
  if (periodKey === 'year') {
    date.setMonth(0, 1)
    return date.getTime()
  }
  return 0
}

function rowDateValue(row, fields) {
  for (const field of fields) {
    const timestamp = dashboardTimestampValue(row?.[field])
    if (timestamp) return timestamp
  }
  return 0
}

function inPeriod(timestamp, startTimestamp, endTimestamp) {
  if (!timestamp) return false
  return timestamp >= startTimestamp && timestamp <= endTimestamp
}

function percentage(part, total) {
  if (!total) return 0
  return Math.round((part / total) * 1000) / 10
}

function uniqueCount(values) {
  return new Set(values.map(value => String(value || '').trim()).filter(Boolean)).size
}

function orderCustomerKey(order) {
  return String(order.customer_id || order.phone || order.customer_name || '').trim()
}

function orderSaleKey(order) {
  return String(order.sale_email || order.owner_email || order.created_by || order.sale_name || 'Chưa phân công')
    .trim()
    .toLowerCase()
}

function orderSaleName(order) {
  return String(order.sale_name || order.sale_email || order.owner_email || order.created_by || 'Chưa phân công').trim()
}

function orderClassificationKey(order) {
  const value = normalizedText(order?.order_classification)
  if (value === 'so moi') return 'new'
  if (value === 'cham soc') return 'care'
  if (value === 'dai ly') return 'agency'
  return 'unclassified'
}

function orderRevenue(order, toNumber) {
  return toNumber(order.actual_revenue || order.payable_amount || order.total_vat)
}

function isCompletedOrder(order) {
  return COMPLETED_ORDER_STATUSES.has(normalizedText(order.order_status))
}

function isCancelledOrder(order) {
  return CANCELLED_ORDER_STATUSES.has(normalizedText(order.order_status))
}

function emptyBusinessMetrics() {
  return {
    orders: 0,
    revenue: 0,
    orderPaid: 0,
    paid: 0,
    cashReceived: 0,
    debt: 0,
    profit: 0,
    collectionRate: 0,
  }
}

function classificationBuckets() {
  return Object.fromEntries(CLASSIFICATION_KEYS.map(key => [key, emptyBusinessMetrics()]))
}

function addOrderToBusinessMetrics(bucket, order, profit, toNumber) {
  bucket.orders += 1
  bucket.revenue += orderRevenue(order, toNumber)
  bucket.orderPaid += toNumber(order.paid_amount)
  bucket.paid = bucket.orderPaid
  bucket.debt += toNumber(order.debt_amount)
  bucket.profit += toNumber(profit)
}

function finalizeBusinessMetrics(bucket) {
  bucket.collectionRate = percentage(bucket.orderPaid, bucket.revenue)
  return bucket
}

function isPrintItemCompleted(item) {
  if (item?.is_completed === true) return true
  const value = normalizedText(item?.is_completed)
  return ['true', '1', 'yes', 'da hoan thanh', 'hoan thanh'].includes(value)
}

function hasLogoData(item) {
  if (String(item?.logo || '').trim()) return true
  const raw = item?.logo_json
  if (Array.isArray(raw)) return raw.length > 0
  if (raw && typeof raw === 'object') return Object.keys(raw).length > 0
  const text = String(raw || '').trim()
  return Boolean(text && text !== '[]' && text !== '{}')
}

function addDesignValue(bucket, type, value) {
  if (!value) return
  if (Array.isArray(value)) {
    value.forEach(item => addDesignValue(bucket, type, item))
    return
  }
  if (typeof value === 'object') {
    const url = value.url || value.path || value.href || value.file_url
    const inferredType = value.type || value.file_type || type
    if (url) addDesignValue(bucket, inferredType, url)
    return
  }
  if (String(value).trim()) bucket.add(type)
}

function designFileTypes(order, orderItems) {
  const found = new Set()
  const sources = [order, ...orderItems]
  sources.forEach(source => {
    addDesignValue(found, 'AI', source?.design_ai_url || source?.ai_file_url || source?.ai_url)
    addDesignValue(found, 'PDF', source?.design_pdf_url || source?.pdf_file_url || source?.pdf_url)
    addDesignValue(found, 'Demo', source?.design_demo_url || source?.demo_url || source?.preview_url)
    addDesignValue(found, 'Mockup', source?.design_mockup_url || source?.mockup_url)
    addDesignValue(found, 'AI', source?.design_file_url || source?.artwork_url)
    if (Array.isArray(source?.design_files)) {
      source.design_files.forEach(file => {
        const type = String(file?.type || file?.file_type || '').trim()
        const normalized = normalizedText(type)
        const resolved = normalized.includes('mockup')
          ? 'Mockup'
          : normalized.includes('demo') || normalized.includes('preview')
            ? 'Demo'
            : normalized.includes('pdf')
              ? 'PDF'
              : 'AI'
        addDesignValue(found, resolved, file)
      })
    }
  })
  return DESIGN_FILE_TYPES.filter(type => found.has(type))
}

function productionStageForOrder(order, context) {
  const operation = normalizedText(`${order.operation_status || ''} ${order.order_status || ''}`)
  if (operation.includes('thiet ke')) return 'design'
  if (operation.includes('film')) return 'film'
  if (operation.includes('qc') || operation.includes('kiem chat') || operation.includes('kiem tra')) return 'qc'
  if (operation.includes('dong goi')) return 'packing'
  if (operation.includes('giao hang') || operation.includes('dang giao')) return 'delivery'

  const shipmentStatuses = context.shipments.map(row => normalizedText(row.shipping_status))
  if (context.shipments.length && !shipmentStatuses.every(status => status.includes('huy'))) return 'delivery'

  const requestStatuses = context.requests.map(row => normalizedText(row.status || row.lifecycle_status))
  if (requestStatuses.some(status => ['da xuat', 'completed', 'released'].includes(status))) return 'delivery'

  if (context.printItems.length) {
    return context.printItems.every(isPrintItemCompleted) ? 'qc' : 'printing'
  }
  if (requestStatuses.length) return 'packing'
  if (operation.includes('in an') || operation.includes('dang in') || operation.includes('san xuat')) return 'printing'
  if (operation.includes('cho xuat kho')) return 'packing'
  if (operation.includes('da coc')) return 'design'
  return null
}

function pipelineStageForOrder(order, context) {
  if (isCancelledOrder(order)) return 'cancelled'
  const fullyPaid = normalizedText(order.payment_status).includes('da thanh toan') || Number(order.debt_amount || 0) <= 0
  if (isCompletedOrder(order) && fullyPaid) return 'completed'
  if ((isCompletedOrder(order) || context.shipments.length) && Number(order.debt_amount || 0) > 0) return 'collection'
  if (productionStageForOrder(order, context) === 'delivery') return 'delivery'
  if (productionStageForOrder(order, context)) return 'production'
  return 'quotation'
}

function makeMonthBuckets(nowValue) {
  const nowTimestamp = dashboardTimestampValue(nowValue) || Date.now()
  const now = new Date(nowTimestamp)
  const buckets = []
  for (let offset = 5; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    buckets.push({ key, label: `T${date.getMonth() + 1}/${date.getFullYear()}`, revenue: 0, paid: 0, profit: 0 })
  }
  return buckets
}

function monthKey(value) {
  const timestamp = dashboardTimestampValue(value)
  if (!timestamp) return ''
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function stageContextForOrder(order, maps) {
  const orderId = String(order.id || '').trim()
  const orderCode = String(order.order_code || '').trim()
  const printOrders = [
    ...(maps.printOrdersByOrderId.get(orderId) || []),
    ...(maps.printOrdersByOrderCode.get(orderCode) || []),
  ]
  const printOrderIds = new Set(printOrders.map(row => String(row.id || '').trim()).filter(Boolean))
  const printItems = Array.from(printOrderIds).flatMap(id => maps.printItemsByPrintOrderId.get(id) || [])
  return {
    items: maps.itemsByOrderId.get(orderId) || [],
    requests: maps.requestsByOrderId.get(orderId) || [],
    shipments: maps.shipmentsByOrderId.get(orderId) || [],
    printOrders,
    printItems,
  }
}

function buildPeriodView({
  periodKey,
  customRange,
  nowValue,
  orders,
  receivedPayments,
  validItems,
  firstOrderByCustomer,
  productById,
  productByCode,
  toNumber,
}) {
  const isCustomRange = periodKey === 'custom'
  const start = isCustomRange
    ? dashboardTimestampValue(customRange?.from)
    : startOfPeriod(periodKey, nowValue)
  const end = isCustomRange
    ? dashboardTimestampValue(customRange?.to)
    : (dashboardTimestampValue(nowValue) || Date.now())
  const matchesPeriod = timestamp => {
    if (!timestamp) return false
    if (!start && !end) return true
    return (!start || timestamp >= start) && (!end || timestamp <= end)
  }
  const periodOrders = periodKey === 'all'
    ? orders
    : orders.filter(order => matchesPeriod(rowDateValue(order, ['order_date', 'created_at'])))
  const businessOrders = periodOrders.filter(order => !isCancelledOrder(order))
  const businessOrderIds = new Set(businessOrders.map(order => String(order.id || '').trim()).filter(Boolean))
  const periodItems = validItems.filter(item => businessOrderIds.has(String(item.order_id || '').trim()))
  const periodPayments = periodKey === 'all'
    ? receivedPayments
    : receivedPayments.filter(payment => matchesPeriod(rowDateValue(payment, ['payment_date', 'created_at'])))

  const profitByOrder = new Map()
  periodItems.forEach(item => {
    const orderId = String(item.order_id || '').trim()
    profitByOrder.set(orderId, (profitByOrder.get(orderId) || 0) + toNumber(item.line_profit))
  })

  const wonOrders = periodOrders.filter(order => {
    const status = normalizedText(order.order_status)
    return !isCancelledOrder(order) && !['moi tao', 'da bao gia'].includes(status)
  })
  const opportunityOrders = periodOrders
  const firstOrderIds = new Set(
    businessOrders
      .filter(order => firstOrderByCustomer.get(orderCustomerKey(order))?.id === order.id)
      .map(order => order.id),
  )

  const salesMap = new Map()
  orders.forEach(order => {
    const key = orderSaleKey(order)
    if (!salesMap.has(key)) {
      salesMap.set(key, {
        key,
        name: orderSaleName(order),
        email: String(order.sale_email || order.owner_email || order.created_by || '').trim(),
        orders: 0,
        opportunities: 0,
        wonOrders: 0,
        newCustomerKeys: new Set(),
        revenue: 0,
        orderPaid: 0,
        paid: 0,
        cashReceived: 0,
        debt: 0,
        profit: 0,
        classifications: classificationBuckets(),
      })
    } else {
      const row = salesMap.get(key)
      if ((!row.name || row.name === row.email || row.name === key) && order.sale_name) row.name = String(order.sale_name).trim()
      if (!row.email) row.email = String(order.sale_email || order.owner_email || order.created_by || '').trim()
    }
  })

  periodOrders.forEach(order => {
    const row = salesMap.get(orderSaleKey(order))
    if (!row) return
    row.opportunities += 1
    if (!isCancelledOrder(order) && !['moi tao', 'da bao gia'].includes(normalizedText(order.order_status))) row.wonOrders += 1
  })

  businessOrders.forEach(order => {
    const row = salesMap.get(orderSaleKey(order))
    if (!row) return
    const orderId = String(order.id || '').trim()
    const profit = profitByOrder.get(orderId) || 0
    addOrderToBusinessMetrics(row, order, profit, toNumber)
    const classification = orderClassificationKey(order)
    addOrderToBusinessMetrics(row.classifications[classification], order, profit, toNumber)
    const customerKey = orderCustomerKey(order)
    if (customerKey && firstOrderIds.has(order.id)) row.newCustomerKeys.add(customerKey)
  })

  const orderById = new Map(orders.map(order => [String(order.id || '').trim(), order]))
  periodPayments.forEach(payment => {
    const amount = toNumber(payment.amount)
    const order = orderById.get(String(payment.order_id || '').trim())
    if (!order) return
    const row = salesMap.get(orderSaleKey(order))
    if (!row) return
    row.cashReceived += amount
    row.classifications[orderClassificationKey(order)].cashReceived += amount
  })

  const classifications = classificationBuckets()
  businessOrders.forEach(order => {
    const orderId = String(order.id || '').trim()
    addOrderToBusinessMetrics(
      classifications[orderClassificationKey(order)],
      order,
      profitByOrder.get(orderId) || 0,
      toNumber,
    )
  })
  periodPayments.forEach(payment => {
    const order = orderById.get(String(payment.order_id || '').trim())
    if (!order) return
    classifications[orderClassificationKey(order)].cashReceived += toNumber(payment.amount)
  })
  Object.values(classifications).forEach(finalizeBusinessMetrics)

  const productProfitMap = new Map()
  periodItems.forEach(item => {
    const product = productById.get(String(item.product_id || '').trim())
      || productByCode.get(String(item.product_code || '').trim())
      || {}
    const group = String(product.category || item.product_category || item.category || item.product_name || 'Khác').trim()
    if (!productProfitMap.has(group)) productProfitMap.set(group, { name: group, revenue: 0, profit: 0, quantity: 0 })
    const row = productProfitMap.get(group)
    row.revenue += toNumber(item.line_total) || toNumber(item.quantity) * toNumber(item.unit_price)
    row.profit += toNumber(item.line_profit)
    row.quantity += toNumber(item.quantity)
  })

  const revenue = businessOrders.reduce((sum, order) => sum + orderRevenue(order, toNumber), 0)
  const orderPaid = businessOrders.reduce((sum, order) => sum + toNumber(order.paid_amount), 0)
  const debt = businessOrders.reduce((sum, order) => sum + toNumber(order.debt_amount), 0)
  const profit = periodItems.reduce((sum, item) => sum + toNumber(item.line_profit), 0)
  const cashReceived = periodPayments.reduce((sum, payment) => sum + toNumber(payment.amount), 0)

  return {
    key: periodKey,
    stats: {
      orders: businessOrders.length,
      customers: uniqueCount(businessOrders.map(orderCustomerKey)),
      products: uniqueCount(periodItems.map(item => item.product_id || item.product_code || item.product_name)),
      newCustomers: firstOrderIds.size,
      revenue,
      newRevenue: classifications.new.revenue,
      careRevenue: classifications.care.revenue,
      agencyRevenue: classifications.agency.revenue,
      unclassifiedRevenue: classifications.unclassified.revenue,
      orderPaid,
      paid: cashReceived,
      cashReceived,
      debt,
      profit,
      collectionRate: percentage(orderPaid, revenue),
      conversionRate: percentage(wonOrders.length, opportunityOrders.length),
      marginRate: percentage(profit, revenue),
      classifications,
    },
    salesKpis: Array.from(salesMap.values())
      .map(row => {
        Object.values(row.classifications).forEach(finalizeBusinessMetrics)
        row.paid = row.orderPaid
        return {
          ...row,
          newCustomers: row.newCustomerKeys.size,
          newRevenue: row.classifications.new.revenue,
          careRevenue: row.classifications.care.revenue,
          agencyRevenue: row.classifications.agency.revenue,
          unclassifiedRevenue: row.classifications.unclassified.revenue,
          collectionRate: percentage(row.orderPaid, row.revenue),
          conversionRate: percentage(row.wonOrders, row.opportunities),
          marginRate: percentage(row.profit, row.revenue),
          newCustomerKeys: undefined,
          wonOrders: undefined,
          opportunities: undefined,
        }
      })
      .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || a.name.localeCompare(b.name, 'vi')),
    productProfit: Array.from(productProfitMap.values())
      .map(row => ({ ...row, marginRate: percentage(row.profit, row.revenue) }))
      .sort((a, b) => b.profit - a.profit || b.revenue - a.revenue)
      .slice(0, 8),
  }
}

export function buildDashboardSnapshot({
  orders = [],
  customers = [],
  products = [],
  requests = [],
  payments = [],
  items = [],
  shipments = [],
  printOrders = [],
  printItems = [],
  computePaymentStatus,
  isActive,
  toNumber,
  now = new Date(),
  customRange = null,
}) {
  if (typeof computePaymentStatus !== 'function') throw new Error('computePaymentStatus is required.')
  if (typeof isActive !== 'function') throw new Error('isActive is required.')
  if (typeof toNumber !== 'function') throw new Error('toNumber is required.')

  const activeOrders = orders.filter(isActive)
  const activePayments = payments.filter(isActive)
  const activeRequests = requests.filter(isActive)
  const activeShipments = shipments.filter(isActive)
  const activePrintOrders = printOrders.filter(isActive)
  const activePrintItems = printItems.filter(isActive)
  const receivedPayments = activePayments.filter(payment => String(payment.payment_status || '').trim() === RECEIVED_PAYMENT_STATUS)

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

  const maps = {
    itemsByOrderId: new Map(),
    requestsByOrderId: new Map(),
    shipmentsByOrderId: new Map(),
    printOrdersByOrderId: new Map(),
    printOrdersByOrderCode: new Map(),
    printItemsByPrintOrderId: new Map(),
  }
  const append = (map, key, row) => {
    const cleanKey = String(key || '').trim()
    if (!cleanKey) return
    if (!map.has(cleanKey)) map.set(cleanKey, [])
    map.get(cleanKey).push(row)
  }
  validItems.forEach(row => append(maps.itemsByOrderId, row.order_id, row))
  activeRequests.forEach(row => append(maps.requestsByOrderId, row.order_id, row))
  activeShipments.forEach(row => append(maps.shipmentsByOrderId, row.order_id, row))
  activePrintOrders.forEach(row => {
    append(maps.printOrdersByOrderId, row.order_id, row)
    append(maps.printOrdersByOrderCode, row.order_code, row)
  })
  activePrintItems.forEach(row => append(maps.printItemsByPrintOrderId, row.print_order_id, row))

  const productById = new Map()
  const productByCode = new Map()
  products.filter(isActive).forEach(product => {
    if (product.id) productById.set(String(product.id), product)
    if (product.product_code) productByCode.set(String(product.product_code), product)
  })

  const firstOrderByCustomer = new Map()
  ;[...ordersWithPayment]
    .filter(order => !isCancelledOrder(order))
    .sort((a, b) => rowDateValue(a, ['order_date', 'created_at']) - rowDateValue(b, ['order_date', 'created_at']))
    .forEach(order => {
      const key = orderCustomerKey(order)
      if (key && !firstOrderByCustomer.has(key)) firstOrderByCustomer.set(key, order)
    })

  const periodEntries = Object.fromEntries(DASHBOARD_PERIODS.map(period => [
    period.key,
    buildPeriodView({
      periodKey: period.key,
      customRange,
      nowValue: now,
      orders: ordersWithPayment,
      receivedPayments,
      validItems,
      firstOrderByCustomer,
      productById,
      productByCode,
      toNumber,
    }),
  ]))
  if (customRange?.from || customRange?.to) {
    periodEntries.custom = buildPeriodView({
      periodKey: 'custom',
      customRange,
      nowValue: now,
      orders: ordersWithPayment,
      receivedPayments,
      validItems,
      firstOrderByCustomer,
      productById,
      productByCode,
      toNumber,
    })
  }

  const contexts = new Map(ordersWithPayment.map(order => [order.id, stageContextForOrder(order, maps)]))
  const pipelineDefinitions = [
    { key: 'quotation', label: 'Báo giá' },
    { key: 'production', label: 'Sản xuất' },
    { key: 'delivery', label: 'Giao hàng' },
    { key: 'collection', label: 'Thu tiền' },
    { key: 'completed', label: 'Hoàn tất' },
  ]
  const pipeline = pipelineDefinitions.map(definition => {
    const matched = ordersWithPayment.filter(order => pipelineStageForOrder(order, contexts.get(order.id)) === definition.key)
    return {
      ...definition,
      count: matched.length,
      amount: matched.reduce((sum, order) => sum + orderRevenue(order, toNumber), 0),
    }
  })

  const productionDefinitions = [
    { key: 'design', label: 'Thiết kế' },
    { key: 'film', label: 'Film' },
    { key: 'printing', label: 'In' },
    { key: 'qc', label: 'QC' },
    { key: 'packing', label: 'Đóng gói' },
    { key: 'delivery', label: 'Giao hàng' },
  ]
  const currentProductionRows = ordersWithPayment
    .filter(order => !isCancelledOrder(order) && !isCompletedOrder(order))
    .map(order => ({ order, context: contexts.get(order.id), stage: productionStageForOrder(order, contexts.get(order.id)) }))
    .filter(row => row.stage)
  const productionStages = productionDefinitions.map(definition => ({
    ...definition,
    count: currentProductionRows.filter(row => row.stage === definition.key).length,
  }))

  const nowStart = startOfDay(now)
  const alerts = []
  const designRows = []
  const orderWatchlist = []
  ordersWithPayment.forEach(order => {
    if (isCancelledOrder(order)) return
    const context = contexts.get(order.id)
    const stage = productionStageForOrder(order, context)
    const dueTimestamp = dashboardTimestampValue(order.expected_delivery_date)
    const daysToDue = dueTimestamp ? Math.ceil((startOfDay(dueTimestamp) - nowStart) / DAY_MS) : null
    const revenue = orderRevenue(order, toNumber)
    const debt = toNumber(order.debt_amount)
    const designTypes = designFileTypes(order, context.items)
    const requiresDesign = context.items.some(hasLogoData) || stage === 'design' || normalizedText(order.operation_status).includes('thiet ke')
    if (requiresDesign) {
      const missingTypes = DESIGN_FILE_TYPES.filter(type => !designTypes.includes(type))
      designRows.push({
        id: order.id,
        orderCode: order.order_code,
        customerName: order.customer_name || '-',
        fileTypes: designTypes,
        missingTypes,
        updatedAt: order.updated_at || order.created_at || order.order_date,
      })
      if (missingTypes.length && ['design', 'film', 'printing'].includes(stage)) {
        alerts.push({
          id: `design:${order.id}`,
          level: 'warning',
          type: 'design',
          title: `${order.order_code}: thiếu hồ sơ thiết kế`,
          description: `Chưa có ${missingTypes.join(', ')}.`,
          orderCode: order.order_code,
          href: '/orders',
          sortDate: dueTimestamp || rowDateValue(order, ['order_date', 'created_at']),
        })
      }
    }

    let alertLevel = 'normal'
    if (dueTimestamp && !isCompletedOrder(order) && daysToDue < 0) {
      alertLevel = 'critical'
      alerts.push({
        id: `delivery-overdue:${order.id}`,
        level: 'critical',
        type: 'delivery',
        title: `${order.order_code}: quá hạn giao ${Math.abs(daysToDue)} ngày`,
        description: `${order.customer_name || 'Khách hàng'} · Hạn ${order.expected_delivery_date}`,
        orderCode: order.order_code,
        href: '/orders',
        sortDate: dueTimestamp,
      })
    } else if (dueTimestamp && !isCompletedOrder(order) && daysToDue <= 3) {
      alertLevel = 'warning'
      alerts.push({
        id: `delivery-soon:${order.id}`,
        level: 'warning',
        type: 'delivery',
        title: `${order.order_code}: sắp đến hạn giao`,
        description: daysToDue === 0 ? 'Hạn giao hôm nay.' : `Còn ${daysToDue} ngày.`,
        orderCode: order.order_code,
        href: '/orders',
        sortDate: dueTimestamp,
      })
    }
    if (debt > 0 && (isCompletedOrder(order) || stage === 'delivery')) {
      if (alertLevel === 'normal') alertLevel = 'warning'
      alerts.push({
        id: `debt:${order.id}`,
        level: debt >= revenue * 0.5 ? 'critical' : 'warning',
        type: 'debt',
        title: `${order.order_code}: còn công nợ`,
        description: `${debt} / ${revenue}`,
        orderCode: order.order_code,
        href: '/payments',
        sortDate: dueTimestamp || rowDateValue(order, ['order_date', 'created_at']),
      })
    }
    if (!isCompletedOrder(order)) {
      orderWatchlist.push({
        ...order,
        production_stage: stage || 'quotation',
        days_to_due: daysToDue,
        alert_level: alertLevel,
      })
    }
  })

  activePrintItems.forEach(item => {
    if (isPrintItemCompleted(item)) return
    const dueTimestamp = dashboardTimestampValue(item.expected_done_at)
    if (!dueTimestamp || startOfDay(dueTimestamp) >= nowStart) return
    const printOrder = activePrintOrders.find(row => row.id === item.print_order_id)
    alerts.push({
      id: `printing:${item.id}`,
      level: 'critical',
      type: 'printing',
      title: `${printOrder?.order_code || item.product_name || 'Lệnh in'}: quá hạn in`,
      description: `${item.product_name || 'Sản phẩm'} · Hạn ${item.expected_done_at}`,
      orderCode: printOrder?.order_code || '',
      href: '/printing',
      sortDate: dueTimestamp,
    })
  })

  const severity = { critical: 3, warning: 2, info: 1 }
  alerts.sort((a, b) => (severity[b.level] || 0) - (severity[a.level] || 0) || (a.sortDate || 0) - (b.sortDate || 0))
  orderWatchlist.sort((a, b) => {
    const rank = { critical: 0, warning: 1, normal: 2 }
    return (rank[a.alert_level] ?? 3) - (rank[b.alert_level] ?? 3)
      || (a.days_to_due ?? 99999) - (b.days_to_due ?? 99999)
      || rowDateValue(b, ['created_at', 'order_date']) - rowDateValue(a, ['created_at', 'order_date'])
  })

  const revenueTrend = makeMonthBuckets(now)
  const trendMap = new Map(revenueTrend.map(row => [row.key, row]))
  ordersWithPayment.filter(order => !isCancelledOrder(order)).forEach(order => {
    const bucket = trendMap.get(monthKey(order.order_date || order.created_at))
    if (bucket) bucket.revenue += orderRevenue(order, toNumber)
  })
  receivedPayments.forEach(payment => {
    const bucket = trendMap.get(monthKey(payment.payment_date || payment.created_at))
    if (bucket) bucket.paid += toNumber(payment.amount)
  })
  validItems.forEach(item => {
    const order = ordersWithPayment.find(row => row.id === item.order_id)
    if (!order || isCancelledOrder(order)) return
    const bucket = trendMap.get(monthKey(order.order_date || order.created_at))
    if (bucket) bucket.profit += toNumber(item.line_profit)
  })

  const allStats = periodEntries.all.stats
  return {
    stats: {
      ...allStats,
      customers: customers.filter(isActive).length,
      products: products.filter(isActive).length,
      exportRequests: activeRequests.length,
      overdueOrders: orderWatchlist.filter(row => row.days_to_due != null && row.days_to_due < 0).length,
      dueSoonOrders: orderWatchlist.filter(row => row.days_to_due != null && row.days_to_due >= 0 && row.days_to_due <= 3).length,
      inProduction: pipeline.find(row => row.key === 'production')?.count || 0,
      waitingCollection: pipeline.find(row => row.key === 'collection')?.count || 0,
    },
    periods: periodEntries,
    pipeline,
    productionStages,
    revenueTrend,
    alerts: alerts.slice(0, DASHBOARD_ALERT_LIMIT),
    orderWatchlist: orderWatchlist.slice(0, DASHBOARD_RECENT_LIMIT),
    designSummary: {
      requiredOrders: designRows.length,
      completeOrders: designRows.filter(row => row.missingTypes.length === 0).length,
      missingOrders: designRows.filter(row => row.missingTypes.length > 0).length,
      rows: designRows
        .sort((a, b) => dashboardTimestampValue(b.updatedAt) - dashboardTimestampValue(a.updatedAt))
        .slice(0, DASHBOARD_RECENT_LIMIT),
    },
    recentOrders: [...ordersWithPayment]
      .sort((a, b) => dashboardTimestampValue(b.created_at || b.order_date) - dashboardTimestampValue(a.created_at || a.order_date))
      .slice(0, DASHBOARD_RECENT_LIMIT),
    recentPayments: [...activePayments]
      .sort((a, b) => dashboardTimestampValue(b.payment_date || b.created_at) - dashboardTimestampValue(a.payment_date || a.created_at))
      .slice(0, DASHBOARD_RECENT_LIMIT),
  }
}
