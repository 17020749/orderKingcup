import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('bus transport model keeps request identity and legacy export fields optional', () => {
  const source = readFileSync('types/models.ts', 'utf8')
  const block = source.match(/export interface BusTransportDoc \{[\s\S]*?\n\}/)?.[0] || ''
  assert.match(block, /source_request_id\?: string/)
  assert.match(block, /request_code\?: string/)
  assert.match(block, /request_status\?: string/)
  assert.match(block, /export_order_id\?: string/)
  assert.match(block, /customer_id\?: string/)
})

test('rules giữ quyền ghi collection cũ tách khỏi module nhà xe', () => {
  const rules = readFileSync('firestore.rules', 'utf8')
  assert.match(rules, /allow get: if isAdmin\(\)[\s\S]*hasAnyPerm\(\['export\.print', 'bus_transport\.view'\]\)/)
  assert.match(rules, /match \/orders\/\{docId\}[\s\S]*allow read:[\s\S]*hasPerm\('bus_transport\.view'\)/)
  assert.match(rules, /match \/order_export_requests\/\{docId\}[\s\S]*'bus_transport\.view'/)
  assert.match(rules, /validBoundedString\(request\.resource\.data\.get\('source_request_id'/)
  assert.doesNotMatch(rules, /match \/orders\/\{docId\}[\s\S]{0,150}allow (create|update): if hasPerm\('bus_transport\.view'\)/)
})
