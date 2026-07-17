const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'

function randomIndex(max, random) {
  return Math.floor(random() * max)
}

export function generateCustomerCode(random = Math.random) {
  let code = ''
  for (let index = 0; index < 3; index++) {
    code += LETTERS[randomIndex(LETTERS.length, random)]
  }
  for (let index = 0; index < 3; index++) {
    code += DIGITS[randomIndex(DIGITS.length, random)]
  }
  return code
}

export function isValidCustomerCode(value) {
  return /^[A-Z]{3}[0-9]{3}$/.test(String(value || '').trim().toUpperCase())
}
