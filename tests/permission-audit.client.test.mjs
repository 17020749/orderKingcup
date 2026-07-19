import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PERMISSION_SCHEMA_VERSION,
  auditPermissionAssignments,
  buildPermissionSyncPatch,
  roleMatchesName,
  summarizePermissionAudit,
} from '../utils/permissionAudit.mjs'

const catalogKeys = [
  'page.orders',
  'orders.view',
  'orders.create',
  'page.customers',
  'customers.view',
  'page.products',
  'products.view',
  'page.export_requests',
  'export_requests.view',
]

const expectedSalePermissions = [
  'customers.view',
  'orders.create',
  'orders.view',
  'page.customers',
  'page.orders',
  'page.products',
  'products.view',
]

const roles = [
  {
    id: 'sale',
    name: 'Sale',
    active: true,
    permissions: ['orders.create'],
  },
  {
    id: 'admin',
    name: 'Admin',
    active: true,
    permissions: ['*'],
  },
]

test('role khớp theo cả id và tên, không phân biệt hoa thường', () => {
  assert.equal(roleMatchesName(roles[0], 'SALE'), true)
  assert.equal(roleMatchesName(roles[0], 'Sale'), true)
  assert.equal(roleMatchesName(roles[0], 'warehouse'), false)
})

test('phát hiện permissions_flat thiếu quyền so với ma trận role', () => {
  const [row] = auditPermissionAssignments({
    users: [{
      email: 'sale@example.com',
      roles: ['sale'],
      permissions_flat: expectedSalePermissions.filter(permission => permission !== 'orders.view'),
      active: true,
      permission_schema_version: PERMISSION_SCHEMA_VERSION,
    }],
    roles,
    catalogKeys,
  })

  assert.deepEqual(row.missingPermissions, ['orders.view'])
  assert.equal(row.isInSync, false)
  assert.equal(row.safeToAutoSync, true)
})

test('phát hiện quyền thừa và quyền không còn trong catalog', () => {
  const [row] = auditPermissionAssignments({
    users: [{
      email: 'sale@example.com',
      roles: ['sale'],
      permissions_flat: [...expectedSalePermissions, 'orders.legacy_delete'],
      active: true,
      permission_schema_version: PERMISSION_SCHEMA_VERSION,
    }],
    roles,
    catalogKeys,
  })

  assert.deepEqual(row.extraPermissions, ['orders.legacy_delete'])
  assert.deepEqual(row.unknownPermissions, ['orders.legacy_delete'])
  assert.equal(row.safeToAutoSync, false)
})

test('không tự động hạ tài khoản admin khi role admin bị mất hoặc đổi sai', () => {
  const [row] = auditPermissionAssignments({
    users: [{
      email: 'admin@example.com',
      roles: ['sale'],
      permissions_flat: ['*'],
      is_admin: true,
      active: true,
    }],
    roles,
    catalogKeys,
  })

  assert.equal(row.protectedAdminMismatch, true)
  assert.equal(row.safeToAutoSync, false)
  assert.throws(() => buildPermissionSyncPatch(row), /đang là admin/)
})

test('không đồng bộ khi user đang tham chiếu role không tồn tại', () => {
  const [row] = auditPermissionAssignments({
    users: [{
      email: 'legacy@example.com',
      roles: ['role_da_xoa'],
      permissions_flat: ['orders.view'],
      active: true,
    }],
    roles,
    catalogKeys,
  })

  assert.deepEqual(row.unknownRoles, ['role_da_xoa'])
  assert.equal(row.safeToAutoSync, false)
  assert.throws(() => buildPermissionSyncPatch(row), /vai trò không tồn tại/)
})

test('patch đồng bộ dùng quyền đã mở rộng từ ma trận và ghi phiên bản schema', () => {
  const [row] = auditPermissionAssignments({
    users: [{
      email: 'sale@example.com',
      roles: ['Sale'],
      permissions_flat: ['orders.create'],
      active: true,
    }],
    roles,
    catalogKeys,
  })

  assert.deepEqual(buildPermissionSyncPatch(row), {
    roles: ['Sale'],
    role: 'Sale',
    permissions_flat: expectedSalePermissions,
    is_admin: false,
    permission_schema_version: PERMISSION_SCHEMA_VERSION,
  })
})

test('tổng hợp báo cáo nêu user lệch và quyền catalog chưa được gán role', () => {
  const rows = auditPermissionAssignments({
    users: [
      {
        email: 'sale@example.com',
        roles: ['sale'],
        permissions_flat: ['page.orders'],
        active: true,
      },
      {
        email: 'admin@example.com',
        roles: ['admin'],
        permissions_flat: ['*'],
        is_admin: true,
        active: true,
        permission_schema_version: PERMISSION_SCHEMA_VERSION,
      },
    ],
    roles,
    catalogKeys,
  })
  const summary = summarizePermissionAudit(rows, roles, catalogKeys)

  assert.equal(summary.totalUsers, 2)
  assert.equal(summary.driftUsers, 1)
  assert.equal(summary.safeToSyncUsers, 1)
  assert.deepEqual(summary.catalogPermissionsNotAssignedToAnyRole, [
    'export_requests.view',
    'page.export_requests',
  ])
})
