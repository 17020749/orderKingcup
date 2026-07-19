import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync('utils/firebaseErrors.ts', 'utf8')

test('firebase error reporter keeps custom business error messages visible', () => {
  assert.match(source, /const message = String\(error\?\.message \|\| ''\)\.trim\(\)/)
  assert.match(source, /return message \|\| fallback/)
})

test('known Firebase permission errors still use friendly mapped messages', () => {
  assert.match(source, /if \(messages\[code\]\) return messages\[code\]/)
  assert.match(source, /'permission-denied': 'Bạn chưa có quyền thực hiện thao tác này\.'/)
})
