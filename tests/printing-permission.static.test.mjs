import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { APP_ACCESS_MODULES } from '../constants/accessMatrix.mjs'

const printDocuments = readFileSync('utils/orderPrintDocuments.ts', 'utf8')
const permissions = readFileSync('constants/permissions.ts', 'utf8')
const printingQueries = readFileSync('composables/usePrintingScopedQueries.ts', 'utf8')
const printingPage = readFileSync('pages/printing.vue', 'utf8')
const routes = readFileSync('constants/appRoutes.ts', 'utf8')
const login = readFileSync('pages/login.vue', 'utf8')
const forbidden = readFileSync('pages/forbidden.vue', 'utf8')
const rules = readFileSync('firestore.rules', 'utf8')

test('all print slips use compact date fields without dotted underlines', () => {
  assert.match(printDocuments, /grid-template-columns: auto 8mm auto 8mm auto 13mm/)
  assert.match(printDocuments, /\.date-value \{[^}]*border-bottom: 0;/)
  assert.doesNotMatch(printDocuments, /\.date-value \{[^}]*border-bottom: 1px dotted/)
})

test('warehouse export packing explanation header uses the common blue header color', () => {
  assert.match(printDocuments, /\.packing-head \{ background: #b9d2f6; \}/)
  assert.match(printDocuments, /class="packing-head">DIỄN GIẢI ĐÓNG GÓI/)
})

test('printing separates operator actions from source-order owner visibility', () => {
  assert.match(permissions, /printing\.orders_view/)
  assert.match(permissions, /Người tạo đơn xem tiến độ đơn của mình/)
  assert.match(permissions, /printing\.view_all/)
  assert.match(printingQueries, /loadOwnSourceOrders/)
  assert.match(printingQueries, /where\(field, 'in', group\)/)
  assert.match(printingQueries, /SAFE_RELATION_QUERY_CHUNK_SIZE/)
  assert.match(printingQueries, /Promise\.allSettled/)
  assert.match(printingQueries, /fetchByIds<PrintOrderDoc>\('print_orders', 'order_id'/)
  assert.match(printingQueries, /fetchByIds<PrintOrderItemDoc>\('print_order_items', 'print_order_id'/)
  assert.match(printingPage, /canViewOwnOrders/)
  assert.match(printingPage, /moduleActionDecision/)
  assert.match(printingPage, /parentOwnerFields: \['owner_email', 'created_by', 'sale_email'\]/)
})

test('read-only source-order owners do not receive printing action buttons', () => {
  assert.match(printingPage, /const canCreate = computed\(\(\) => hasPermission\('printing\.create'\)/)
  assert.match(printingPage, /function canEditOrder/)
  assert.match(printingPage, /function canDeleteOrder/)
  assert.match(printingPage, /v-if="canCreate"/)
  assert.match(printingPage, /v-if="canEditOrder\(row\)"/)
  assert.match(printingPage, /v-if="canDeleteOrder\(row\)"/)
})

test('login and forbidden page use the complete shared route catalog', () => {
  const pagePermissions = new Set(APP_ACCESS_MODULES.map(module => module.permission).filter(Boolean))
  for (const permission of [
    'page.printing',
    'page.inventory',
    'page.imports',
    'page.exports',
    'page.warehouse_export_requests',
    'page.warehouse_settings',
  ]) {
    assert.equal(pagePermissions.has(permission), true, `Access matrix thiếu ${permission}`)
  }
  assert.match(routes, /APP_ACCESS_MODULES\.map/)
  assert.match(login, /firstAllowedAppRoute/)
  assert.doesNotMatch(login, /navigateTo\('\/dashboard'\)/)
  assert.match(forbidden, /firstAllowedAppRoute/)
})

test('Firestore Rules link printing.orders_view to source order ownership', () => {
  assert.match(rules, /printing\.orders_view/)
  assert.match(rules, /ownsOrderById/)
  assert.match(rules, /printingCanReadProgress/)
})
