from pathlib import Path
import re


def exact(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f'{path}: expected {count} exact matches, found {actual}: {old[:120]}')
    p.write_text(text.replace(old, new, count))


def regex(path, pattern, replacement, count=1, flags=0):
    p = Path(path)
    text = p.read_text()
    updated, actual = re.subn(pattern, replacement, text, count=count, flags=flags)
    if actual != count:
        raise SystemExit(f'{path}: expected {count} regex matches, found {actual}: {pattern[:160]}')
    p.write_text(updated)


exact(
    'constants/permissions.ts',
    "  { key: 'invoices.view', group: 'Hóa đơn', name: 'Xem dữ liệu' },\n  { key: 'invoices.create', group: 'Hóa đơn', name: 'Thêm dữ liệu' },",
    "  { key: 'invoices.view', group: 'Hóa đơn', name: 'Xem hóa đơn của mình' },\n  { key: 'invoices.view_all', group: 'Hóa đơn', name: 'Xem tất cả hóa đơn', emphasis: 'scope' },\n  { key: 'invoices.create', group: 'Hóa đơn', name: 'Thêm dữ liệu' },",
)
exact(
    'constants/accessMatrix.mjs',
    "  'export_requests.view_all': ['page.export_requests'],",
    "  'export_requests.view_all': ['page.export_requests', 'orders.view_all'],",
)
exact(
    'constants/accessMatrix.mjs',
    "  'invoices.view': ['page.invoices', 'orders.view'],\n  'invoices.create': ['page.invoices', 'invoices.view', 'orders.view'],",
    "  'invoices.view': ['page.invoices', 'orders.view'],\n  'invoices.view_all': ['page.invoices', 'orders.view_all'],\n  'invoices.create': ['page.invoices', 'invoices.view', 'orders.view'],",
)
exact(
    'composables/useScopedQueries.ts',
    "    if (!isAdminUser()) return fullCursorPage(await loadScopedInvoices(force))",
    "    if (!canAll('invoices.view_all')) return fullCursorPage(await loadScopedInvoices(force))",
)
exact(
    'composables/useScopedQueries.ts',
    "  async function loadScopedInvoices(force = false) {\n    if (isAdminUser()) {",
    "  async function loadScopedInvoices(force = false) {\n    if (canAll('invoices.view_all')) {",
)

exact(
    'firestore.rules',
    "          isAdmin()\n          || ownsOrderData(order)",
    "          isAdmin()\n          || hasPerm('orders.view_all')\n          || ownsOrderData(order)",
    count=2,
)
regex(
    'firestore.rules',
    r"hasPerm\('orders\.delete'\)\s*&& ownsOrderData\(resource\.data\)\s*&& orderIdentityUnchanged\(\)",
    "hasPerm('orders.delete')\n          && (\n            hasPerm('orders.view_all')\n            || ownsOrderData(resource.data)\n          )\n          && orderIdentityUnchanged()",
)
regex(
    'firestore.rules',
    r"hasPerm\('orders\.edit'\)\s*&& ownsOrderData\(resource\.data\)\s*&& orderIdentityUnchanged\(\)",
    "hasPerm('orders.edit')\n          && (\n            hasPerm('orders.view_all')\n            || ownsOrderData(resource.data)\n          )\n          && orderIdentityUnchanged()",
)
regex(
    'firestore.rules',
    r"hasPerm\('orders\.delete'\)\s*&& ownsOrderData\(resource\.data\)\s*&& orderCanBeDeleted\(\)",
    "hasPerm('orders.delete')\n          && (\n            hasPerm('orders.view_all')\n            || ownsOrderData(resource.data)\n          )\n          && orderCanBeDeleted()",
)
regex(
    'firestore.rules',
    r"hasAnyPerm\(\['export_requests\.delete', 'orders\.delete'\]\)\s*&& ownsOrderChildData\(resource\.data\);",
    "hasAnyPerm(['export_requests.delete', 'orders.delete'])\n        && (\n          hasPerm('export_requests.view_all')\n          || ownsOrderChildData(resource.data)\n        );",
)
regex(
    'firestore.rules',
    r"hasPerm\('orders\.warehouse_export'\)\s*&& ownsOrderChildData\(resource\.data\)\s*&& ownEmailField\(request\.resource\.data, 'updated_by'\);",
    "hasPerm('orders.warehouse_export')\n        && (\n          hasPerm('export_requests.view_all')\n          || ownsOrderChildData(resource.data)\n        )\n        && ownEmailField(request.resource.data, 'updated_by');",
)
regex(
    'firestore.rules',
    r"match /invoices/\{docId\} \{\s*allow read: if isAdmin\(\)\s*\|\| \(\s*hasPerm\('invoices\.view'\)\s*&& \(\s*ownsOrderChildData\(resource\.data\)\s*\|\| \(\s*resource\.data\.order_id is string\s*&& ownsOrderById\(resource\.data\.order_id\)\s*\)\s*\)\s*\);",
    "match /invoices/{docId} {\n      allow read: if hasPerm('invoices.view_all')\n        || (\n          hasAnyPerm([\n            'invoices.view',\n            'invoices.create',\n            'invoices.edit',\n            'invoices.delete'\n          ])\n          && (\n            hasPerm('orders.view_all')\n            || ownsOrderChildData(resource.data)\n            || (\n              resource.data.order_id is string\n              && ownsOrderById(resource.data.order_id)\n            )\n          )\n        );",
    flags=re.S,
)

