import { readFileSync, writeFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

function write(path, content) {
  writeFileSync(path, content)
  console.log(`updated ${path}`)
}

function replaceOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, found ${count}`)
  return source.replace(anchor, replacement)
}

function insertBeforeOnce(source, anchor, insertion, label) {
  return replaceOnce(source, anchor, `${insertion}${anchor}`, label)
}

function appendTests(command, tests) {
  let next = command
  for (const test of tests) {
    if (next.includes(test)) continue
    const lastQuote = next.lastIndexOf('"')
    if (lastQuote < 0) throw new Error(`Cannot append ${test}: test command has no closing quote`)
    next = `${next.slice(0, lastQuote)} ${test}${next.slice(lastQuote)}`
  }
  return next
}

{
  const path = 'types/models.ts'
  let source = read(path)
  if (!source.includes('export interface BusTransportDoc')) {
    const insertion = `export interface BusTransportDoc {\n  id: string\n  transport_code?: string\n  export_order_id: string\n  export_order_code?: string\n  source_request_id?: string\n  order_id?: string\n  order_code?: string\n  customer_name?: string\n  receiver_name?: string\n  receiver_phone?: string\n  receiver_address?: string\n  carrier_name?: string\n  carrier_phone?: string\n  vehicle_plate?: string\n  driver_name?: string\n  departure_at?: string\n  transport_status?: string\n  note?: string\n  items_json?: string\n  status?: string\n  active?: boolean\n  deleted?: boolean\n  created_by?: string\n  created_at?: any\n  updated_by?: string\n  updated_at?: any\n  deleted_by?: string\n  deleted_at?: any\n  source?: string\n}\n\n`
    source = insertBeforeOnce(source, 'export interface PrintOrderDoc {', insertion, 'types/models.ts BusTransportDoc')
    write(path, source)
  }
}

{
  const path = 'constants/permissions.ts'
  let source = read(path)
  if (!source.includes("key: 'page.bus_transport'")) {
    source = replaceOnce(
      source,
      "  { key: 'page.shipments', group: 'Vận chuyển', name: 'Xem tab Vận chuyển' },",
      "  { key: 'page.shipments', group: 'Vận chuyển', name: 'Xem tab Vận chuyển' },\n  { key: 'page.bus_transport', group: 'Vận chuyển nhà xe', name: 'Xem tab Vận chuyển nhà xe' },",
      'permissions page.bus_transport',
    )
  }
  if (!source.includes("key: 'bus_transport.view'")) {
    source = replaceOnce(
      source,
      "  { key: 'shipments.delete', group: 'Vận chuyển', name: 'Xóa vận chuyển' },",
      "  { key: 'shipments.delete', group: 'Vận chuyển', name: 'Xóa vận chuyển' },\n\n  { key: 'bus_transport.view', group: 'Vận chuyển nhà xe', name: 'Xem tất cả đơn vận chuyển nhà xe' },\n  { key: 'bus_transport.create', group: 'Vận chuyển nhà xe', name: 'Tạo đơn vận chuyển nhà xe' },\n  { key: 'bus_transport.edit', group: 'Vận chuyển nhà xe', name: 'Sửa đơn vận chuyển nhà xe' },\n  { key: 'bus_transport.delete', group: 'Vận chuyển nhà xe', name: 'Xóa đơn vận chuyển nhà xe' },",
      'permissions bus_transport actions',
    )
  }
  write(path, source)
}

{
  const path = 'constants/accessMatrix.mjs'
  let source = read(path)
  if (!source.includes("key: 'bus_transport'")) {
    source = replaceOnce(
      source,
      "  { key: 'shipments', path: '/shipments', label: 'Vận chuyển', permission: 'page.shipments', navSection: 'warehouse', navOrder: 70 },",
      "  { key: 'shipments', path: '/shipments', label: 'Vận chuyển', permission: 'page.shipments', navSection: 'warehouse', navOrder: 70 },\n  { key: 'bus_transport', path: '/bus-transport', label: 'Vận chuyển nhà xe', permission: 'page.bus_transport', navSection: 'warehouse', navOrder: 80 },",
      'access matrix bus_transport module',
    )
  }
  if (!source.includes("'page.bus_transport': ['bus_transport.view']")) {
    source = replaceOnce(
      source,
      "  'shipments.delete': ['page.shipments', 'shipments.view', 'orders.view'],\n\n  'page.invoices':",
      "  'shipments.delete': ['page.shipments', 'shipments.view', 'orders.view'],\n\n  'page.bus_transport': ['bus_transport.view'],\n  'bus_transport.view': ['page.bus_transport'],\n  'bus_transport.create': ['page.bus_transport', 'bus_transport.view'],\n  'bus_transport.edit': ['page.bus_transport', 'bus_transport.view'],\n  'bus_transport.delete': ['page.bus_transport', 'bus_transport.view'],\n\n  'page.invoices':",
      'access matrix bus_transport dependencies',
    )
  }
  write(path, source)
}

{
  const path = 'pages/warehouse-export-requests.vue'
  let source = read(path)
  if (!source.includes('<WarehousePrintMenu')) {
    source = replaceOnce(
      source,
      '                  <button class="btn-sm" @click="openDetail(row)">Xem</button>',
      '                  <button class="btn-sm" @click="openDetail(row)">Xem</button>\n                  <WarehousePrintMenu :request="row" :order="orders.find(item => item.id === row.order_id) || null" />',
      'warehouse export request print menu',
    )
    write(path, source)
  }
}

{
  const path = 'firestore.rules'
  let source = read(path)
  const oldRead = "allow read: if hasAnyPerm(['export.view', 'export_requests.release', 'export_requests.process']);"
  const newRead = "allow read: if hasAnyPerm(['export.view', 'export_requests.release', 'export_requests.process', 'bus_transport.view']);"
  if (!source.includes(newRead)) {
    const count = source.split(oldRead).length - 1
    if (count !== 2) throw new Error(`firestore export read grants: expected 2 anchors, found ${count}`)
    source = source.split(oldRead).join(newRead)
  }

  if (!source.includes('match /bus_transport_orders/{docId}')) {
    const insertion = `    match /bus_transport_orders/{docId} {\n      allow read: if hasPerm('bus_transport.view');\n\n      allow create: if hasPerm('bus_transport.create')\n        && request.resource.data.get('id', '') == docId\n        && validBoundedString(request.resource.data.get('transport_code', ''), 1, 200)\n        && validBoundedString(request.resource.data.get('export_order_id', ''), 1, 200)\n        && request.resource.data.get('active', false) == true\n        && request.resource.data.get('deleted', true) == false\n        && request.resource.data.get('created_at', null) is timestamp\n        && request.resource.data.get('created_at', null) == request.time\n        && ownEmailField(request.resource.data, 'created_by');\n\n      allow update: if isAdmin()\n        || (\n          hasPerm('bus_transport.edit')\n          && unchanged([\n            'id', 'transport_code', 'export_order_id', 'export_order_code',\n            'source_request_id', 'order_id', 'order_code', 'created_at', 'created_by',\n            'deleted', 'active', 'status', 'deleted_at', 'deleted_by'\n          ])\n          && request.resource.data.get('active', false) == true\n          && request.resource.data.get('deleted', true) == false\n          && ownEmailField(request.resource.data, 'updated_by')\n        )\n        || (\n          hasPerm('bus_transport.delete')\n          && onlyChanged([\n            'deleted', 'active', 'status', 'deleted_at', 'deleted_by',\n            'updated_at', 'updated_by'\n          ])\n          && request.resource.data.get('deleted', false) == true\n          && request.resource.data.get('active', true) == false\n          && request.resource.data.get('status', '') == 'deleted'\n          && request.resource.data.get('deleted_at', null) is timestamp\n          && request.resource.data.get('deleted_at', null) == request.time\n          && ownEmailField(request.resource.data, 'deleted_by')\n          && ownEmailField(request.resource.data, 'updated_by')\n        );\n\n      allow delete: if isAdmin();\n    }\n\n`
    source = insertBeforeOnce(source, '    match /invoices/{docId} {', insertion, 'firestore bus_transport match')
  }
  write(path, source)
}

{
  const path = 'package.json'
  const pkg = JSON.parse(read(path))
  pkg.scripts['test:rules'] = appendTests(pkg.scripts['test:rules'], [
    'tests/bus-transport-permissions.rules.test.mjs',
    'tests/bus-transport-permission-matrix.client.test.mjs',
    'tests/warehouse-print-menu.static.test.mjs',
  ])
  pkg.scripts['test:permissions'] = appendTests(pkg.scripts['test:permissions'], [
    'tests/bus-transport-permissions.rules.test.mjs',
    'tests/bus-transport-permission-matrix.client.test.mjs',
  ])
  write(path, `${JSON.stringify(pkg, null, 2)}\n`)
}

console.log('bus transport feature patches applied')
