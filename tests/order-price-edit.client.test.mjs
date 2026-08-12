import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'

import {
  assertPriceOnlyItemChange,
  priceOnlyItemsChanged,
} from '../utils/orderPriceEdit.mjs'

const item = {
  id: 'item-1',
  order_id: 'order-1',
  product_id: 'product-1',
  product_code: 'P-1',
  product_name: 'Sản phẩm 1',
  unit: 'Cái',
  quantity: 10,
  unit_price: 100,
  line_total: 1000,
  line_profit: 1000,
  logo_json: '',
}

test('chấp nhận thay đổi đơn giá và thành tiền của dòng hiện có', () => {
  const next = { ...item, unit_price: 120, line_total: 1200, line_profit: 1200 }
  assert.doesNotThrow(() => assertPriceOnlyItemChange(item, next))
  assert.equal(priceOnlyItemsChanged([item], [next]), true)
})

test('từ chối thay đổi sản phẩm hoặc số lượng trong luồng sửa giá', () => {
  assert.throws(
    () => assertPriceOnlyItemChange(item, { ...item, quantity: 11, unit_price: 120, line_total: 1320 }),
    /Chỉ được sửa đơn giá/,
  )
  assert.throws(
    () => assertPriceOnlyItemChange(item, { ...item, product_id: 'product-2', unit_price: 120, line_total: 1200 }),
    /Chỉ được sửa đơn giá/,
  )
})

test('giữ nguyên hình dạng logo khi chỉ sửa giá dòng logo', () => {
  const current = {
    ...item,
    logo_json: JSON.stringify([{ logo: 'A', logo_color: 'Đỏ', quantity: 5, unit_price: 100, line_total: 500 }]),
  }
  const next = {
    ...current,
    logo_json: JSON.stringify([{ logo: 'A', logo_color: 'Đỏ', quantity: 5, unit_price: 120, line_total: 600 }]),
  }
  assert.doesNotThrow(() => assertPriceOnlyItemChange(current, next))
  assert.throws(
    () => assertPriceOnlyItemChange(current, {
      ...next,
      logo_json: JSON.stringify([{ logo: 'A', logo_color: 'Đỏ', quantity: 6, unit_price: 120, line_total: 720 }]),
    }),
    /logo và số lượng logo/,
  )
})

test('UI và rules có nhánh sửa giá riêng cho đơn đã xuất đủ', () => {
  const page = fs.readFileSync(new URL('../pages/orders.vue', import.meta.url), 'utf8')
  const rules = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')
  assert.match(page, /useOrderPriceSave/)
  assert.match(page, /v-model\.number="item\.unit_price"/)
  assert.match(page, /priceOnlyItemsChanged/)
  assert.match(rules, /function orderPriceEditAllowed\(\)/)
  assert.match(rules, /function orderPriceItemUpdateAllowed\(\)/)
  assert.doesNotMatch(rules, /invoicePriceUpdateAllowed/)
})
