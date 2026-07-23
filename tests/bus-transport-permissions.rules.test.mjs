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

const projectId = 'demo-bus-transport-permissions'
const VIEWER = 'viewer@example.com'
const CREATOR = 'creator@example.com'
const EDITOR = 'editor@example.com'
const DELETER = 'deleter@example.com'
const NONE = 'none@example.com'
let env

function activeUser(permissions) {
  return {
    active: true,
    deleted: false,
    status: 'active',
    permissions_flat: permissions,
  }
}

function exportOrder(id = 'exp-1') {
  return {
    id,
    code: 'PXK-001',
    export_code: 'PXK-001',
    lifecycle_status: 'released',
    status: 'completed',
    active: true,
    deleted: false,
    created_by: 'warehouse@example.com',
  }
}

function exportItem(id = 'exp-item-1') {
  return {
    id,
    export_order_id: 'exp-1',
    product_id: 'product-1',
    product_code: 'SP-001',
    product_name: 'Cốc giấy',
    logo: 'KINGCUP',
    quantity: 100,
    active: true,
    deleted: false,
    created_by: 'warehouse@example.com',
  }
}

function transport(id = 'bus-1', overrides = {}) {
  return {
    id,
    transport_code: 'VCNX-001',
    export_order_id: 'exp-1',
    export_order_code: 'PXK-001',
    carrier_name: 'Nhà xe A',
    carrier_phone: '',
    vehicle_plate: '',
    driver_name: '',
    departure_at: '',
    receiver_name: 'Khách hàng A',
    receiver_phone: '',
    receiver_address: '',
    transport_status: 'Chờ xuất phát',
    note: '',
    status: 'active',
    active: true,
    deleted: false,
    created_by: VIEWER,
    created_at: new Date('2026-07-23T00:00:00Z'),
    updated_by: VIEWER,
    updated_at: new Date('2026-07-23T00:00:00Z'),
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
      setDoc(doc(db, 'users', VIEWER), activeUser(['bus_transport.view'])),
      setDoc(doc(db, 'users', CREATOR), activeUser(['bus_transport.view', 'bus_transport.create'])),
      setDoc(doc(db, 'users', EDITOR), activeUser(['bus_transport.view', 'bus_transport.edit'])),
      setDoc(doc(db, 'users', DELETER), activeUser(['bus_transport.view', 'bus_transport.delete'])),
      setDoc(doc(db, 'users', NONE), activeUser([])),
      setDoc(doc(db, 'export_orders', 'exp-1'), exportOrder()),
      setDoc(doc(db, 'export_order_items', 'exp-item-1'), exportItem()),
      setDoc(doc(db, 'bus_transport_orders', 'bus-1'), transport()),
    ])
  })
})

after(async () => env.cleanup())

test('bus_transport.view đọc toàn bộ module và dữ liệu phiếu xuất nguồn', async () => {
  const db = env.authenticatedContext(VIEWER, { email: VIEWER }).firestore()
  await assertSucceeds(getDocs(collection(db, 'bus_transport_orders')))
  await assertSucceeds(getDoc(doc(db, 'export_orders', 'exp-1')))
  await assertSucceeds(getDoc(doc(db, 'export_order_items', 'exp-item-1')))
})

test('không có bus_transport.view thì không đọc được module mới', async () => {
  const db = env.authenticatedContext(NONE, { email: NONE }).firestore()
  await assertFails(getDoc(doc(db, 'bus_transport_orders', 'bus-1')))
})

test('bus_transport.create chỉ tạo được document hợp lệ của chính tài khoản', async () => {
  const db = env.authenticatedContext(CREATOR, { email: CREATOR }).firestore()
  await assertSucceeds(setDoc(doc(db, 'bus_transport_orders', 'bus-new'), {
    ...transport('bus-new', {
      transport_code: 'VCNX-NEW',
      created_by: CREATOR,
      updated_by: CREATOR,
    }),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
  await assertFails(setDoc(doc(db, 'bus_transport_orders', 'bus-wrong-owner'), {
    ...transport('bus-wrong-owner', {
      created_by: VIEWER,
      updated_by: VIEWER,
    }),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
})

test('bus_transport.edit sửa thông tin nhà xe nhưng không đổi liên kết phiếu xuất', async () => {
  const db = env.authenticatedContext(EDITOR, { email: EDITOR }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'bus_transport_orders', 'bus-1'), {
    carrier_name: 'Nhà xe B',
    vehicle_plate: '15C-12345',
    updated_by: EDITOR,
    updated_at: serverTimestamp(),
  }))
  await assertFails(updateDoc(doc(db, 'bus_transport_orders', 'bus-1'), {
    export_order_id: 'exp-other',
    updated_by: EDITOR,
    updated_at: serverTimestamp(),
  }))
})

test('bus_transport.delete chỉ xóa mềm, không được xóa cứng', async () => {
  const db = env.authenticatedContext(DELETER, { email: DELETER }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'bus_transport_orders', 'bus-1'), {
    deleted: true,
    active: false,
    status: 'deleted',
    deleted_by: DELETER,
    deleted_at: serverTimestamp(),
    updated_by: DELETER,
    updated_at: serverTimestamp(),
  }))
  await assertFails(deleteDoc(doc(db, 'bus_transport_orders', 'bus-1')))
})

test('quyền module nhà xe không cấp quyền ghi phiếu xuất kho', async () => {
  const db = env.authenticatedContext(CREATOR, { email: CREATOR }).firestore()
  await assertFails(updateDoc(doc(db, 'export_orders', 'exp-1'), {
    note: 'không được phép',
  }))
  await assertFails(setDoc(doc(db, 'export_order_items', 'exp-item-new'), exportItem('exp-item-new')))
})
