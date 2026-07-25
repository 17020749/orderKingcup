import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const carrierPage = readFileSync('pages/transport-carriers.vue', 'utf8')
const shipmentsPage = readFileSync('pages/shipments.vue', 'utf8')
const busTransportPage = readFileSync('pages/bus-transport.vue', 'utf8')
const accessMatrix = readFileSync('constants/accessMatrix.mjs', 'utf8')
const permissions = readFileSync('constants/permissions.ts', 'utf8')

test('danh sách nhà xe có page riêng và bốn quyền CRUD độc lập', () => {
  assert.match(accessMatrix, /path: '\/transport-carriers'/)
  assert.match(accessMatrix, /label: 'Danh sách nhà xe'/)
  for (const permission of [
    'transport_carriers.view',
    'transport_carriers.create',
    'transport_carriers.edit',
    'transport_carriers.delete',
  ]) {
    assert.match(permissions, new RegExp(`key: '${permission.replace('.', '\\.')}'`))
    assert.match(carrierPage, new RegExp(`hasPermission\\('${permission.replace('.', '\\.')}'\\)`))
  }
})

test('ba page được gom trong nhóm Thông tin vận chuyển', () => {
  assert.match(accessMatrix, /key: 'transport', label: 'Thông tin vận chuyển'/)
  for (const key of ['shipments', 'bus_transport', 'transport_carriers']) {
    assert.match(accessMatrix, new RegExp(`key: '${key}'[\\s\\S]{0,180}navSection: 'transport'`))
  }
})

test('hai nghiệp vụ vận chuyển đọc danh mục và lưu ID cùng snapshot nhà xe', () => {
  for (const source of [shipmentsPage, busTransportPage]) {
    assert.match(source, /collection\(db, 'transport_carriers'\)/)
    assert.match(source, /SearchableSelect v-model="form\.transport_carrier_id"/)
    assert.match(source, /transport_carrier_id:/)
    assert.match(source, /carrier_phone:/)
    assert.match(source, /vehicle_plate:/)
    assert.match(source, /driver_name:/)
  }
  assert.match(shipmentsPage, /carrier: carrier\.carrier_name/)
  assert.match(busTransportPage, /carrier_name: carrier\.carrier_name/)
})

test('thông tin snapshot trên form vận chuyển là chỉ đọc', () => {
  for (const field of ['carrier_phone', 'vehicle_plate', 'driver_name']) {
    assert.match(shipmentsPage, new RegExp(`v-model="form\\.${field}"[^>]*readonly`))
    assert.match(busTransportPage, new RegExp(`v-model="form\\.${field}"[^>]*readonly`))
  }
  assert.match(busTransportPage, /v-model="form\.carrier_name"[^>]*readonly/)
})

test('page danh mục chỉ ghi collection transport_carriers', () => {
  assert.match(carrierPage, /doc\(db, 'transport_carriers'/)
  assert.match(carrierPage, /collection\(db, 'transport_carriers'\)/)
  assert.doesNotMatch(carrierPage, /doc\(db, '(orders|customers|shipments|bus_transport_orders)'/)
})
