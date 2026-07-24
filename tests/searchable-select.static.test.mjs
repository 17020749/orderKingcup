import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('shared searchable select opens above near viewport bottom and clears opposite offsets', () => {
  const source = readFileSync('components/SearchableSelect.vue', 'utf8')
  assert.match(source, /const openAbove = bottomSpace < 280 && topSpace > bottomSpace/)
  assert.match(source, /top: openAbove \? "auto"/)
  assert.match(source, /bottom: openAbove \? `\$\{viewportHeight - rect\.top \+ 6\}px` : "auto"/)
  assert.match(source, /right: "auto"/)
})

test('shared searchable select options have their own vertical scroll area', () => {
  const source = readFileSync('components/SearchableSelect.vue', 'utf8')
  assert.match(source, /display: flex/)
  assert.match(source, /flex-direction: column/)
  assert.match(source, /min-height: 0/)
  assert.match(source, /max-height: none/)
  assert.match(source, /overflow-y: auto/)
  assert.match(source, /scrollbar-gutter: stable/)
})
