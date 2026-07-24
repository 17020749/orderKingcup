import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  APP_ACCESS_MODULES,
  findAppAccessRule,
  resolvePermissionDependencies,
} from '../constants/accessMatrix.mjs'

test('module vận chuyển nhà xe có route và permission riêng', () => {
  assert.deepEqual(APP_ACCESS_MODULES.find(module => module.key === 'bus_transport'), {
    key: 'bus_transport',
    path: '/bus-transport',
    label: 'Vận chuyển nhà xe',
    permission: 'page.bus_transport',
    navSection: 'warehouse',
    navOrder: 80,
  })
  assert.equal(findAppAccessRule('/bus-transport')?.permission, 'page.bus_transport')
})

test('CRUD nhà xe chỉ phụ thuộc page và quyền xem của module mới', () => {
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
      'export.view',
      'page.exports',
      'page.warehouse_export_requests',
    ]) {
      assert.equal(grants.has(unrelated), false, `${action} không được tự cấp ${unrelated}`)
    }
  }
})

test('permission catalog giữ nguyên namespace, không tạo view_all', () => {
  const source = readFileSync('constants/permissions.ts', 'utf8')
  for (const key of [
    'page.bus_transport',
    'bus_transport.view',
    'bus_transport.create',
    'bus_transport.edit',
    'bus_transport.delete',
  ]) {
    assert.match(source, new RegExp(`key: '${key.replace('.', '\\.')}'`))
  }
  assert.doesNotMatch(source, /bus_transport\.view_all/)
})

test('rules chỉ mở request snapshot và không cấp quyền đọc hoặc ghi collection cũ', () => {
  const rules = readFileSync('firestore.rules', 'utf8')
  assert.match(rules, /match \/bus_transport_orders\/\{docId\}/)
  assert.match(rules, /allow read: if hasPerm\('bus_transport\.view'\)/)
  assert.match(rules, /order_export_requests[\s\S]*bus_transport\.view/)
  assert.doesNotMatch(rules, /match \/orders\/\{docId\}[\s\S]{0,500}hasPerm\('bus_transport\.view'\)/)
  assert.doesNotMatch(rules, /match \/customers\/\{docId\}[\s\S]{0,500}'bus_transport\.view'/)
  assert.doesNotMatch(rules, /match \/customers\/\{docId\}[\s\S]{0,500}'export\.print'/)
  assert.doesNotMatch(rules, /allow (create|update): if hasPerm\('bus_transport\.view'\)/)
  assert.match(rules, /requestSnapshotAllowsExportItem/)
})
