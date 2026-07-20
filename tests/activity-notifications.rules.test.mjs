import assert from 'node:assert/strict'
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
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore'

const projectId = 'demo-orderkingcup-activity-notifications'
const ADMIN = 'admin@example.com'
const SALE = 'sale@example.com'
const OTHER = 'other@example.com'
const VIEWER = 'activity-viewer@example.com'
const NO_VIEW = 'no-activity-view@example.com'
const DISABLED = 'disabled@example.com'
const WAREHOUSE_ACCEPT = 'warehouse-accept@example.com'
const WAREHOUSE_REJECT = 'warehouse-reject@example.com'
const WAREHOUSE_RELEASE = 'warehouse-release@example.com'
const WAREHOUSE_PROCESS = 'warehouse-process@example.com'
const WAREHOUSE_PAGE_ONLY = 'warehouse-page@example.com'
const RANDOM = 'random@example.com'
const WAREHOUSE_PERMISSIONS = [
  'export_requests.accept',
  'export_requests.reject',
  'export_requests.release',
  'export_requests.process',
]
let env

function user(email, permissions = [], extra = {}) {
  return {
    email,
    active: true,
    deleted: false,
    permissions_flat: permissions,
    ...extra,
  }
}

function exportRequest({
  id,
  sale = SALE,
  status = 'cho_xu_ly',
  lifecycle = '',
  handledBy = '',
  updatedBy = sale,
}) {
  return {
    id,
    request_id: id.toUpperCase(),
    order_id: `order-${id}`,
    order_code: `ORDER-${id}`,
    requested_by: sale,
    created_by: sale,
    updated_by: updatedBy,
    order_owner_email: sale,
    order_created_by: sale,
    order_sale_email: sale,
    status,
    lifecycle_status: lifecycle,
    warehouse_handled_by: handledBy,
    active: true,
    deleted: false,
  }
}

