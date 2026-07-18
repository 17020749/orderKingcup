import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const printDocuments = readFileSync('utils/orderPrintDocuments.ts', 'utf8')
const permissions = readFileSync('constants/permissions.ts', 'utf8')
const scopedQueries = readFileSync('composables/useScopedQueries.ts', 'utf8')
const printingPage = readFileSync('pages/printing.vue', 'utf8')
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

test('printing permissions separate own records from view all', () => {
  assert.match(permissions, /printing\.view_all/)
  assert.match(permissions, /Xem tiến độ in ấn của mình/)
  assert.match(scopedQueries, /canAll\('printing\.view_all'\)/)
  assert.match(scopedQueries, /listByEmailFields<PrintOrderDoc>\('print_orders', \['created_by'\]/)
  assert.match(scopedQueries, /listByEmailFields<PrintOrderItemDoc>[\s\S]*\['created_by'\]/)
})

test('printing buttons are ownership aware and reload after auth permissions settle', () => {
  assert.match(printingPage, /function canEditOrder/)
  assert.match(printingPage, /function canDeleteOrder/)
  assert.match(printingPage, /v-if="canEditOrder\(row\)"/)
  assert.match(printingPage, /v-if="canDeleteOrder\(row\)"/)
  assert.match(printingPage, /authReady\.value/)
  assert.match(printingPage, /permissions\.value\.slice\(\)\.sort\(\)/)
  assert.match(printingPage, /void loadRows\(true\)/)
})

test('Firestore Rules enforce creator ownership for print orders and items', () => {
  assert.match(rules, /match \/print_orders\/\{docId\}[\s\S]*hasPerm\('printing\.view_all'\)/)
  assert.match(rules, /match \/print_orders\/\{docId\}[\s\S]*ownsPrintOrderData\(resource\.data\)/)
  assert.match(rules, /match \/print_order_items\/\{docId\}[\s\S]*ownEmailField\(resource\.data, 'created_by'\)/)
  assert.match(rules, /ownsActivePrintOrderAfterById/)
})
