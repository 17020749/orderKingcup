import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const releasePage = readFileSync('pages/warehouse-export-requests.vue', 'utf8')
const exportsPage = readFileSync('pages/exports.vue', 'utf8')
const transactions = readFileSync('composables/useWarehouseTransactions.ts', 'utf8')
const costTransactions = readFileSync('composables/useWarehouseCostTransactions.ts', 'utf8')
const warehouseCostModule = readFileSync('modules/warehouse-cost.ts', 'utf8')

test('warehouse release client sends selected warehouse id and object per line', () => {
  const submitSection = releasePage.slice(
    releasePage.indexOf('async function submitRelease'),
    releasePage.indexOf('async function submitAction'),
  )

  assert.match(submitSection, /const warehouseId = releaseWarehouseId\(line, line\.__release_index\)/)
  assert.match(submitSection, /const fromWarehouse = findWarehouse\(warehouseId\)/)
  assert.match(submitSection, /fromWarehouse,\s*\n\s*warehouse: fromWarehouse,/)
  assert.match(submitSection, /from_warehouse_id: warehouseId,\s*\n\s*warehouse_id: warehouseId,/)
  assert.match(submitSection, /missingWarehouseDocs/)
})

test('manual transfer export client sends selected source warehouse id and object per line', () => {
  const saveSection = exportsPage.slice(
    exportsPage.indexOf('async function saveExportOrder'),
    exportsPage.indexOf('async function loadRows'),
  )

  assert.match(saveSection, /const missingWarehouseDoc = validLines\.find/)
  assert.match(saveSection, /const fromWarehouse = findWarehouse\(line\.from_warehouse_id\)/)
  assert.match(saveSection, /fromWarehouse,\s*\n\s*warehouse: fromWarehouse,/)
  assert.match(saveSection, /from_warehouse_id: line\.from_warehouse_id,\s*\n\s*warehouse_id: line\.from_warehouse_id,/)
  assert.match(saveSection, /source_logo:\s*\n\s*form\.destination_type === "warehouse"\s*\n\s*\? line\.source_logo \|\| ""/)
  assert.match(saveSection, /target_logo: line\.logo \|\| ""/)
})

test('warehouse transaction resolver accepts ids from line payload shapes', () => {
  const ensureSection = transactions.slice(
    transactions.indexOf('function ensureWarehouse'),
    transactions.indexOf('function ensurePositiveQuantity'),
  )

  assert.match(ensureSection, /warehouse\?\.from_warehouse_id/)
  assert.match(ensureSection, /warehouse\?\.warehouse_id/)
  assert.match(ensureSection, /warehouse\?\.to_warehouse_id/)
  assert.match(ensureSection, /function missingWarehouseError\(fields: string\)/)
  assert.match(ensureSection, /Payload \$\{label\}: \$\{fields \|\| 'rỗng'\}/)
  assert.match(ensureSection, /if \(!id\) throw missingWarehouseError\(warehouse\)/)

  const createSection = transactions.slice(
    transactions.indexOf('async function createExportOrder'),
    transactions.indexOf('const balanceDeltas = new Map<string, BalanceDelta>()', transactions.indexOf('async function createExportOrder')),
  )
  assert.match(createSection, /line\.from_warehouse_id \|\| line\.warehouse_id \|\| line\.fromWarehouse \|\| line\.warehouse \|\| line/)
  assert.match(createSection, /`kho xuất dòng \$\{index \+ 1\}`/)

  const updateSection = transactions.slice(
    transactions.indexOf('async function updateExportOrder'),
    transactions.indexOf('const balanceDeltas = new Map<string, BalanceDelta>()', transactions.indexOf('async function updateExportOrder')),
  )
  assert.match(updateSection, /line\.from_warehouse_id \|\| line\.warehouse_id \|\| line\.fromWarehouse \|\| line\.warehouse \|\| line/)
  assert.match(updateSection, /`kho xuất dòng \$\{index \+ 1\}`/)

  const requestReleaseSection = transactions.slice(
    transactions.indexOf('async function processExportRequestToExportOrder'),
    transactions.indexOf('const balanceDeltas = new Map<string, BalanceDelta>()', transactions.indexOf('async function processExportRequestToExportOrder')),
  )
  assert.match(requestReleaseSection, /ensureWarehouse\(input\.warehouse, 'kho xuất mặc định'\)/)
  assert.match(requestReleaseSection, /line\.from_warehouse_id \|\| line\.warehouse_id \|\| line\.fromWarehouse \|\| line\.warehouse \|\| fallbackWarehouse \|\| line/)
  assert.match(requestReleaseSection, /`kho xuất dòng \$\{index \+ 1\}`/)
})

