function text(value) {
  return String(value || '').trim()
}

function normalized(value) {
  return text(value).toLowerCase()
}

export function normalizePermissionList(value) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map(text).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right))
}

export function effectivePermissionsFromUser(user = {}) {
  return normalizePermissionList(user.permissions_flat)
}

export function isAdminFromPermissions(permissions) {
  return normalizePermissionList(permissions).includes('*')
}

export function isActiveAuthorizationUser(user = {}) {
  const status = normalized(user.status)
  return user.deleted !== true
    && user.active !== false
    && status !== 'deleted'
    && status !== 'inactive'
    && status !== 'đã xóa'
    && status !== 'không hoạt động'
}

function hashText(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function authorizationFingerprint(user = {}) {
  const permissions = effectivePermissionsFromUser(user)
  return [
    normalized(user.email || user.id || user.firestore_id),
    isActiveAuthorizationUser(user) ? 'active' : 'inactive',
    Number(user.permission_schema_version || 0),
    permissions.join('|'),
  ].join('::')
}

export function authorizationCacheToken(user = {}) {
  const schemaVersion = Number(user.permission_schema_version || 0)
  return `v${schemaVersion}-${hashText(authorizationFingerprint(user))}`
}

export function authorizationChanged(previousUser, nextUser) {
  return authorizationFingerprint(previousUser || {}) !== authorizationFingerprint(nextUser || {})
}