function storedNotification({
  id,
  toEmail = SALE,
  createdBy = WAREHOUSE_ACCEPT,
  audience = '',
  audiencePermissions = [],
  type = 'warehouse_export_request_accepted',
  route = '/export-requests',
  requestId = 'request-accepted',
}) {
  const timestamp = Timestamp.fromMillis(1)
  return {
    id,
    type,
    title: 'Thông báo hợp lệ',
    message: 'Nội dung thông báo hợp lệ',
    route,
    entity_collection: 'order_export_requests',
    entity_id: requestId,
    entity_code: requestId.toUpperCase(),
    created_by: createdBy,
    to_email: toEmail,
    audience,
    audience_permissions: audiencePermissions,
    metadata_json: '{}',
    status: 'unread',
    read: false,
    active: true,
    deleted: false,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

async function seed() {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users', ADMIN), user(ADMIN, ['*'], { is_admin: true })),
      setDoc(doc(db, 'users', SALE), user(SALE, ['orders.warehouse_export'])),
      setDoc(doc(db, 'users', OTHER), user(OTHER, ['orders.warehouse_export'])),
      setDoc(doc(db, 'users', VIEWER), user(VIEWER, ['activity_logs.view'])),
      setDoc(doc(db, 'users', NO_VIEW), user(NO_VIEW)),
      setDoc(doc(db, 'users', DISABLED), user(DISABLED, ['orders.warehouse_export'], { active: false })),
      setDoc(doc(db, 'users', WAREHOUSE_ACCEPT), user(WAREHOUSE_ACCEPT, [
        'page.warehouse_export_requests',
        'export_requests.accept',
      ])),
      setDoc(doc(db, 'users', WAREHOUSE_REJECT), user(WAREHOUSE_REJECT, [
        'page.warehouse_export_requests',
        'export_requests.reject',
      ])),
      setDoc(doc(db, 'users', WAREHOUSE_RELEASE), user(WAREHOUSE_RELEASE, [
        'page.warehouse_export_requests',
        'export_requests.release',
      ])),
      setDoc(doc(db, 'users', WAREHOUSE_PROCESS), user(WAREHOUSE_PROCESS, [
        'page.warehouse_export_requests',
        'export_requests.process',
      ])),
      setDoc(doc(db, 'users', WAREHOUSE_PAGE_ONLY), user(WAREHOUSE_PAGE_ONLY, [
        'page.warehouse_export_requests',
      ])),
      setDoc(doc(db, 'order_export_requests', 'request-pending'), exportRequest({
        id: 'request-pending',
      })),
      setDoc(doc(db, 'order_export_requests', 'request-disabled'), exportRequest({
        id: 'request-disabled',
        sale: DISABLED,
      })),
      setDoc(doc(db, 'order_export_requests', 'request-accepted'), exportRequest({
        id: 'request-accepted',
        status: 'da_tiep_nhan',
        handledBy: WAREHOUSE_ACCEPT,
      })),
      setDoc(doc(db, 'order_export_requests', 'request-accepted-by-reject'), exportRequest({
        id: 'request-accepted-by-reject',
        status: 'da_tiep_nhan',
        handledBy: WAREHOUSE_REJECT,
      })),
      setDoc(doc(db, 'order_export_requests', 'request-accepted-by-process'), exportRequest({
        id: 'request-accepted-by-process',
        status: 'da_tiep_nhan',
        handledBy: WAREHOUSE_PROCESS,
      })),
      setDoc(doc(db, 'order_export_requests', 'request-rejected'), exportRequest({
        id: 'request-rejected',
        status: 'tu_choi',
        handledBy: WAREHOUSE_REJECT,
      })),
      setDoc(doc(db, 'order_export_requests', 'request-released'), exportRequest({
        id: 'request-released',
        status: 'da_xuat',
        lifecycle: 'released',
        handledBy: WAREHOUSE_RELEASE,
      })),
      setDoc(doc(db, 'order_export_requests', 'request-released-by-accept'), exportRequest({
        id: 'request-released-by-accept',
        status: 'da_xuat',
        lifecycle: 'released',
        handledBy: WAREHOUSE_ACCEPT,
      })),
      setDoc(doc(db, 'order_export_requests', 'request-cancelled'), exportRequest({
        id: 'request-cancelled',
        status: 'da_tiep_nhan',
        lifecycle: 'release_cancelled',
        handledBy: WAREHOUSE_RELEASE,
      })),
      setDoc(doc(db, 'order_export_requests', 'request-admin'), exportRequest({
        id: 'request-admin',
        status: 'da_tiep_nhan',
        handledBy: ADMIN,
      })),
      setDoc(doc(db, 'activity_logs', 'activity-existing'), {
        module: 'orders',
        action: 'create',
        changed_by: SALE,
        before_json: '',
        after_json: '{}',
        created_at: Timestamp.fromMillis(1),
        active: true,
        deleted: false,
      }),
      setDoc(doc(db, 'notifications', 'notification-own'), storedNotification({
        id: 'notification-own',
      })),
      setDoc(doc(db, 'notifications', 'notification-other'), storedNotification({
        id: 'notification-other',
        toEmail: OTHER,
      })),
      setDoc(doc(db, 'notifications', 'notification-audience'), storedNotification({
        id: 'notification-audience',
        toEmail: '',
        createdBy: SALE,
        audience: 'warehouse_export',
        audiencePermissions: WAREHOUSE_PERMISSIONS,
        type: 'warehouse_export_request_created',
        route: '/warehouse-export-requests',
        requestId: 'request-pending',
      })),
    ])
  })
}

function activityPayload(actor, overrides = {}) {
  return {
    module: 'orders',
    action: 'update',
    item_code: 'ORDER-001',
    item_name: 'Đơn hàng 001',
    changed_by: actor,
    before_json: '{}',
    after_json: '{"status":"updated"}',
    created_at: serverTimestamp(),
    active: true,
    deleted: false,
    ...overrides,
  }
}

function notificationPayload({
  actor,
  requestId,
  type,
  toEmail = '',
  audience = '',
  audiencePermissions = [],
  overrides = {},
}) {
  const direct = type === 'warehouse_export_request_accepted'
    || type === 'warehouse_export_request_rejected'
    || type === 'warehouse_export_request_released'
    || type === 'warehouse_export_request_cancelled'
  return {
    type,
    title: 'Thông báo nghiệp vụ',
    message: 'Thông báo gắn với yêu cầu xuất kho hợp lệ.',
    route: direct ? '/export-requests' : '/warehouse-export-requests',
    entity_collection: 'order_export_requests',
    entity_id: requestId,
    entity_code: requestId.toUpperCase(),
    created_by: actor,
    to_email: toEmail,
    audience,
    audience_permissions: audiencePermissions,
    metadata_json: '{}',
    status: 'unread',
    read: false,
    active: true,
    deleted: false,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
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
  await seed()
})

after(async () => env.cleanup())

