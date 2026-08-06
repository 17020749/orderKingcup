import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  FULFILLED_ORDER_METADATA_WRITE_FIELDS,
  buildFulfilledOrderMetadataPatch,
  fulfilledOrderMetadataChanged,
  isFulfilledOrder,
  normalizeFulfilledOrderMetadata,
} from '../utils/orderFulfilledMetadataEdit.mjs'

const ordersPageSource = fs.readFileSync(
  new URL('../pages/orders.vue', import.meta.url),
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

test('recognizes only fully exported orders as fulfilled', () => {
  assert.equal(isFulfilledOrder({ warehouse_fulfillment_status: 'da_xuat_du' }), true)
  assert.equal(isFulfilledOrder({ warehouse_fulfillment_status: 'da_xuat_1_phan' }), false)
  assert.equal(isFulfilledOrder({ warehouse_fulfillment_status: '' }), false)
})

test('normalizes the only two editable business fields', () => {
  assert.deepEqual(normalizeFulfilledOrderMetadata({
    orderDate: ' 2026-08-06T19:30 ',
    orderStatus: ' Hoàn thành ',
  }), {
    order_date: '2026-08-06T19:30',
    order_status: 'Hoàn thành',
  })
})

test('builds an exact metadata-only patch and advances revision once', () => {
  const updatedAt = { sentinel: 'serverTimestamp' }
  const patch = buildFulfilledOrderMetadataPatch({
    orderDate: '2026-08-06T19:30',
    orderStatus: 'Hoàn thành',
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

test('detects whether date or order status changed', () => {
  const current = {
    order_date: '2026-08-06T19:30',
    order_status: 'Hoàn thành',
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
})

test('rejects empty values, invalid revisions and missing audit fields', () => {
  assert.throws(
    () => normalizeFulfilledOrderMetadata({ orderDate: '', orderStatus: 'Hoàn thành' }),
    /Ngày giờ đơn/,
  )
  assert.throws(
    () => normalizeFulfilledOrderMetadata({ orderDate: '2026-08-06T19:30', orderStatus: '' }),
    /Trạng thái đơn/,
  )
  assert.throws(
    () => buildFulfilledOrderMetadataPatch({
      orderDate: '2026-08-06T19:30',
      orderStatus: 'Hoàn thành',
      currentRevision: -1,
      operationId: 'op',
      updatedAt: {},
    }),
    /Phiên bản đơn hàng/,
  )
  assert.throws(
    () => buildFulfilledOrderMetadataPatch({
      orderDate: '2026-08-06T19:30',
      orderStatus: 'Hoàn thành',
      currentRevision: 0,
      operationId: '',
      updatedAt: {},
    }),
    /mã thao tác/,
  )
})

test('keeps one edit button and routes fulfilled orders to the limited save flow', () => {
  assert.match(
    ordersPageSource,
    /<button v-if="canEditRow\(row\)" class="btn-sm" @click="openModal\(row\)">Sửa<\/button>/,
  )
  assert.match(
    ordersPageSource,
    /if \(editing\.value && editingFulfilledOrder\.value\) return saveFulfilledMetadataOnly\(\)/,
  )
  assert.match(
    ordersPageSource,
    /const editingFulfilledOrder = computed\(\(\) => isFulfilledOrder\(editing\.value \|\| \{\}\)\)/,
  )
  assert.match(ordersPageSource, /Đơn đã xuất đủ\. Hệ thống chỉ cho phép cập nhật ngày giờ và trạng thái đơn/)
  assert.match(ordersPageSource, /<fieldset :disabled="editingFulfilledOrder"/)
})

test('fulfilled save transaction touches only orders and activity logs', () => {
  assert.match(fulfilledSaveSource, /doc\(db, 'orders', orderId\)/)
  assert.match(fulfilledSaveSource, /doc\(collection\(db, 'activity_logs'\)\)/)
  assert.match(fulfilledSaveSource, /transaction\.update\(orderRef, patch\)/)
  assert.doesNotMatch(fulfilledSaveSource, /order_items/)
  assert.doesNotMatch(fulfilledSaveSource, /inventory_balances/)
  assert.doesNotMatch(fulfilledSaveSource, /stock_movements/)
  assert.doesNotMatch(fulfilledSaveSource, /export_orders/)
  assert.doesNotMatch(fulfilledSaveSource, /invoices/)
})

test('firestore rules allow only the fulfilled metadata whitelist', () => {
  assert.match(firestoreRulesSource, /function fulfilledOrderMetadataUpdateAllowed\(\)/)
  assert.match(firestoreRulesSource, /fulfillmentStatus\(\) == 'da_xuat_du'/)
  assert.match(
    firestoreRulesSource,
    /onlyChanged\(\[\s*'order_date',\s*'order_status',\s*'revision',\s*'last_operation_id',\s*'updated_at'\s*\]\)/,
  )
  assert.match(
    firestoreRulesSource,
    /fulfilledOrderMetadataUpdateAllowed\(\)\s*\|\| \(\s*hasPerm\('orders\.edit'\)/,
  )
  assert.match(
    firestoreRulesSource,
    /request\.resource\.data\.get\('revision', -1\)\s*== resource\.data\.get\('revision', 0\) \+ 1/,
  )
})
