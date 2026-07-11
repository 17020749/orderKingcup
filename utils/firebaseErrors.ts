export function firebaseErrorMessage(error: any, fallback = 'Có lỗi xảy ra, vui lòng thử lại.') {
  const code = String(error?.code || '').replace('firestore/', '').replace('auth/', '')
  const messages: Record<string, string> = {
    'permission-denied': 'Bạn chưa có quyền thực hiện thao tác này.',
    'unauthenticated': 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.',
    'not-found': 'Không tìm thấy dữ liệu cần thao tác.',
    'already-exists': 'Dữ liệu này đã tồn tại.',
    'failed-precondition': 'Dữ liệu hoặc truy vấn chưa đáp ứng điều kiện thực hiện.',
    'invalid-argument': 'Dữ liệu nhập vào không hợp lệ.',
    'unavailable': 'Không kết nối được Firebase, vui lòng thử lại.',
    'deadline-exceeded': 'Yêu cầu mất quá nhiều thời gian, vui lòng thử lại.',
    'resource-exhausted': 'Đã vượt giới hạn tài nguyên, vui lòng thử lại sau.'
  }
  return messages[code] || fallback
}

export function reportFirebaseError(error: any, fallback?: string) {
  console.error(error)
  return firebaseErrorMessage(error, fallback)
}
