import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore'

const projectId = 'demo-shipment-permission-scopes'
const SALE = 'sale@example.com'
const OTHER = 'other@example.com'
const MANAGER = 'manager@example.com'
let env

function activeUser(permissions) {
  return {
    active: true,
    deleted: false,
    status: 'active',
    permissions_flat: permissions,
  }
}

function order(id, owner) {
  return {
    id,
    order_code: id,
    owner_email: owner,
    created_by: owner,
    sale_email: owner,
    active: true,
    deleted: false,
    status: 'active',
  }
}

function shipment(id, orderId, owner) {
  return {
    id,
    order_id: orderId,
    order_code: orderId,
    created_by: owner,
    order_owner_email: owner,
    order_created_by: owner,
    order_sale_email: owner,
    shipping_status: 'Chờ giao',
    shipped_date: '2026-07-21',
    active: true,
    deleted: false,
    status: 'active',
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
      setDoc(doc(db, 'users', SALE), activeUser(['orders.view', 'shipments.view'])),
      setDoc(doc(db, 'users', OTHER), activeUser(['orders.view', 'shipments.view'])),
      setDoc(doc(db, 'users', MANAGER), activeUser(['orders.view_all', 'shipments.view_all'])),
      setDoc(doc(db, 'orders', 'order-sale'), order('order-sale', SALE)),
      setDoc(doc(db, 'orders', 'order-other'), order('order-other', OTHER)),
      setDoc(doc(db, 'shipments', 'shipment-sale'), shipment('shipment-sale', 'order-sale', SALE)),
      setDoc(doc(db, 'shipments', 'shipment-other'), shipment('shipment-other', 'order-other', OTHER)),
    ])
  })
})

after(async () => env.cleanup())

test('shipments.view chỉ đọc vận chuyển thuộc phạm vi của mình', async () => {
  const saleDb = env.authenticatedContext(SALE, { email: SALE }).firestore()
  await assertSucceeds(getDoc(doc(saleDb, 'shipments', 'shipment-sale')))
  await assertFails(getDoc(doc(saleDb, 'shipments', 'shipment-other')))
})

test('shipments.view_all đọc và query được vận chuyển của mọi đơn', async () => {
  const managerDb = env.authenticatedContext(MANAGER, { email: MANAGER }).firestore()
  await assertSucceeds(getDoc(doc(managerDb, 'shipments', 'shipment-sale')))
  await assertSucceeds(getDoc(doc(managerDb, 'shipments', 'shipment-other')))
  await assertSucceeds(getDocs(query(
    collection(managerDb, 'shipments'),
    where('order_id', '==', 'order-sale'),
  )))
})
