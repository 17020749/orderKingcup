import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync('utils/firebaseErrors.ts', 'utf8')
const busSource = readFileSync('utils/permissionErrorBus.mjs', 'utf8')

test('firebase error reporter keeps custom business error messages visible', () => {
  assert.match(source, /const message = String\(error\?\.message \|\| ''\)\.trim\(\)/)
  assert.match(source, /return message \|\| fallback/)
})

test('permission-denied uses structured diagnostics instead of a generic missing-permission claim', () => {
  assert.match(source, /permissionDeniedUserMessage/)
  assert.match(source, /firebaseCode: code/)
  assert.match(busSource, /Bạn không có quyền thực hiện thao tác này\./)
})

test('production reporter does not leave unconditional diagnostic logs', () => {
  assert.match(source, /if \(import\.meta\.dev\) console\.error\(error\)/)
  assert.doesNotMatch(source, /\n\s*console\.error\(error\)/)
})
