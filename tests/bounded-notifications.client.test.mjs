import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildNotificationWindow,
  NOTIFICATION_READ_STATE_LIMIT,
  NOTIFICATION_SOURCE_LIMIT,
  NOTIFICATION_VISIBLE_LIMIT,
  notificationTimestamp,
} from '../utils/notificationWindow.mjs'

function notification(id, seconds, overrides = {}) {
  return {
    id,
    title: id,
    created_at: { seconds, nanoseconds: 0 },
    active: true,
    deleted: false,
    created_by: 'sender@example.com',
    to_email: 'viewer@example.com',
    status: 'unread',
    read: false,
    ...overrides,
  }
}

test('notification limits are explicit and stay below Firestore batch/read safety bounds', () => {
  assert.equal(NOTIFICATION_SOURCE_LIMIT, 100)
  assert.equal(NOTIFICATION_READ_STATE_LIMIT, 300)
  assert.equal(NOTIFICATION_VISIBLE_LIMIT, 100)
  assert.ok(NOTIFICATION_VISIBLE_LIMIT <= NOTIFICATION_SOURCE_LIMIT)
  assert.ok(NOTIFICATION_READ_STATE_LIMIT >= NOTIFICATION_SOURCE_LIMIT * 2)
  assert.ok(NOTIFICATION_VISIBLE_LIMIT < 450)
})

test('notification timestamps support Firestore timestamps, dates and ISO strings', () => {
  assert.equal(notificationTimestamp({ seconds: 10, nanoseconds: 500_000_000 }), 10_500)
  assert.equal(notificationTimestamp({ toMillis: () => 42 }), 42)
  assert.equal(notificationTimestamp('2026-07-29T00:00:00.000Z'), Date.parse('2026-07-29T00:00:00.000Z'))
})

test('notification window deduplicates, filters inactive/self-audience rows and keeps latest 100', () => {
  const directRows = Array.from({ length: 120 }, (_, index) => notification(`direct-${index}`, index + 1))
  const audienceRows = Array.from({ length: 120 }, (_, index) => notification(`audience-${index}`, index + 121, {
    to_email: '',
    audience: 'warehouse_export',
  }))
  audienceRows.push(notification('self-audience', 1000, {
    created_by: 'viewer@example.com',
    to_email: '',
    audience: 'warehouse_export',
  }))
  audienceRows.push(notification('deleted', 1001, { deleted: true, to_email: '' }))
  audienceRows.push(notification('direct-119', 2000, { to_email: '', audience: 'warehouse_export' }))

  const rows = buildNotificationWindow({
    directRows,
    audienceRows,
    activeEmail: 'VIEWER@example.com',
  })

  assert.equal(rows.length, NOTIFICATION_VISIBLE_LIMIT)
  assert.equal(rows[0].id, 'direct-119')
  assert.equal(rows.filter(row => row.id === 'direct-119').length, 1)
  assert.ok(!rows.some(row => row.id === 'self-audience'))
  assert.ok(!rows.some(row => row.id === 'deleted'))
  assert.ok(rows.every((row, index) => index === 0 || notificationTimestamp(rows[index - 1].created_at) >= notificationTimestamp(row.created_at)))
})

test('notification window applies per-user read state without mutating source rows', () => {
  const source = notification('n-1', 1)
  const rows = buildNotificationWindow({
    directRows: [source, notification('n-2', 2, { status: 'seen' })],
    readIds: ['n-1'],
    activeEmail: 'viewer@example.com',
  })

  assert.equal(rows.find(row => row.id === 'n-1')?.is_read, true)
  assert.equal(rows.find(row => row.id === 'n-2')?.is_read, true)
  assert.equal(source.is_read, undefined)
})

test('notification listeners order by recency and apply server-side limits to all streams', () => {
  const source = readFileSync(new URL('../composables/useNotifications.ts', import.meta.url), 'utf8')
  assert.equal((source.match(/orderBy\('created_at', 'desc'\)/g) || []).length, 2)
  assert.equal((source.match(/queryLimit\(NOTIFICATION_SOURCE_LIMIT\)/g) || []).length, 2)
  assert.match(source, /where\('user_email', '==', nextEmail\)[\s\S]*orderBy\('read_at', 'desc'\)[\s\S]*queryLimit\(NOTIFICATION_READ_STATE_LIMIT\)/)
  assert.match(source, /buildNotificationWindow/)
  assert.doesNotMatch(source, /\.slice\(0, 100\)/)
})

test('all required bounded notification composite indexes are declared', () => {
  const indexDocument = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'))
  const signatures = new Set(indexDocument.indexes.map(index => [
    index.collectionGroup,
    ...index.fields.map(field => `${field.fieldPath}:${field.order || field.arrayConfig}`),
  ].join('|')))

  assert.ok(signatures.has('notifications|to_email:ASCENDING|created_at:DESCENDING'))
  assert.ok(signatures.has('notifications|audience:ASCENDING|created_at:DESCENDING'))
  assert.ok(signatures.has('notification_reads|user_email:ASCENDING|read_at:DESCENDING'))
})
