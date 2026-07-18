'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { allocateCandidateLots, sortLots } = require('../src/allocation')

const lots = [
  { id: 'lot-new', import_date: '2026-07-15', expiry_date: '2027-01-01', available_quantity: 120 },
  { id: 'lot-old', import_date: '2026-07-01', expiry_date: '2027-06-01', available_quantity: 100 },
  { id: 'lot-mid', import_date: '2026-07-10', expiry_date: '2026-12-01', available_quantity: 80 },
]

test('FIFO lấy lô nhập cũ trước', () => {
  const result = allocateCandidateLots(lots, 150, 'fifo')
  assert.deepEqual(result.map(row => [row.lot.id, row.quantity]), [
    ['lot-old', 100],
    ['lot-mid', 50],
  ])
})

test('FEFO lấy lô hết hạn gần trước', () => {
  assert.deepEqual(sortLots(lots, 'fefo').map(row => row.id), ['lot-mid', 'lot-new', 'lot-old'])
})

test('lô còn ít trước giúp đóng lô lẻ', () => {
  const result = allocateCandidateLots(lots, 150, 'smallest_lot_first')
  assert.deepEqual(result.map(row => [row.lot.id, row.quantity]), [
    ['lot-mid', 80],
    ['lot-old', 70],
  ])
})

test('chặn khi tổng tồn theo lô không đủ', () => {
  assert.throws(() => allocateCandidateLots(lots, 301, 'fifo'), /Còn thiếu 1/)
})
