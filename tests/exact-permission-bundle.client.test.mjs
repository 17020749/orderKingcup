import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolvePermissionDependencies } from '../constants/accessMatrix.mjs'
import { permissionDeniedMessage, scopedActionDecision } from '../utils/permissionDiagnostics.mjs'

const permissions = `customers.create, customers.delete, customers.edit, customers.orders_view, customers.view, export_requests.accept, export_requests.delete, export_requests.reject, export_requests.view, invoices.create, invoices.delete, invoices.edit, invoices.view, invoices.view_all, orders.delete, orders.edit, orders.export, orders.import, orders.view, orders.view_all, orders.warehouse_export, page.customers, page.export_requests, page.invoices, page.orders, page.payments, page.printing, page.products, page.shipments, page.warehouse_export_requests, page.warehouse_settings, payments.create, payments.delete, payments.edit, payments.export, payments.view, payments.view_all, printing.orders_view, printing.view, printing.view_all, products.view, shipments.create, shipments.delete, shipments.edit, shipments.view, shipments.view_all, suppliers.view, units.view, warehouses.view`
  .split(',').map(value => value.trim())

const cases = [
  ['orders.edit', 'orders.view_all', true],
  ['payments.edit', 'payments.view_all', true],
  ['invoices.edit', 'invoices.view_all', true],
  ['shipments.edit', 'shipments.view_all', true],
]

for (const [actionPermission, scopePermission, expected] of cases) {
  test(`bộ quyền test cho phép sửa toàn phạm vi: ${actionPermission}`, () => {
    assert.equal(scopedActionDecision({
      permissions,
      actionPermission,
      scopePermission,
      ownsRecord: false,
      operation: 'sửa dữ liệu',
    }).allowed, expected)
  })
}

test('yêu cầu xuất kho của sale khác báo chính xác thiếu export_requests.view_all', () => {
  const decision = scopedActionDecision({
    permissions,
    actionPermission: 'orders.warehouse_export',
    scopePermission: 'export_requests.view_all',
    ownsRecord: false,
    operation: 'sửa yêu cầu xuất kho',
    recordLabel: 'YCXK-TEST',
  })
  assert.equal(decision.allowed, false)
  assert.deepEqual(decision.missingPermissions, ['export_requests.view_all'])
  assert.match(decision.message, /\[export_requests\.view_all\]/)
})

test('các page chỉ có quyền xem báo đúng quyền sửa còn thiếu', () => {
  const expected = [
    ['printing.edit', 'printing.view_all'],
    ['products.edit', ''],
    ['warehouses.manage', ''],
    ['suppliers.manage', ''],
    ['units.manage', ''],
  ]
  for (const [actionPermission, scopePermission] of expected) {
    const decision = scopedActionDecision({
      permissions, actionPermission, scopePermission, ownsRecord: false, operation: 'sửa dữ liệu',
    })
    assert.equal(decision.allowed, false)
    assert.match(decision.message, new RegExp(actionPermission.replace('.', '\\.')))
  }
})

test('permission-denied phân biệt thiếu quyền và lỗi ràng buộc dữ liệu', () => {
  assert.match(permissionDeniedMessage({
    currentPermissions: permissions,
    requiredAll: ['printing.edit'],
    operation: 'sửa tiến độ in',
  }), /thiếu \[printing\.edit\]/)

  assert.match(permissionDeniedMessage({
    currentPermissions: permissions,
    requiredAll: ['payments.edit', 'payments.view_all'],
    operation: 'sửa thanh toán',
    diagnosticCode: 'PAYMENTS_UPDATE_RULES',
  }), /Không thiếu quyền client.*PAYMENTS_UPDATE_RULES/)
})

test('tick view_all kéo theo trực tiếp page và quyền view tương ứng', () => {
  const expectations = {
    'orders.view_all': ['page.orders', 'orders.view'],
    'export_requests.view_all': ['page.export_requests', 'export_requests.view', 'orders.view_all'],
    'payments.view_all': ['page.payments', 'payments.view', 'orders.view_all'],
    'invoices.view_all': ['page.invoices', 'invoices.view', 'orders.view_all'],
    'shipments.view_all': ['page.shipments', 'shipments.view', 'orders.view_all'],
    'printing.view_all': ['page.printing', 'printing.view'],
  }
  for (const [viewAll, dependencies] of Object.entries(expectations)) {
    const resolved = resolvePermissionDependencies([viewAll])
    for (const dependency of dependencies) assert.equal(resolved.includes(dependency), true, `${viewAll} thiếu ${dependency}`)
  }
})

test('modal role chuẩn hóa dependency ngay khi mở và export request dùng guard theo row', () => {
  const usersPage = readFileSync('pages/settings/users.vue', 'utf8')
  const exportPage = readFileSync('pages/export-requests.vue', 'utf8')
  assert.match(usersPage, /permissions: resolvePermissionDependencies\(row\.permissions \|\| \[\]\)/)
  assert.match(exportPage, /function canEditRequest\(row: any\)/)
  assert.match(exportPage, /v-if="[\s\S]*?canEditRequest\(row\)/)
})


test('payment, invoice và shipment dùng cùng guard cho button, modal, save và delete', () => {
  const pages = {
    payments: readFileSync('pages/payments.vue', 'utf8'),
    invoices: readFileSync('pages/invoices.vue', 'utf8'),
    shipments: readFileSync('pages/shipments.vue', 'utf8'),
  }
  for (const [module, source] of Object.entries(pages)) {
    const singular = module.slice(0, -1)
    assert.match(source, new RegExp(`function ${singular}ActionDecision`))
    assert.match(source, new RegExp(`scopePermission: '${module}\\.view_all'`))
    assert.match(source, new RegExp(`canEdit${module[0].toUpperCase() + module.slice(1)}Row\\(row\\)`))
    assert.match(source, new RegExp(`canDelete${module[0].toUpperCase() + module.slice(1)}Row\\(row\\)`))
  }
})

test('các page CRUD không còn thông báo quyền tạo sửa xóa chung chung', () => {
  const paths = [
    'pages/payments.vue', 'pages/invoices.vue', 'pages/shipments.vue',
    'pages/customers/index.vue', 'pages/products.vue', 'pages/printing.vue',
    'pages/imports.vue', 'pages/exports.vue', 'pages/warehouse-settings.vue',
  ]
  for (const path of paths) {
    const source = readFileSync(path, 'utf8')
    assert.doesNotMatch(source, /Bạn không có quyền (tạo|thêm|sửa|xóa|quản lý)/, path)
  }
})
