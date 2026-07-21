import { readFileSync } from 'node:fs'
import { after, before, beforeEach, test } from 'node:test'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-customer-create-flow'
const CREATOR = 'customercreator@example.com'
const OTHER = 'other@example.com'
let env

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', CREATOR), {
        email: CREATOR,
        active: true,
        deleted: false,
        permissions_flat: ['customers.view', 'customers.create']
      }),
      setDoc(doc(db, 'users', OTHER), {
        email: OTHER,
        active: true,
        deleted: false,
        permissions_flat: ['customers.view', 'customers.create']
      }),
      setDoc(doc(db, 'customers', 'other-customer'), {
        id: 'other-customer',
        customer_code: 'OTH001',
        customer_name: 'Khách của người khác',
        created_by: OTHER,
        active: true,
        deleted: false
      })
    ])
  })
}

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') }
  })
})

beforeEach(async () => {
  await env.clearFirestore()
  await seed()
})

after(async () => env.cleanup())

test('Tài khoản được phân quyền tạo khách bằng transaction nhưng vẫn không đọc được khách của người khác', async () => {
  const db = env.authenticatedContext(CREATOR, { email: CREATOR }).firestore()
  const customerRef = doc(collection(db, 'customers'))
  const codeRef = doc(db, 'customer_codes', 'NEW123')
  const activityRef = doc(collection(db, 'activity_logs'))

  await assertSucceeds(runTransaction(db, async transaction => {
    // Luồng thật chỉ đọc reservation mã. Không đọc customerRef chưa tồn tại,
    // vì quyền đọc customers đang giới hạn theo created_by.
    const codeSnapshot = await transaction.get(codeRef)
    if (codeSnapshot.exists()) throw new Error('Mã khách đã tồn tại')

    transaction.set(customerRef, {
      id: customerRef.id,
      customer_code: 'NEW123',
      customer_name: 'Khách mới',
      created_by: CREATOR,
      active: true,
      deleted: false,
      status: 'active',
      created_at: 'now',
      updated_at: 'now'
    })
    transaction.set(codeRef, {
      customer_code: 'NEW123',
      customer_id: customerRef.id,
      created_by: CREATOR,
      active: true,
      deleted: false,
      created_at: 'now'
    })
    transaction.set(activityRef, {
      module: 'customers',
      action: 'create',
      item_code: 'NEW123',
      item_name: 'Khách mới',
      changed_by: CREATOR,
      active: true,
      deleted: false,
      created_at: serverTimestamp()
    })
  }))

  await assertSucceeds(getDoc(customerRef))
  await assertFails(getDoc(doc(db, 'customers', 'other-customer')))
})
