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
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-phase5-security'
const SALE = 'sale@example.com'
const SECOND_SALE = 'secondsale@example.com'
const ACCEPT = 'warehouseaccept@example.com'
const REJECT = 'warehousereject@example.com'
const RELEASE = 'warehouserelease@example.com'
const OTHER = 'other@example.com'
const INACTIVE = 'inactive@example.com'
const ADMIN = 'admin@example.com'
const AUDIT = 'audit@example.com'

const warehouseAudiencePermissions = [
  'export_requests.accept',
  'export_requests.reject',
  'export_requests.release',
  'export_requests.process',
]

let env

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', SALE), {
        email: SALE,
        active: true,
        deleted: false,
        permissions_flat: ['orders.warehouse_export'],
      }),
      setDoc(doc(db, 'users', SECOND_SALE), {
        email: SECOND_SALE,
        active: true,
        deleted: false,
        permissions_flat: ['orders.view'],
      }),
      setDoc(doc(db, 'users', ACCEPT), {
        email: ACCEPT,
        active: true,
        deleted: false,
        permissions_flat: ['page.warehouse_export_requests', 'export_requests.accept'],
      }),
      setDoc(doc(db, 'users', REJECT), {
        email: REJECT,
        active: true,
        deleted: false,
        permissions_flat: ['page.warehouse_export_requests', 'export_requests.reject'],
      }),
      setDoc(doc(db, 'users', RELEASE), {
        email: RELEASE,
        active: true,
        deleted: false,
        permissions_flat: ['page.warehouse_export_requests', 'export_requests.release'],
      }),
      setDoc(doc(db, 'users', OTHER), {
        email: OTHER,
        active: true,
        deleted: false,
        permissions_flat: [],
      }),
      setDoc(doc(db, 'users', INACTIVE), {
        email: INACTIVE,
        active: false,
        deleted: false,
        permissions_flat: ['orders.warehouse_export'],
      }),
      setDoc(doc(db, 'users', ADMIN), {
        email: ADMIN,
        active: true,
        deleted: false,
        permissions_flat: ['*'],
        is_admin: true,
      }),
      setDoc(doc(db, 'users', AUDIT), {
        email: AUDIT,
        active: true,
        deleted: false,
        permissions_flat: ['activity_logs.view'],
      }),
      setDoc(doc(db, 'order_export_requests', 'request-a'), {
        id: 'request-a',
        request_id: 'YCXK-A',
        order_id: 'order-a',
        requested_by: SALE,
        created_by: SALE,
        order_sale_email: SECOND_SALE,
        active: true,
        deleted: false,
        status: 'cho_xu_ly',
      }),
      setDoc(doc(db, 'notifications', 'direct-sale'), {
        type: 'warehouse_export_request_accepted',
        title: 'Kho đã tiếp nhận',
        message: 'YCXK-A',
        route: '/export-requests',
        entity_collection: 'order_export_requests',
        entity_id: 'request-a',
        entity_code: 'YCXK-A',
        created_by: ACCEPT,
        to_email: SALE,
        audience: '',
        audience_permissions: [],
        status: 'unread',
        read: false,
        active: true,
        deleted: false,
      }),
      setDoc(doc(db, 'notifications', 'warehouse-broadcast'), {
        type: 'warehouse_export_request_created',
        title: 'Có yêu cầu xuất kho mới',
        message: 'YCXK-A',
        created_by: SALE,
        to_email: '',
        audience: 'warehouse_export',
        audience_permissions: warehouseAudiencePermissions,
        status: 'unread',
        read: false,
        active: true,
        deleted: false,
      }),
      setDoc(doc(db, 'activity_logs', 'existing-log'), {
        module: 'orders',
        action: 'update',
        item_code: 'order-a',
        changed_by: SALE,
        created_at: 'seed',
        active: true,
        deleted: false,
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

function activityPayload(changedBy = SALE) {
  return {
    module: 'orders',
    action: 'update',
    item_code: 'order-a',
    item_name: 'Đơn A',
    changed_by: changedBy,
    after_json: '{}',
    created_at: serverTimestamp(),
    active: true,
    deleted: false,
  }
}

function directNotificationPayload({
  type = 'warehouse_export_request_accepted',
  createdBy = ACCEPT,
  toEmail = SALE,
} = {}) {
  return {
    type,
    title: 'Cập nhật yêu cầu xuất kho',
    message: 'YCXK-A',
    route: '/export-requests',
    entity_collection: 'order_export_requests',
    entity_id: 'request-a',
    entity_code: 'YCXK-A',
    created_by: createdBy,
    to_email: toEmail,
    audience: '',
    audience_permissions: [],
    metadata_json: '{}',
    status: 'unread',
    read: false,
    active: true,
    deleted: false,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }
}

test('activity_logs chỉ cho active user ghi đúng changed_by', async () => {
  const saleDb = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const inactiveDb = env.authenticatedContext(INACTIVE, { email: INACTIVE }).firestore()

  await assertSucceeds(setDoc(doc(saleDb, 'activity_logs', 'valid-log'), activityPayload()))
  await assertFails(setDoc(doc(saleDb, 'activity_logs', 'forged-actor'), activityPayload(OTHER)))
  await assertFails(setDoc(doc(inactiveDb, 'activity_logs', 'inactive-log'), activityPayload(INACTIVE)))
})

test('activity_logs là append-only kể cả với admin', async () => {
  const adminDb = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  await assertFails(updateDoc(doc(adminDb, 'activity_logs', 'existing-log'), { action: 'delete' }))
  await assertFails(deleteDoc(doc(adminDb, 'activity_logs', 'existing-log')))
})

test('thông báo broadcast chỉ chấp nhận payload và permission canonical', async () => {
  const saleDb = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const otherDb = env.authenticatedContext(OTHER, { email: OTHER }).firestore()

  const valid = {
    type: 'warehouse_export_request_created',
    title: 'Có yêu cầu xuất kho mới',
    message: 'YCXK-A',
    created_by: SALE,
    to_email: '',
    audience: 'warehouse_export',
    audience_permissions: warehouseAudiencePermissions,
    status: 'unread',
    read: false,
    active: true,
    deleted: false,
  }
  await assertSucceeds(setDoc(doc(saleDb, 'notifications', 'valid-broadcast'), valid))
  await assertFails(setDoc(doc(saleDb, 'notifications', 'wrong-audience-perms'), {
    ...valid,
    audience_permissions: ['export_requests.accept'],
  }))
  await assertFails(setDoc(doc(otherDb, 'notifications', 'unauthorized-broadcast'), {
    ...valid,
    created_by: OTHER,
  }))
})

test('thông báo trực tiếp phải đúng quyền thao tác và đúng Sale trên yêu cầu', async () => {
  const acceptDb = env.authenticatedContext(ACCEPT, { email: ACCEPT }).firestore()
  const releaseDb = env.authenticatedContext(RELEASE, { email: RELEASE }).firestore()
  const otherDb = env.authenticatedContext(OTHER, { email: OTHER }).firestore()

  await assertSucceeds(setDoc(doc(acceptDb, 'notifications', 'accepted-sale'), directNotificationPayload()))
  await assertSucceeds(setDoc(doc(acceptDb, 'notifications', 'accepted-second-sale'), directNotificationPayload({ toEmail: SECOND_SALE })))
  await assertSucceeds(setDoc(doc(releaseDb, 'notifications', 'released-sale'), directNotificationPayload({
    type: 'warehouse_export_request_released',
    createdBy: RELEASE,
  })))
  await assertFails(setDoc(doc(acceptDb, 'notifications', 'wrong-recipient'), directNotificationPayload({ toEmail: OTHER })))
  await assertFails(setDoc(doc(acceptDb, 'notifications', 'wrong-action-permission'), directNotificationPayload({
    type: 'warehouse_export_request_released',
  })))
  await assertFails(setDoc(doc(otherDb, 'notifications', 'unprivileged-direct'), directNotificationPayload({
    createdBy: OTHER,
  })))
})

test('nội dung notification bất biến, người nhận chỉ được chuyển sang đã đọc', async () => {
  const saleDb = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const adminDb = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()

  await assertSucceeds(updateDoc(doc(saleDb, 'notifications', 'direct-sale'), {
    status: 'read',
    read: true,
    read_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
  await assertFails(updateDoc(doc(saleDb, 'notifications', 'direct-sale'), { message: 'Nội dung giả' }))
  await assertFails(updateDoc(doc(adminDb, 'notifications', 'direct-sale'), { message: 'Admin sửa nội dung' }))
  await assertFails(updateDoc(doc(saleDb, 'notifications', 'direct-sale'), {
    status: 'unread',
    read: false,
    updated_at: serverTimestamp(),
  }))
})

test('notification_reads phải có ID chuẩn và chỉ trỏ tới notification user được đọc', async () => {
  const saleDb = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const acceptDb = env.authenticatedContext(ACCEPT, { email: ACCEPT }).firestore()

  await assertSucceeds(setDoc(doc(saleDb, 'notification_reads', `direct-sale__${SALE}`), {
    id: `direct-sale__${SALE}`,
    notification_id: 'direct-sale',
    user_email: SALE,
    read_at: serverTimestamp(),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    active: true,
    deleted: false,
  }))
  await assertFails(setDoc(doc(saleDb, 'notification_reads', `wrong-id__${SALE}`), {
    id: `wrong-id__${SALE}`,
    notification_id: 'direct-sale',
    user_email: SALE,
    read_at: serverTimestamp(),
    active: true,
    deleted: false,
  }))
  await assertFails(setDoc(doc(saleDb, 'notification_reads', `warehouse-broadcast__${SALE}`), {
    id: `warehouse-broadcast__${SALE}`,
    notification_id: 'warehouse-broadcast',
    user_email: SALE,
    read_at: serverTimestamp(),
    active: true,
    deleted: false,
  }))
  await assertSucceeds(setDoc(doc(acceptDb, 'notification_reads', `warehouse-broadcast__${ACCEPT}`), {
    id: `warehouse-broadcast__${ACCEPT}`,
    notification_id: 'warehouse-broadcast',
    user_email: ACCEPT,
    read_at: serverTimestamp(),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    active: true,
    deleted: false,
  }))
  await assertSucceeds(getDoc(doc(acceptDb, 'notification_reads', `warehouse-broadcast__${ACCEPT}`)))
})
