import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  exportRequestActionDecision,
  moduleActionDecision,
  moduleViewDecision,
} from '../utils/permissionDecisions.mjs'
import { resolvePermissionDependencies } from '../constants/accessMatrix.mjs'

const OWNER = 'owner@example.com'
const OTHER = 'other@example.com'
const ownRecord = { id: 'own', created_by: OWNER }
const foreignRecord = { id: 'foreign', created_by: OTHER }

test('ma trận chung tách độc lập view, view_all và action', () => {
  assert.equal(moduleViewDecision({
    viewPermission: 'payments.view',
    viewAllPermission: 'payments.view_all',
    permissions: ['payments.view'],
    record: ownRecord,
    currentUserEmail: OWNER,
  }).allowed, true)

  assert.equal(moduleViewDecision({
    viewPermission: 'payments.view',
    viewAllPermission: 'payments.view_all',
    permissions: ['payments.view'],
    record: foreignRecord,
    currentUserEmail: OWNER,
  }).allowed, false)

  assert.equal(moduleActionDecision({
    actionPermission: 'payments.edit',
    viewAllPermission: 'payments.view_all',
    permissions: ['payments.edit'],
    record: ownRecord,
    currentUserEmail: OWNER,
  }).allowed, true)

  const foreignWithoutScope = moduleActionDecision({
    actionPermission: 'payments.edit',
    viewAllPermission: 'payments.view_all',
    permissions: ['payments.edit'],
    record: foreignRecord,
    currentUserEmail: OWNER,
  })
  assert.equal(foreignWithoutScope.allowed, false)
  assert.equal(foreignWithoutScope.code, 'missing_scope')
  assert.deepEqual(foreignWithoutScope.missingPermissions, ['payments.view_all'])

  const scopeWithoutAction = moduleActionDecision({
    actionPermission: 'payments.edit',
    viewAllPermission: 'payments.view_all',
    permissions: ['payments.view_all'],
    record: foreignRecord,
    currentUserEmail: OWNER,
  })
  assert.equal(scopeWithoutAction.allowed, false)
  assert.equal(scopeWithoutAction.code, 'missing_action')
  assert.deepEqual(scopeWithoutAction.missingPermissions, ['payments.edit'])

  assert.equal(moduleActionDecision({
    actionPermission: 'payments.edit',
    viewAllPermission: 'payments.view_all',
    permissions: ['payments.edit', 'payments.view_all'],
    record: foreignRecord,
    currentUserEmail: OWNER,
  }).allowed, true)
})

test('business constraint chặn action kể cả khi có view_all và action', () => {
  const decision = moduleActionDecision({
    actionPermission: 'orders.delete',
    viewAllPermission: 'orders.view_all',
    permissions: ['orders.delete', 'orders.view_all'],
    record: foreignRecord,
    currentUserEmail: OWNER,
    businessAllowed: false,
    businessCode: 'order_locked',
  })
  assert.equal(decision.allowed, false)
  assert.equal(decision.code, 'order_locked')
})

test('export request dùng scope của chính module và delete không nhận orders.delete thay thế', () => {
  const foreignOrder = {
    id: 'order-other', owner_email: OTHER, created_by: OTHER, sale_email: OTHER,
  }
  const foreignRequest = {
    id: 'request-other', order_id: foreignOrder.id, requested_by: OTHER, created_by: OTHER,
    status: 'cho_xu_ly', warehouse_export_code: '', active_export_order_id: '',
  }

  assert.equal(exportRequestActionDecision({
    action: 'create',
    order: foreignOrder,
    permissions: ['orders.warehouse_export'],
    currentUserEmail: OWNER,
  }).allowed, false)

  assert.equal(exportRequestActionDecision({
    action: 'create',
    order: foreignOrder,
    permissions: ['orders.warehouse_export', 'export_requests.view_all'],
    currentUserEmail: OWNER,
  }).allowed, true)

  assert.equal(exportRequestActionDecision({
    action: 'edit',
    request: foreignRequest,
    order: foreignOrder,
    permissions: ['orders.warehouse_export', 'export_requests.view_all'],
    currentUserEmail: OWNER,
  }).allowed, true)

  const wrongDeletePermission = exportRequestActionDecision({
    action: 'delete',
    request: foreignRequest,
    order: foreignOrder,
    permissions: ['orders.delete', 'export_requests.view_all'],
    currentUserEmail: OWNER,
  })
  assert.equal(wrongDeletePermission.allowed, false)
  assert.deepEqual(wrongDeletePermission.missingPermissions, ['export_requests.delete'])

  assert.equal(exportRequestActionDecision({
    action: 'delete',
    request: foreignRequest,
    order: foreignOrder,
    permissions: ['export_requests.delete', 'export_requests.view_all'],
    currentUserEmail: OWNER,
  }).allowed, true)
})

