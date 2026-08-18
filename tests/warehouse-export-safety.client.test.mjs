import test from 'node:test'
import assert from 'node:assert/strict'
import {
  externalExportManifestCountMatches,
  notificationDocumentId,
} from '../utils/warehouseExportSafety.mjs'

test('legacy external exports without item_count remain cancellable when item snapshots exist', () => {
  assert.equal(externalExportManifestCountMatches({}, 2), true)
  assert.equal(externalExportManifestCountMatches({ item_count: null }, 1), true)
})

test('explicit external manifest counts must match observed item snapshots', () => {
  assert.equal(externalExportManifestCountMatches({ item_count: 2 }, 2), true)
  assert.equal(externalExportManifestCountMatches({ item_count: 1 }, 2), false)
  assert.equal(externalExportManifestCountMatches({ item_count: 'invalid' }, 2), false)
  assert.equal(externalExportManifestCountMatches({}, 0), false)
})

test('notification document ids keep distinct recipients distinct', () => {
  const operation = 'export_request_release:request-a:7'
  const requestId = 'request-a'
  const plusAddress = notificationDocumentId(operation, requestId, 'sale+ops@example.com')
  const underscoreAddress = notificationDocumentId(operation, requestId, 'sale_ops@example.com')
  assert.notEqual(plusAddress, underscoreAddress)
})

test('notification document ids are not truncated before the recipient component', () => {
  const operation = `external_release:${'x'.repeat(600)}`
  const first = notificationDocumentId(operation, 'request-a', 'first@example.com')
  const second = notificationDocumentId(operation, 'request-a', 'second@example.com')
  assert.notEqual(first, second)
  assert.ok(first.length <= 1500)
  assert.ok(second.length <= 1500)
})