test('active admin và active business user tạo Activity Log hợp lệ', async () => {
  const adminDb = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()
  const saleDb = env.authenticatedContext(SALE, { email: SALE }).firestore()

  await assertSucceeds(setDoc(doc(adminDb, 'activity_logs', 'activity-admin'), activityPayload(ADMIN)))
  await assertSucceeds(setDoc(doc(saleDb, 'activity_logs', 'activity-sale'), activityPayload(SALE)))
})

test('Activity Log chặn tài khoản disabled, chưa đăng nhập và changed_by giả mạo', async () => {
  const disabledDb = env.authenticatedContext(DISABLED, { email: DISABLED }).firestore()
  const anonymousDb = env.unauthenticatedContext().firestore()
  const saleDb = env.authenticatedContext(SALE, { email: SALE }).firestore()

  await assertFails(setDoc(doc(disabledDb, 'activity_logs', 'activity-disabled'), activityPayload(DISABLED)))
  await assertFails(setDoc(doc(anonymousDb, 'activity_logs', 'activity-anonymous'), activityPayload(SALE)))
  await assertFails(setDoc(doc(saleDb, 'activity_logs', 'activity-forged'), activityPayload(OTHER)))
})

test('Activity Log bắt buộc server timestamp, module/action và payload JSON đúng kiểu, đúng giới hạn', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()

  await assertFails(setDoc(doc(db, 'activity_logs', 'activity-client-time'), activityPayload(SALE, {
    created_at: Timestamp.fromDate(new Date('2026-07-20T00:00:00.000Z')),
  })))

  const missingModule = activityPayload(SALE)
  delete missingModule.module
  await assertFails(setDoc(doc(db, 'activity_logs', 'activity-missing-module'), missingModule))

  const missingAction = activityPayload(SALE)
  delete missingAction.action
  await assertFails(setDoc(doc(db, 'activity_logs', 'activity-missing-action'), missingAction))

  await assertFails(setDoc(doc(db, 'activity_logs', 'activity-json-type'), activityPayload(SALE, {
    after_json: { unsafe: true },
  })))
  await assertFails(setDoc(doc(db, 'activity_logs', 'activity-json-large'), activityPayload(SALE, {
    after_json: 'x'.repeat(100001),
  })))
})

test('Activity Log append-only: client không thể update hoặc delete, kể cả admin', async () => {
  const adminDb = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()

  await assertFails(updateDoc(doc(adminDb, 'activity_logs', 'activity-existing'), {
    action: 'forged',
  }))
  await assertFails(deleteDoc(doc(adminDb, 'activity_logs', 'activity-existing')))
})

test('chỉ user có activity_logs.view hoặc admin được đọc Activity Log', async () => {
  const viewerDb = env.authenticatedContext(VIEWER, { email: VIEWER }).firestore()
  const noViewDb = env.authenticatedContext(NO_VIEW, { email: NO_VIEW }).firestore()
  const adminDb = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()

  await assertSucceeds(getDoc(doc(viewerDb, 'activity_logs', 'activity-existing')))
  await assertSucceeds(getDocs(collection(viewerDb, 'activity_logs')))
  await assertFails(getDoc(doc(noViewDb, 'activity_logs', 'activity-existing')))
  await assertFails(getDocs(collection(noViewDb, 'activity_logs')))
  await assertSucceeds(getDoc(doc(adminDb, 'activity_logs', 'activity-existing')))
})

test('Sale tạo notification audience hợp lệ; creator không liên quan và tài khoản disabled bị chặn', async () => {
  const saleDb = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const otherDb = env.authenticatedContext(OTHER, { email: OTHER }).firestore()
  const disabledDb = env.authenticatedContext(DISABLED, { email: DISABLED }).firestore()

  await assertSucceeds(setDoc(doc(saleDb, 'notifications', 'audience-created'), notificationPayload({
    actor: SALE,
    requestId: 'request-pending',
    type: 'warehouse_export_request_created',
    audience: 'warehouse_export',
    audiencePermissions: WAREHOUSE_PERMISSIONS,
  })))
  await assertSucceeds(setDoc(doc(saleDb, 'notifications', 'audience-updated'), notificationPayload({
    actor: SALE,
    requestId: 'request-pending',
    type: 'warehouse_export_request_updated',
    audience: 'warehouse_export',
    audiencePermissions: WAREHOUSE_PERMISSIONS,
  })))
  await assertFails(setDoc(doc(otherDb, 'notifications', 'audience-forged-owner'), notificationPayload({
    actor: OTHER,
    requestId: 'request-pending',
    type: 'warehouse_export_request_created',
    audience: 'warehouse_export',
    audiencePermissions: WAREHOUSE_PERMISSIONS,
  })))
  await assertFails(setDoc(doc(disabledDb, 'notifications', 'audience-disabled'), notificationPayload({
    actor: DISABLED,
    requestId: 'request-disabled',
    type: 'warehouse_export_request_created',
    audience: 'warehouse_export',
    audiencePermissions: WAREHOUSE_PERMISSIONS,
  })))
})

