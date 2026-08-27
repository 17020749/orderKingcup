import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('absolute admin edit repairs exactly one legacy order before atomic transaction', () => {
  const atomicSave = readFileSync('composables/useAtomicOrderSave.ts', 'utf8')
  const reconcile = readFileSync('utils/reconcileLegacyOrderForEdit.ts', 'utf8')

  assert.ok(atomicSave.includes("import { reconcileLegacyOrderForEdit } from '~/utils/reconcileLegacyOrderForEdit'"))
  assert.ok(atomicSave.includes("input.mode === 'edit' && (permissions.value || []).includes('*')"))
  assert.ok(atomicSave.includes('await reconcileLegacyOrderForEdit({'))
  assert.ok(atomicSave.indexOf('await reconcileLegacyOrderForEdit({') < atomicSave.indexOf('await runTransaction(db'))

  assert.ok(reconcile.includes("getDoc(orderRef)"))
  for (const module of ['payments', 'invoices', 'shipments']) {
    assert.ok(reconcile.includes(`collection(db, '${module}')`))
  }
  assert.ok(reconcile.includes("where('order_id', '==', normalizedOrderId)"))
  assert.ok(reconcile.includes('buildReconciledOrderRelationPatch({'))
  assert.ok(reconcile.includes('relationReconcileNeeded(order, patch)'))
  assert.ok(reconcile.includes('await updateDoc(orderRef, patch)'))
  assert.ok(!reconcile.includes("getDocs(collection(db, 'orders'))"))
})

test('normal sale edit does not receive admin-only reconcile write', () => {
  const atomicSave = readFileSync('composables/useAtomicOrderSave.ts', 'utf8')
  const guardIndex = atomicSave.indexOf("input.mode === 'edit' && (permissions.value || []).includes('*')")
  const reconcileIndex = atomicSave.indexOf('await reconcileLegacyOrderForEdit({')

  assert.ok(guardIndex >= 0)
  assert.ok(reconcileIndex > guardIndex)
})
