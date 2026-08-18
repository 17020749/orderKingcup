import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  FULFILLED_ORDER_METADATA_FIELDS,
  FULFILLED_ORDER_METADATA_WRITE_FIELDS,
  buildFulfilledOrderMetadataPatch,
  fulfilledOrderMetadataChanged,
  isFulfilledOrder,
  normalizeFulfilledOrderMetadata,
  validateFulfilledInvoiceStatusTransition,
} from '../utils/orderFulfilledMetadataEdit.mjs'

const ordersPageSource = fs.readFileSync(
  new URL('../pages/orders.vue', import.meta.url),
  'utf8',
)
const orderPrintSource = fs.readFileSync(
  new URL('../utils/orderPrintDocuments.ts', import.meta.url),
  'utf8',
)
const fulfilledSaveSource = fs.readFileSync(
  new URL('../composables/useFulfilledOrderMetadataSave.ts', import.meta.url),
  'utf8',
)
const firestoreRulesSource = fs.readFileSync(
  new URL('../firestore.rules', import.meta.url),
  'utf8',
)
const warehouseRequestsSource = fs.readFileSync(
  new URL('../pages/warehouse-export-requests.vue', import.meta.url),
  'utf8',
)

test('recognizes only fully exported orders as fulfilled', () => {
  assert.equal(isFulfilledOrder({ warehouse_fulfillment_status: 'da_xuat_du' }), true)
  assert.equal(isFulfilledOrder({ warehouse_fulfillment_status: 'da_xuat_1_phan' }), false)
  assert.equal(isFulfilledOrder({ warehouse_fulfillment_status: '' }), false)
})

test('normalizes the three editable fulfilled-order fields', () => {
  assert.deepEqual(FULFILLED_ORDER_METADATA_FIELDS, ['order_date', 'order_status', 'invoice_status'])
  assert.deepEqual(normalizeFulfilledOrderMetadata({
    orderDate: ' 2026-08-06T19:30 ',
    orderStatus: ' Hoàn thành ',
    invoiceStatus: ' Yêu cầu xuất ',
  }), {
    order_date: '2026-08-06T19:30',
    order_status: 'Hoàn thành',
    invoice_status: 'Yêu cầu xuất',
  })
})

test('base fulfilled metadata patch excludes invoice relation fields and advances revision once', () => {
  const updatedAt = { sentinel: 'serverTimestamp' }
  const patch = buildFulfilledOrderMetadataPatch({
    orderDate: '2026-08-06T19:30',
    orderStatus: 'Hoàn thành',
    invoiceStatus: 'Không xuất',
    currentRevision: 7,
    operationId: 'order:ord_1:edit:abc',
    updatedAt,
  })

  assert.deepEqual(Object.keys(patch).sort(), [...FULFILLED_ORDER_METADATA_WRITE_FIELDS].sort())
  assert.deepEqual(patch, {
    order_date: '2026-08-06T19:30',
    order_status: 'Hoàn thành',
    revision: 8,
    last_operation_id: 'order:ord_1:edit:abc',
    updated_at: updatedAt,
  })
})

test('detects date, order status or invoice status changes', () => {
  const current = {
    order_date: '2026-08-06T19:30',
    order_status: 'Hoàn thành',
    invoice_status: 'Không xuất',
  }

  assert.equal(fulfilledOrderMetadataChanged(current, current), false)
  assert.equal(fulfilledOrderMetadataChanged(current, {
    ...current,
    order_status: 'Đang xử lý',
  }), true)
  assert.equal(fulfilledOrderMetadataChanged(current, {
    ...current,
    order_date: '2026-08-07T08:00',
  }), true)
  assert.equal(fulfilledOrderMetadataChanged(current, {
    ...current,
    invoice_status: 'Yêu cầu xuất',
  }), true)
})

test('fulfilled invoice transition lets Sale toggle request state but locks Đã xuất', () => {
  assert.equal(validateFulfilledInvoiceStatusTransition('Không xuất', 'Yêu cầu xuất'), 'Yêu cầu xuất')
  assert.equal(validateFulfilledInvoiceStatusTransition('Yêu cầu xuất', 'Không xuất'), 'Không xuất')
  assert.equal(validateFulfilledInvoiceStatusTransition('Đã xuất', 'Đã xuất'), 'Đã xuất')
  assert.throws(
    () => validateFulfilledInvoiceStatusTransition('Đã xuất', 'Không xuất'),
    /Hóa đơn đã xuất/,
  )
})

