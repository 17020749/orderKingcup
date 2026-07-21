import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const permissionCatalog = readFileSync('constants/permissions.ts', 'utf8')
const accessMatrix = readFileSync('constants/accessMatrix.mjs', 'utf8')
const scopedQueries = readFileSync('composables/useScopedQueries.ts', 'utf8')
const orderRelations = readFileSync('composables/useAtomicOrderRelations.ts', 'utf8')
const orderLogic = readFileSync('composables/useOrderLogic.ts', 'utf8')
const firestoreRules = readFileSync('firestore.rules', 'utf8')

test('shipment permissions expose the same own/all scope model as payments', () => {
  assert.match(permissionCatalog, /key: 'shipments\.view_all'/)
  assert.match(accessMatrix, /'shipments\.view_all': \['page\.shipments', 'orders\.view_all'\]/)
  assert.match(scopedQueries, /canAll\('shipments\.view_all'\)/)
  assert.match(firestoreRules, /hasPerm\('shipments\.view_all'\)/)
})

test('shipment relation summaries use all records for the selected order', () => {
  assert.match(orderRelations, /where\('order_id', '==', order\.id\)/)
  assert.match(orderRelations, /const authoritativeRecords = relationSnapshot\.docs\.map/)
  assert.match(orderRelations, /removeRelationRecord\(authoritativeRecords, recordId\)/)
  assert.match(orderRelations, /replaceRelationRecord\(authoritativeRecords,/)
})

test('shipment page preserves the atomic payment summary without payment read access', () => {
  assert.match(orderLogic, /hasStoredRelationSummary/)
  assert.match(orderLogic, /if \(!paymentRows\.length && hasStoredRelationSummary\)/)
  assert.match(orderLogic, /paid_amount: toNumber\(order\.paid_amount\)/)
})
