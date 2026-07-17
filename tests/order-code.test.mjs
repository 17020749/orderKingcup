import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildOrderCode,
  normalizeUserCode,
  orderDateCode,
  userCodeValidationError
} from '../utils/orderCode.js'

const date = new Date(2026, 6, 17, 9, 30, 0)

test('Mã đơn ghép YYMMDD, mã người dùng và số riêng từ 1000', () => {
  assert.equal(orderDateCode(date), '260717')
  assert.equal(buildOrderCode('sale01', 1000, date), '260717SALE011000')
  assert.equal(buildOrderCode('SALE01', 1001, date), '260717SALE011001')
})

test('Mã người dùng được chuẩn hóa và chỉ nhận chữ A-Z cùng số', () => {
  assert.equal(normalizeUserCode('  nv01 '), 'NV01')
  assert.equal(userCodeValidationError('NV01'), '')
  assert.match(userCodeValidationError('NV-01'), /chỉ gồm chữ A-Z và số/)
  assert.throws(() => buildOrderCode('NV01', 999, date), /bắt đầu từ 1000/)
})
