import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { importUpdateMode } from '../utils/warehouseImportUpdateMode.mjs'

const source = readFileSync('utils/warehouseLotAllocation.ts', 'utf8')
const transactions = readFileSync('composables/useWarehouseCostTransactions.ts', 'utf8')
const warehouseClient = readFileSync('composables/useWarehouseTransactionsClient.ts', 'utf8')
const productsPage = readFileSync('pages/products.vue', 'utf8')
const settingsPage = readFileSync('pages/settings/general.vue', 'utf8')
const inventoryPage = readFileSync('pages/inventory.vue', 'utf8')
const ordersPage = readFileSync('pages/orders.vue', 'utf8')
const printingPage = readFileSync('pages/printing.vue', 'utf8')
const orderLogic = readFileSync('composables/useOrderLogic.ts', 'utf8')
const warehouseLogic = readFileSync('composables/useWarehouseLogic.ts', 'utf8')
const warehouseFulfillment = readFileSync('utils/warehouseFulfillment.mjs', 'utf8')
const models = readFileSync('types/models.ts', 'utf8')

function oldImportItem(overrides = {}) {
  return {
    id: 'imp__1',
    product_id: 'product-1',
    warehouse_id: 'warehouse-1',
    logo: 'housing',
    quantity: 1000,
    unit: 'Cái',
    unit_cost: 597.22,
    vat_rate: 8,
    expiry_date: '',
    note: '',
    active: true,
    deleted: false,
    ...overrides,
  }
}

function editedImportLine(overrides = {}) {
  return {
    product: { id: 'product-1' },
    warehouse: { id: 'warehouse-1' },
    logo: 'housing',
    quantity: 1000,
    unit: 'Cái',
    unit_cost: 610,
    vat_rate: 10,
    expiry_date: '2027-01-01',
    note: 'điều chỉnh giá',
    ...overrides,
  }
}

test('lot engine supports configured issue policies', () => {
  assert.match(source, /'fifo'/)
  assert.match(source, /'fefo'/)
  assert.match(source, /'smallest_lot_first'/)
})

