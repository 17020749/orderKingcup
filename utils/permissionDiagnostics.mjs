function clean(value, fallback = '(unknown)') {
  const text = String(value ?? '').trim()
  return text || fallback
}

function permissionList(values) {
  return (Array.isArray(values) ? values : [values])
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .map(value => `[${value}]`)
    .join(', ')
}

export function buildPermissionDiagnostic(input = {}) {
  return {
    operation: clean(input.operation, 'firestore.operation'),
    record: clean(input.record),
    diagnosticCode: clean(input.diagnosticCode, 'permission-denied'),
    status: clean(input.status),
    actionPermissions: permissionList(input.actionPermissions || input.actionPermission || []),
    scopePermissions: permissionList(input.scopePermissions || input.scopePermission || []),
    immutableField: clean(input.immutableField, ''),
  }
}

export function formatPermissionDiagnostic(input = {}) {
  const diagnostic = buildPermissionDiagnostic(input)
  const details = [
    `operation=${diagnostic.operation}`,
    `record=${diagnostic.record}`,
    `code=${diagnostic.diagnosticCode}`,
    `status=${diagnostic.status}`,
  ]
  if (diagnostic.actionPermissions) details.push(`permission=${diagnostic.actionPermissions}`)
  if (diagnostic.scopePermissions) details.push(`scope=${diagnostic.scopePermissions}`)
  if (diagnostic.immutableField) details.push(`immutable_field=${diagnostic.immutableField}`)
  return details.join(', ')
}

export function permissionDeniedDiagnosticMessage(input = {}) {
  return `Firestore từ chối thao tác (${formatPermissionDiagnostic(input)}). Hãy tải lại quyền/dữ liệu; nếu vẫn lỗi, gửi mã chẩn đoán này cho quản trị viên.`
}
