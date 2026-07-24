import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('shared searchable select opens above near viewport bottom', () => {
  const source = readFileSync('components/SearchableSelect.vue', 'utf8')
  assert.match(source, /top: openAbove \? "auto"/)
  assert.match(source, /bottom: openAbove \? `\$\{viewportHeight - rect\.top \+ 6\}px` : "auto"/)
})

test('shared searchable select options have their own vertical scroll area', () => {
  const source = readFileSync('components/SearchableSelect.vue', 'utf8')
  assert.match(source, /overflow-y: auto/)
  assert.match(source, /max-height: none/)
})
