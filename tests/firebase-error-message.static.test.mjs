import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { permissionDeniedMessage } from '../utils/permissionDiagnostics.mjs'

const source = readFileSync('utils/firebaseErrors.ts', 'utf8')

test('firebase error reporter keeps custom business error messages visible', () => {
  assert.match(source, /const message = String\(error\?\.message \|\| ''\)\.trim\(\)/)
  assert.match(source, /return message \|\| fallback/)
})

test('permission-denied không còn trả lỗi quyền chung chung', () => {
  assert.doesNotMatch(source, /Bạn chưa có quyền thực hiện thao tác này/)
  assert.match(source, /permissionDeniedMessage\(context\)/)
})

test('permission error liệt kê khóa quyền thiếu cụ thể', () => {
  const message = permissionDeniedMessage({
    currentPermissions: ['payments.view'],
    requiredAll: ['payments.edit', 'payments.view_all'],
    operation: 'sửa thanh toán',
  })
  assert.match(message, /\[payments\.edit\]/)
  assert.match(message, /\[payments\.view_all\]/)
})
