import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('printing suppliers are selected and stored per print item', () => {
  const page = readFileSync('pages/printing.vue', 'utf8')
  const progress = readFileSync('composables/usePrintingProgress.ts', 'utf8')
  const models = readFileSync('types/models.ts', 'utf8')

  assert.doesNotMatch(page, /v-model="form\.supplier_id"/)
  assert.match(page, /v-model="group\.supplier_id"/)
  assert.match(page, /v-model="line\.supplier_id"/)
  assert.match(page, /supplier_summary/)
  assert.match(page, /item\.supplier_name/)
  assert.match(progress, /supplier_id: text\(supplier\?\.id\)/)
  assert.match(progress, /supplier_name: text\(supplier\?\.name/)
  assert.match(progress, /supplier_id: '',[\s\S]*supplier_name: ''/)
  assert.match(models, /interface PrintOrderItemDoc[\s\S]*supplier_id\?: string[\s\S]*supplier_name\?: string/)
})

test('printing permission and rules files are not changed for line suppliers', () => {
  const page = readFileSync('pages/printing.vue', 'utf8')
  assert.match(page, /printing\.create/)
  assert.match(page, /printing\.edit/)
  assert.match(page, /printing\.delete/)
  assert.match(page, /loadSuppliers/)
})
