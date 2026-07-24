import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'

const projectId = 'demo-payment-bank-accounts'
const ADMIN = 'admin@example.com'
const CREATOR = 'creator@example.com'
const VIEWER = 'viewer@example.com'
const NONE = 'none@example.com'
let env

function user(permissions) {
  return { active: true, deleted: false, status: 'active', permissions_flat: permissions }
}

function account(id = 'bank-1', overrides = {}) {
  return {
    id,
    recipient_name: 'KINGCUP VIET NAM',
    account_number: '0123456789',
    bank_name: 'Vietcombank',
    status: 'active',
    active: true,
    deleted: false,
    created_by: ADMIN,
    created_at: new Date('2026-07-24T00:00:00Z'),
    updated_at: new Date('2026-07-24T00:00:00Z'),
    search_text: 'kingcup viet nam 0123456789 vietcombank',
    ...overrides,
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
      setDoc(doc(db, 'users', ADMIN), user(['*'])),
      setDoc(doc(db, 'users', CREATOR), user(['payments.view', 'payments.create'])),
      setDoc(doc(db, 'users', VIEWER), user(['payments.view'])),
      setDoc(doc(db, 'users', NONE), user([])),
      setDoc(doc(db, 'payment_bank_accounts', 'bank-1'), account()),
      setDoc(doc(db, 'payment_bank_accounts', 'bank-deleted'), account('bank-deleted', { active: false, deleted: true, status: 'deleted' })),
    ])
  })
})

after(async () => env.cleanup())

test('payment users can read only active account options', async () => {
  const db = env.authenticatedContext(CREATOR, { email: CREATOR }).firestore()
  await assertSucceeds(getDocs(query(
    collection(db, 'payment_bank_accounts'),
    where('active', '==', true),
    where('deleted', '==', false),
  )))
  await assertSucceeds(getDoc(doc(db, 'payment_bank_accounts', 'bank-1')))
  await assertFails(getDoc(doc(db, 'payment_bank_accounts', 'bank-deleted')))
})

test('unrelated users cannot read recipient accounts', async () => {
  const db = env.authenticatedContext(NONE, { email: NONE }).firestore()
  await assertFails(getDoc(doc(db, 'payment_bank_accounts', 'bank-1')))
})

test('non-admin payment users cannot create update or delete setup accounts', async () => {
  const db = env.authenticatedContext(CREATOR, { email: CREATOR }).firestore()
  await assertFails(setDoc(doc(db, 'payment_bank_accounts', 'bank-new'), {
    ...account('bank-new', { created_by: CREATOR }),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
  await assertFails(updateDoc(doc(db, 'payment_bank_accounts', 'bank-1'), {
    bank_name: 'ACB',
    updated_at: serverTimestamp(),
  }))
  await assertFails(deleteDoc(doc(db, 'payment_bank_accounts', 'bank-1')))
})

test('admin can create edit and soft delete accounts but cannot hard delete', async () => {
  const db = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  await assertSucceeds(setDoc(doc(db, 'payment_bank_accounts', 'bank-new'), {
    ...account('bank-new'),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
  await assertSucceeds(updateDoc(doc(db, 'payment_bank_accounts', 'bank-new'), {
    bank_name: 'ACB',
    updated_at: serverTimestamp(),
  }))
  await assertSucceeds(updateDoc(doc(db, 'payment_bank_accounts', 'bank-new'), {
    active: false,
    deleted: true,
    status: 'deleted',
    deleted_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
  await assertFails(deleteDoc(doc(db, 'payment_bank_accounts', 'bank-1')))
})
