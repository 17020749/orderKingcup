#!/usr/bin/env node

import { createHash, createSign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const LOCKED_PROJECT_ID = 'orderfirestore-501909'
const DATABASE_ID = '(default)'
const MAX_ATOMIC_WRITES = 450
const PAGE_SIZE = 300
const EPSILON = 0.0001
const CONFIRM_TEXT = 'DELETE_TEST_ORDER_DATA'

const CHILD_COLLECTIONS = [
  'order_items',
  'payments',
  'shipments',
  'invoices',
]

const READ_COLLECTIONS = [
  'orders',
  ...CHILD_COLLECTIONS,
  'order_export_requests',
  'export_orders',
  'export_order_items',
  'stock_movements',
  'inventory_balances',
  'notifications',
  'activity_logs',
  'warehouse_export_logs',
]

function parseArgs(argv) {
  const values = new Map()
  const flags = new Set()

  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const body = arg.slice(2)
    const separator = body.indexOf('=')
    if (separator === -1) flags.add(body)
    else values.set(body.slice(0, separator), body.slice(separator + 1))
  }

  const orderIds = String(values.get('order-id') || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

  return {
    execute: flags.has('execute'),
    dryRun: !flags.has('execute'),
    projectId: values.get('project') || process.env.FIREBASE_PROJECT_ID || LOCKED_PROJECT_ID,
    actor: String(values.get('actor') || process.env.CLEANUP_ACTOR_EMAIL || '').trim().toLowerCase(),
    confirm: values.get('confirm') || '',
    scope: values.get('scope') || '',
    orderIds,
  }
}

function printUsage() {
  console.log(`\nDọn dữ liệu test liên quan đơn hàng, giữ nguyên nhập kho thật.\n\nChạy thử toàn bộ đơn hiện tại:\n  npm run cleanup:test-orders -- --scope=all-orders\n\nChạy thử một số đơn:\n  npm run cleanup:test-orders -- --order-id=ORDER_ID_1,ORDER_ID_2\n\nXóa thật toàn bộ đơn hiện tại:\n  npm run cleanup:test-orders -- --execute --scope=all-orders --actor=admin@example.com --confirm=${CONFIRM_TEXT}\n\nXóa thật một số đơn:\n  npm run cleanup:test-orders -- --execute --order-id=ORDER_ID_1,ORDER_ID_2 --actor=admin@example.com --confirm=${CONFIRM_TEXT}\n\nXác thực hỗ trợ:\n  1. GOOGLE_OAUTH_ACCESS_TOKEN\n  2. GOOGLE_APPLICATION_CREDENTIALS trỏ tới service-account JSON\n  3. gcloud auth application-default print-access-token\n`)
}

function assertArguments(args) {
  if (args.projectId !== LOCKED_PROJECT_ID) {
    throw new Error(`Script bị khóa cho project ${LOCKED_PROJECT_ID}; project nhận được là ${args.projectId}.`)
  }

  if (!args.orderIds.length && args.scope !== 'all-orders') {
    throw new Error('Phải dùng --scope=all-orders hoặc --order-id=id1,id2. Không tự suy đoán phạm vi xóa.')
  }

  if (args.execute) {
    if (args.confirm !== CONFIRM_TEXT) {
      throw new Error(`Thiếu mã xác nhận. Cần --confirm=${CONFIRM_TEXT}.`)
    }
    if (!args.actor || !args.actor.includes('@')) {
      throw new Error('Khi --execute phải có --actor=email_admin để ghi activity_logs.')
    }
  }
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

async function tokenFromServiceAccount(filePath) {
  const absolutePath = resolve(filePath)
  if (!existsSync(absolutePath)) {
    throw new Error(`Không tìm thấy GOOGLE_APPLICATION_CREDENTIALS: ${absolutePath}`)
  }

  const credentials = JSON.parse(readFileSync(absolutePath, 'utf8'))
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Service-account JSON thiếu client_email hoặc private_key.')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))
  const unsigned = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  signer.end()
  const signature = signer
    .sign(credentials.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  })

  const body = await response.json()
  if (!response.ok || !body.access_token) {
    throw new Error(`Không lấy được access token từ service account: ${JSON.stringify(body)}`)
  }
  return body.access_token
}

async function getAccessToken() {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) {
    return process.env.GOOGLE_OAUTH_ACCESS_TOKEN.trim()
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return tokenFromServiceAccount(process.env.GOOGLE_APPLICATION_CREDENTIALS)
  }

  try {
    return execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    throw new Error('Chưa có thông tin xác thực. Hãy đặt GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_OAUTH_ACCESS_TOKEN, hoặc đăng nhập gcloud Application Default Credentials.')
  }
}

