import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('parcel labels use one editable generic product row', () => {
  const modal = readFileSync('components/ParcelLabelPrintModal.vue', 'utf8')
  const builder = readFileSync('utils/parcelLabelPrintDocuments.ts', 'utf8')

  assert.ok(modal.includes("DEFAULT_PRODUCT_NAME = 'Đồ dùng một lần cho quán cà phê, trà sữa'"))
  assert.ok(modal.includes('v-model="form.productName"'))
  assert.ok(modal.includes('v-model="form.packageCount"'))
  assert.ok(modal.includes('v-model="form.logo"'))
  assert.ok(modal.includes('v-model="form.receiverName"'))
  assert.ok(modal.includes('v-model="form.senderName"'))
  assert.ok(modal.includes('v-model="form.orderCode"'))
  assert.ok(modal.includes('1 dòng cố định'))
  assert.ok(!modal.includes('props.items.filter'))
  assert.ok(builder.includes('packageCount?: string'))
  assert.ok(builder.includes('displayValue(row.packageCount)'))
  assert.ok(!builder.includes('setTimeout(() => window.print()'))
})
