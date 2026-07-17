import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildOrderCode,
  customerCodeValidationError,
  normalizeUserCode,
  userCodeValidationError
} from '../utils/orderCode.js'
import { generateCustomerCode, isValidCustomerCode } from '../utils/customerCode.js'

test('Mã đơn ghép mã người dùng, mã khách và số riêng của khách từ 0001', () => {
  assert.equal(buildOrderCode('sale01', 'kha001', 1), 'SALE01-KHA001-0001')
  assert.equal(buildOrderCode('SALE01', 'KHA001', 2), 'SALE01-KHA001-0002')
  assert.equal(buildOrderCode('SALE01', 'KHB002', 1), 'SALE01-KHB002-0001')
})

test('Mã người dùng được chuẩn hóa và chỉ nhận chữ A-Z cùng số', () => {
  assert.equal(normalizeUserCode('  nv01 '), 'NV01')
  assert.equal(userCodeValidationError('NV01'), '')
  assert.match(userCodeValidationError('NV-01'), /chỉ gồm chữ A-Z và số/)
  assert.throws(() => buildOrderCode('NV01', 'KHA001', 0), /bắt đầu từ 0001/)
  assert.match(customerCodeValidationError('KH-01'), /3 chữ cái in hoa và 3 chữ số/)
})

test('Mã khách tự động luôn có đúng 3 chữ cái hoa và 3 chữ số', () => {
  const values = [0, 0.04, 0.08, 0.1, 0.2, 0.3]
  let index = 0
  const code = generateCustomerCode(() => values[index++])
  assert.equal(code, 'ABC123')
  assert.equal(isValidCustomerCode(code), true)
  assert.equal(isValidCustomerCode('AB1234'), false)
})
