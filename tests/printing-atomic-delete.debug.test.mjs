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
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-printing-atomic-delete'
const PRINTING = 'printing@example.com'
let env

function deletedPatch() {
  return {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: 'now',
    deleted_by: PRINTING,
    updated_by: PRINTING,
    updated_at: 'now',
  }
}

function minimalDeletedPatch() {
  return {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_at: 'now',
    updated_at: 'now',
  }
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', PRINTING), {
        email: PRINTING,
        active: true,
        deleted: false,
        permissions_flat: ['page.printing', 'printing.view', 'printing.delete'],
      }),
      setDoc(doc(db, 'orders', 'order-a'), {
        id: 'order-a',
        order_code: 'order-a',
        owner_email: 'sale@example.com',
        created_by: 'sale@example.com',
        sale_email: 'sale@example.com',
        active: true,
        deleted: false,
      }),
      setDoc(doc(db, 'print_orders', 'print-a'), {
        id: 'print-a',
        order_id: 'order-a',
        order_code: 'order-a',
        created_by: PRINTING,
        active: true,
        deleted: false,
        status: 'active',
        source: 'test',
      }),
      setDoc(doc(db, 'print_order_items', 'print-item-a'), {
        id: 'print-item-a',
        print_order_id: 'print-a',
        product_id: 'product-a',
        print_quantity: 10,
        actual_print_quantity: 0,
        created_by: PRINTING,
        active: true,
        deleted: false,
        status: 'active',
        source: 'test',
      }),
    ])
  })
})

after(async () => env.cleanup())

test('xóa mềm riêng đơn cha', async () => {
  const db = env.authenticatedContext(PRINTING, { email: PRINTING }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'print_orders', 'print-a'), minimalDeletedPatch()))
})

test('xóa mềm riêng dòng con khi cha còn active', async () => {
  const db = env.authenticatedContext(PRINTING, { email: PRINTING }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'print_order_items', 'print-item-a'), deletedPatch()))
})

test('xóa mềm cha và dòng in trong cùng batch', async () => {
  const db = env.authenticatedContext(PRINTING, { email: PRINTING }).firestore()
  const batch = writeBatch(db)
  batch.update(doc(db, 'print_orders', 'print-a'), deletedPatch())
  batch.update(doc(db, 'print_order_items', 'print-item-a'), deletedPatch())
  await assertSucceeds(batch.commit())
})

test('không cho hard delete đơn in', async () => {
  const db = env.authenticatedContext(PRINTING, { email: PRINTING }).firestore()
  await assertFails(deleteDoc(doc(db, 'print_orders', 'print-a')))
})
