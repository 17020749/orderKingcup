import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const releasePage = readFileSync('pages/warehouse-export-requests.vue', 'utf8')
const exportsPage = readFileSync('pages/exports.vue', 'utf8')
const transactions = readFileSync('composables/useWarehouseTransactions.ts', 'utf8')

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
})

test('warehouse transaction resolver accepts ids from line payload shapes', () => {
  const ensureSection = transactions.slice(
    transactions.indexOf('function ensureWarehouse'),
    transactions.indexOf('function ensurePositiveQuantity'),
  )

  assert.match(ensureSection, /warehouse\?\.from_warehouse_id/)
  assert.match(ensureSection, /warehouse\?\.warehouse_id/)
  assert.match(ensureSection, /warehouse\?\.to_warehouse_id/)

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
  assert.match(requestReleaseSection, /line\.from_warehouse_id \|\| line\.warehouse_id \|\| line\.fromWarehouse \|\| line\.warehouse \|\| fallbackWarehouse \|\| line/)
  assert.match(requestReleaseSection, /`kho xuất dòng \$\{index \+ 1\}`/)
})
