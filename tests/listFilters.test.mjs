import assert from 'node:assert/strict'
import test from 'node:test'
import { isDateInRange, matchesKeyword, toDateKey, uniqueOptions } from '../utils/listFilters.ts'

test('toDateKey normalizes supported date values', () => {
  assert.equal(toDateKey('2026-07-19T08:30:00.000Z'), '2026-07-19')
  assert.equal(toDateKey({ seconds: 1784448000 }), '2026-07-19')
  assert.equal(toDateKey({ toDate: () => new Date('2026-07-20T00:00:00.000Z') }), '2026-07-20')
  assert.equal(toDateKey('not-a-date'), '')
})

test('isDateInRange checks inclusive date boundaries', () => {
  assert.equal(isDateInRange('2026-07-19', '2026-07-19', '2026-07-20'), true)
  assert.equal(isDateInRange('2026-07-18', '2026-07-19', '2026-07-20'), false)
  assert.equal(isDateInRange('2026-07-21', '2026-07-19', '2026-07-20'), false)
  assert.equal(isDateInRange('', '', ''), true)
})

test('matchesKeyword searches normalized joined values', () => {
  assert.equal(matchesKeyword(['Cà phê', 'Sữa đá'], 'ca phe'), true)
  assert.equal(matchesKeyword(['ORD-001', 'Nguyễn Văn A'], 'van a'), true)
  assert.equal(matchesKeyword(['Sản phẩm'], 'khach hang'), false)
  assert.equal(matchesKeyword(['Sản phẩm'], ''), true)
})

test('uniqueOptions returns trimmed sorted unique field values', () => {
  const rows = [{ status: 'active' }, { status: ' inactive ' }, { status: 'active' }, { status: '' }, {}]
  assert.deepEqual(uniqueOptions(rows, 'status'), ['active', 'inactive'])
})
