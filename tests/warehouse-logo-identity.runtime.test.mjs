import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  canonicalWarehouseLogo,
  selectEquivalentWarehouseBalance,
  warehouseLogoLookupVariants,
  warehouseLogosEquivalent,
} from '../utils/warehouseLogoIdentity.mjs'
import { requestProductIdentityForLine } from '../utils/warehouseExportRequestIdentity.mjs'

const productId = 'product-correct-12oz'
const warehouseId = 'a9d45209-25ae-4b76-8c61-e37ec086e8c9'

function balance(overrides = {}) {
  return {
    id: 'balance-1',
    product_id: productId,
    warehouse_id: warehouseId,
    logo: 'Ghiền',
    quantity: 1000,
    active: true,
    deleted: false,
    ...overrides,
  }
}

test('Ghiền NFC và NFD được coi là cùng logo kho', () => {
  const nfc = 'Ghiền'
  const nfd = nfc.normalize('NFD')
  assert.notEqual(nfc, nfd)
  assert.equal(canonicalWarehouseLogo(nfc), canonicalWarehouseLogo(nfd))
  assert.equal(warehouseLogosEquivalent(nfc, nfd), true)
})

test('logo nhiều từ có dấu NFC và NFD được coi là cùng logo', () => {
  const nfc = 'Phở Ông Định - Cà Phê Hà Nội'
  const nfd = nfc.normalize('NFD')
  assert.notEqual(nfc, nfd)
  assert.equal(warehouseLogosEquivalent(nfc, nfd), true)
})

test('chuẩn hóa NBSP, nhiều khoảng trắng và zero-width nhưng vẫn giữ dấu tiếng Việt', () => {
  const dirty = `  Cà\u00A0\u00A0Phê\u200B   Ghiền  `
  assert.equal(canonicalWarehouseLogo(dirty), 'Cà Phê Ghiền')
  assert.notEqual(canonicalWarehouseLogo('Hương'), canonicalWarehouseLogo('Huong'))
})

test('lookup variants bao gồm raw, NFC và NFD để đọc được balance cũ mà không đổi key toàn hệ thống', () => {
  const raw = 'Ghiền'.normalize('NFD')
  const variants = warehouseLogoLookupVariants(raw)
  assert.ok(variants.includes(raw))
  assert.ok(variants.includes('Ghiền'))
  assert.ok(variants.includes('Ghiền'.normalize('NFD')))
})

test('balance exact bằng 0 nhưng balance Unicode tương đương có tồn thì chọn balance có tồn', () => {
  const requested = 'Ghiền'
  const legacyNfd = requested.normalize('NFD')
  const selection = selectEquivalentWarehouseBalance([
    balance({ id: 'exact-zero', logo: requested, quantity: 0 }),
    balance({ id: 'legacy-stock', logo: legacyNfd, quantity: 1000 }),
  ], {
    productId,
    warehouseId,
    logo: requested,
  })

  assert.equal(selection.ambiguous, false)
  assert.equal(selection.balance.id, 'legacy-stock')
  assert.equal(selection.balance.quantity, 1000)
})

test('không tự cộng/trừ khi có nhiều balance tương đương cùng còn tồn', () => {
  const requested = 'Cà Phê Ghiền'
  const selection = selectEquivalentWarehouseBalance([
    balance({ id: 'stock-a', logo: requested, quantity: 400 }),
    balance({ id: 'stock-b', logo: requested.normalize('NFD'), quantity: 600 }),
  ], {
    productId,
    warehouseId,
    logo: requested,
  })

  assert.equal(selection.ambiguous, true)
  assert.equal(selection.balance, null)
  assert.equal(selection.positive.length, 2)
})

test('đối chiếu product snapshot nhận ra logo cùng chữ nhưng khác Unicode', () => {
  const request = {
    payload_json: JSON.stringify({
      items: [{
        source_order_item_id: 'order-item-12oz',
        product_id: productId,
        product_code: 'LNPET93-12OZ',
        logo: 'Ghiền'.normalize('NFD'),
      }],
    }),
  }
  const identity = requestProductIdentityForLine(request, {
    source_order_item_id: 'order-item-12oz',
    logo: 'Ghiền',
  })
  assert.equal(identity.productId, productId)
})

test('wrapper xuất từ yêu cầu resolve logo balance cũ trước cả preflight và transaction', () => {
  const source = readFileSync('composables/useWarehouseTransactionsClient.ts', 'utf8')
  assert.match(source, /canonicalWarehouseLogo/)
  assert.match(source, /warehouseLogoLookupVariants/)
  assert.match(source, /selectEquivalentWarehouseBalance/)
  assert.match(source, /getDocs\(query\(/)
  assert.match(source, /const lines = await resolveExportRequestInventoryLines\(alignedLines\)/)
  assert.match(source, /await checkExportStock\(preflightInput, 'customer'\)/)
  assert.match(source, /base\.processExportRequestToExportOrder\(preflightInput\)/)
})
