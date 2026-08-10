import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { resolveImportItemLotIdentity } from '../utils/warehouseImportLotIdentity.mjs'

const productId = 'product-pet-12oz'
const warehouseId = 'warehouse-main'

function item(overrides = {}) {
  return {
    id: 'import-item-1',
    import_order_id: 'import-order-1',
    product_id: productId,
    product_code: 'LNPET93-12OZ',
    warehouse_id: warehouseId,
    logo: 'Ghiền',
    lot_id: 'lot-stale',
    quantity: 100,
    source: 'nuxt',
    ...overrides,
  }
}

function balance(overrides = {}) {
  return {
    id: 'balance-1',
    product_id: productId,
    warehouse_id: warehouseId,
    logo: 'Ghiền',
    quantity: 100,
    active: true,
    deleted: false,
    lots: [],
    ...overrides,
  }
}

test('sửa phiếu nhập tìm lại lô theo import_order_item_id khi lot_id cũ bị lệch', () => {
  const resolved = resolveImportItemLotIdentity([
    balance({
      logo: 'Ghiền'.normalize('NFD'),
      lots: [{
        id: 'lot-real',
        import_order_item_id: 'import-item-1',
        available_quantity: 100,
      }],
    }),
  ], item())

  assert.equal(resolved.ambiguous, false)
  assert.equal(resolved.mode, 'item_id')
  assert.equal(resolved.lot.id, 'lot-real')
  assert.equal(resolved.balance.logo, 'Ghiền'.normalize('NFD'))
})

test('lot_id là bằng chứng ưu tiên kể cả item đang giữ logo legacy sai', () => {
  const resolved = resolveImportItemLotIdentity([
    balance({
      logo: 'Logo raw trong balance',
      lots: [{ id: 'lot-stale', available_quantity: 100 }],
    }),
  ], item())

  assert.equal(resolved.mode, 'lot_id')
  assert.equal(resolved.balance.logo, 'Logo raw trong balance')
})

test('không lấy legacy opening để che trường hợp lô nuxt đã xuất hết', () => {
  const resolved = resolveImportItemLotIdentity([
    balance({
      lots: [{
        id: 'opening-balance',
        source: 'legacy_opening',
        available_quantity: 100,
      }],
    }),
  ], item())

  assert.equal(resolved.mode, 'unresolved')
  assert.equal(resolved.balance, null)
})

test('dòng legacy có thể đảo từ opening lot khi toàn bộ tồn tương ứng chưa phát sinh lô mới', () => {
  const resolved = resolveImportItemLotIdentity([
    balance({
      logo: 'Ghiền'.normalize('NFD'),
      lots: [{
        id: 'opening-balance',
        source: 'legacy_opening',
        available_quantity: 100,
      }],
    }),
  ], item({
    source: 'legacy',
    legacy_line_key: 'old-row-1',
  }))

  assert.equal(resolved.mode, 'legacy_opening')
  assert.equal(resolved.clearLotId, true)
})

test('wrapper áp dụng resolver cho cả update và delete phiếu nhập', () => {
  const source = readFileSync('composables/useWarehouseTransactionsClient.ts', 'utf8')
  assert.match(source, /resolveImportItemLotIdentity/)
  assert.match(source, /async function updateImportOrder/)
  assert.match(source, /async function deleteImportOrder/)
  assert.match(source, /resolveImportExistingItems/)
  assert.match(source, /base\.updateImportOrder/)
  assert.match(source, /base\.deleteImportOrder/)
})
