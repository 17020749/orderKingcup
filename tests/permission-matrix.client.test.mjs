import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  APP_ACCESS_MODULES,
  NON_ASSIGNABLE_PERMISSION_KEYS,
  accessModulesForNavigation,
  findAppAccessRule,
  firstAllowedAccessModule,
  missingPermissionDependencies,
  removePermissionWithDependents,
  resolvePermissionDependencies,
} from '../constants/accessMatrix.mjs'

function grantSet(permission) {
  return new Set(resolvePermissionDependencies([permission]))
}

test('route và sidebar dùng một manifest, không có path hoặc key trùng', () => {
  assert.equal(new Set(APP_ACCESS_MODULES.map(module => module.path)).size, APP_ACCESS_MODULES.length)
  assert.equal(new Set(APP_ACCESS_MODULES.map(module => module.key)).size, APP_ACCESS_MODULES.length)
  assert.deepEqual(
    accessModulesForNavigation().map(module => module.key),
    APP_ACCESS_MODULES.slice().sort((left, right) => {
      const sectionOrder = { business: 10, warehouse: 20, standalone: 30, settings: 40 }
      return sectionOrder[left.navSection] - sectionOrder[right.navSection]
        || left.navOrder - right.navOrder
    }).map(module => module.key),
  )
})

test('hóa đơn xuất hiện trong menu Kinh doanh và route dùng đúng quyền', () => {
  const invoice = APP_ACCESS_MODULES.find(module => module.key === 'invoices')
  assert.deepEqual(invoice, {
    key: 'invoices',
    path: '/invoices',
    label: 'Hóa đơn',
    permission: 'page.invoices',
    navSection: 'business',
    navOrder: 60,
  })
  assert.equal(findAppAccessRule('/invoices/INV-001')?.key, 'invoices')
})

test('luồng tạo đơn tự có quyền mở trang, xem đơn, khách hàng và sản phẩm', () => {
  const grants = grantSet('orders.create')
  for (const required of [
    'orders.create',
    'page.orders',
    'orders.view',
    'customers.view',
    'page.customers',
    'products.view',
    'page.products',
  ]) {
    assert.equal(grants.has(required), true, `Thiếu ${required}`)
  }
  assert.deepEqual(missingPermissionDependencies([...grants]), [])
})

test('luồng Sale tạo yêu cầu xuất tự có quyền xem đơn và mở đúng hai page', () => {
  const grants = grantSet('orders.warehouse_export')
  for (const required of [
    'orders.warehouse_export',
    'page.export_requests',
    'export_requests.view',
    'orders.view',
    'page.orders',
  ]) {
    assert.equal(grants.has(required), true, `Thiếu ${required}`)
  }
})

test('luồng Kho cho xuất tự có quyền xử lý, xem tồn và xem phiếu xuất', () => {
  const grants = grantSet('export_requests.release')
  for (const required of [
    'export_requests.release',
    'page.warehouse_export_requests',
    'inventory.view',
    'page.inventory',
    'export.view',
    'page.exports',
  ]) {
    assert.equal(grants.has(required), true, `Thiếu ${required}`)
  }
})

test('luồng tạo tiến độ in tự có quyền mở page, xem tiến độ và lấy đơn nguồn', () => {
  const grants = grantSet('printing.create')
  for (const required of [
    'printing.create',
    'page.printing',
    'printing.view',
    'printing.orders_view',
  ]) {
    assert.equal(grants.has(required), true, `Thiếu ${required}`)
  }
})

test('luồng thanh toán tự có quyền mở thanh toán và đọc đơn nguồn', () => {
  const grants = grantSet('payments.create')
  for (const required of [
    'payments.create',
    'page.payments',
    'payments.view',
    'orders.view',
    'page.orders',
  ]) {
    assert.equal(grants.has(required), true, `Thiếu ${required}`)
  }
})

test('bỏ quyền xem đơn sẽ tự bỏ các quyền nghiệp vụ đang phụ thuộc', () => {
  const before = resolvePermissionDependencies(['orders.create', 'orders.edit', 'orders.delete'])
  const after = removePermissionWithDependents(before, 'orders.view')

  for (const removed of ['orders.view', 'page.orders', 'orders.create', 'orders.edit', 'orders.delete']) {
    assert.equal(after.includes(removed), false, `${removed} chưa bị loại`)
  }
  assert.equal(after.includes('customers.view'), true)
  assert.equal(after.includes('products.view'), true)
})

test('quyền users/roles không thể cấp riêng cho role thường', () => {
  assert.deepEqual(
    resolvePermissionDependencies([
      'users.view',
      'users.manage',
      'roles.view',
      'roles.manage',
    ]),
    [],
  )
  assert.deepEqual(NON_ASSIGNABLE_PERMISSION_KEYS.sort(), [
    'roles.manage',
    'roles.view',
    'users.manage',
    'users.view',
  ])
  assert.deepEqual(resolvePermissionDependencies(['*', 'orders.view']), ['*'])
})

test('resolve dependency ổn định và không sinh quyền thiếu sau lần hai', () => {
  const once = resolvePermissionDependencies([
    'orders.create',
    'export_requests.release',
    'printing.create',
    'payments.create',
  ])
  const twice = resolvePermissionDependencies(once)
  assert.deepEqual(twice, once)
  assert.deepEqual(missingPermissionDependencies(once), [])
})

test('điều hướng đầu tiên tôn trọng quyền page và route admin-only', () => {
  assert.equal(firstAllowedAccessModule(['page.orders'])?.key, 'orders')
  assert.equal(firstAllowedAccessModule([], true)?.key, 'settings_users')
  assert.equal(findAppAccessRule('/settings/permission-audit')?.adminOnly, true)
})

test('client thật đã nối role editor, sidebar và middleware vào ma trận', () => {
  const roleEditor = readFileSync('pages/settings/users.vue', 'utf8')
  const appShell = readFileSync('components/AppShell.vue', 'utf8')
  const middleware = readFileSync('middleware/auth.global.ts', 'utf8')
  const routes = readFileSync('constants/appRoutes.ts', 'utf8')

  assert.match(roleEditor, /resolvePermissionDependencies/)
  assert.match(roleEditor, /removePermissionWithDependents/)
  assert.match(roleEditor, /missingPermissionDependencies/)
  assert.match(roleEditor, /permissions: normalizedPermissions/)
  assert.doesNotMatch(roleEditor, /roleForm\.permissions\.push\(key\)/)
  assert.match(appShell, /accessModulesForNavigation/)
  assert.doesNotMatch(appShell, /const navGroups/)
  assert.match(middleware, /appRoutePermission\(to\.path\)/)
  assert.match(routes, /APP_ACCESS_MODULES\.map/)
})
