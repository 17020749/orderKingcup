export const ORDER_SEQUENCE_START = 1

export function normalizeUserCode(value) {
  return String(value || '').trim().toUpperCase()
}

export function userCodeValidationError(value) {
  const code = normalizeUserCode(value)
  if (!code) return 'Thiếu Mã Người dùng.'
  if (!/^[A-Z0-9]{1,12}$/.test(code)) {
    return 'Mã Người dùng chỉ gồm chữ A-Z và số, tối đa 12 ký tự.'
  }
  return ''
}

export function normalizeCustomerCode(value) {
  return String(value || '').trim().toUpperCase()
}

export function customerCodeValidationError(value) {
  const code = normalizeCustomerCode(value)
  if (!code) return 'Khách hàng chưa có Mã khách.'
  if (!/^[A-Z]{3}[0-9]{3}$/.test(code)) {
    return 'Mã khách phải gồm đúng 3 chữ cái in hoa và 3 chữ số.'
  }
  return ''
}

export function buildOrderCode(userCode, customerCode, sequence) {
  const codeError = userCodeValidationError(userCode)
  if (codeError) throw new Error(codeError)
  const customerError = customerCodeValidationError(customerCode)
  if (customerError) throw new Error(customerError)

  const number = Number(sequence)
  if (!Number.isInteger(number) || number < ORDER_SEQUENCE_START) {
    throw new Error('Số thứ tự đơn phải bắt đầu từ 0001.')
  }

  return `${normalizeUserCode(userCode)}-${normalizeCustomerCode(customerCode)}-${String(number).padStart(4, '0')}`
}
