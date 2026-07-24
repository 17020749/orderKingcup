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
const PRINTER = 'printer@example.com'
const NONE = 'none@example.com'
let env

function activeUser(permissions) {
  return { active: true, deleted: false, status: 'active', permissions_flat: permissions }
}

function order(id = 'order-1') {
  return {
    id,
    order_code: 'DH-001',
    customer_id: 'customer-1',
    customer_name: 'Tên dự phòng',
    owner_email: 'sale@example.com',
    created_by: 'sale@example.com',
    sale_email: 'sale@example.com',
    active: true,
    deleted: false,
  }
}

function customer(id = 'customer-1') {
  return {
    id,
    customer_code: 'KH-001',
    customer_name: 'Khách hàng chuẩn',
    phone: '0909000000',
    shipping_address: 'Địa chỉ giao hàng chuẩn',
    billing_address: 'Địa chỉ hóa đơn',
    created_by: 'sale@example.com',
    active: true,
    deleted: false,
  }
}

function request(id = 'request-1', overrides = {}) {
  return {
    id,
    request_id: 'YCXK-001',
    order_id: 'order-1',
    order_code: 'DH-001',
    customer_id: 'customer-1',
    customer_name: 'Khách hàng chuẩn',
    receiver_name: 'Khách hàng chuẩn',
    receiver_phone: '0909000000',
    receiver_address: 'Địa chỉ giao hàng chuẩn',
    request_snapshot_version: 1,
    source_items: {},
    status: 'cho_xu_ly',
    payload_json: JSON.stringify({
      receiver_name: 'Khách hàng chuẩn',
      receiver_phone: '0909000000',
      receiver_address: 'Địa chỉ giao hàng chuẩn',
      items: [{ product_code: 'SP-001', product_name: 'Cốc giấy', logo: 'KINGCUP', export_quantity: 100 }],
    }),
    requested_by: 'sale@example.com',
    order_owner_email: 'sale@example.com',
    order_created_by: 'sale@example.com',
    order_sale_email: 'sale@example.com',
    active: true,
    deleted: false,
    ...overrides,
  }
}

function transport(id = 'bus-1', overrides = {}) {
  return {
    id,
    transport_code: 'VCNX-001',
    source_request_id: 'request-1',
    request_code: 'YCXK-001',
    request_status: 'cho_xu_ly',
    export_order_id: '',
    export_order_code: '',
    order_id: 'order-1',
    order_code: 'DH-001',
    customer_id: 'customer-1',
    customer_name: 'Khách hàng chuẩn',
    carrier_name: 'Nhà xe A',
    carrier_phone: '',
    vehicle_plate: '',
    driver_name: '',
    departure_at: '',
    receiver_name: 'Khách hàng chuẩn',
    receiver_phone: '0909000000',
    receiver_address: 'Địa chỉ giao hàng chuẩn',
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
      setDoc(doc(db, 'users', PRINTER), activeUser(['export.view', 'export.print'])),
      setDoc(doc(db, 'users', NONE), activeUser([])),
      setDoc(doc(db, 'orders', 'order-1'), order()),
      setDoc(doc(db, 'customers', 'customer-1'), customer()),
      setDoc(doc(db, 'order_export_requests', 'request-1'), request()),
      setDoc(doc(db, 'order_export_requests', 'request-rejected'), request('request-rejected', { request_id: 'YCXK-REJECT', status: 'tu_choi' })),
      setDoc(doc(db, 'bus_transport_orders', 'bus-1'), transport()),
    ])
  })
})

after(async () => env.cleanup())

test('bus_transport.view chỉ đọc module và snapshot yêu cầu, không đọc đơn hoặc khách hàng', async () => {
  const db = env.authenticatedContext(VIEWER, { email: VIEWER }).firestore()
  await assertSucceeds(getDocs(collection(db, 'bus_transport_orders')))
  await assertSucceeds(getDocs(collection(db, 'order_export_requests')))
  await assertFails(getDocs(collection(db, 'orders')))
  await assertFails(getDoc(doc(db, 'orders', 'order-1')))
  await assertFails(getDoc(doc(db, 'customers', 'customer-1')))
  await assertFails(getDocs(collection(db, 'customers')))
})

test('export.print không tự cấp quyền đọc bảng khách hàng', async () => {
  const db = env.authenticatedContext(PRINTER, { email: PRINTER }).firestore()
  await assertFails(getDoc(doc(db, 'customers', 'customer-1')))
  await assertFails(getDocs(collection(db, 'customers')))
})

test('không có bus_transport.view thì không đọc được module mới', async () => {
  const db = env.authenticatedContext(NONE, { email: NONE }).firestore()
  await assertFails(getDoc(doc(db, 'bus_transport_orders', 'bus-1')))
  await assertFails(getDocs(collection(db, 'order_export_requests')))
})

test('bus_transport.create tạo từ yêu cầu hợp lệ và chặn yêu cầu từ chối', async () => {
  const db = env.authenticatedContext(CREATOR, { email: CREATOR }).firestore()
  await assertSucceeds(setDoc(doc(db, 'bus_transport_orders', 'bus-new'), {
    ...transport('bus-new', { transport_code: 'VCNX-NEW', created_by: CREATOR, updated_by: CREATOR }),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
  await assertFails(setDoc(doc(db, 'bus_transport_orders', 'bus-rejected'), {
    ...transport('bus-rejected', {
      transport_code: 'VCNX-REJECT',
      source_request_id: 'request-rejected',
      request_code: 'YCXK-REJECT',
      request_status: 'tu_choi',
      created_by: CREATOR,
      updated_by: CREATOR,
    }),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }))
})

test('bus_transport.edit sửa thông tin nhà xe nhưng không đổi liên kết yêu cầu', async () => {
  const db = env.authenticatedContext(EDITOR, { email: EDITOR }).firestore()
  await assertSucceeds(updateDoc(doc(db, 'bus_transport_orders', 'bus-1'), {
    carrier_name: 'Nhà xe B',
    vehicle_plate: '15C-12345',
    updated_by: EDITOR,
    updated_at: serverTimestamp(),
  }))
  await assertFails(updateDoc(doc(db, 'bus_transport_orders', 'bus-1'), {
    source_request_id: 'request-other',
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

test('quyền nhà xe không được ghi đơn, khách hàng hoặc yêu cầu xuất', async () => {
  const db = env.authenticatedContext(CREATOR, { email: CREATOR }).firestore()
  await assertFails(updateDoc(doc(db, 'orders', 'order-1'), { note: 'không được phép' }))
  await assertFails(updateDoc(doc(db, 'customers', 'customer-1'), { phone: '000' }))
  await assertFails(updateDoc(doc(db, 'order_export_requests', 'request-1'), { warehouse_note: 'không được phép' }))
})
