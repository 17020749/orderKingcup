import fs from 'node:fs'

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 match, found ${count}`)
  }
  return source.replace(before, after)
}

const ordersPath = 'pages/orders.vue'
let orders = fs.readFileSync(ordersPath, 'utf8')

orders = replaceOnce(
  orders,
  "import { collection, doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore'",
  "import { collection, doc, getDoc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'",
  'orders firebase import',
)

orders = replaceOnce(
  orders,
`  saving.value = true
  let commitSucceeded = false
  await withLoading(async () => {
    await saveFulfilledOrderMetadata({
      orderId: currentOrder.id,
      expectedRevision: toNumber(currentOrder.revision),
      orderDate: form.order_date,
      orderStatus: form.order_status,
    })`,
`  saving.value = true
  let commitSucceeded = false
  await withLoading(async () => {
    const { order: persistedOrder, items: persistedItems } = await loadPersistedOrder(currentOrder.id)
    const latestRequests = await loadScopedExportRequests([persistedOrder], true)
    const latestSummary = orderSummary(
      buildFulfillmentRows(persistedItems, latestRequests),
      latestRequests,
    )

    if (!isFulfilledOrder(latestSummary)) {
      await synchronizePersistedOrder(currentOrder.id).catch(() => null)
      throw new Error('Đơn hàng hiện chưa xuất đủ. Dữ liệu đã được làm mới, vui lòng kiểm tra lại.')
    }

    if (!isFulfilledOrder(persistedOrder)) {
      if (!hasPermission('orders.warehouse_export')) {
        throw new Error('Đơn đã xuất đủ nhưng trạng thái tổng hợp chưa đồng bộ. Vui lòng nhờ người có quyền xuất kho mở và lưu lại đơn.')
      }
      await updateDoc(doc(db, 'orders', currentOrder.id), {
        warehouse_fulfillment_status: latestSummary.warehouse_fulfillment_status,
        warehouse_request_status: latestSummary.warehouse_request_status,
        updated_at: serverTimestamp(),
      })
    }

    await saveFulfilledOrderMetadata({
      orderId: currentOrder.id,
      expectedRevision: toNumber(persistedOrder.revision),
      orderDate: form.order_date,
      orderStatus: form.order_status,
    })`,
  'fulfilled metadata preflight',
)

fs.writeFileSync(ordersPath, orders)

const warehousePath = 'pages/warehouse-export-requests.vue'
let warehouse = fs.readFileSync(warehousePath, 'utf8')

warehouse = replaceOnce(
  warehouse,
`const {
  loadProducts,
  loadWarehouses,
  listenWarehouseExportRequests,
} = useScopedQueries()
const { requestLineProgress } = useWarehouseLogic()`,
`const {
  loadPersistedOrder,
  loadProducts,
  loadScopedExportRequests,
  loadWarehouses,
  listenWarehouseExportRequests,
} = useScopedQueries()
const { buildFulfillmentRows, orderSummary, requestLineProgress } = useWarehouseLogic()`,
  'warehouse scoped queries',
)

warehouse = replaceOnce(
  warehouse,
`async function updateRequestStatus(row: any, nextStatus: string, action: string, title: string, note = '', extra: Record<string, any> = {}, notification?: { type: string; title: string; message: string }, extendBatch?: (batch: any) => void) {
  const orderPatch = fallbackOrderPatch(nextStatus)`,
`async function deriveOrderSummaryPatch(row: any, nextStatus: string) {
  const orderId = String(row?.order_id || '').trim()
  if (!orderId) return fallbackOrderPatch(nextStatus)

  const { order, items } = await loadPersistedOrder(orderId)
  const latestRequests = (await loadScopedExportRequests([order], true)).filter(isActive)
  const targetId = String(row?.id || row?.request_id || '').trim()
  let targetFound = false
  const nextRequests = latestRequests.map((request: any) => {
    const requestId = String(request?.id || request?.request_id || '').trim()
    if (!targetId || requestId !== targetId) return request
    targetFound = true
    return { ...request, status: nextStatus }
  })

  if (!targetFound) nextRequests.push({ ...row, status: nextStatus })
  return orderSummary(buildFulfillmentRows(items, nextRequests), nextRequests)
}

async function updateRequestStatus(row: any, nextStatus: string, action: string, title: string, note = '', extra: Record<string, any> = {}, notification?: { type: string; title: string; message: string }, extendBatch?: (batch: any) => void) {
  const orderPatch = nextStatus === 'da_xuat'
    ? await deriveOrderSummaryPatch(row, nextStatus)
    : fallbackOrderPatch(nextStatus)`,
  'warehouse exact order summary helper',
)

warehouse = replaceOnce(
  warehouse,
  "    orderSummaryPatch: fallbackOrderPatch('da_xuat'),",
  "    orderSummaryPatch: await deriveOrderSummaryPatch(row, 'da_xuat'),",
  'standard release summary',
)

warehouse = replaceOnce(
  warehouse,
  "    orderSummaryPatch: fallbackOrderPatch('da_tiep_nhan'),",
  "    orderSummaryPatch: await deriveOrderSummaryPatch(row, 'da_tiep_nhan'),",
  'cancel release summary',
)

fs.writeFileSync(warehousePath, warehouse)

const testPath = 'tests/order-fulfilled-metadata-edit.client.test.mjs'
let tests = fs.readFileSync(testPath, 'utf8')

tests = replaceOnce(
  tests,
`const firestoreRulesSource = fs.readFileSync(
  new URL('../firestore.rules', import.meta.url),
  'utf8',
)`,
`const firestoreRulesSource = fs.readFileSync(
  new URL('../firestore.rules', import.meta.url),
  'utf8',
)
const warehouseRequestsSource = fs.readFileSync(
  new URL('../pages/warehouse-export-requests.vue', import.meta.url),
  'utf8',
)`,
  'test warehouse source fixture',
)

tests += `

test('revalidates and repairs a stale fulfilled summary before metadata save', () => {
  assert.match(ordersPageSource, /loadPersistedOrder\(currentOrder\.id\)/)
  assert.match(ordersPageSource, /loadScopedExportRequests\(\[persistedOrder\], true\)/)
  assert.match(ordersPageSource, /const latestSummary = orderSummary\(/)
  assert.match(ordersPageSource, /if \(!isFulfilledOrder\(latestSummary\)\)/)
  assert.match(ordersPageSource, /hasPermission\('orders\.warehouse_export'\)/)
  assert.match(ordersPageSource, /warehouse_fulfillment_status: latestSummary\.warehouse_fulfillment_status/)
  assert.match(ordersPageSource, /expectedRevision: toNumber\(persistedOrder\.revision\)/)
})

test('warehouse release persists an exact order summary instead of a permanent partial fallback', () => {
  assert.match(warehouseRequestsSource, /async function deriveOrderSummaryPatch\(/)
  assert.match(warehouseRequestsSource, /loadPersistedOrder\(orderId\)/)
  assert.match(warehouseRequestsSource, /loadScopedExportRequests\(\[order\], true\)/)
  assert.match(warehouseRequestsSource, /orderSummary\(buildFulfillmentRows\(items, nextRequests\), nextRequests\)/)
  assert.match(warehouseRequestsSource, /orderSummaryPatch: await deriveOrderSummaryPatch\(row, 'da_xuat'\)/)
  assert.match(warehouseRequestsSource, /orderSummaryPatch: await deriveOrderSummaryPatch\(row, 'da_tiep_nhan'\)/)
})
`

fs.writeFileSync(testPath, tests)
console.log('Patched fulfilled order summary synchronization and regression tests.')