test('recipient trực tiếp phải liên quan tới request; email tùy ý bị chặn', async () => {
  const db = env.authenticatedContext(WAREHOUSE_ACCEPT, { email: WAREHOUSE_ACCEPT }).firestore()

  await assertSucceeds(setDoc(doc(db, 'notifications', 'direct-valid'), notificationPayload({
    actor: WAREHOUSE_ACCEPT,
    requestId: 'request-accepted',
    type: 'warehouse_export_request_accepted',
    toEmail: SALE,
  })))
  await assertFails(setDoc(doc(db, 'notifications', 'direct-random'), notificationPayload({
    actor: WAREHOUSE_ACCEPT,
    requestId: 'request-accepted',
    type: 'warehouse_export_request_accepted',
    toEmail: RANDOM,
  })))
})

test('notification type được khóa theo quyền accept/reject/release/process', async () => {
  const acceptDb = env.authenticatedContext(WAREHOUSE_ACCEPT, { email: WAREHOUSE_ACCEPT }).firestore()
  const rejectDb = env.authenticatedContext(WAREHOUSE_REJECT, { email: WAREHOUSE_REJECT }).firestore()
  const releaseDb = env.authenticatedContext(WAREHOUSE_RELEASE, { email: WAREHOUSE_RELEASE }).firestore()
  const processDb = env.authenticatedContext(WAREHOUSE_PROCESS, { email: WAREHOUSE_PROCESS }).firestore()

  await assertSucceeds(setDoc(doc(acceptDb, 'notifications', 'accepted-allow'), notificationPayload({
    actor: WAREHOUSE_ACCEPT,
    requestId: 'request-accepted',
    type: 'warehouse_export_request_accepted',
    toEmail: SALE,
  })))
  await assertFails(setDoc(doc(rejectDb, 'notifications', 'accepted-deny'), notificationPayload({
    actor: WAREHOUSE_REJECT,
    requestId: 'request-accepted-by-reject',
    type: 'warehouse_export_request_accepted',
    toEmail: SALE,
  })))
  await assertSucceeds(setDoc(doc(rejectDb, 'notifications', 'rejected-allow'), notificationPayload({
    actor: WAREHOUSE_REJECT,
    requestId: 'request-rejected',
    type: 'warehouse_export_request_rejected',
    toEmail: SALE,
  })))
  await assertSucceeds(setDoc(doc(releaseDb, 'notifications', 'released-allow'), notificationPayload({
    actor: WAREHOUSE_RELEASE,
    requestId: 'request-released',
    type: 'warehouse_export_request_released',
    toEmail: SALE,
  })))
  await assertSucceeds(setDoc(doc(releaseDb, 'notifications', 'cancelled-allow'), notificationPayload({
    actor: WAREHOUSE_RELEASE,
    requestId: 'request-cancelled',
    type: 'warehouse_export_request_cancelled',
    toEmail: SALE,
  })))
  await assertFails(setDoc(doc(acceptDb, 'notifications', 'released-deny'), notificationPayload({
    actor: WAREHOUSE_ACCEPT,
    requestId: 'request-released-by-accept',
    type: 'warehouse_export_request_released',
    toEmail: SALE,
  })))
  await assertSucceeds(setDoc(doc(processDb, 'notifications', 'process-allow'), notificationPayload({
    actor: WAREHOUSE_PROCESS,
    requestId: 'request-accepted-by-process',
    type: 'warehouse_export_request_accepted',
    toEmail: SALE,
  })))
})