permission_test = Path('tests/permission-matrix.client.test.mjs')
text = permission_test.read_text()
if 'view_all mở rộng đúng scope nhưng không tự cấp action' not in text:
    text += r'''

test('view_all mở rộng đúng scope nhưng không tự cấp action', () => {
  const cases = [
    ['orders.view_all', 'page.orders', null],
    ['export_requests.view_all', 'page.export_requests', 'orders.view_all'],
    ['payments.view_all', 'page.payments', 'orders.view_all'],
    ['invoices.view_all', 'page.invoices', 'orders.view_all'],
    ['shipments.view_all', 'page.shipments', 'orders.view_all'],
  ]
  for (const [permission, pagePermission, orderScope] of cases) {
    const grants = grantSet(permission)
    assert.equal(grants.has(permission), true)
    assert.equal(grants.has(pagePermission), true)
    if (orderScope) assert.equal(grants.has(orderScope), true)
  }
  const allOnly = resolvePermissionDependencies(cases.map(([permission]) => permission))
  for (const action of [
    'orders.edit', 'orders.delete',
    'orders.warehouse_export', 'export_requests.delete',
    'payments.edit', 'payments.delete',
    'invoices.edit', 'invoices.delete',
    'shipments.edit', 'shipments.delete',
  ]) assert.equal(allOnly.includes(action), false, `${action} không được tự cấp từ view_all`)
})
'''
    permission_test.write_text(text)

Path('tests/view-all-action-scopes.client.test.mjs').write_text(r'''import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const accessMatrix = readFileSync('constants/accessMatrix.mjs', 'utf8')
const scopedQueries = readFileSync('composables/useScopedQueries.ts', 'utf8')
const firestoreRules = readFileSync('firestore.rules', 'utf8')
const pages = {
  orders: readFileSync('pages/orders.vue', 'utf8'),
  requests: readFileSync('pages/export-requests.vue', 'utf8'),
  payments: readFileSync('pages/payments.vue', 'utf8'),
  invoices: readFileSync('pages/invoices.vue', 'utf8'),
  shipments: readFileSync('pages/shipments.vue', 'utf8'),
}

test('view_all chỉ mở rộng dữ liệu, action vẫn là quyền riêng', () => {
  for (const permission of ['orders', 'export_requests', 'payments', 'invoices', 'shipments']) {
    assert.match(scopedQueries, new RegExp(`canAll\\('${permission}\\.view_all'\\)`))
  }
  assert.match(pages.orders, /hasPermission\('orders\.edit'\)/)
  assert.match(pages.orders, /hasPermission\('orders\.delete'\)/)
  assert.match(pages.requests, /hasPermission\("orders\.warehouse_export"\)/)
  assert.match(pages.requests, /hasPermission\("export_requests\.delete"\)/)
  for (const module of ['payments', 'invoices', 'shipments']) {
    assert.match(pages[module], new RegExp(`hasPermission\\('${module}\\.edit'\\)`))
    assert.match(pages[module], new RegExp(`hasPermission\\('${module}\\.delete'\\)`))
  }
})

test('các page quan hệ kéo theo orders.view_all', () => {
  for (const permission of ['export_requests', 'payments', 'invoices', 'shipments']) {
    assert.match(accessMatrix, new RegExp(`'${permission}\\.view_all': \\[[^\\]]*'orders\\.view_all'`))
  }
})

test('rules ghép all-scope với action và giữ printing độc lập', () => {
  assert.match(firestoreRules, /hasPerm\('orders\.edit'\)[\s\S]*hasPerm\('orders\.view_all'\)/)
  assert.match(firestoreRules, /hasPerm\('orders\.delete'\)[\s\S]*hasPerm\('orders\.view_all'\)/)
  assert.match(firestoreRules, /hasPerm\('orders\.warehouse_export'\)[\s\S]*hasPerm\('export_requests\.view_all'\)/)
  assert.match(firestoreRules, /match \/invoices\/\{docId\} \{[\s\S]*hasPerm\('invoices\.view_all'\)/)
  assert.doesNotMatch(accessMatrix, /'printing\.view_all': \[[^\]]*'orders\.view_all'/)
})
''')

package = Path('package.json')
text = package.read_text()
old = 'tests/shipment-permission-flow.client.test.mjs tests/shipment-permissions.rules.test.mjs\\"'
new = 'tests/shipment-permission-flow.client.test.mjs tests/shipment-permissions.rules.test.mjs tests/view-all-action-scopes.client.test.mjs\\"'
if old not in text:
    raise SystemExit('package.json test:rules tail mismatch')
package.write_text(text.replace(old, new, 1))
