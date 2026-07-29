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
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'

const projectId = 'demo-transport-carriers-permissions'
const VIEWER = 'carrier-viewer@example.com'
const CREATOR = 'carrier-creator@example.com'
const EDITOR = 'carrier-editor@example.com'
const DELETER = 'carrier-deleter@example.com'
const SHIPMENT_VIEWER = 'shipment-viewer@example.com'
const BUS_VIEWER = 'bus-viewer@example.com'
const NONE = 'carrier-none@example.com'
let env

function activeUser(permissions) {
  return { active: true, deleted: false, status: 'active', permissions_flat: permissions }
}

function carrier(id = 'carrier-1', overrides = {}) {
  return {
    id,
    carrier_code: 'NX-001',
    carrier_name: 'Nhà xe Miền Nam',
    carrier_phone: '0909000000',
    carrier_address: 'Bến xe Miền Đông, TP. Hồ Chí Minh',
    service_province_codes: [74, 75, 79],
    service_province_names: ['Tỉnh Bình Dương', 'Tỉnh Đồng Nai', 'Thành phố Hồ Chí Minh'],
    service_district_codes: [719, 740],
    service_district_names: ['Huyện Bàu Bàng', 'Huyện Long Thành'],
    driver_name: 'Nguyễn Văn Tài',
    note: '',
    status: 'active',
    active: true,
    deleted: false,
    created_by: CREATOR,
    created_at: new Date('2026-07-25T00:00:00Z'),
    updated_by: CREATOR,
    updated_at: new Date('2026-07-25T00:00:00Z'),
    source: 'nuxt',
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
      setDoc(doc(db, 'users', VIEWER), activeUser(['page.transport_carriers', 'transport_carriers.view'])),
      setDoc(doc(db, 'users', CREATOR), activeUser(['page.transport_carriers', 'transport_carriers.view', 'transport_carriers.create'])),
      setDoc(doc(db, 'users', EDITOR), activeUser(['page.transport_carriers', 'transport_carriers.view', 'transport_carriers.edit'])),
      setDoc(doc(db, 'users', DELETER), activeUser(['page.transport_carriers', 'transport_carriers.view', 'transport_carriers.delete'])),
      setDoc(doc(db, 'users', SHIPMENT_VIEWER), activeUser(['shipments.view'])),
      setDoc(doc(db, 'users', BUS_VIEWER), activeUser(['bus_transport.view'])),
      setDoc(doc(db, 'users', NONE), activeUser([])),
      setDoc(doc(db, 'transport_carriers', 'carrier-1'), carrier()),
      setDoc(doc(db, 'orders', 'order-1'), {
        id: 'order-1', order_code: 'DH-001', active: true, deleted: false,
      }),
    ])
  })
})

after(async () => env.cleanup())

test('quyền xem danh mục và nghiệp vụ vận chuyển nhà xe chỉ được đọc nhà xe', async () => {
  for (const email of [VIEWER, BUS_VIEWER]) {
    const db = env.authenticatedContext(email, { email }).firestore()
    await assertSucceeds(getDoc(doc(db, 'transport_carriers', 'carrier-1')))
    await assertSucceeds(getDocs(collection(db, 'transport_carriers')))
    await assertFails(updateDoc(doc(db, 'transport_carriers', 'carrier-1'), {
      note: 'không được sửa',
      updated_by: email,
      updated_at: serverTimestamp(),
    }))
  }

  for (const email of [SHIPMENT_VIEWER, NONE]) {
    const db = env.authenticatedContext(email, { email }).firestore()
    await assertFails(getDoc(doc(db, 'transport_carriers', 'carrier-1')))
    await assertFails(getDocs(collection(db, 'transport_carriers')))
  }
})

test('transport_carriers.create chỉ tạo được document hợp lệ của chính người dùng', async () => {
  const db = env.authenticatedContext(CREATOR, { email: CREATOR }).firestore()
  await assertSucceeds(setDoc(doc(db, 'transport_carriers', 'carrier-new'), {
    ...carrier('carrier-new', {
      carrier_code: 'NX-NEW',
      carrier_name: 'Nhà xe Bắc Nam',
      carrier_address: 'Bến xe Nước Ngầm, Hà Nội',
      service_province_codes: [1, 31, 79],
      service_province_names: ['Thành phố Hà Nội', 'Thành phố Hải Phòng', 'Thành phố Hồ Chí Minh'],
      created_by: CREATOR,
      updated_by: CREATOR,
    }),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))

  await assertFails(setDoc(doc(db, 'transport_carriers', 'carrier-wrong-id'), {
    ...carrier('different-id', {
      carrier_code: 'NX-WRONG',
      created_by: CREATOR,
      updated_by: CREATOR,
    }),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
  await assertFails(updateDoc(doc(db, 'transport_carriers', 'carrier-1'), {
    note: 'quyền thêm không được sửa',
    updated_by: CREATOR,
    updated_at: serverTimestamp(),
  }))
})

test('transport_carriers.edit cập nhật thông tin nhưng không đổi định danh hoặc xóa mềm', async () => {
  const db = env.authenticatedContext(EDITOR, { email: EDITOR }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'transport_carriers', 'carrier-1'), {
    carrier_name: 'Nhà xe Miền Nam Mới',
    carrier_phone: '0911000000',
    carrier_address: 'Địa chỉ nhà xe mới',
    service_province_codes: [75, 79, 80],
    service_province_names: ['Tỉnh Đồng Nai', 'Thành phố Hồ Chí Minh', 'Tỉnh Long An'],
    service_district_codes: [740, 760, 803],
    service_district_names: ['Huyện Long Thành', 'Quận 1', 'Huyện Bến Lức'],
    driver_name: 'Trần Văn B',
    updated_by: EDITOR,
    updated_at: serverTimestamp(),
  }))
  await assertFails(updateDoc(doc(db, 'transport_carriers', 'carrier-1'), {
    carrier_code: 'NX-HACK',
    updated_by: EDITOR,
    updated_at: serverTimestamp(),
  }))
  await assertFails(updateDoc(doc(db, 'transport_carriers', 'carrier-1'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_by: EDITOR,
    deleted_at: serverTimestamp(),
    updated_by: EDITOR,
    updated_at: serverTimestamp(),
  }))
})

test('transport_carriers.delete chỉ xóa mềm và không được sửa nội dung hoặc xóa cứng', async () => {
  const db = env.authenticatedContext(DELETER, { email: DELETER }).firestore()
  await assertFails(updateDoc(doc(db, 'transport_carriers', 'carrier-1'), {
    carrier_name: 'Không được sửa bằng quyền xóa',
    updated_by: DELETER,
    updated_at: serverTimestamp(),
  }))
  await assertSucceeds(updateDoc(doc(db, 'transport_carriers', 'carrier-1'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_by: DELETER,
    deleted_at: serverTimestamp(),
    updated_by: DELETER,
    updated_at: serverTimestamp(),
  }))
  await assertFails(deleteDoc(doc(db, 'transport_carriers', 'carrier-1')))
})

test('quyền danh mục nhà xe không được ghi sang đơn hàng', async () => {
  for (const email of [CREATOR, EDITOR, DELETER]) {
    const db = env.authenticatedContext(email, { email }).firestore()
    await assertFails(updateDoc(doc(db, 'orders', 'order-1'), { note: 'không được phép' }))
  }
})