test('route, entity collection, entity id và payload hệ thống không nhận giá trị tùy ý', async () => {
  const db = env.authenticatedContext(WAREHOUSE_ACCEPT, { email: WAREHOUSE_ACCEPT }).firestore()
  const base = {
    actor: WAREHOUSE_ACCEPT,
    requestId: 'request-accepted',
    type: 'warehouse_export_request_accepted',
    toEmail: SALE,
  }

  await assertFails(setDoc(doc(db, 'notifications', 'bad-route'), notificationPayload({
    ...base,
    overrides: { route: 'https://evil.example/phish' },
  })))
  await assertFails(setDoc(doc(db, 'notifications', 'bad-collection'), notificationPayload({
    ...base,
    overrides: { entity_collection: 'users' },
  })))
  await assertFails(setDoc(doc(db, 'notifications', 'bad-entity'), notificationPayload({
    ...base,
    overrides: { entity_id: '../users/admin' },
  })))
  await assertFails(setDoc(doc(db, 'notifications', 'bad-type'), notificationPayload({
    ...base,
    overrides: { type: 'arbitrary_system_event' },
  })))
  await assertFails(setDoc(doc(db, 'notifications', 'bad-created-at'), notificationPayload({
    ...base,
    overrides: { created_at: Timestamp.fromMillis(1) },
  })))
})

test('user chỉ đọc notification của mình; audience cần đúng quyền page và nghiệp vụ', async () => {
  const saleDb = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const acceptDb = env.authenticatedContext(WAREHOUSE_ACCEPT, { email: WAREHOUSE_ACCEPT }).firestore()
  const pageOnlyDb = env.authenticatedContext(WAREHOUSE_PAGE_ONLY, { email: WAREHOUSE_PAGE_ONLY }).firestore()

  await assertSucceeds(getDoc(doc(saleDb, 'notifications', 'notification-own')))
  await assertFails(getDoc(doc(saleDb, 'notifications', 'notification-other')))

  const ownQuery = query(collection(saleDb, 'notifications'), where('to_email', '==', SALE))
  const otherQuery = query(collection(saleDb, 'notifications'), where('to_email', '==', OTHER))
  const ownSnapshot = await assertSucceeds(getDocs(ownQuery))
  assert.equal(ownSnapshot.docs.length, 1)
  await assertFails(getDocs(otherQuery))

  await assertSucceeds(getDoc(doc(acceptDb, 'notifications', 'notification-audience')))
  await assertFails(getDoc(doc(pageOnlyDb, 'notifications', 'notification-audience')))
})

test('recipient chỉ cập nhật trạng thái đọc của notification chính mình', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()

  await assertSucceeds(updateDoc(doc(db, 'notifications', 'notification-own'), {
    read: true,
    is_read: true,
    status: 'read',
    read_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
})

test('recipient không thể sửa recipient, type, route, entity hoặc người tạo', async () => {
  const db = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const ref = doc(db, 'notifications', 'notification-own')

  await assertFails(updateDoc(ref, { to_email: OTHER }))
  await assertFails(updateDoc(ref, { type: 'warehouse_export_request_released' }))
  await assertFails(updateDoc(ref, { route: '/warehouse-export-requests' }))
  await assertFails(updateDoc(ref, { entity_collection: 'users' }))
  await assertFails(updateDoc(ref, { entity_id: 'request-released' }))
  await assertFails(updateDoc(ref, { created_by: SALE }))
})

test('user thường không xóa notification; admin đọc, đánh dấu đọc và xóa nhưng vẫn không gửi tới recipient tùy ý', async () => {
  const saleDb = env.authenticatedContext(SALE, { email: SALE }).firestore()
  const adminDb = env.authenticatedContext(ADMIN, { email: ADMIN }).firestore()

  await assertFails(deleteDoc(doc(saleDb, 'notifications', 'notification-own')))
  await assertSucceeds(getDoc(doc(adminDb, 'notifications', 'notification-other')))
  await assertSucceeds(updateDoc(doc(adminDb, 'notifications', 'notification-other'), {
    read: true,
    status: 'read',
    read_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
  await assertSucceeds(setDoc(doc(adminDb, 'notifications', 'admin-valid'), notificationPayload({
    actor: ADMIN,
    requestId: 'request-admin',
    type: 'warehouse_export_request_accepted',
    toEmail: SALE,
  })))
  await assertFails(setDoc(doc(adminDb, 'notifications', 'admin-random'), notificationPayload({
    actor: ADMIN,
    requestId: 'request-admin',
    type: 'warehouse_export_request_accepted',
    toEmail: RANDOM,
  })))
  await assertSucceeds(deleteDoc(doc(adminDb, 'notifications', 'notification-own')))
})
