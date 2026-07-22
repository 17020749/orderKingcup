// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { permissionDeniedMessage } from '~/utils/permissionDiagnostics.mjs'

export type FirebasePermissionContext = {
  currentPermissions?: string[]
  requiredAll?: string[]
  requiredAny?: string[]
  operation?: string
  recordLabel?: string
  diagnosticCode?: string
  reason?: string
}

export function firebaseErrorMessage(
  error: any,
  fallback = 'Có lỗi xảy ra, vui lòng thử lại.',
  permissionContext?: FirebasePermissionContext,
) {
  const code = String(error?.code || '').replace('firestore/', '').replace('auth/', '')
  const context = error?.permissionContext || permissionContext
  if (code === 'permission-denied') {
    if (context) return permissionDeniedMessage(context)
    return 'Firestore từ chối thao tác (permission-denied). Nơi gọi chưa khai báo quyền bắt buộc nên chưa thể xác định khóa quyền thiếu.'
  }

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
  if (messages[code]) return messages[code]
  const message = String(error?.message || '').trim()
  return message || fallback
}

export function reportFirebaseError(
  error: any,
  fallback?: string,
  permissionContext?: FirebasePermissionContext,
) {
  console.error(error)
  return firebaseErrorMessage(error, fallback, permissionContext)
}
