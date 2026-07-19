import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('warehouse client exposes the cost-aware cancel release function', () => {
  const costSource = readFileSync('composables/useWarehouseCostTransactions.ts', 'utf8')
  const clientSource = readFileSync('composables/useWarehouseTransactionsClient.ts', 'utf8')
  const pageSource = readFileSync('pages/warehouse-export-requests.vue', 'utf8')

  assert.match(costSource, /async function cancelExportRequestRelease\(/)
  assert.match(costSource, /restoreSourceAllocation\(/)
  assert.match(costSource, /buildCancelledReleaseRequestPatch\(/)
  assert.match(costSource, /cancelExportRequestRelease,\s*\n/)
  assert.match(clientSource, /\.\.\.base/)
  assert.match(pageSource, /cancelExportRequestRelease/)
})

test('cost-aware release keeps the Step 8 lifecycle and lot summary fields', () => {
  const source = readFileSync('composables/useWarehouseCostTransactions.ts', 'utf8')
  assert.match(source, /nextExportReleaseSequence\(request\)/)
  assert.match(source, /requestExportOrderId\(requestDocId, releaseSequence\)/)
  assert.match(source, /buildGeneratedExportLifecycleFields/)
  assert.match(source, /buildReleasedRequestPatch/)
  assert.match(source, /warehouse_id: line\.fromWarehouse\.id/)
  assert.match(source, /lot_allocations: allocations/)
})

test('relation reconciliation remains an explicit admin maintenance action', () => {
  const relationSource = readFileSync('composables/useAtomicOrderRelations.ts', 'utf8')
  const relationHelper = readFileSync('utils/orderRelationState.mjs', 'utf8')
  const orderPage = readFileSync('pages/orders.vue', 'utf8')
  const rules = readFileSync('firestore.rules', 'utf8')

  assert.match(relationSource, /if \(!isAdmin\.value\)/)
  assert.match(relationSource, /buildReconciledOrderRelationPatch/)
  assert.match(relationHelper, /relation_last_action: 'reconcile'/)
  assert.match(orderPage, /reconcileOrderRelationLocks/)
  assert.match(rules, /function orderRelationReconcileAllowed\(\)/)
  assert.match(rules, /relation_last_module', ''\) == 'all'/)
})


test('cancel release resolves the source warehouse from the persisted export item', () => {
  const source = readFileSync('composables/useWarehouseCostTransactions.ts', 'utf8')

  assert.match(source, /The persisted export item is the source of truth for reversal/)
  assert.match(source, /item\.from_warehouse_id\s*
\s*\|\| item\.warehouse_id/)
  assert.match(source, /line\.fromWarehouse = ensureWarehouse\(/)
  assert.match(source, /line\.logo = exportItemSourceLogo\(item\)/)
  assert.match(source, /currentExport\.export_date \|\| request\.export_date/)
  assert.match(source, /export_order_item_id: line\.itemId/)
  assert.match(source, /from_warehouse_id: line\.fromWarehouse\.id/)
  assert.match(source, /source_logo: normalizeLogo\(line\.sourceLogo\)/)
})