test('warehouse cost transaction override accepts per-line source warehouses', () => {
  assert.match(warehouseCostModule, /as: 'useWarehouseTransactions'/)

  const ensureSection = costTransactions.slice(
    costTransactions.indexOf('function ensureWarehouse'),
    costTransactions.indexOf('function positiveQuantity'),
  )
  assert.match(ensureSection, /warehouse\?\.from_warehouse_id/)
  assert.match(ensureSection, /warehouse\?\.warehouse_id/)
  assert.match(ensureSection, /if \(!id\) throw missingWarehouseError\(warehouse\)/)

  const prepareSection = costTransactions.slice(
    costTransactions.indexOf('async function prepareExportLines'),
    costTransactions.indexOf('async function createExportOrder'),
  )
  assert.match(prepareSection, /line\.from_warehouse_id \|\| line\.warehouse_id \|\| line\.fromWarehouse \|\| line\.warehouse \|\| line/)
  assert.match(prepareSection, /`kho xuất dòng \$\{index \+ 1\}`/)
  assert.match(prepareSection, /sourceLogo: toWarehouse \? lineSourceLogo\(line\) : lineTargetLogo\(line\)/)
  assert.match(prepareSection, /targetLogo: lineTargetLogo\(line\)/)

  const createSection = costTransactions.slice(
    costTransactions.indexOf('async function createExportOrder'),
    costTransactions.indexOf('async function restoreExistingExportToStates'),
  )
  assert.match(createSection, /warehouse: line\.fromWarehouse, logo: line\.sourceLogo/)
  assert.match(createSection, /warehouse: line\.toWarehouse, logo: line\.targetLogo/)
  assert.match(createSection, /entry\.logo === normalizeLogo\(line\.sourceLogo\)/)
  assert.match(createSection, /entry\.logo === normalizeLogo\(line\.targetLogo\)/)
  assert.match(createSection, /source_logo: normalizeLogo\(line\.sourceLogo\)/)
  assert.match(createSection, /target_logo: normalizeLogo\(line\.targetLogo\)/)
  assert.match(createSection, /logo: line\.sourceLogo/)
  assert.match(createSection, /logo: line\.targetLogo/)

  const requestReleaseSection = costTransactions.slice(
    costTransactions.indexOf('async function processExportRequestToExportOrder'),
    costTransactions.indexOf('const saleRecipients', costTransactions.indexOf('async function processExportRequestToExportOrder')),
  )
  assert.match(requestReleaseSection, /const fallbackWarehouse = input\.warehouse \? ensureWarehouse\(input\.warehouse, 'kho xuất mặc định'\) : null/)
  assert.match(requestReleaseSection, /fromWarehouse: line\.fromWarehouse \|\| line\.warehouse \|\| line\.from_warehouse_id \|\| line\.warehouse_id \|\| fallbackWarehouse/)
  assert.match(requestReleaseSection, /warehouse: line\.fromWarehouse/)
})

test('warehouse cost transaction shortage message includes product warehouse logo and quantities', () => {
  const allocateSection = costTransactions.slice(
    costTransactions.indexOf('function allocateFromState'),
    costTransactions.indexOf('function restoreSourceAllocation'),
  )
  assert.match(allocateSection, /const beforeQuantity = roundQuantity\(state\.quantity\)/)
  assert.match(allocateSection, /productCode\(state\.product\)} - \$\{productName\(state\.product\)\}/)
  assert.match(allocateSection, /warehouseName\(state\.warehouse\)/)
  assert.ok(allocateSection.includes("logoText ? ` / logo ${logoText}` : ' / hàng trơn'"))
  assert.match(allocateSection, /Tồn hiện tại \$\{beforeQuantity\}, cần \$\{roundQuantity\(quantity\)\}/)
})
