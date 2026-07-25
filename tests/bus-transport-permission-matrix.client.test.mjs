import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  APP_ACCESS_MODULES,
  findAppAccessRule,
  resolvePermissionDependencies,
} from '../constants/accessMatrix.mjs'

test('các module vận chuyển nằm trong nhóm Thông tin vận chuyển', () => {
  assert.deepEqual(APP_ACCESS_MODULES.find(module => module.key === 'bus_transport'), {
    key: 'bus_transport',
    path: '/bus-transport',
    label: 'Vận chuyển nhà xe',
    permission: 'page.bus_transport',
    navSection: 'transport',
    navOrder: 20,
  })
  assert.deepEqual(APP_ACCESS_MODULES.find(module => module.key === 'transport_carriers'), {
    key: 'transport_carriers',
    path: '/transport-carriers',
    label: 'Danh sách nhà xe',
    permission: 'page.transport_carriers',
    navSection: 'transport',
    navOrder: 30,
  })
  assert.equal(findAppAccessRule('/bus-transport')?.permission, 'page.bus_transport')
  assert.equal(findAppAccessRule('/transport-carriers')?.permission, 'page.transport_carriers')
})

test('CRUD vận chuyển nhà xe chỉ phụ thuộc page và quyền xem của module', () => {
  for (const action of ['create', 'edit', 'delete']) {
    const grants = new Set(resolvePermissionDependencies([`bus_transport.${action}`]))
    for (const expected of [`bus_transport.${action}`, 'bus_transport.view', 'page.bus_transport']) {
      assert.equal(grants.has(expected), true, `${action} thiếu ${expected}`)
    }
    for (const unrelated of [
      'orders.view',
      'orders.view_all',
      'customers.view',
      'customers.view_all',
      'shipments.view',
      'shipments.view_all',
      'transport_carriers.create',
      'transport_carriers.edit',
      'transport_carriers.delete',
      'export.view',
      'page.exports',
      'page.warehouse_export_requests',
    ]) {
      assert.equal(grants.has(unrelated), false, `${action} không được tự cấp ${unrelated}`)
    }
  }
})

test('CRUD danh sách nhà xe có bốn quyền riêng và không kéo quyền vận chuyển', () => {
  for (const action of ['create', 'edit', 'delete']) {
    const grants = new Set(resolvePermissionDependencies([`transport_carriers.${action}`]))
    for (const expected of [`transport_carriers.${action}`, 'transport_carriers.view', 'page.transport_carriers']) {
      assert.equal(grants.has(expected), true, `${action} thiếu ${expected}`)
    }
    for (const unrelated of [
      'bus_transport.view',
      'bus_transport.create',
      'shipments.view',
      'shipments.create',
      'orders.view',
      'customers.view',
    ]) {
      assert.equal(grants.has(unrelated), false, `${action} không được tự cấp ${unrelated}`)
    }
  }
})

test('permission catalog có namespace nhà xe riêng, không tạo view_all', () => {
  const source = readFileSync('constants/permissions.ts', 'utf8')
  for (const key of [
    'page.bus_transport',
    'bus_transport.view',
    'bus_transport.create',
    'bus_transport.edit',
    'bus_transport.delete',
    'page.transport_carriers',
    'transport_carriers.view',
    'transport_carriers.create',
    'transport_carriers.edit',
    'transport_carriers.delete',
  ]) {
    assert.match(source, new RegExp(`key: '${key.replace('.', '\\.')}'`))
  }
  assert.doesNotMatch(source, /bus_transport\.view_all/)
  assert.doesNotMatch(source, /transport_carriers\.view_all/)
})

test('rules giữ module vận chuyển độc lập và thêm catalog nhà xe riêng', () => {
  const rules = readFileSync('firestore.rules', 'utf8')
  assert.match(rules, /match \/bus_transport_orders\/\{docId\}/)
  assert.match(rules, /allow read: if hasPerm\('bus_transport\.view'\)/)
  assert.match(rules, /order_export_requests[\s\S]*bus_transport\.view/)
  assert.doesNotMatch(rules, /match \/orders\/\{docId\}[\s\S]{0,500}hasPerm\('bus_transport\.view'\)/)
  assert.doesNotMatch(rules, /match \/customers\/\{docId\}[\s\S]{0,500}'bus_transport\.view'/)
  assert.doesNotMatch(rules, /match \/customers\/\{docId\}[\s\S]{0,500}'export\.print'/)
  assert.doesNotMatch(rules, /allow (create|update): if hasPerm\('bus_transport\.view'\)/)
  assert.match(rules, /match \/transport_carriers\/\{docId\}/)
  assert.match(rules, /hasPerm\('transport_carriers\.create'\)/)
  assert.match(rules, /hasPerm\('transport_carriers\.edit'\)/)
  assert.match(rules, /hasPerm\('transport_carriers\.delete'\)/)
  assert.match(rules, /requestSnapshotAllowsExportItem/)
})
