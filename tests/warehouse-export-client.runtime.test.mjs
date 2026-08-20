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
import {
  alignExportRequestLineProduct,
  requestProductIdentityForLine,
} from '../utils/warehouseExportRequestIdentity.mjs'

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

test('xuất từ yêu cầu dùng product_id trong snapshot thay vì product cùng mã được UI tìm nhầm', () => {
  const request = {
    source_items: {
      'order-item-12oz': {
        product_id: 'product-correct-12oz',
        product_code: 'LNPET93-12OZ',
        product_name: 'Ly nhựa PET 93 - 12/14oz (T)',
      },
    },
  }
  const line = {
    source_order_item_id: 'order-item-12oz',
    product: {
      id: 'product-duplicate-wrong',
      product_code: 'LNPET93-12OZ',
      product_name: 'Ly nhựa PET 93 - 12/14oz (T)',
    },
    fromWarehouse: { id: 'a9d45209-25ae-4b76-8c61-e37ec086e8c9', name: 'HÀNG IN' },
    logo: 'Ghiền',
    quantity: 1000,
  }

  const identity = requestProductIdentityForLine(request, line)
  assert.equal(identity.productId, 'product-correct-12oz')

  const aligned = alignExportRequestLineProduct(request, line)
  assert.equal(aligned.product.id, 'product-correct-12oz')
  assert.equal(aligned.product.firestore_id, 'product-correct-12oz')
  assert.equal(aligned.product.product_code, 'LNPET93-12OZ')
  assert.equal(aligned.fromWarehouse.id, 'a9d45209-25ae-4b76-8c61-e37ec086e8c9')
  assert.equal(aligned.logo, 'Ghiền')
  assert.equal(aligned.quantity, 1000)
})

test('product_id cũ trong payload_json vẫn được dùng để căn đúng tồn kho', () => {
  const request = {
    payload_json: JSON.stringify({
      items: [{
        source_order_item_id: 'order-item-16oz',
        product_id: 'product-correct-16oz',
        product_code: 'LNPET93-16OZ',
        logo: 'Ghiền',
      }],
    }),
  }
  const line = {
    source_order_item_id: 'order-item-16oz',
    product: { id: 'wrong-id', product_code: 'LNPET93-16OZ' },
    logo: 'Ghiền',
  }

  const aligned = alignExportRequestLineProduct(request, line)
  assert.equal(aligned.product.id, 'product-correct-16oz')
})

test('dữ liệu yêu cầu cũ không có product_id giữ nguyên product hiện tại', () => {
  const line = {
    source_order_item_id: 'legacy-item',
    product: { id: 'legacy-product', product_code: 'LEGACY' },
  }
  const aligned = alignExportRequestLineProduct({}, line)
  assert.equal(aligned.product.id, 'legacy-product')
})

test('Nuxt auto-import dùng wrapper có preflight trước cost transaction', async () => {
  const { readFileSync } = await import('node:fs')
  const moduleSource = readFileSync('modules/warehouse-cost.ts', 'utf8')
  const wrapperSource = readFileSync('composables/useWarehouseTransactionsClient.ts', 'utf8')
  assert.match(moduleSource, /name: 'useWarehouseTransactionsClient'/)
  assert.match(moduleSource, /as: 'useWarehouseTransactions'/)
  assert.match(wrapperSource, /await checkExportStock\(input\)/)
  assert.match(wrapperSource, /return await base\.createExportOrder\(input\)/)
  assert.match(wrapperSource, /alignExportRequestLineProducts\(input\?\.request \|\| \{\}, linesWithWarehouse\)/)
  assert.match(wrapperSource, /await checkExportStock\(preflightInput, 'customer'\)/)
  assert.match(wrapperSource, /return await base\.processExportRequestToExportOrder\(preflightInput\)/)
})

test('tạo phiếu xuất/chuyển kho không tham chiếu biến adjustment chưa khai báo', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync('composables/useWarehouseCostTransactions.ts', 'utf8')
  const start = source.indexOf('async function createExportOrder(input: any)')
  const end = source.indexOf('async function restoreExistingExportToStates', start)
  assert.ok(start >= 0 && end > start)

  const createExportSource = source.slice(start, end)
  assert.doesNotMatch(createExportSource, /adjustmentCostItemId|adjustmentCostItemSnap/)
})
