import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildStockShortageMessage,
  collectExportStockRequirements,
  inventoryBalanceId,
  preflightExportStock,
  sourceLogoOf,
  targetLogoOf,
} from '../utils/warehouseExportPreflight.mjs'

const product = {
  id: 'product-cup-500',
  product_code: 'CUP-500',
  product_name: 'Ly 500ml',
}
const plainWarehouse = { id: 'warehouse-plain', name: 'Kho trơn' }
const printedWarehouse = { id: 'warehouse-printed', name: 'Kho in' }

function transferLine(overrides = {}) {
  return {
    product,
    fromWarehouse: plainWarehouse,
    from_warehouse_id: plainWarehouse.id,
    toWarehouse: printedWarehouse,
    to_warehouse_id: printedWarehouse.id,
    source_logo: '',
    target_logo: 'A',
    logo: 'A',
    quantity: 5,
    ...overrides,
  }
}

test('chuyển kho dùng logo nguồn trống và logo nhận A độc lập', () => {
  const line = transferLine()
  assert.equal(sourceLogoOf(line, 'warehouse'), '')
  assert.equal(targetLogoOf(line), 'A')

  const [requirement] = collectExportStockRequirements({
    destination_type: 'warehouse',
    lines: [line],
  })
  assert.equal(requirement.warehouseId, plainWarehouse.id)
  assert.equal(requirement.logo, '')
  assert.equal(requirement.targetLogo, 'A')
  assert.equal(requirement.quantity, 5)
})

test('khóa tồn hàng trơn dùng no_logo thay vì logo A của kho nhận', async () => {
  assert.equal(
    await inventoryBalanceId(product.id, plainWarehouse.id, ''),
    `${plainWarehouse.id}__${product.id}__no_logo`,
  )
  assert.notEqual(
    await inventoryBalanceId(product.id, plainWarehouse.id, 'A'),
    `${plainWarehouse.id}__${product.id}__no_logo`,
  )
})

test('preflight đọc tồn hàng trơn ở kho xuất, không đọc logo A của kho nhận', async () => {
  const lookups = []
  const requirements = await preflightExportStock({
    destination_type: 'warehouse',
    lines: [transferLine()],
    async loadBalance(input) {
      lookups.push(input)
      return { quantity: 10 }
    },
  })

  assert.equal(requirements.length, 1)
  assert.equal(lookups.length, 1)
  assert.equal(lookups[0].warehouseId, plainWarehouse.id)
  assert.equal(lookups[0].logo, '')
})

test('cộng gộp nhiều dòng cùng sản phẩm, kho và logo trước khi kiểm tra tồn', () => {
  const [requirement] = collectExportStockRequirements({
    destination_type: 'warehouse',
    lines: [transferLine({ quantity: 4 }), transferLine({ quantity: 7 })],
  })
  assert.equal(requirement.quantity, 11)
})

test('lỗi thiếu tồn nêu sản phẩm, kho, logo, tồn, cần, thiếu và có tồn hay không', async () => {
  await assert.rejects(
    () => preflightExportStock({
      destination_type: 'warehouse',
      lines: [transferLine()],
      async loadBalance() {
        return { quantity: 3 }
      },
    }),
    error => {
      assert.match(error.message, /CUP-500 - Ly 500ml/)
      assert.match(error.message, /kho Kho trơn/)
      assert.match(error.message, /hàng trơn \(không logo\)/)
      assert.match(error.message, /Tồn hiện tại 3, cần 5, thiếu 2/)
      assert.match(error.message, /Sản phẩm có tồn ở kho này: Có/)
      return true
    },
  )
})

test('thông báo nói rõ không có tồn khi số lượng bằng 0', () => {
  const [requirement] = collectExportStockRequirements({
    destination_type: 'warehouse',
    lines: [transferLine()],
  })
  assert.match(buildStockShortageMessage(requirement, 0), /Sản phẩm có tồn ở kho này: Không/)
})

test('Nuxt auto-import dùng wrapper có preflight trước cost transaction', async () => {
  const { readFileSync } = await import('node:fs')
  const moduleSource = readFileSync('modules/warehouse-cost.ts', 'utf8')
  const wrapperSource = readFileSync('composables/useWarehouseTransactionsClient.ts', 'utf8')
  assert.match(moduleSource, /name: 'useWarehouseTransactionsClient'/)
  assert.match(moduleSource, /as: 'useWarehouseTransactions'/)
  assert.match(wrapperSource, /await checkExportStock\(input\)/)
  assert.match(wrapperSource, /return await base\.createExportOrder\(input\)/)
  assert.match(wrapperSource, /await checkExportStock\(preflightInput, 'customer'\)/)
})
