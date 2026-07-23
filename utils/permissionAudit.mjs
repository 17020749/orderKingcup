import { resolvePermissionDependencies } from '../constants/accessMatrix.mjs'

export const PERMISSION_SCHEMA_VERSION = 3

function text(value) {
  return String(value || '').trim()
}

function normalized(value) {
  return text(value).toLowerCase()
}

function uniqueSorted(values) {
  return Array.from(new Set((values || []).map(text).filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

function activeRecord(record) {
  const status = normalized(record?.status)
  return record?.deleted !== true
    && record?.active !== false
    && status !== 'deleted'
    && status !== 'inactive'
    && status !== 'đã xóa'
    && status !== 'không hoạt động'
}

export function roleNamesFromUser(user = {}) {
  const raw = user.roles ?? user.role_names ?? user.role ?? []
  const values = Array.isArray(raw) ? raw : text(raw).split(',')
  return uniqueSorted(values)
}

export function permissionList(value) {
  return uniqueSorted(Array.isArray(value) ? value : [])
}

function roleAliases(role = {}) {
  return uniqueSorted([role.id, role.name, role.role].map(normalized))
}

export function roleMatchesName(role, name) {
  const needle = normalized(name)
  return Boolean(needle && roleAliases(role).includes(needle))
}

function userEmail(user = {}) {
  return normalized(user.email || user.id || user.firestore_id)
}

export function auditPermissionAssignments({ users = [], roles = [], catalogKeys = [] } = {}) {
  const activeRoles = roles.filter(activeRecord)
  const catalog = new Set(permissionList(['*', ...catalogKeys]))

  return users
    .filter(activeRecord)
    .map(user => {
      const roleNames = roleNamesFromUser(user)
      const matchedRoles = activeRoles.filter(role => roleNames.some(name => roleMatchesName(role, name)))
      const matchedNames = new Set(matchedRoles.flatMap(roleAliases))
      const unknownRoles = roleNames.filter(name => !matchedNames.has(normalized(name)))
      const rawRolePermissions = matchedRoles.flatMap(role => permissionList(role.permissions))
      const expectedPermissions = permissionList(resolvePermissionDependencies(rawRolePermissions))
      const actualPermissions = permissionList(user.permissions_flat)
      const expectedSet = new Set(expectedPermissions)
      const actualSet = new Set(actualPermissions)
      const missingPermissions = expectedPermissions.filter(permission => !actualSet.has(permission))
      const extraPermissions = actualPermissions.filter(permission => !expectedSet.has(permission))
      const unknownPermissions = actualPermissions.filter(permission => !catalog.has(permission))
      const expectedAdmin = expectedPermissions.includes('*')
      const currentAdmin = actualPermissions.includes('*')
      const protectedAdminMismatch = (user.is_admin === true || currentAdmin) && !expectedAdmin
      const isInSync = !unknownRoles.length
        && !missingPermissions.length
        && !extraPermissions.length
        && user.is_admin === expectedAdmin
        && currentAdmin === expectedAdmin
        && Number(user.permission_schema_version || 0) === PERMISSION_SCHEMA_VERSION

      return {
        email: userEmail(user),
        displayName: text(user.display_name || user.name),
        roleNames,
        matchedRoleIds: uniqueSorted(matchedRoles.map(role => role.id || role.name)),
        unknownRoles,
        expectedPermissions,
        actualPermissions,
        missingPermissions,
        extraPermissions,
        unknownPermissions,
        expectedAdmin,
        currentAdmin,
        protectedAdminMismatch,
        permissionSchemaVersion: Number(user.permission_schema_version || 0),
        isInSync,
        safeToAutoSync: !unknownRoles.length && !unknownPermissions.length && !protectedAdminMismatch,
        sourceUser: user,
      }
    })
    .sort((left, right) => left.email.localeCompare(right.email))
}

export function buildPermissionSyncPatch(row, schemaVersion = PERMISSION_SCHEMA_VERSION) {
  if (!row?.email) throw new Error('Thiếu email người dùng cần đồng bộ quyền.')
  if (row.unknownRoles?.length) {
    throw new Error(`Không thể đồng bộ ${row.email}: vai trò không tồn tại (${row.unknownRoles.join(', ')}).`)
  }
  if (row.protectedAdminMismatch) {
    throw new Error(`Không thể tự động đồng bộ ${row.email}: tài khoản đang là admin nhưng vai trò không còn quyền toàn hệ thống.`)
  }

  return {
    roles: [...row.roleNames],
    role: row.roleNames[0] || '',
    permissions_flat: [...row.expectedPermissions],
    is_admin: row.expectedAdmin,
    permission_schema_version: schemaVersion,
  }
}

export function summarizePermissionAudit(rows = [], roles = [], catalogKeys = []) {
  const rolePermissionSet = new Set(
    roles.filter(activeRecord).flatMap(role => resolvePermissionDependencies(permissionList(role.permissions))),
  )
  const catalog = permissionList(catalogKeys)
  return {
    totalUsers: rows.length,
    inSyncUsers: rows.filter(row => row.isInSync).length,
    driftUsers: rows.filter(row => !row.isInSync).length,
    safeToSyncUsers: rows.filter(row => !row.isInSync && row.safeToAutoSync).length,
    unknownRoleUsers: rows.filter(row => row.unknownRoles.length).length,
    protectedAdminUsers: rows.filter(row => row.protectedAdminMismatch).length,
    unknownPermissions: uniqueSorted(rows.flatMap(row => row.unknownPermissions)),
    catalogPermissionsNotAssignedToAnyRole: catalog.filter(permission => permission !== '*' && !rolePermissionSet.has(permission)),
  }
}
