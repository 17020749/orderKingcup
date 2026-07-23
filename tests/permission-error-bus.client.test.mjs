import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  PERMISSION_DENIED_USER_MESSAGE,
  permissionDeniedUserMessage,
  subscribePermissionErrors,
} from '../utils/permissionErrorBus.mjs'

test('permission reporter keeps diagnostics out of the user-facing message', () => {
  const events = []
  const unsubscribe = subscribePermissionErrors(event => events.push(event))

  const message = permissionDeniedUserMessage({
    module: 'payments',
    operation: 'update',
    source: 'preflight',
    missingPermissions: ['payments.edit'],
    recordId: 'payment-01',
  })
  unsubscribe()

  assert.equal(message, PERMISSION_DENIED_USER_MESSAGE)
  assert.deepEqual(events[0].missingPermissions, ['payments.edit'])
  assert.equal(events[0].recordId, 'payment-01')
  assert.doesNotMatch(message, /payments\.edit|payment-01|permission-denied/)
})

test('permission reporter listener failures never interrupt the original flow', () => {
  const unsubscribe = subscribePermissionErrors(() => {
    throw new Error('logger unavailable')
  })
  assert.doesNotThrow(() => permissionDeniedUserMessage({ operation: 'read' }))
  unsubscribe()
})

test('ownership đã thỏa scope không bị chẩn đoán thiếu orders.view_all', () => {
  const events = []
  const unsubscribe = subscribePermissionErrors(event => events.push(event))

  permissionDeniedUserMessage({
    module: 'orders',
    operation: 'orders.edit',
    actionPermission: 'orders.edit',
    scopePermission: 'orders.view_all',
    scopeSatisfied: true,
  })
  unsubscribe()

  assert.deepEqual(events[0].requiredPermissions, ['orders.edit'])
  assert.equal(events[0].context.scope_satisfied, true)
})

test('scope chưa thỏa vẫn ghi đúng quyền view_all thay thế ownership', () => {
  const events = []
  const unsubscribe = subscribePermissionErrors(event => events.push(event))

  permissionDeniedUserMessage({
    module: 'orders',
    operation: 'orders.edit',
    actionPermission: 'orders.edit',
    scopePermission: 'orders.view_all',
  })
  unsubscribe()

  assert.deepEqual(events[0].requiredPermissions, ['orders.edit', 'orders.view_all'])
  assert.equal(events[0].context.scope_satisfied, false)
})

test('permission error logs have a 30-day Firestore TTL field policy', () => {
  const config = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'))
  const ttlPolicy = config.fieldOverrides.find(item => (
    item.collectionGroup === 'permission_error_logs'
    && item.fieldPath === 'expires_at'
  ))

  assert.equal(ttlPolicy?.ttl, true)
  assert.deepEqual(ttlPolicy?.indexes, [])
})
