import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  authorizationCacheToken,
  authorizationChanged,
  authorizationFingerprint,
  effectivePermissionsFromUser,
  isAdminFromPermissions,
  normalizePermissionList,
} from '../utils/authorizationState.mjs'

test('quyền client chỉ lấy từ permissions_flat, không cộng quyền trong role', () => {
  const user = {
    email: 'sale@example.com',
    roles: ['sale'],
    role_permissions: ['orders.delete', 'orders.view_all'],
    permissions_flat: ['page.orders', 'orders.view'],
    active: true,
  }

  assert.deepEqual(effectivePermissionsFromUser(user), ['orders.view', 'page.orders'])
  assert.equal(effectivePermissionsFromUser(user).includes('orders.delete'), false)
  assert.equal(effectivePermissionsFromUser(user).includes('orders.view_all'), false)
})

test('permissions_flat được loại trùng, bỏ giá trị rỗng và sắp xếp ổn định', () => {
  assert.deepEqual(
    normalizePermissionList(['orders.view', '', 'page.orders', 'orders.view', null]),
    ['orders.view', 'page.orders'],
  )
})

test('admin phía client chỉ đến từ wildcard trong permissions_flat', () => {
  assert.equal(isAdminFromPermissions(['*']), true)
  assert.equal(isAdminFromPermissions(['orders.view']), false)
  assert.equal(isAdminFromPermissions([]), false)
})

test('thay quyền hoặc phiên bản schema làm thay đổi fingerprint và cache token', () => {
  const before = {
    email: 'sale@example.com',
    active: true,
    permissions_flat: ['orders.view'],
    permission_schema_version: 1,
  }
  const afterGrant = {
    ...before,
    permissions_flat: ['orders.view', 'orders.create'],
  }
  const afterSchema = {
    ...before,
    permission_schema_version: 2,
  }

  assert.notEqual(authorizationFingerprint(before), authorizationFingerprint(afterGrant))
  assert.notEqual(authorizationCacheToken(before), authorizationCacheToken(afterGrant))
  assert.notEqual(authorizationCacheToken(before), authorizationCacheToken(afterSchema))
  assert.equal(authorizationChanged(before, afterGrant), true)
})

test('đổi thứ tự permissions_flat không tạo thay đổi quyền giả', () => {
  const left = {
    email: 'sale@example.com',
    active: true,
    permissions_flat: ['orders.create', 'orders.view'],
    permission_schema_version: 1,
  }
  const right = {
    ...left,
    permissions_flat: ['orders.view', 'orders.create'],
  }

  assert.equal(authorizationFingerprint(left), authorizationFingerprint(right))
  assert.equal(authorizationChanged(left, right), false)
})

test('khóa hoặc xóa user làm thay đổi trạng thái phân quyền', () => {
  const active = {
    email: 'sale@example.com',
    active: true,
    permissions_flat: ['orders.view'],
  }
  assert.equal(authorizationChanged(active, { ...active, active: false }), true)
  assert.equal(authorizationChanged(active, { ...active, deleted: true }), true)
})

test('useAuth không còn đọc collection roles hoặc cờ is_admin để sinh quyền', () => {
  const source = readFileSync('composables/useAuth.ts', 'utf8')
  assert.doesNotMatch(source, /getDocs\s*\(\s*collection\s*\(\s*db\s*,\s*['"]roles['"]\s*\)/)
  assert.doesNotMatch(source, /rolePerms/)
  assert.match(source, /effectivePermissionsFromUser\(profile\)/)
  assert.match(source, /const canonicalAdmin = isAdminFromPermissions\(effectivePermissions\)/)
  assert.match(source, /is_admin: canonicalAdmin/)
  assert.match(source, /onSnapshot\(/)
  assert.match(source, /invalidateScopedCache\(\)/)
})

test('các điểm quyết định quyền không dùng role hoặc is_admin làm nguồn thay thế', () => {
  const scopedQueries = readFileSync('composables/useScopedQueries.ts', 'utf8')
  const generalSettings = readFileSync('pages/settings/general.vue', 'utf8')
  assert.doesNotMatch(scopedQueries, /appUser\.value\?\.is_admin/)
  assert.doesNotMatch(generalSettings, /\.role|\.roles|is_admin/)
  assert.match(generalSettings, /computed\(\(\) => hasPermission\('\*'\)\)/)
})

test('plugin reload đúng một lần khi revision quyền thay đổi sau khởi tạo', () => {
  const source = readFileSync('plugins/authorization-refresh.client.ts', 'utf8')
  assert.match(source, /watch\(authorizationRevision/)
  assert.match(source, /previousRevision === 0/)
  assert.match(source, /window\.location\.reload\(\)/)
})