test('create export request bắt buộc đánh giá selected order, không coi request null là owner', () => {
  const decision = exportRequestActionDecision({
    action: 'create',
    request: null,
    order: null,
    permissions: ['orders.warehouse_export'],
    currentUserEmail: OWNER,
  })
  assert.equal(decision.allowed, false)
  assert.equal(decision.code, 'missing_parent')
})

test('orders.view_all không được dùng thay scope action của module con', () => {
  for (const [actionPermission, viewAllPermission] of [
    ['payments.edit', 'payments.view_all'],
    ['invoices.edit', 'invoices.view_all'],
    ['shipments.edit', 'shipments.view_all'],
  ]) {
    const decision = moduleActionDecision({
      actionPermission,
      viewAllPermission,
      permissions: [actionPermission, 'orders.view_all'],
      record: foreignRecord,
      currentUserEmail: OWNER,
    })
    assert.equal(decision.allowed, false, `orders.view_all không được mở ${actionPermission}`)
    assert.deepEqual(decision.missingPermissions, [viewAllPermission])
  }
})

test('bundle hồi quy có đúng hành vi action/scope đã thống nhất', () => {
  const bundle = `
customers.create, customers.delete, customers.edit, customers.orders_view, customers.view,
export_requests.accept, export_requests.delete, export_requests.reject, export_requests.view,
export_requests.view_all,
invoices.create, invoices.delete, invoices.edit, invoices.view, invoices.view_all,
orders.delete, orders.edit, orders.export, orders.import, orders.view, orders.view_all,
orders.warehouse_export,
page.customers, page.export_requests, page.invoices, page.orders, page.payments,
page.printing, page.products, page.shipments, page.warehouse_export_requests,
page.warehouse_settings,
payments.create, payments.delete, payments.edit, payments.export, payments.view,
payments.view_all,
printing.orders_view, printing.view, printing.view_all,
products.view,
shipments.create, shipments.delete, shipments.edit, shipments.view, shipments.view_all,
suppliers.view, units.view, warehouses.view
  `.split(',').map(value => value.trim()).filter(Boolean)

  for (const [actionPermission, viewAllPermission] of [
    ['orders.edit', 'orders.view_all'],
    ['orders.delete', 'orders.view_all'],
    ['payments.create', 'payments.view_all'],
    ['payments.edit', 'payments.view_all'],
    ['payments.delete', 'payments.view_all'],
    ['invoices.create', 'invoices.view_all'],
    ['invoices.edit', 'invoices.view_all'],
    ['invoices.delete', 'invoices.view_all'],
    ['shipments.create', 'shipments.view_all'],
    ['shipments.edit', 'shipments.view_all'],
    ['shipments.delete', 'shipments.view_all'],
  ]) {
    assert.equal(moduleActionDecision({
      actionPermission,
      viewAllPermission,
      permissions: bundle,
      record: foreignRecord,
      currentUserEmail: OWNER,
    }).allowed, true, `${actionPermission} phải thao tác được foreign record`)
  }

  for (const actionPermission of ['printing.create', 'printing.edit', 'printing.delete', 'products.edit']) {
    assert.equal(bundle.includes(actionPermission), false, `Bundle không được chứa ${actionPermission}`)
  }
})

test('page export requests phải nối cùng helper cho button, modal, save và delete', () => {
  const page = readFileSync('pages/export-requests.vue', 'utf8')
  assert.match(page, /exportRequestActionDecision/)
  assert.doesNotMatch(page, /export_requests\.delete["']\)\s*\|\|\s*hasPermission\(["']orders\.delete/)
})
