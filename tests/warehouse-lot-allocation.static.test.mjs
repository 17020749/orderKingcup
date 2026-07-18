import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync('utils/warehouseLotAllocation.ts', 'utf8')
const transactions = readFileSync('composables/useWarehouseCostTransactions.ts', 'utf8')
const productsPage = readFileSync('pages/products.vue', 'utf8')
const settingsPage = readFileSync('pages/settings/general.vue', 'utf8')
const inventoryPage = readFileSync('pages/inventory.vue', 'utf8')
const ordersPage = readFileSync('pages/orders.vue', 'utf8')
const printingPage = readFileSync('pages/printing.vue', 'utf8')
const orderLogic = readFileSync('composables/useOrderLogic.ts', 'utf8')
const warehouseLogic = readFileSync('composables/useWarehouseLogic.ts', 'utf8')
const models = readFileSync('types/models.ts', 'utf8')

test('lot engine supports configured issue policies', () => {
  assert.match(source, /'fifo'/)
  assert.match(source, /'fefo'/)
  assert.match(source, /'smallest_lot_first'/)
})

test('export transaction stores only lot references and quantities', () => {
  assert.match(transactions, /lot_allocations_json/)
  const exportSection = transactions.slice(transactions.indexOf('async function createExportOrder'))
  assert.doesNotMatch(exportSection, /unit_cost\s*:/)
  assert.doesNotMatch(exportSection, /line_cost\s*:/)
})

test('priced fields are limited to import transaction payloads', () => {
  const importSection = transactions.slice(
    transactions.indexOf('async function createImportOrder'),
    transactions.indexOf('async function prepareExportLines'),
  )
  assert.match(importSection, /unit_cost:/)
  assert.match(importSection, /line_cost:/)
})

test('product catalog removes legacy cost_price and settings provides migration', () => {
  assert.match(productsPage, /cost_price:\s*deleteField\(\)/)
  assert.doesNotMatch(productsPage, /Giá vốn/)
  assert.match(settingsPage, /cleanupLegacyProductCosts/)
  assert.match(settingsPage, /cost_price:\s*deleteField\(\)/)
})

test('inventory cost details require import.view and join prices only in the viewer', () => {
  assert.match(inventoryPage, /hasPermission\('import\.view'\)/)
  assert.match(inventoryPage, /if \(canViewCost\.value\)/)
  assert.match(inventoryPage, /loadImportOrderItems\(force\)/)
  assert.match(inventoryPage, /Các lô giá/)
  assert.match(inventoryPage, /Giá trị còn lại/)
  assert.match(inventoryPage, /costItem as any\)\.unit_cost/)
})

test('warehouse users can load inventory without reading priced import documents', () => {
  const guardedLoadIndex = inventoryPage.indexOf('if (canViewCost.value)')
  const importLoadIndex = inventoryPage.indexOf('loadImportOrders(force)', guardedLoadIndex)
  const importItemLoadIndex = inventoryPage.indexOf('loadImportOrderItems(force)', guardedLoadIndex)
  assert.ok(guardedLoadIndex >= 0)
  assert.ok(importLoadIndex > guardedLoadIndex)
  assert.ok(importItemLoadIndex > guardedLoadIndex)
})

test('order logo color is saved as metadata and shown beside logo', () => {
  assert.match(models, /interface LogoLineDoc[\s\S]*logo_color\?: string/)
  assert.match(orderLogic, /logo_color: String\(line\?\.logo_color \?\? line\?\.color \?\? ''\)/)
  assert.match(ordersPage, /v-model="line\.logo_color"/)
  assert.match(ordersPage, /logo: '', logo_color: ''/)
  assert.match(ordersPage, /<th>Màu<\/th>/)
})

test('warehouse quantity identity remains product plus logo only', () => {
  assert.match(warehouseLogic, /function key\(code: any, logo: any\)/)
  assert.doesNotMatch(warehouseLogic, /logo_color/)
  assert.match(ordersPage, /const key = `\$\{String\(item\.product_code[\s\S]*\|\$\{String\(line\.logo/)
})

test('printing source order includes only products with valid logo lines', () => {
  assert.match(printingPage, /item\.order_id === orderId[\s\S]*sourceLogoLines\(item\)\.length > 0/)
  const sourceSection = printingPage.slice(
    printingPage.indexOf('function groupsFromSourceOrder'),
    printingPage.indexOf('function chooseSourceOrder'),
  )
  assert.doesNotMatch(sourceSection, /blankProductGroup\(\{[\s\S]*print_quantity: toNumber\(item\.quantity\)/)
  assert.match(sourceSection, /logo_color: String\(line\.logo_color \|\| line\.color \|\| ''\)/)
})

test('inventory keeps zero stock after import or transfer-in history', () => {
  assert.match(inventoryPage, /has_inbound_history: boolean/)
  assert.match(inventoryPage, /qualifiesAsInboundHistory = quantity > 0/)
  assert.match(inventoryPage, /type\.includes\('transfer_in'\)/)
  assert.match(inventoryPage, /\.filter\(row => row\.has_inbound_history\)/)
  assert.match(inventoryPage, />Hết hàng<\/span>/)
})

test('inventory does not show a movement-only outbound row', () => {
  assert.match(inventoryPage, /has_balance: false,[\s\S]*has_inbound_history: false/)
  assert.doesNotMatch(inventoryPage, /Math\.abs\(row\.movement_quantity\)[\s\S]*\.filter/)
})
