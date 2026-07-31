import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { orderRelationDeleteBlocker } from '../utils/orderRelationState.mjs'

const deletableOrder = {
  id: 'order-a',
  relation_lock_version: 1,
  payment_record_count: 0,
  invoice_record_count: 0,
  shipment_record_count: 0,
  payment_relation_revision: 0,
  invoice_relation_revision: 0,
  shipment_relation_revision: 0,
  invoice_status: 'Không xuất',
}

test('client chặn xóa đơn khi hóa đơn đã được phát hành', () => {
  const blocker = orderRelationDeleteBlocker({
    ...deletableOrder,
    invoice_record_count: 1,
    invoice_status: 'Đã xuất',
  })

  assert.match(blocker, /hóa đơn đã phát hành/)
})

test('hóa đơn nháp vẫn được cascade delete cùng đơn như trước', () => {
  assert.equal(orderRelationDeleteBlocker({
    ...deletableOrder,
    invoice_record_count: 1,
    invoice_status: 'HĐ nháp',
  }), '')
})

test('client guard và Firestore Rules cùng kiểm tra trạng thái Đã xuất', () => {
  const client = readFileSync('utils/orderRelationState.mjs', 'utf8')
  const rules = readFileSync('firestore.rules', 'utf8')
  const ordersPage = readFileSync('pages/orders.vue', 'utf8')

  assert.match(client, /invoice_status\) === 'Đã xuất'/)
  assert.match(rules, /invoice_status', 'Không xuất'\) != 'Đã xuất'/)
  assert.match(ordersPage, /orderRelationDeleteBlocker\(row\)/)
  assert.match(ordersPage, /orderRelationDeleteBlocker\(latestOrder\)/)
})
