import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const printingGuard = readFileSync('composables/useOrderPrintingDeleteGuard.ts', 'utf8')
const orderRelations = readFileSync('composables/useAtomicOrderRelations.ts', 'utf8')
const scopedQueries = readFileSync('composables/useScopedQueries.ts', 'utf8')

test('read-only order users do not query printing collections outside their permissions', () => {
  assert.match(printingGuard, /function canReadOrderPrintingDependencies\(\)/)
  assert.match(printingGuard, /hasPermission\('orders\.edit'\)/)
  assert.match(printingGuard, /hasPermission\('orders\.delete'\)/)
  assert.match(printingGuard, /hasPermission\('printing\.orders_view'\)/)
  assert.match(printingGuard, /hasPermission\('printing\.view_all'\)/)
  assert.match(printingGuard, /if \(!canReadOrderPrintingDependencies\(\)\) return \[\] as PrintOrderDoc\[\]/)
  assert.match(printingGuard, /printOrders: \[\] as PrintOrderDoc\[\], printItems: \[\] as PrintOrderItemDoc\[\]/)
})

test('creating a payment or other order relation does not read its missing child document', () => {
  assert.match(orderRelations, /const childSnap = mode === 'create' \? null : await transaction\.get\(childRef\)/)
  assert.doesNotMatch(orderRelations, /Promise\.all\(\[\s*transaction\.get\(orderRef\),\s*transaction\.get\(childRef\)/)
  assert.match(orderRelations, /transaction\.set\(childRef, firestorePayload, \{ merge: mode !== 'create' \}\)/)
})

test('export request realtime listener falls back when Firestore rejects the OR query by permission', () => {
  assert.match(scopedQueries, /\['failed-precondition', 'invalid-argument', 'permission-denied', 'unimplemented'\]/)
  assert.match(scopedQueries, /startFallback\(\)/)
  assert.match(scopedQueries, /where\(field, '==', currentEmail\)/)
})
