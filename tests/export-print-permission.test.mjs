import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-export-print-rules'
const PRINTER = 'export-printer@example.com'
const PRINT_ONLY = 'export-print-only@example.com'
let env

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', PRINTER), {
        email: PRINTER,
        active: true,
        deleted: false,
        permissions_flat: ['page.exports', 'export.view', 'export.print'],
      }),
      setDoc(doc(db, 'users', PRINT_ONLY), {
        email: PRINT_ONLY,
        active: true,
        deleted: false,
        permissions_flat: ['page.exports', 'export.print'],
      }),
      setDoc(doc(db, 'export_orders', 'export-print-a'), {
        id: 'export-print-a',
        code: 'PX-PRINT-A',
        export_date: '2026-07-18',
        destination_type: 'customer',
        customer_name: 'Khách in thử',
        created_by: 'warehouse@example.com',
        active: true,
        deleted: false,
        status: 'completed',
        source: 'test',
      }),
      setDoc(doc(db, 'export_order_items', 'export-print-item-a'), {
        id: 'export-print-item-a',
        export_order_id: 'export-print-a',
        product_id: 'product-a',
        product_code: 'SP-A',
        product_name: 'Sản phẩm A',
        from_warehouse_id: 'warehouse-a',
        quantity: 10,
        created_by: 'warehouse@example.com',
        active: true,
        deleted: false,
        source: 'test',
      }),
    ])
  })
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await seed()
})

after(async () => env.cleanup())

test('Người có quyền xem và in đọc được dữ liệu phiếu xuất để in', async () => {
  const db = env.authenticatedContext(PRINTER, { email: PRINTER }).firestore()
  await assertSucceeds(getDoc(doc(db, 'export_orders', 'export-print-a')))
  await assertSucceeds(getDoc(doc(db, 'export_order_items', 'export-print-item-a')))
})

test('Quyền in không thay thế quyền xem dữ liệu phiếu xuất', async () => {
  const db = env.authenticatedContext(PRINT_ONLY, { email: PRINT_ONLY }).firestore()
  await assertFails(getDoc(doc(db, 'export_orders', 'export-print-a')))
  await assertFails(getDoc(doc(db, 'export_order_items', 'export-print-item-a')))
})

test('Người chỉ có quyền xem và in không được tạo sửa hoặc xóa phiếu xuất', async () => {
  const db = env.authenticatedContext(PRINTER, { email: PRINTER }).firestore()

  await assertFails(setDoc(doc(db, 'export_orders', 'forged-export'), {
    id: 'forged-export',
    code: 'PX-FORGED',
    created_by: PRINTER,
    active: true,
    deleted: false,
    source: 'test',
  }))
  await assertFails(updateDoc(doc(db, 'export_orders', 'export-print-a'), {
    note: 'Không được sửa',
  }))
  await assertFails(deleteDoc(doc(db, 'export_orders', 'export-print-a')))
})
