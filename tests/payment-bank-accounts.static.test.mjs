import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Regression boundary: existing payment permissions stay unchanged; the new
// setup collection is readable for payment workflows and writable by admin only.
test('payments page exposes transfer recipient setup without adding permission keys', () => {
  const page = readFileSync('pages/payments.vue', 'utf8')
  const permissions = readFileSync('constants/permissions.ts', 'utf8')
  const matrix = readFileSync('constants/accessMatrix.mjs', 'utf8')

  assert.match(page, /isBankTransferMethod/)
  assert.match(page, /payment_bank_accounts/)
  assert.match(page, /recipient_account_id/)
  assert.match(page, /recipient_account_number/)
  assert.match(page, /recipient_bank_name/)
  assert.match(page, /sender_image_url/)
  assert.match(page, /v-if="isAdmin"[^>]*>Thiết lập tài khoản nhận/)
  assert.match(page, /target="_blank"/)
  assert.doesNotMatch(permissions, /payment_bank_accounts\./)
  assert.doesNotMatch(matrix, /payment_bank_accounts\./)
})

test('bank account rules are isolated and admin-only for writes', () => {
  const rules = readFileSync('firestore.rules', 'utf8')
  const start = rules.indexOf('match /payment_bank_accounts/{docId}')
  const end = rules.indexOf('// Warehouse export requests', start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const block = rules.slice(start, end)
  assert.match(block, /allow read: if isAdmin\(\)/)
  assert.match(block, /payments\.view/)
  assert.match(block, /allow create: if isAdmin\(\)/)
  assert.match(block, /allow update: if isAdmin\(\)/)
  assert.match(block, /allow delete: if false/)
})
