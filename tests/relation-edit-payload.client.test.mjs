import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildActiveRelationPayload } from '../utils/orderRelationPayload.mjs'

const order = {
  id: 'order-owner',
  order_code: 'ORD-001',
  owner_email: 'owner@example.com',
  created_by: 'owner@example.com',
  sale_email: 'owner@example.com',
}

for (const module of ['payments', 'invoices', 'shipments']) {
  test(`${module}: sửa bản ghi legacy thiếu created_by không tự đổi identity`, () => {
    const payload = buildActiveRelationPayload({
      mode: 'update',
      actor: 'manager@example.com',
      order,
      existingRecord: { id: `${module}-legacy`, order_id: order.id },
      record: {
        id: `${module}-legacy`,
        order_id: order.id,
        created_by: 'manager@example.com',
        created_at: 'client-copy',
        note: 'Đã sửa từ modal',
      },
    })
    assert.equal(Object.hasOwn(payload, 'created_by'), false)
    assert.equal(Object.hasOwn(payload, 'created_at'), false)
    assert.equal(payload.note, 'Đã sửa từ modal')
    assert.equal(payload.order_owner_email, order.owner_email)
  })

  test(`${module}: sửa bản ghi mới giữ nguyên created_by gốc`, () => {
    const payload = buildActiveRelationPayload({
      mode: 'update',
      actor: 'manager@example.com',
      order,
      existingRecord: { created_by: 'owner@example.com', created_at: 'server-time' },
      record: { created_by: 'manager@example.com', created_at: 'client-copy', note: 'updated' },
    })
    assert.equal(payload.created_by, 'owner@example.com')
    assert.equal(Object.hasOwn(payload, 'created_at'), false)
  })
}

test('tạo mới vẫn ghi created_by là người thao tác', () => {
  const payload = buildActiveRelationPayload({
    mode: 'create', actor: 'manager@example.com', order, record: { note: 'new' },
  })
  assert.equal(payload.created_by, 'manager@example.com')
})