test('rejects empty values, invalid revisions and missing audit fields', () => {
  assert.throws(
    () => normalizeFulfilledOrderMetadata({ orderDate: '', orderStatus: 'Hoàn thành', invoiceStatus: 'Không xuất' }),
    /Ngày giờ đơn/,
  )
  assert.throws(
    () => normalizeFulfilledOrderMetadata({ orderDate: '2026-08-06T19:30', orderStatus: '', invoiceStatus: 'Không xuất' }),
    /Trạng thái đơn/,
  )
  assert.throws(
    () => buildFulfilledOrderMetadataPatch({
      orderDate: '2026-08-06T19:30', orderStatus: 'Hoàn thành', invoiceStatus: 'Không xuất',
      currentRevision: -1, operationId: 'op', updatedAt: {},
    }),
    /Phiên bản đơn hàng/,
  )
  assert.throws(
    () => buildFulfilledOrderMetadataPatch({
      orderDate: '2026-08-06T19:30', orderStatus: 'Hoàn thành', invoiceStatus: 'Không xuất',
      currentRevision: 0, operationId: '', updatedAt: {},
    }),
    /mã thao tác/,
  )
})

test('keeps one edit button and exposes price plus metadata for fulfilled orders', () => {
  assert.match(
    ordersPageSource,
    /<button v-if="canEditRow\(row\)" class="btn-sm" @click="openModal\(row\)">Sửa<\/button>/,
  )
  assert.match(
    ordersPageSource,
    /if \(editing\.value && editingFulfilledOrder\.value\) return saveFulfilledMetadataOnly\(\)/,
  )
  assert.match(ordersPageSource, /Sửa đơn giá \/ ngày giờ \/ trạng thái \/ hóa đơn/)
  assert.match(ordersPageSource, /Đơn đã xuất đủ\. Hệ thống chỉ cho phép cập nhật đơn giá, ngày giờ, trạng thái đơn và trạng thái hóa đơn/)
  assert.match(ordersPageSource, /useOrderPriceSave/)
  assert.match(ordersPageSource, /v-model\.number="item\.unit_price"/)
  assert.match(ordersPageSource, /<fieldset :disabled="editingFulfilledOrder"/)
  assert.match(ordersPageSource, /invoiceStatus: requestedInvoiceStatus/)
})

