import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

function read(path) { return readFileSync(path, 'utf8') }
function write(path, content) { writeFileSync(path, content); console.log(`updated ${path}`) }

function replaceOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1
  if (count !== 1) throw new Error(`${label}: expected 1 anchor, found ${count}`)
  return source.replace(anchor, replacement)
}

{
  const path = 'types/models.ts'
  let source = read(path)
  const pattern = /export interface BusTransportDoc \{[\s\S]*?\n\}\n\nexport interface PrintOrderDoc \{/
  const replacement = `export interface BusTransportDoc {
  id: string
  transport_code?: string
  source_request_id?: string
  request_code?: string
  request_status?: string
  export_order_id?: string
  export_order_code?: string
  order_id?: string
  order_code?: string
  customer_id?: string
  customer_name?: string
  receiver_name?: string
  receiver_phone?: string
  receiver_address?: string
  carrier_name?: string
  carrier_phone?: string
  vehicle_plate?: string
  driver_name?: string
  departure_at?: string
  transport_status?: string
  note?: string
  items_json?: string
  status?: string
  active?: boolean
  deleted?: boolean
  created_by?: string
  created_at?: any
  updated_by?: string
  updated_at?: any
  deleted_by?: string
  deleted_at?: any
  source?: string
}

export interface PrintOrderDoc {`
  if (!pattern.test(source)) throw new Error('types/models.ts: BusTransportDoc block not found')
  source = source.replace(pattern, replacement)
  write(path, source)
}

{
  const path = 'firestore.rules'
  let source = read(path)

  const customerRead = `    match /customers/{docId} {
      allow read: if isAdmin()
        || (
          hasPerm('customers.view')
          && (
            hasPerm('customers.view_all')
            || ownEmailField(resource.data, 'created_by')
          )
        );`
  const customerSplitRead = `    match /customers/{docId} {
      allow get: if isAdmin()
        || hasAnyPerm(['export.print', 'bus_transport.view'])
        || (
          hasPerm('customers.view')
          && (
            hasPerm('customers.view_all')
            || ownEmailField(resource.data, 'created_by')
          )
        );
      allow list: if isAdmin()
        || (
          hasPerm('customers.view')
          && (
            hasPerm('customers.view_all')
            || ownEmailField(resource.data, 'created_by')
          )
        );`
  source = replaceOnce(source, customerRead, customerSplitRead, 'customer get/list permissions')

  source = replaceOnce(
    source,
    `    match /orders/{docId} {
      allow read: if hasPerm('orders.view_all')
        || hasPerm('printing.view_all')`,
    `    match /orders/{docId} {
      allow read: if hasPerm('orders.view_all')
        || hasPerm('bus_transport.view')
        || hasPerm('printing.view_all')`,
    'orders bus transport read',
  )

  const requestRead = `    match /order_export_requests/{docId} {
      allow read: if hasAnyPerm([
          'page.warehouse_export_requests',
          'export_requests.accept',
          'export_requests.reject',
          'export_requests.release',
          'export_requests.process'
        ])`
  const requestReadNext = `    match /order_export_requests/{docId} {
      allow read: if hasAnyPerm([
          'page.warehouse_export_requests',
          'export_requests.accept',
          'export_requests.reject',
          'export_requests.release',
          'export_requests.process',
          'bus_transport.view'
        ])`
  source = replaceOnce(source, requestRead, requestReadNext, 'request bus transport read')

  source = replaceOnce(
    source,
    `        && validBoundedString(request.resource.data.get('export_order_id', ''), 1, 200)
        && request.resource.data.get('active', false) == true`,
    `        && validBoundedString(request.resource.data.get('source_request_id', ''), 1, 200)
        && exists(/databases/$(database)/documents/order_export_requests/$(request.resource.data.get('source_request_id', '')))
        && !(get(/databases/$(database)/documents/order_export_requests/$(request.resource.data.get('source_request_id', ''))).data.get('status', '') in ['tu_choi', 'rejected'])
        && request.resource.data.get('active', false) == true`,
    'bus transport create source request',
  )

  source = replaceOnce(
    source,
    `            'id', 'transport_code', 'export_order_id', 'export_order_code',
            'source_request_id', 'order_id', 'order_code', 'created_at', 'created_by',
            'deleted', 'active', 'status', 'deleted_at', 'deleted_by'`,
    `            'id', 'transport_code', 'source_request_id', 'request_code', 'request_status',
            'export_order_id', 'export_order_code', 'order_id', 'order_code',
            'customer_id', 'customer_name', 'created_at', 'created_by',
            'deleted', 'active', 'status', 'deleted_at', 'deleted_by'`,
    'bus transport immutable request identity',
  )

  write(path, source)
}

for (const path of [
  'scripts/apply-bus-transport-followup.mjs',
  '.github/workflows/apply-bus-transport-followup.yml',
]) {
  try { unlinkSync(path); console.log(`removed ${path}`) } catch {}
}
