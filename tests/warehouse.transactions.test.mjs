import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  runTransaction,
  setDoc
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-v75-transactions'
const STOCK = 'stock-v75@example.com'
let env

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', STOCK), {
        email: STOCK,
        active: true,
        deleted: false,
        permissions_flat: [
          'import.view', 'import.create', 'import.edit', 'import.delete',
          'export.view', 'export.create', 'export.edit', 'export.delete',
          'inventory.view', 'inventory.adjust', 'stock_movements.view',
          'export_requests.process'
        ]
      }),
      setDoc(doc(db, 'inventory_balances', 'wh-a__product-existing__no_logo'), {
        id: 'wh-a__product-existing__no_logo',
        product_id: 'product-existing',
        product_code: 'SP001',
        product_name: 'Sản phẩm test V7.5',
        warehouse_id: 'wh-a',
        warehouse_name: 'Kho A',
        logo: '',
        unit: 'Cái',
        quantity: 10,
        active: true,
        deleted: false,
        source: 'test'
      }),
      setDoc(doc(db, 'export_orders', 'export-v75-revision'), {
        id: 'export-v75-revision',
        code: 'PX-V75-REVISION',
        destination_type: 'customer',
        destination_name: 'Khách test',
        source_request_id: '',
        sync_source: '',
        source: 'nuxt',
        revision: 0,
        created_by: STOCK,
        created_at: 'seed',
        active: true,
        deleted: false,
        status: 'completed'
      })
    ])
  })
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8')
    }
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await seed()
})

after(async () => {
  await env.cleanup()
})

test('V7.5 cùng operation id chỉ áp tồn một lần khi hai transaction chạy đồng thời', async () => {
  const db = env.authenticatedContext(STOCK, { email: STOCK }).firestore()
  const operationId = 'op-v75-concurrent-import'
  const operationRef = doc(db, 'warehouse_operations', operationId)
  const movementRef = doc(db, 'stock_movements', 'move-v75-concurrent-import')
  const balanceRef = doc(db, 'inventory_balances', 'wh-a__product-existing__no_logo')

  async function applyOnce() {
    return runTransaction(db, async transaction => {
      const operationSnap = await transaction.get(operationRef)
      if (operationSnap.exists()) return 'replayed'

      const balanceSnap = await transaction.get(balanceRef)
      const currentQuantity = Number(balanceSnap.data()?.quantity || 0)

      transaction.set(operationRef, {
        id: operationId,
        operation_id: operationId,
        action: 'import_create',
        target_collection: 'import_orders',
        target_id: 'import-v75-concurrent',
        result_code: 'PNK-V75-CONCURRENT',
        target_revision: 1,
        created_by: STOCK,
        status: 'completed',
        active: true,
        deleted: false
      })
      transaction.set(movementRef, {
        id: 'move-v75-concurrent-import',
        movement_type: 'import',
        direction: 'in',
        movement_date: '2026-07-16',
        product_id: 'product-existing',
        product_code: 'SP001',
        product_name: 'Sản phẩm test V7.5',
        warehouse_id: 'wh-a',
        warehouse_name: 'Kho A',
        logo: '',
        unit: 'Cái',
        quantity: 5,
        source_collection: 'import_orders',
        source_doc_id: 'import-v75-concurrent',
        source_item_id: 'import-item-v75-concurrent',
        source_code: 'PNK-V75-CONCURRENT',
        reason: 'Kiểm thử idempotency V7.5',
        created_by: STOCK,
        operation_id: operationId,
        active: true,
        deleted: false,
        source: 'test'
      })
      transaction.set(balanceRef, {
        quantity: currentQuantity + 5,
        last_operation_id: operationId,
        updated_at: 'now'
      }, { merge: true })
      return 'applied'
    })
  }

  const results = await Promise.all([applyOnce(), applyOnce()])
  assert.equal(results.filter(result => result === 'applied').length, 1)
  assert.equal(results.filter(result => result === 'replayed').length, 1)

  const balanceSnap = await getDoc(balanceRef)
  const movementSnap = await getDoc(movementRef)
  const operationSnap = await getDoc(operationRef)
  assert.equal(Number(balanceSnap.data()?.quantity || 0), 15)
  assert.equal(movementSnap.exists(), true)
  assert.equal(operationSnap.exists(), true)
})

test('V7.5 revision chỉ cho một transaction cập nhật phiếu xuất tại cùng phiên bản', async () => {
  const db = env.authenticatedContext(STOCK, { email: STOCK }).firestore()
  const orderRef = doc(db, 'export_orders', 'export-v75-revision')

  async function updateAtRevision(operationId) {
    return runTransaction(db, async transaction => {
      const operationRef = doc(db, 'warehouse_operations', operationId)
      const operationSnap = await transaction.get(operationRef)
      if (operationSnap.exists()) return 'replayed'

      const orderSnap = await transaction.get(orderRef)
      const revision = Number(orderSnap.data()?.revision || 0)
      if (revision !== 0) throw new Error(`STALE_REVISION:${revision}`)

      transaction.set(operationRef, {
        id: operationId,
        operation_id: operationId,
        action: 'export_update',
        target_collection: 'export_orders',
        target_id: 'export-v75-revision',
        result_code: 'PX-V75-REVISION',
        target_revision: 1,
        created_by: STOCK,
        status: 'completed',
        active: true,
        deleted: false
      })
      transaction.update(orderRef, {
        note: operationId,
        revision: 1,
        operation_id: operationId,
        last_operation_id: operationId,
        updated_by: STOCK,
        updated_at: 'now'
      })
      return 'applied'
    })
  }

  const results = await Promise.allSettled([
    updateAtRevision('op-v75-revision-a'),
    updateAtRevision('op-v75-revision-b')
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected').length, 1)

  const orderSnap = await getDoc(orderRef)
  assert.equal(Number(orderSnap.data()?.revision || 0), 1)
})
