import test from 'node:test'
import assert from 'node:assert/strict'
import { BUSINESS_TIME_ZONE, businessDateKey, isDateInRange, monthKey, toDateKey, todayKey } from '../lib/businessDate.mjs'

const instant = value => new Date(value)

test('business date helpers use Asia/Ho_Chi_Minh', () => {
  assert.equal(BUSINESS_TIME_ZONE, 'Asia/Ho_Chi_Minh')
})

test('todayKey keeps the Vietnam business date before the UTC boundary', () => {
  assert.equal(todayKey(instant('2026-07-19T17:30:00.000Z')), '2026-07-20')
  assert.equal(todayKey(instant('2026-07-19T23:59:00.000Z')), '2026-07-20')
  assert.equal(todayKey(instant('2026-07-20T00:00:00.000Z')), '2026-07-20')
})

test('business date helpers handle month and year boundaries', () => {
  const firstOfMonthInVietnam = instant('2026-07-31T17:30:00.000Z')
  const firstOfYearInVietnam = instant('2026-12-31T17:30:00.000Z')

  assert.equal(businessDateKey(firstOfMonthInVietnam), '2026-08-01')
  assert.equal(monthKey(firstOfMonthInVietnam), '2026-08')
  assert.equal(businessDateKey(firstOfYearInVietnam), '2027-01-01')
  assert.equal(monthKey(firstOfYearInVietnam), '2027-01')
})

test('business date helpers handle leap day', () => {
  const leapDayInVietnam = instant('2024-02-28T17:30:00.000Z')
  const marchInVietnam = instant('2024-02-29T17:30:00.000Z')

  assert.equal(todayKey(leapDayInVietnam), '2024-02-29')
  assert.equal(monthKey(leapDayInVietnam), '2024-02')
  assert.equal(todayKey(marchInVietnam), '2024-03-01')
  assert.equal(monthKey(marchInVietnam), '2024-03')
})

test('date-only business keys are preserved without timezone conversion', () => {
  assert.equal(businessDateKey('2026-07-20'), '2026-07-20')
  assert.equal(monthKey('2026-07'), '2026-07')
  assert.equal(monthKey('2026-07-20'), '2026-07')
})

test('date range filters use the Vietnam business date', () => {
  const beforeUtcBoundary = '2026-07-19T17:30:00.000Z'

  assert.equal(toDateKey(beforeUtcBoundary), '2026-07-20')
  assert.equal(isDateInRange(beforeUtcBoundary, '2026-07-20', '2026-07-20'), true)
  assert.equal(isDateInRange(beforeUtcBoundary, undefined, '2026-07-19'), false)
})
