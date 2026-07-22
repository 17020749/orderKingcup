function cleanPermissions(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean)))
}

function labelTarget(recordLabel) {
  const value = String(recordLabel || '').trim()
  return value ? ` [${value}]` : ''
}

function formatKeys(keys) {
  return keys.map(key => `[${key}]`).join(', ')
}

export function hasPermissionGrant(permissions, key) {
  const grants = cleanPermissions(permissions)
  return grants.includes('*') || grants.includes(key)
}

export function recordBelongsToUser(record = {}, email = '', parentOrder = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail) return false
  const values = [
    record.created_by,
    record.requested_by,
    record.owner_email,
    record.sale_email,
    record.order_owner_email,
    record.order_created_by,
    record.order_sale_email,
    parentOrder.owner_email,
    parentOrder.created_by,
    parentOrder.sale_email,
  ]
  return values.some(value => String(value || '').trim().toLowerCase() === normalizedEmail)
}

export function scopedActionDecision({
  permissions = [],
  actionPermission = '',
  scopePermission = '',
  ownsRecord = true,
  operation = 'thực hiện thao tác',
  recordLabel = '',
  diagnosticCode = 'CLIENT_PERMISSION_DENIED',
  reason = '',
} = {}) {
  const grants = cleanPermissions(permissions)
  const missingPermissions = []
  if (actionPermission && !hasPermissionGrant(grants, actionPermission)) {
    missingPermissions.push(actionPermission)
  }
  if (!ownsRecord && scopePermission && !hasPermissionGrant(grants, scopePermission)) {
    missingPermissions.push(scopePermission)
  }
  const requiredAll = [
    ...(actionPermission ? [actionPermission] : []),
    ...(!ownsRecord && scopePermission ? [scopePermission] : []),
  ]
  const message = missingPermissions.length
    ? `Không thể ${operation}${labelTarget(recordLabel)}. Thiếu quyền: ${formatKeys(missingPermissions)}.`
    : ''
  return {
    allowed: missingPermissions.length === 0,
    missingPermissions,
    message,
    permissionContext: {
      currentPermissions: grants,
      requiredAll,
      requiredAny: [],
      operation,
      recordLabel,
      diagnosticCode,
      reason,
    },
  }
}

export function permissionDeniedMessage({
  currentPermissions = [],
  requiredAll = [],
  requiredAny = [],
  operation = 'thực hiện thao tác',
  recordLabel = '',
  diagnosticCode = 'FIRESTORE_PERMISSION_DENIED',
  reason = '',
} = {}) {
  const grants = cleanPermissions(currentPermissions)
  const isAdmin = grants.includes('*')
  const allKeys = cleanPermissions(requiredAll)
  const anyKeys = cleanPermissions(requiredAny)
  const missingAll = isAdmin ? [] : allKeys.filter(key => !grants.includes(key))
  const anySatisfied = isAdmin || !anyKeys.length || anyKeys.some(key => grants.includes(key))

  if (missingAll.length || !anySatisfied) {
    const parts = []
    if (missingAll.length) parts.push(`thiếu ${formatKeys(missingAll)}`)
    if (!anySatisfied) parts.push(`cần ít nhất một trong ${formatKeys(anyKeys)}`)
    return `Không thể ${operation}${labelTarget(recordLabel)}: ${parts.join('; ')}.`
  }

  const required = cleanPermissions([...allKeys, ...anyKeys])
  const grantedText = required.length ? formatKeys(required) : 'không có khóa quyền bắt buộc được khai báo'
  const detail = reason || 'Ràng buộc dữ liệu của bản ghi không hợp lệ: phạm vi sở hữu, trạng thái nghiệp vụ hoặc trường bất biến.'
  return `Không thể ${operation}${labelTarget(recordLabel)}. Không thiếu quyền client (${grantedText}), nhưng Firestore Rules từ chối dữ liệu. Mã chẩn đoán: ${diagnosticCode}. ${detail}`
}
