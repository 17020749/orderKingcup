export const ORDER_SEQUENCE_START = 1000

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

export function orderDateCode(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Ngày tạo mã đơn không hợp lệ.')
  const pad = number => String(number).padStart(2, '0')
  return `${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

export function buildOrderCode(userCode, sequence, value = new Date()) {
  const codeError = userCodeValidationError(userCode)
  if (codeError) throw new Error(codeError)

  const number = Number(sequence)
  if (!Number.isInteger(number) || number < ORDER_SEQUENCE_START) {
    throw new Error(`Số thứ tự đơn phải bắt đầu từ ${ORDER_SEQUENCE_START}.`)
  }

  return `${orderDateCode(value)}${normalizeUserCode(userCode)}${String(number).padStart(4, '0')}`
}