function decodeValue(value = {}) {
  if ('nullValue' in value) return null
  if ('stringValue' in value) return value.stringValue
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('timestampValue' in value) return value.timestampValue
  if ('referenceValue' in value) return value.referenceValue
  if ('bytesValue' in value) return value.bytesValue
  if ('geoPointValue' in value) return value.geoPointValue
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {})
  return undefined
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]))
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Không thể ghi số không hợp lệ: ${value}`)
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } }
  if (typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)])) } }
  }
  return { stringValue: String(value) }
}

function encodeFields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encodeValue(value)]))
}

function documentId(name) {
  return String(name || '').split('/').pop() || ''
}

function documentPath(projectId, collectionName, id) {
  return `projects/${projectId}/databases/${DATABASE_ID}/documents/${collectionName}/${id}`
}

async function firestoreFetch(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  })

  if (response.status === 404 && options.allowNotFound) return null
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    throw new Error(`Firestore REST ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  }
  return body
}

async function listCollection(projectId, collectionName, token) {
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${DATABASE_ID}/documents/${collectionName}`
  const documents = []
  let pageToken = ''

  do {
    const url = new URL(base)
    url.searchParams.set('pageSize', String(PAGE_SIZE))
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const body = await firestoreFetch(url, token, { method: 'GET', allowNotFound: true })
    if (!body) break
    for (const raw of body.documents || []) {
      documents.push({
        id: documentId(raw.name),
        name: raw.name,
        data: decodeFields(raw.fields || {}),
        raw,
      })
    }
    pageToken = body.nextPageToken || ''
  } while (pageToken)

  return documents
}

function normalizeLogo(value) {
  return String(value || '').trim()
}

function safeDocId(value, prefix = 'doc') {
  let id = String(value || '').trim() || `${prefix}_${Date.now()}`
  id = id.replace(/[\\/?#\[\]]/g, '_').replace(/\s+/g, '_')
  if (!id || id === '.' || id === '..' || /^__.*__$/.test(id)) id = `${prefix}_${Date.now()}`
  if (id.length > 900) id = `${prefix}_${id.slice(0, 120)}_${Date.now()}`
  return id
}

function inventoryBalanceId(productId, warehouseId, logo) {
  const logoText = normalizeLogo(logo)
  const logoKey = logoText
    ? createHash('sha256').update(logoText).digest('hex').slice(0, 24)
    : 'no_logo'
  return safeDocId(`${warehouseId}__${productId}__${logoKey}`, 'balance')
}

function inventoryKey(data) {
  return [
    String(data?.warehouse_id || '').trim(),
    String(data?.product_id || '').trim(),
    normalizeLogo(data?.logo),
  ].join('|')
}

function isActive(data) {
  return data?.deleted !== true && data?.active !== false
}

function asString(value) {
  return String(value || '').trim()
}

function anyStringContains(value, candidates) {
  if (!value) return false
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return Array.from(candidates).some(candidate => candidate && text.includes(candidate))
}

function collectIdentityValues(documents, fields = []) {
  const values = new Set()
  for (const document of documents) {
    values.add(document.id)
    for (const field of fields) {
      const value = asString(document.data?.[field])
      if (value) values.add(value)
    }
  }
  return values
}

function selectPlan(all, args) {
  const requestedOrderIds = new Set(args.orderIds)
  const selectedOrders = args.scope === 'all-orders'
    ? all.orders
    : all.orders.filter(document => requestedOrderIds.has(document.id))

  if (args.orderIds.length) {
    const found = new Set(selectedOrders.map(document => document.id))
    const missing = args.orderIds.filter(id => !found.has(id))
    if (missing.length) throw new Error(`Không tìm thấy order_id: ${missing.join(', ')}`)
  }

  const orderIds = collectIdentityValues(selectedOrders, ['id'])
  const orderCodes = collectIdentityValues(selectedOrders, ['order_code', 'code'])

  const selectedChildren = Object.fromEntries(CHILD_COLLECTIONS.map(collectionName => [
    collectionName,
    all[collectionName].filter(document => orderIds.has(asString(document.data?.order_id))),
  ]))

  const selectedRequests = args.scope === 'all-orders'
    ? all.order_export_requests
    : all.order_export_requests.filter(document => orderIds.has(asString(document.data?.order_id)))

  const requestIds = collectIdentityValues(selectedRequests, [
    'id', 'request_id', 'warehouse_export_id', 'warehouse_export_order_id', 'export_order_id',
  ])
  const requestDocIds = new Set(selectedRequests.map(document => document.id))
  const requestCodes = collectIdentityValues(selectedRequests, ['request_id'])

  const selectedExportOrders = all.export_orders.filter(document => {
    const data = document.data || {}
    const sourceRequestId = asString(data.source_request_id)
    const syncSource = asString(data.sync_source)
    const source = asString(data.source)
    const deterministicRequestId = document.id.startsWith('request_export__')
      ? document.id.slice('request_export__'.length)
      : ''
    return requestIds.has(sourceRequestId)
      || requestDocIds.has(deterministicRequestId)
      || source === 'kingcup_firestore'
      || syncSource.startsWith('kingcup_firestore:')
  })

  const exportOrderIds = collectIdentityValues(selectedExportOrders, ['id', 'export_code', 'code'])
  const exportOrderDocIds = new Set(selectedExportOrders.map(document => document.id))
  const selectedExportItems = all.export_order_items.filter(document =>
    exportOrderDocIds.has(asString(document.data?.export_order_id)),
  )

  const movementIdsFromRequests = new Set()
  for (const request of selectedRequests) {
    const values = request.data?.stock_movement_ids
    if (Array.isArray(values)) values.map(asString).filter(Boolean).forEach(id => movementIdsFromRequests.add(id))
  }

  const selectedMovements = all.stock_movements.filter(document => {
    const data = document.data || {}
    return movementIdsFromRequests.has(document.id)
      || (
        asString(data.source_collection) === 'export_orders'
        && exportOrderDocIds.has(asString(data.source_doc_id))
      )
  })

  const referenceValues = new Set([
    ...orderIds,
    ...orderCodes,
    ...requestIds,
    ...requestCodes,
    ...exportOrderIds,
  ])

  const selectedNotifications = all.notifications.filter(document => {
    const data = document.data || {}
    const entityCollection = asString(data.entity_collection)
    const entityId = asString(data.entity_id)
    const entityCode = asString(data.entity_code)
    const directMatch = referenceValues.has(entityId) || referenceValues.has(entityCode)
    const typedMatch = ['orders', 'order_export_requests', 'export_orders'].includes(entityCollection) && directMatch
    return typedMatch || anyStringContains(data.metadata, referenceValues)
  })

  const selectedActivityLogs = all.activity_logs.filter(document => {
    const data = document.data || {}
    const moduleName = asString(data.module)
    const itemCode = asString(data.item_code)
    const relevantModule = ['orders', 'order_items', 'payments', 'shipments', 'invoices', 'order_export_requests', 'export_orders'].includes(moduleName)
    return (relevantModule && referenceValues.has(itemCode))
      || anyStringContains(data.after_json, referenceValues)
      || anyStringContains(data.before_json, referenceValues)
  })

  const selectedWarehouseExportLogs = all.warehouse_export_logs.filter(document =>
    anyStringContains(document.data, referenceValues),
  )

  const affectedKeys = new Set(selectedMovements.map(document => inventoryKey(document.data)))
  const selectedMovementIds = new Set(selectedMovements.map(document => document.id))
  const remainingMovements = all.stock_movements.filter(document =>
    !selectedMovementIds.has(document.id) && isActive(document.data),
  )

  const movementsByKey = new Map()
  for (const movement of remainingMovements) {
    const key = inventoryKey(movement.data)
    if (!affectedKeys.has(key)) continue
    if (!movementsByKey.has(key)) movementsByKey.set(key, [])
    movementsByKey.get(key).push(movement)
  }

  const balancesByKey = new Map(all.inventory_balances.map(document => [inventoryKey(document.data), document]))
  const balanceRebuilds = []

  for (const key of affectedKeys) {
    const movements = movementsByKey.get(key) || []
    const quantity = Math.round(movements.reduce((sum, movement) => sum + Number(movement.data?.quantity || 0), 0) * 1000) / 1000
    if (quantity < -EPSILON) {
      throw new Error(`Sau khi bỏ movement test, tồn theo lịch sử bị âm ở ${key}: ${quantity}. Dừng để kiểm tra dữ liệu.`)
    }

    const currentBalance = balancesByKey.get(key) || null
    const newestMovement = [...movements].sort((left, right) =>
      asString(right.data?.movement_date || right.data?.created_at)
        .localeCompare(asString(left.data?.movement_date || left.data?.created_at)),
    )[0]

    balanceRebuilds.push({
      key,
      currentBalance,
      quantity: Math.abs(quantity) < EPSILON ? 0 : quantity,
      newestMovement,
    })
  }

  return {
    selectedOrders,
    selectedChildren,
    selectedRequests,
    selectedExportOrders,
    selectedExportItems,
    selectedMovements,
    selectedNotifications,
    selectedActivityLogs,
    selectedWarehouseExportLogs,
    balanceRebuilds,
  }
}

function selectedCollections(plan) {
  return {
    order_items: plan.selectedChildren.order_items,
    payments: plan.selectedChildren.payments,
    shipments: plan.selectedChildren.shipments,
    invoices: plan.selectedChildren.invoices,
    notifications: plan.selectedNotifications,
    warehouse_export_logs: plan.selectedWarehouseExportLogs,
    activity_logs: plan.selectedActivityLogs,
    stock_movements: plan.selectedMovements,
    export_order_items: plan.selectedExportItems,
    export_orders: plan.selectedExportOrders,
    order_export_requests: plan.selectedRequests,
    orders: plan.selectedOrders,
  }
}

function summaryFromPlan(plan) {
  const collections = selectedCollections(plan)
  return {
    ...Object.fromEntries(Object.entries(collections).map(([name, rows]) => [name, rows.length])),
    inventory_balances_rebuild: plan.balanceRebuilds.length,
    delete_documents: Object.values(collections).reduce((sum, rows) => sum + rows.length, 0),
  }
}

function printSummary(summary, args) {
  console.log('\n=== KẾ HOẠCH DỌN DỮ LIỆU TEST ===')
  console.log(`Project: ${args.projectId}`)
  console.log(`Chế độ: ${args.execute ? 'EXECUTE' : 'DRY RUN'}`)
  console.log(`Phạm vi: ${args.scope === 'all-orders' ? 'Tất cả orders hiện tại' : args.orderIds.join(', ')}`)
  console.table(summary)
  console.log(`Giới hạn commit nguyên tử: ${MAX_ATOMIC_WRITES} writes`)
}

function createDeleteWrites(plan) {
  const writes = []
  for (const rows of Object.values(selectedCollections(plan))) {
    for (const document of rows) writes.push({ delete: document.name })
  }
  return writes
}

function createBalanceWrites(plan, projectId, runId, nowIso) {
  const writes = []

  for (const rebuild of plan.balanceRebuilds) {
    const movement = rebuild.newestMovement?.data || {}
    if (rebuild.currentBalance) {
      const fields = {
        quantity: rebuild.quantity,
        updated_at: new Date(nowIso),
        last_movement_at: asString(movement.movement_date || movement.created_at),
        cleanup_run_id: runId,
        cleanup_reason: 'Rebuild sau khi xóa dữ liệu đơn hàng test',
      }
      writes.push({
        update: {
          name: rebuild.currentBalance.name,
          fields: encodeFields(fields),
        },
        updateMask: { fieldPaths: Object.keys(fields) },
      })
      continue
    }

    if (rebuild.quantity <= EPSILON || !rebuild.newestMovement) continue
    const [warehouseId, productId] = rebuild.key.split('|')
    const source = rebuild.newestMovement.data || {}
    const fallbackId = inventoryBalanceId(productId, warehouseId, source.logo || '')
    const fields = {
      id: fallbackId,
      warehouse_id: warehouseId,
      warehouse_legacy_id: source.warehouse_legacy_id || warehouseId,
      warehouse_name: source.warehouse_name || '',
      product_id: productId,
      product_legacy_id: source.product_legacy_id || productId,
      product_code: source.product_code || '',
      product_name: source.product_name || '',
      logo: source.logo || '',
      quantity: rebuild.quantity,
      unit: source.unit || '',
      updated_at: new Date(nowIso),
      last_movement_at: asString(source.movement_date || source.created_at),
      active: true,
      deleted: false,
      source: 'cleanup_rebuild',
      cleanup_run_id: runId,
      cleanup_reason: 'Tạo balance thiếu sau khi xóa dữ liệu đơn hàng test',
    }
    writes.push({
      update: {
        name: documentPath(projectId, 'inventory_balances', fallbackId),
        fields: encodeFields(fields),
      },
    })
  }

  return writes
}

function createActivityWrite(projectId, args, runId, summary, nowIso) {
  const id = `cleanup_test_orders__${runId}`
  const fields = {
    module: 'admin_cleanup',
    action: 'hard_delete_test_order_data',
    item_code: runId,
    item_name: 'Dọn dữ liệu test liên quan đơn hàng',
    changed_by: args.actor,
    after_json: JSON.stringify({
      project_id: projectId,
      scope: args.scope || 'selected-orders',
      order_ids: args.orderIds,
      summary,
    }),
    created_at: new Date(nowIso),
    active: true,
    deleted: false,
    source: 'scripts/cleanup-test-order-data.mjs',
  }
  return {
    update: {
      name: documentPath(projectId, 'activity_logs', id),
      fields: encodeFields(fields),
    },
  }
}

function writeBackup(plan, args, runId, summary, writes) {
  const directory = resolve('backups/cleanup-test-orders')
  mkdirSync(directory, { recursive: true })
  const filePath = resolve(directory, `${runId}.json`)
  const selected = Object.fromEntries(
    Object.entries(selectedCollections(plan)).map(([name, rows]) => [name, rows.map(row => row.raw)]),
  )
  const balances = plan.balanceRebuilds.map(rebuild => ({
    key: rebuild.key,
    quantity_after: rebuild.quantity,
    balance_before: rebuild.currentBalance?.raw || null,
    newest_remaining_movement: rebuild.newestMovement?.raw || null,
  }))

  writeFileSync(filePath, JSON.stringify({
    run_id: runId,
    generated_at: new Date().toISOString(),
    project_id: args.projectId,
    scope: args.scope || 'selected-orders',
    order_ids: args.orderIds,
    summary,
    selected_documents: selected,
    balance_rebuilds: balances,
    planned_writes: writes,
  }, null, 2))
  return filePath
}

async function commitWrites(projectId, token, writes) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${DATABASE_ID}/documents:commit`
  return firestoreFetch(url, token, {
    method: 'POST',
    body: JSON.stringify({ writes }),
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (process.argv.includes('--help')) {
    printUsage()
    return
  }
  assertArguments(args)

  const token = await getAccessToken()
  console.log(`Đang đọc dữ liệu Firestore project ${args.projectId}...`)
  const entries = await Promise.all(READ_COLLECTIONS.map(async collectionName => [
    collectionName,
    await listCollection(args.projectId, collectionName, token),
  ]))
  const all = Object.fromEntries(entries)
  const plan = selectPlan(all, args)
  const summary = summaryFromPlan(plan)
  printSummary(summary, args)

  if (!summary.delete_documents) {
    console.log('\nKhông có dữ liệu nào trong phạm vi. Không thực hiện thay đổi.')
    return
  }

  const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const nowIso = new Date().toISOString()
  const deleteWrites = createDeleteWrites(plan)
  const balanceWrites = createBalanceWrites(plan, args.projectId, runId, nowIso)
  const activityWrite = createActivityWrite(args.projectId, args, runId, summary, nowIso)
  const writes = [...deleteWrites, ...balanceWrites, activityWrite]

  console.log(`Tổng số writes dự kiến: ${writes.length}`)
  if (writes.length > MAX_ATOMIC_WRITES) {
    throw new Error(`Có ${writes.length} writes, vượt ngưỡng an toàn ${MAX_ATOMIC_WRITES}. Script không chia batch để tránh trạng thái xóa dở dang.`)
  }

  if (args.dryRun) {
    console.log('\nDRY RUN hoàn tất. Firestore chưa bị thay đổi.')
    console.log(`Để xóa thật, thêm --execute --actor=email_admin --confirm=${CONFIRM_TEXT}.`)
    return
  }

  const backupPath = writeBackup(plan, args, runId, summary, writes)
  console.log(`Đã ghi backup trước khi xóa: ${backupPath}`)
  await commitWrites(args.projectId, token, writes)
  console.log('\nĐã dọn dữ liệu test và rebuild các dòng tồn bị ảnh hưởng trong một commit nguyên tử.')
  console.log(`Run ID: ${runId}`)
  console.log(`Backup: ${backupPath}`)
}

main().catch(error => {
  console.error(`\nLỖI: ${error?.message || error}`)
  process.exitCode = 1
})
