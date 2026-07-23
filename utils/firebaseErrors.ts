// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { permissionDeniedUserMessage } from '~/utils/permissionErrorBus.mjs'

export type FirebaseErrorContext = {
  operation?: string
  record?: string
  diagnosticCode?: string
  status?: string
  actionPermission?: string
  actionPermissions?: string[]
  scopePermission?: string
  scopePermissions?: string[]
  immutableField?: string
  module?: string
  stage?: string
  source?: string
  missingPermissions?: string[]
  context?: Record<string, any>
}

export function firebaseErrorMessage(
  error: any,
  fallback = 'Có lỗi xảy ra, vui lòng thử lại.',
  context: FirebaseErrorContext = {},
) {
  const code = String(error?.code || '').replace('firestore/', '').replace('auth/', '')
  const messages: Record<string, string> = {
    'unauthenticated': 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
    'not-found': 'Không tìm thấy dữ liệu cần thao tác.',
    'already-exists': 'Dữ liệu này đã tồn tại.',
    'failed-precondition': 'Dữ liệu hoặc truy vấn chưa đáp ứng điều kiện thực hiện.',
    'invalid-argument': 'Dữ liệu nhập vào không hợp lệ.',
    'unavailable': 'Không kết nối được máy chủ, vui lòng thử lại.',
    'deadline-exceeded': 'Yêu cầu mất quá nhiều thời gian, vui lòng thử lại.',
    'resource-exhausted': 'Đã vượt giới hạn tài nguyên, vui lòng thử lại sau.'
  }
  if (code === 'permission-denied') {
    return permissionDeniedUserMessage({
      module: context.module,
      operation: context.operation,
      stage: context.stage || 'firestore_denied',
      source: context.source || 'firestore',
      recordId: context.record,
      recordStatus: context.status,
      firebaseCode: code,
      firebaseMessage: String(error?.message || ''),
      actionPermission: context.actionPermission,
      actionPermissions: context.actionPermissions,
      scopePermission: context.scopePermission,
      scopePermissions: context.scopePermissions,
      missingPermissions: context.missingPermissions,
      context: {
        ...context.context,
        immutable_field: context.immutableField || '',
        diagnostic_code: context.diagnosticCode || code,
      },
      stack: String(error?.stack || ''),
    })
  }
  if (messages[code]) return messages[code]
  const message = String(error?.message || '').trim()
  return message || fallback
}

export function reportFirebaseError(error: any, fallback?: string, context: FirebaseErrorContext = {}) {
  if (import.meta.dev) console.error(error)
  return firebaseErrorMessage(error, fallback, context)
}

export function reportPermissionError(context: FirebaseErrorContext = {}) {
  return permissionDeniedUserMessage({
    module: context.module,
    operation: context.operation,
    stage: context.stage || 'client_preflight',
    source: context.source || 'preflight',
    recordId: context.record,
    recordStatus: context.status,
    actionPermission: context.actionPermission,
    actionPermissions: context.actionPermissions,
    scopePermission: context.scopePermission,
    scopePermissions: context.scopePermissions,
    missingPermissions: context.missingPermissions,
    context: context.context,
  })
}
