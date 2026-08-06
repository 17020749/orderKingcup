import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FULFILLED_ORDER_METADATA_WRITE_FIELDS,
  buildFulfilledOrderMetadataPatch,
  fulfilledOrderMetadataChanged,
  isFulfilledOrder,
  normalizeFulfilledOrderMetadata,
} from '../utils/orderFulfilledMetadataEdit.mjs'

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