test('export transaction stores only lot references and quantities', () => {
  assert.match(transactions, /lot_allocations_json/)
  const exportSection = transactions.slice(
    transactions.indexOf('async function createExportOrder'),
    transactions.indexOf('async function createInventoryAdjustment'),
  )
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

test('price VAT expiry supplier-style metadata edits do not require reversing an import lot', () => {
  const mode = importUpdateMode({
    order: { import_date: '2026-08-08' },
    import_date: '2026-08-08',
    existingItems: [oldImportItem()],
    lines: [editedImportLine()],
  })
  assert.equal(mode, 'metadata')
})

test('quantity product warehouse logo or receipt-date changes stay on guarded inventory path', () => {
  const base = {
    order: { import_date: '2026-08-08' },
    import_date: '2026-08-08',
    existingItems: [oldImportItem()],
  }
  assert.equal(importUpdateMode({ ...base, lines: [editedImportLine({ quantity: 999 })] }), 'inventory')
  assert.equal(importUpdateMode({ ...base, lines: [editedImportLine({ product: { id: 'product-2' } })] }), 'inventory')
  assert.equal(importUpdateMode({ ...base, lines: [editedImportLine({ warehouse: { id: 'warehouse-2' } })] }), 'inventory')
  assert.equal(importUpdateMode({ ...base, lines: [editedImportLine({ logo: 'other-logo' })] }), 'inventory')
  assert.equal(importUpdateMode({ ...base, import_date: '2026-08-09', lines: [editedImportLine()] }), 'inventory')
})

test('adding or removing import lines stays on guarded inventory path', () => {
  const base = {
    order: { import_date: '2026-08-08' },
    import_date: '2026-08-08',
    existingItems: [oldImportItem()],
  }
  assert.equal(importUpdateMode({ ...base, lines: [editedImportLine(), editedImportLine()] }), 'inventory')
  assert.equal(importUpdateMode({ ...base, lines: [] }), 'inventory')
})

test('client wrapper uses metadata transaction only for non-inventory edits', () => {
  assert.match(warehouseClient, /importUpdateMode\(input\) === 'metadata'/)
  assert.match(warehouseClient, /updateImportOrderMetadataOnly/)
  assert.match(warehouseClient, /return await base\.updateImportOrder\(input\)/)
  assert.match(warehouseClient, /inventory_unchanged: true/)
  assert.match(warehouseClient, /Lô nhập không còn tồn khả dụng hoặc đã được xuất hết/)
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
  assert.match(inventoryPage, /const costSource = costItem \|\| lotCost \|\| lot/)
})

test('warehouse users can load inventory without reading priced import documents', () => {
  const guardedLoadIndex = inventoryPage.indexOf('if (canViewCost.value)')
  const importLoadIndex = inventoryPage.indexOf('loadImportOrders(force)', guardedLoadIndex)
  const importItemLoadIndex = inventoryPage.indexOf('loadImportOrderItems(force)', guardedLoadIndex)
  assert.ok(guardedLoadIndex >= 0)
  assert.ok(importLoadIndex > guardedLoadIndex)
  assert.ok(importItemLoadIndex > guardedLoadIndex)
})

test('inventory adjustments use manual price for increases and lot allocation for decreases', () => {
  const adjustmentSection = transactions.slice(transactions.indexOf('async function createInventoryAdjustment'))
  assert.match(adjustmentSection, /const increaseCost = quantity > 0 \? importCostFields\(input, quantity\) : null/)
  assert.match(adjustmentSection, /inventory_lot_costs/)
  assert.match(adjustmentSection, /inventory_adjustment_costs/)
  assert.match(adjustmentSection, /allocateManualInventoryLots/)
  assert.match(adjustmentSection, /allocationMode === 'manual'/)
  assert.match(inventoryPage, /unit_cost: delta > 0 \? toNumber\(adjustmentForm\.unit_cost\)/)
  assert.match(inventoryPage, /allocation_mode: delta < 0 \? adjustmentForm\.allocation_mode/)
})
test('order logo color is saved as metadata and shown beside logo', () => {
  assert.match(models, /interface LogoLineDoc[\s\S]*logo_color\?: string/)
  assert.match(orderLogic, /logo_color: String\(line\?\.logo_color \?\? line\?\.color \?\? ''\)/)
  assert.match(ordersPage, /v-model="line\.logo_color"/)
  assert.match(ordersPage, /logo: '', logo_color: ''/)
  assert.match(ordersPage, /<th>Màu<\/th>/)
})

test('warehouse quantity identity uses source row plus logo and ignores logo color', () => {
  assert.match(warehouseLogic, /buildWarehouseFulfillmentRows/)
  assert.match(warehouseFulfillment, /function productLogoKey\(code, logo\)/)
  assert.match(warehouseFulfillment, /function referenceKey\(orderItemId, logo\)/)
  assert.doesNotMatch(warehouseFulfillment, /logo_color/)
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
  assert.match(inventoryPage, /hasActiveImportSource/)
  assert.match(inventoryPage, /activeImportOrderIds\.value\.has\(importOrderId\)/)
  assert.match(inventoryPage, /activeImportItemIds\.value\.has\(importItemId\)/)
  assert.match(inventoryPage, /type\.includes\('transfer_in'\)/)
  assert.match(inventoryPage, /\.filter\(row => row\.has_inbound_history\)/)
  assert.match(inventoryPage, />Hết hàng<\/span>/)
})

test('inventory ignores deleted or cancelled import sources when validating inbound history', () => {
  assert.match(inventoryPage, /function isActiveRecord\(row: any\)/)
  assert.match(inventoryPage, /\['deleted', 'cancelled', 'canceled'\]\.includes/)
  assert.match(inventoryPage, /function lotHasValidInboundOrigin\(lot: any\)/)
  assert.match(inventoryPage, /source === 'import_order'[\s\S]*activeImportOrderIds\.value\.has\(orderId\)/)
})

test('inventory does not show a movement-only outbound row', () => {
  assert.match(inventoryPage, /has_balance: false,[\s\S]*has_inbound_history: false/)
  assert.doesNotMatch(inventoryPage, /Math\.abs\(row\.movement_quantity\)[\s\S]*\.filter/)
})