test('fulfilled save keeps warehouse/items untouched and mutates invoice only with a relation plan', () => {
  assert.match(fulfilledSaveSource, /doc\(db, 'orders', orderId\)/)
  assert.match(fulfilledSaveSource, /doc\(collection\(db, 'activity_logs'\)\)/)
  assert.match(fulfilledSaveSource, /doc\(db, 'invoices', String\(invoiceMutation\.invoiceId\)\.trim\(\)\)/)
  assert.match(fulfilledSaveSource, /transaction\.update\(invoiceRef/)
  assert.match(fulfilledSaveSource, /transaction\.set\(invoiceRef/)
  assert.match(fulfilledSaveSource, /transaction\.update\(orderRef, orderPatch\)/)
  assert.doesNotMatch(fulfilledSaveSource, /order_items/)
  assert.doesNotMatch(fulfilledSaveSource, /inventory_balances/)
  assert.doesNotMatch(fulfilledSaveSource, /stock_movements/)
  assert.doesNotMatch(fulfilledSaveSource, /export_orders/)
})

test('firestore rules keep plain metadata strict and allow invoice relation only through fulfilled whitelist', () => {
  assert.match(firestoreRulesSource, /function fulfilledOrderMetadataUpdateAllowed\(\)/)
  assert.match(
    firestoreRulesSource,
    /onlyChanged\(\[\s*'order_date',\s*'order_status',\s*'revision',\s*'last_operation_id',\s*'updated_at'\s*\]\)/,
  )
  assert.match(firestoreRulesSource, /function fulfilledOrderInvoiceMutationFieldsAllowed\(\)/)
  assert.match(
    firestoreRulesSource,
    /'invoice_status', 'invoice_record_count', 'invoice_relation_revision'/,
  )
  assert.match(
    firestoreRulesSource,
    /fulfillmentStatus\(\) != 'da_xuat_du'\s*\|\| fulfilledOrderInvoiceMutationFieldsAllowed\(\)/,
  )
  assert.match(
    firestoreRulesSource,
    /request\.resource\.data\.get\('revision', -1\)[\s\S]*== resource\.data\.get\('revision', 0\) \+ 1/,
  )
})

test('revalidates and repairs a stale fulfilled summary before limited save', () => {
  assert.equal(ordersPageSource.includes('loadPersistedOrder(currentOrder.id)'), true)
  assert.equal(ordersPageSource.includes('loadScopedExportRequests([persistedOrder], true)'), true)
  assert.equal(ordersPageSource.includes('const latestSummary = orderSummary('), true)
  assert.equal(ordersPageSource.includes('if (!isFulfilledOrder(latestSummary))'), true)
  assert.equal(ordersPageSource.includes("hasPermission('orders.warehouse_export')"), true)
  assert.equal(ordersPageSource.includes('warehouse_fulfillment_status: latestSummary.warehouse_fulfillment_status'), true)
  assert.equal(ordersPageSource.includes('let expectedRevision = toNumber(persistedOrder.revision)'), true)
  assert.equal(ordersPageSource.includes('loadScopedInvoicesForOrders([persistedOrder], true)'), true)
})

test('repairs a stale persisted fulfilled status before a normal partial-order edit', () => {
  assert.equal(ordersPageSource.includes('persistedEditItems = persistedItems'), true)
  assert.equal(ordersPageSource.includes('if (isFulfilledOrder(latestSummary))'), true)
  assert.equal(ordersPageSource.includes('if (isFulfilledOrder(persistedOrder))'), true)
  assert.equal(ordersPageSource.includes("saveStage = 'reconcile_warehouse_summary'"), true)
  assert.equal(ordersPageSource.includes('warehouse_fulfillment_status: latestSummary.warehouse_fulfillment_status'), true)
  assert.equal(ordersPageSource.includes('previousItems: persistedItems'), true)
  assert.equal(ordersPageSource.includes("'orders/order_items/invoices'"), true)
})

test('warehouse release persists an exact order summary instead of a permanent partial fallback', () => {
  assert.equal(warehouseRequestsSource.includes('async function reconcileOrderSummary('), true)
  assert.equal(warehouseRequestsSource.includes('requestsAfterTransition(row, patch)'), true)
  assert.equal(warehouseRequestsSource.includes('orderWarehouseFulfillmentSummaryFromRequests('), true)
  assert.equal(warehouseRequestsSource.includes("}, 'release')"), true)
  assert.equal(warehouseRequestsSource.includes("}, 'cancel_release')"), true)
  assert.equal(warehouseRequestsSource.includes('orderSummaryPatch:'), false)
})

test('fulfilled invoice exception is scoped away from delete lock and duplicate UI', () => {
  const fieldsetIndex = ordersPageSource.indexOf('<fieldset :disabled="editingFulfilledOrder"')
  assert.ok(fieldsetIndex > 0)
  const normalFields = ordersPageSource.slice(fieldsetIndex)
  assert.match(normalFields, /<div v-if="!editingFulfilledOrder" class="form-group">\s*<label>Hóa đơn<\/label>/)

  const deleteStart = firestoreRulesSource.indexOf('function orderCanBeDeleted()')
  const deleteEnd = firestoreRulesSource.indexOf('function exportRequestEditable()', deleteStart)
  const deleteRule = firestoreRulesSource.slice(deleteStart, deleteEnd)
  assert.match(deleteRule, /fulfillmentStatus\(\) != 'da_xuat_du'/)
  assert.doesNotMatch(deleteRule, /fulfilledOrderInvoiceMutationFieldsAllowed/)

  const legacyStart = firestoreRulesSource.indexOf('function orderLegacyInvoiceCreateAllowed(orderId)')
  const legacyEnd = firestoreRulesSource.indexOf('function invoiceOrderCascadeDeleteAllowed()', legacyStart)
  const legacyRule = firestoreRulesSource.slice(legacyStart, legacyEnd)
  assert.match(legacyRule, /fulfilledOrderInvoiceMutationFieldsAllowed\(\)/)
})

test('orders expose fulfillment filtering and flag fulfilled orders with unpaid balances', () => {
  assert.match(ordersPageSource, /const fulfillmentStatusFilter = ref\(''\)/)
  assert.match(ordersPageSource, /fulfillmentStatusKey\(row\.warehouse_fulfillment_status\)/)
  assert.match(ordersPageSource, /hasFulfilledPaymentAlert\(row\)/)
  assert.match(ordersPageSource, /order-row--payment-alert/)
  assert.match(ordersPageSource, /paymentStatus !== 'Đã thanh toán'/)
  assert.match(ordersPageSource, /<option value="Đã cọc">Đã cọc<\/option>/)
  assert.match(ordersPageSource, /Đã cọc \+ thanh toán một phần/)
  assert.match(orderPrintSource, /email\?: string/)
  assert.match(orderPrintSource, /info\.email \? `<div class="info-row"><strong>Địa chỉ email:<\/strong>/)
})
