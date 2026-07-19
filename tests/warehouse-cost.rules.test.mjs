import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-warehouse-cost-rules'
const WAREHOUSE = 'warehouse-cost@example.com'
const IMPORTER = 'import-cost@example.com'
const ADMIN = 'admin-cost@example.com'
let env

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', WAREHOUSE), {
        email: WAREHOUSE,
        active: true,
        deleted: false,
        permissions_flat: [
          'page.warehouse_export_requests',
          'export_requests.release',
          'export.view',
          'export.create',
          'export.edit',
          'export.delete',
          'inventory.view',
          'inventory.adjust',
          'stock_movements.view',
        ],
      }),
      setDoc(doc(db, 'users', IMPORTER), {
        email: IMPORTER,
        active: true,
        deleted: false,
        permissions_flat: ['import.view', 'import.create', 'import.edit', 'import.delete'],
      }),
      setDoc(doc(db, 'users', ADMIN), {
        email: ADMIN,
        active: true,
        deleted: false,
        permissions_flat: ['*'],
      }),
      setDoc(doc(db, 'import_orders', 'import-priced'), {
        id: 'import-priced',
        code: 'PNK-PRICE-001',
        import_date: '2026-07-18',
        created_by: IMPORTER,
        active: true,
        deleted: false,
        status: 'completed',
      }),
      setDoc(doc(db, 'import_order_items', 'import-priced__1'), {
        id: 'import-priced__1',
        import_order_id: 'import-priced',
        product_id: 'product-a',
        product_code: 'SPA',
        product_name: 'Sản phẩm A',
        warehouse_id: 'warehouse-a',
        warehouse_name: 'Kho A',
        logo: '',
        quantity: 10,
        unit: 'Cái',
        unit_cost: 2500,
        line_cost: 25000,
        lot_id: 'lot__import-priced__1',
        created_by: IMPORTER,
        active: true,
        deleted: false,
        status: 'completed',
      }),
      setDoc(doc(db, 'export_orders', 'export-cost-test'), {
        id: 'export-cost-test',
        code: 'PXK-COST-TEST',
        export_code: 'PXK-COST-TEST',
        export_date: '2026-07-19',
        destination_type: 'customer',
        customer_name: 'Khách kiểm tra giá vốn',
        created_by: WAREHOUSE,
        active: true,
        deleted: false,
        status: 'completed',
        source: 'nuxt',
      }),
      setDoc(doc(db, 'inventory_balances', 'warehouse-a__product-a__no_logo'), {
        id: 'warehouse-a__product-a__no_logo',
        product_id: 'product-a',
        product_code: 'SPA',
        product_name: 'Sản phẩm A',
        warehouse_id: 'warehouse-a',
        warehouse_name: 'Kho A',
        logo: '',
        unit: 'Cái',
        quantity: 10,
        lots: [{
          id: 'lot__import-priced__1',
          import_order_id: 'import-priced',
          import_order_item_id: 'import-priced__1',
          import_code: 'PNK-PRICE-001',
          import_date: '2026-07-18',
          received_quantity: 10,
          available_quantity: 10,
          cost_item_id: 'import-priced__1',
          status: 'available',
        }],
        active: true,
        deleted: false,
      }),
      setDoc(doc(db, 'app_meta', 'warehouse_issue'), {
        id: 'warehouse_issue',
        strategy: 'fifo',
        max_lots_per_line: 50,
        revision: 1,
        active: true,
        deleted: false,
      }),
    ])
  })
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await seed()
})

after(async () => {
  await env.cleanup()
})

test('Kho không đọc được chi tiết phiếu nhập có giá vốn', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  await assertFails(getDoc(doc(db, 'import_order_items', 'import-priced__1')))
})

test('Người có quyền nhập kho đọc được giá của phiếu nhập', async () => {
  const db = env.authenticatedContext(IMPORTER, { email: IMPORTER }).firestore()
  const snapshot = await assertSucceeds(getDoc(doc(db, 'import_order_items', 'import-priced__1')))
  assert.equal(snapshot.data()?.unit_cost, 2500)
})

test('Kho chỉ đọc cấu hình chiến lược nhưng không sửa được', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const snapshot = await assertSucceeds(getDoc(doc(db, 'app_meta', 'warehouse_issue')))
  assert.equal(snapshot.data()?.strategy, 'fifo')
  await assertFails(updateDoc(doc(db, 'app_meta', 'warehouse_issue'), {
    strategy: 'smallest_lot_first',
  }))
})

test('Admin sửa được cấu hình xuất kho', async () => {
  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'app_meta', 'warehouse_issue'), {
    strategy: 'fefo',
    revision: 2,
  }))
})

test('Kho được cập nhật số lượng và metadata lô trong cùng operation hợp lệ', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  const operationId = 'export_create_cost_test'
  const batch = writeBatch(db)
  batch.set(doc(db, 'warehouse_operations', operationId), {
    id: operationId,
    operation_id: operationId,
    action: 'export_create',
    target_collection: 'export_orders',
    target_id: 'export-cost-test',
    result_code: 'PXK-COST-TEST',
    target_revision: 0,
    created_by: WAREHOUSE,
    status: 'processing',
    active: true,
    deleted: false,
  })
  batch.update(doc(db, 'inventory_balances', 'warehouse-a__product-a__no_logo'), {
    quantity: 8,
    tracked_lot_quantity: 8,
    lots: [{
      id: 'lot__import-priced__1',
      import_order_id: 'import-priced',
      import_order_item_id: 'import-priced__1',
      import_code: 'PNK-PRICE-001',
      import_date: '2026-07-18',
      received_quantity: 10,
      available_quantity: 8,
      cost_item_id: 'import-priced__1',
      status: 'available',
    }],
    last_operation_id: operationId,
    updated_by: WAREHOUSE,
  })
  await assertSucceeds(batch.commit())
})

test('Dòng phiếu xuất có parent hợp lệ chỉ cần mã lô và số lượng, không cần giá nhập', async () => {
  const db = env.authenticatedContext(WAREHOUSE, { email: WAREHOUSE }).firestore()
  await assertSucceeds(setDoc(doc(db, 'export_order_items', 'export-cost-test__1'), {
    id: 'export-cost-test__1',
    export_order_id: 'export-cost-test',
    product_id: 'product-a',
    product_code: 'SPA',
    product_name: 'Sản phẩm A',
    from_warehouse_id: 'warehouse-a',
    from_warehouse_name: 'Kho A',
    logo: '',
    quantity: 2,
    unit: 'Cái',
    lot_allocations_json: JSON.stringify([{
      lot_id: 'lot__import-priced__1',
      quantity: 2,
      import_order_id: 'import-priced',
      import_order_item_id: 'import-priced__1',
    }]),
    allocation_strategy: 'fifo',
    created_by: WAREHOUSE,
    active: true,
    deleted: false,
    status: 'completed',
  }))
})
