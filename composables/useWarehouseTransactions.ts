import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp
} from 'firebase/firestore'
import type { ProductDoc, SupplierDoc, WarehouseDoc } from '~/types/models'
import { makeCode, makeId, normalizeEmail, toNumber, todayKey } from '~/utils/format'
import { invalidateScopedCache } from '~/composables/useScopedQueries'
import {
  buildNotificationPayload,
  resolveSaleNotificationRecipients,
} from '~/composables/useNotifications'
// @ts-ignore Shared ESM lifecycle helpers are executed directly by Node tests.
import {
  activeExportOrderId,
  appendExportLifecycleTimeline,
  buildCancelledReleaseRequestPatch,
  buildGeneratedExportLifecycleFields,
  buildReleasedRequestPatch,
  canCancelExportRequestRelease,
  canReleaseExportRequest,
  exportLifecycleLinkError,
  nextExportReleaseSequence,
  requestExportOrderId,
} from '~/utils/exportLifecycle.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { validateWarehouseReleaseSources } from '~/utils/orderItemDependencies.mjs'

type WarehouseLineInput = {
  source_order_id?: string
  source_order_item_id?: string
  product: ProductDoc | any
  warehouse?: WarehouseDoc | any
  warehouse_id?: string
  fromWarehouse?: WarehouseDoc | any
  from_warehouse_id?: string
  toWarehouse?: WarehouseDoc | any | null
  to_warehouse_id?: string
  logo?: string
  source_logo?: string
  target_logo?: string
  quantity: number
  unit?: string
  note?: string
}

type BalanceDelta = {
  id: string
  delta: number
  product: ProductDoc | any
  warehouse: WarehouseDoc | any
  logo: string
  unit?: string
  movementDate: string
}

function normalizeLogo(value: any) {
  return String(value || '').trim()
}

function hasOwnField(data: any, field: string) {
  return data != null && Object.prototype.hasOwnProperty.call(data, field)
}

function lineSourceLogo(line: any) {
  if (hasOwnField(line, 'source_logo')) return normalizeLogo(line.source_logo)
  return normalizeLogo(line.logo)
}

function lineTargetLogo(line: any) {
  if (hasOwnField(line, 'target_logo')) return normalizeLogo(line.target_logo)
  return normalizeLogo(line.logo)
}

function exportItemSourceLogo(item: any) {
  return hasOwnField(item, 'source_logo')
    ? normalizeLogo(item.source_logo)
    : normalizeLogo(item.logo)
}

function exportItemTargetLogo(item: any) {
  return hasOwnField(item, 'target_logo')
    ? normalizeLogo(item.target_logo)
    : normalizeLogo(item.logo)
}

function normalizeId(value: any) {
  return String(value || '').trim()
}

function productCode(product: any) {
  return String(product?.product_code || product?.code || '').trim()
}

function productName(product: any) {
  return String(product?.product_name || product?.name || '').trim()
}

function warehouseName(warehouse: any) {
  return String(warehouse?.name || warehouse?.warehouse_name || warehouse?.warehouse_code || '').trim()
}

function safeDocId(value: any, prefix = 'doc') {
  const raw = String(value || '').trim()
  let id = raw || `${prefix}_${Date.now()}`
  id = id.replace(/[\\/?#\[\]]/g, '_').replace(/\s+/g, '_')
  if (!id || id === '.' || id === '..' || /^__.*__$/.test(id)) id = `${prefix}_${Date.now()}`
  if (id.length > 900) id = `${prefix}_${id.slice(0, 120)}_${Date.now()}`
  return id
}

async function sha256Hex24(value: string) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Trình duyệt không hỗ trợ crypto.subtle để tạo khóa tồn kho theo logo.')
  const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24)
}

async function inventoryBalanceId(productId: string, warehouseId: string, logo: any) {
  const logoText = normalizeLogo(logo)
  const logoKey = logoText ? await sha256Hex24(logoText) : 'no_logo'
  return safeDocId(`${warehouseId}__${productId}__${logoKey}`, 'balance')
}

function ensureProduct(product: any) {
  const id = normalizeId(product?.id || product?.firestore_id)
  if (!id) throw new Error('Thiếu sản phẩm hoặc sản phẩm chưa có ID hệ thống.')
  return { ...product, id }
}

function ensureWarehouse(warehouse: any, label = 'kho') {
  function missingWarehouseError(fields: string) {
    return new Error(`Thiếu ${label} hoặc ${label} chưa có ID hệ thống. Payload ${label}: ${fields || 'rỗng'}.`)
  }

  if (typeof warehouse === 'string') {
    const id = normalizeId(warehouse)
    if (!id) throw missingWarehouseError(warehouse)
    return { id, firestore_id: id, name: id, warehouse_code: id }
  }
  const id = normalizeId(
    warehouse?.id
    || warehouse?.firestore_id
    || warehouse?.value
    || warehouse?.from_warehouse_id
    || warehouse?.warehouse_id
    || warehouse?.to_warehouse_id
  )
  if (!id) {
    const fields = warehouse && typeof warehouse === 'object'
      ? Object.keys(warehouse).slice(0, 8).join(', ')
      : String(warehouse || '')
    throw missingWarehouseError(fields)
  }
  return { ...warehouse, id, firestore_id: warehouse?.firestore_id || id }
}

function ensurePositiveQuantity(value: any, label = 'Số lượng') {
  const quantity = toNumber(value)
  if (quantity <= 0) throw new Error(`${label} phải lớn hơn 0.`)
  return quantity
}

function signedNumber(value: any) {
  const quantity = toNumber(value)
  if (quantity === 0) throw new Error('Số lượng điều chỉnh phải khác 0.')
  return quantity
}

function revisionOf(data: any) {
  const value = Number(data?.revision || 0)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function operationIdOf(value: any, fallback: string) {
  return safeDocId(String(value || fallback || makeId('warehouse_operation')).trim(), 'warehouse_operation')
}

function assertExpectedRevision(current: any, expected: any, label: string) {
  const actual = revisionOf(current)
  const normalizedExpected = expected === undefined || expected === null || expected === ''
    ? actual
    : revisionOf({ revision: expected })
  if (actual !== normalizedExpected) {
    throw new Error(`${label} đã được người khác thay đổi. Phiên bản đang mở là ${normalizedExpected}, phiên bản hiện tại là ${actual}. Hãy tải lại dữ liệu trước khi thao tác.`)
  }
  return actual
}

function warehouseOperationPayload(input: {
  operationId: string
  action: string
  targetCollection: string
  targetId: string
  resultCode?: string
  targetRevision?: number
  createdBy: string
}) {
  return {
    id: input.operationId,
    operation_id: input.operationId,
    action: input.action,
    target_collection: input.targetCollection,
    target_id: input.targetId,
    result_code: input.resultCode || '',
    target_revision: input.targetRevision || 0,
    created_by: input.createdBy,
    status: 'processing',
    processing_at: serverTimestamp(),
    created_at: serverTimestamp(),
    active: true,
    deleted: false,
    source: 'nuxt_v7_5'
  }
}

function warehouseOperationCompletionPayload(input: {
  operationId: string
  action: string
  targetCollection: string
  targetId: string
  resultCode?: string
  targetRevision?: number
  createdBy: string
}) {
  return {
    status: 'completed',
    result_code: input.resultCode || '',
    target_revision: input.targetRevision || 0,
    completed_at: serverTimestamp()
  }
}

function assertOperationOwner(data: any, action: string, createdBy: string) {
  if (String(data?.action || '') !== action) {
    throw new Error('operation_id đã được dùng cho một nghiệp vụ khác. Hãy tải lại trang và thử lại.')
  }
  if (normalizeEmail(data?.created_by || '') !== normalizeEmail(createdBy)) {
    throw new Error('operation_id thuộc về tài khoản khác, không thể tiếp tục thao tác.')
  }
  const status = String(data?.status || '')
  if (!['pending', 'processing', 'failed', 'completed'].includes(status)) {
    throw new Error(`operation_id đang ở trạng thái không hợp lệ: ${status || 'trống'}.`)
  }
}

async function claimWarehouseOperation(db: any, input: {
  operationId: string
  action: string
  targetCollection: string
  targetId: string
  resultCode?: string
  targetRevision?: number
  createdBy: string
}) {
  const operationRef = doc(db, 'warehouse_operations', input.operationId)
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(operationRef)
    if (!snapshot.exists()) {
      transaction.set(operationRef, warehouseOperationPayload(input))
      return
    }

    const data = snapshot.data() || {}
    assertOperationOwner(data, input.action, input.createdBy)
    const status = String(data.status || '')
    if (status === 'completed') return

    if (status === 'processing') {
      const targetCollection = String(data.target_collection || '')
      const targetId = String(data.target_id || '')
      if (targetCollection && targetId) {
        const targetSnapshot = await transaction.get(doc(db, targetCollection, targetId))
        const target = targetSnapshot.exists() ? (targetSnapshot.data() || {}) : {}
        if (String(target.operation_id || target.last_operation_id || '') === input.operationId) {
          transaction.update(operationRef, warehouseOperationCompletionPayload({
            ...input,
            targetCollection,
            targetId,
            resultCode: data.result_code || input.resultCode,
            targetRevision: revisionOf(target) || data.target_revision || input.targetRevision
          }))
          return
        }
      }
      throw new Error('Nghiệp vụ kho này đang được xử lý ở một phiên hoặc tab khác. Hãy chờ và tải lại dữ liệu.')
    }

    if (!['failed', 'pending'].includes(status)) {
      throw new Error(`operation_id đang ở trạng thái không thể chạy lại: ${status || 'trống'}.`)
    }
    transaction.update(operationRef, {
      status: 'processing',
      processing_at: serverTimestamp(),
      failed_at: null,
      failure_message: ''
    })
  })
}

async function completeWarehouseOperation(db: any, input: {
  operationId: string
  action: string
  targetCollection: string
  targetId: string
  resultCode?: string
  targetRevision?: number
  createdBy: string
}) {
  const operationRef = doc(db, 'warehouse_operations', input.operationId)
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(operationRef)
    if (!snapshot.exists()) throw new Error('Không tìm thấy operation cần hoàn tất.')
    const data = snapshot.data() || {}
    assertOperationOwner(data, input.action, input.createdBy)
    if (String(data.status || '') === 'completed') return
    if (String(data.status || '') !== 'processing') {
      throw new Error(`Operation không ở trạng thái processing: ${String(data.status || '')}.`)
    }
    transaction.update(operationRef, warehouseOperationCompletionPayload(input))
  })
}

async function failWarehouseOperation(db: any, operationId: string, action: string, createdBy: string, error: any) {
  const operationRef = doc(db, 'warehouse_operations', operationId)
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(operationRef)
    if (!snapshot.exists()) return
    const data = snapshot.data() || {}
    assertOperationOwner(data, action, createdBy)
    if (String(data.status || '') !== 'processing') return
    transaction.update(operationRef, {
      status: 'failed',
      failed_at: serverTimestamp(),
      failure_message: String(error?.message || error || 'Nghiệp vụ kho thất bại').slice(0, 500)
    })
  })
}

function readOperationResult(data: any, action: string) {
  if (String(data?.action || '') !== action) {
    throw new Error('operation_id đã được dùng cho một nghiệp vụ khác. Hãy tải lại trang và thử lại.')
  }
  return {
    id: String(data?.target_id || ''),
    code: String(data?.result_code || ''),
    revision: revisionOf({ revision: data?.target_revision })
  }
}

function applyDelta(map: Map<string, BalanceDelta>, delta: BalanceDelta) {
  const current = map.get(delta.id)
  if (!current) {
    map.set(delta.id, { ...delta })
    return
  }
  current.delta += delta.delta
}

function balancePayload(delta: BalanceDelta, nextQuantity: number, operationId = '', updatedBy = '') {
  return {
    id: delta.id,
    warehouse_id: delta.warehouse.id,
    warehouse_legacy_id: delta.warehouse.legacy_id || delta.warehouse.id,
    warehouse_name: warehouseName(delta.warehouse),
    product_id: delta.product.id,
    product_legacy_id: delta.product.legacy_id || delta.product.warehouse_legacy_id || delta.product.id,
    product_code: productCode(delta.product),
    product_name: productName(delta.product),
    logo: normalizeLogo(delta.logo),
    quantity: Math.round(nextQuantity * 1000) / 1000,
    unit: delta.unit || delta.product.unit || '',
    updated_at: serverTimestamp(),
    last_movement_at: delta.movementDate,
    active: true,
    deleted: false,
    source: 'nuxt',
    last_operation_id: operationId,
    updated_by: updatedBy
  }
}

function movementPayload(input: {
  id: string
  type: string
  direction: 'in' | 'out' | 'adjust'
  quantity: number
  product: any
  warehouse: any
  logo?: string
  unit?: string
  movementDate: string
  sourceCollection: string
  sourceDocId: string
  sourceItemId: string
  sourceCode: string
  reason: string
  createdBy: string
  operationId: string
}) {
  return {
    id: input.id,
    movement_date: input.movementDate,
    movement_type: input.type,
    direction: input.direction,
    quantity: Math.round(input.quantity * 1000) / 1000,
    absolute_quantity: Math.abs(Math.round(input.quantity * 1000) / 1000),
    product_id: input.product.id,
    product_legacy_id: input.product.legacy_id || input.product.warehouse_legacy_id || input.product.id,
    product_code: productCode(input.product),
    product_name: productName(input.product),
    warehouse_id: input.warehouse.id,
    warehouse_legacy_id: input.warehouse.legacy_id || input.warehouse.id,
    warehouse_name: warehouseName(input.warehouse),
    logo: normalizeLogo(input.logo),
    unit: input.unit || input.product.unit || '',
    source_collection: input.sourceCollection,
    source_doc_id: input.sourceDocId,
    source_item_id: input.sourceItemId,
    source_code: input.sourceCode,
    reason: input.reason,
    created_by: input.createdBy,
    operation_id: input.operationId,
    created_at: serverTimestamp(),
    active: true,
    deleted: false,
    source: 'nuxt'
  }
}

function invalidateWarehouseCaches() {
  ;[
    'import_orders', 'import_order_items',
    'export_orders', 'export_order_items',
    'inventory_adjustments', 'inventory_balances', 'stock_movements',
    'order_export_requests', 'orders', 'activity_logs', 'warehouse_operations'
  ].forEach(name => invalidateScopedCache(name))
}

export function useWarehouseTransactions() {
  const { db } = useFirebaseServices()
  const { appUser } = useAuth()

  function email() {
    return normalizeEmail(appUser.value?.email || '')
  }

  function activity(module: string, action: string, itemCode: string, after: any, operationId = '') {
    return {
      module,
      action,
      item_code: itemCode,
      item_name: after?.code || after?.import_code || after?.export_code || after?.product_name || itemCode,
      changed_by: email(),
      operation_id: operationId,
      after_json: JSON.stringify(after || {}),
      created_at: serverTimestamp(),
      active: true,
      deleted: false
    }
  }

  async function prepareBalanceDeltas(lines: Array<WarehouseLineInput & { delta: number; movementDate: string }>) {
    const deltas = new Map<string, BalanceDelta>()
    for (const line of lines) {
      const product = ensureProduct(line.product)
      const warehouse = ensureWarehouse(line.warehouse, 'kho')
      const id = await inventoryBalanceId(product.id, warehouse.id, line.logo)
      applyDelta(deltas, {
        id,
        delta: line.delta,
        product,
        warehouse,
        logo: normalizeLogo(line.logo),
        unit: line.unit || product.unit || '',
        movementDate: line.movementDate
      })
    }
    return deltas
  }

  async function createImportOrder(input: {
    import_date?: string
    supplier?: SupplierDoc | any | null
    note?: string
    operation_id?: string
    lines: WarehouseLineInput[]
  }) {
    const createdBy = email()
    if (!createdBy) throw new Error('Bạn chưa đăng nhập.')
    const rawLines = input.lines.filter(line => toNumber(line.quantity) > 0)
    if (!rawLines.length) throw new Error('Phiếu nhập phải có ít nhất một dòng hàng.')

    const importDate = input.import_date || todayKey()
    const orderId = makeId('imp')
    const code = makeCode('PNK')
    const operationId = operationIdOf(input.operation_id, `import_create:${orderId}`)
    let resultId = orderId
    let resultCode = code
    let alreadyProcessed = false
    const preparedLines = [] as Array<WarehouseLineInput & { product: any; warehouse: any; quantity: number; itemId: string; movementId: string }>
    rawLines.forEach((line, index) => {
      const product = ensureProduct(line.product)
      const warehouse = ensureWarehouse(line.warehouse, 'kho nhập')
      const quantity = ensurePositiveQuantity(line.quantity)
      preparedLines.push({
        ...line,
        product,
        warehouse,
        quantity,
        itemId: safeDocId(`${orderId}__${index + 1}`, 'import_item'),
        movementId: safeDocId(`import:${orderId}:${index + 1}`, 'movement')
      })
    })

    const balanceDeltas = await prepareBalanceDeltas(preparedLines.map(line => ({
      product: line.product,
      warehouse: line.warehouse,
      logo: line.logo,
      unit: line.unit,
      quantity: line.quantity,
      delta: line.quantity,
      movementDate: importDate
    })))

    const supplier = input.supplier || {}
    const orderPayload = {
      id: orderId,
      code,
      import_code: code,
      import_date: importDate,
      supplier_id: supplier.id || '',
      supplier_name: supplier.name || supplier.supplier_name || '',
      note: input.note || '',
      status: 'completed',
      active: true,
      deleted: false,
      created_by: createdBy,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      operation_id: operationId,
      last_operation_id: operationId,
      revision: 1,
      source: 'nuxt'
    }

    await claimWarehouseOperation(db, {
      operationId,
      action: 'import_create',
      targetCollection: 'import_orders',
      targetId: orderId,
      resultCode: code,
      createdBy: createdBy
    })

    try {
      await runTransaction(db, async tx => {
      const operationRef = doc(db, 'warehouse_operations', operationId)
      const operationSnap = await tx.get(operationRef)
      if (!operationSnap.exists()) throw new Error('Không tìm thấy operation pending cho nghiệp vụ kho.')
      const operationData = operationSnap.data() || {}
      assertOperationOwner(operationData, 'import_create', createdBy)
      if (String(operationData.status || '') === 'completed') {
        const previous = readOperationResult(operationSnap.data(), 'import_create')
        resultId = previous.id || resultId
        resultCode = previous.code || resultCode
        alreadyProcessed = true
        return

      }
      const balanceSnaps = new Map<string, any>()
      for (const delta of balanceDeltas.values()) {
        balanceSnaps.set(delta.id, await tx.get(doc(db, 'inventory_balances', delta.id)))
      }

      tx.set(doc(db, 'import_orders', orderId), orderPayload)
      preparedLines.forEach((line, index) => {
        const itemPayload = {
          id: line.itemId,
          import_order_id: orderId,
          product_id: line.product.id,
          product_code: productCode(line.product),
          product_name: productName(line.product),
          warehouse_id: line.warehouse.id,
          warehouse_name: warehouseName(line.warehouse),
          logo: normalizeLogo(line.logo),
          quantity: line.quantity,
          unit: line.unit || line.product.unit || '',
          note: line.note || '',
          legacy_line_key: '',
          status: 'completed',
          active: true,
          deleted: false,
          created_by: createdBy,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
          operation_id: operationId,
          last_operation_id: operationId,
          revision: 1,
          source: 'nuxt'
        }
        tx.set(doc(db, 'import_order_items', line.itemId), itemPayload)
        tx.set(doc(db, 'stock_movements', line.movementId), movementPayload({
          id: line.movementId,
          type: 'import',
          direction: 'in',
          quantity: line.quantity,
          product: line.product,
          warehouse: line.warehouse,
          logo: line.logo,
          unit: line.unit,
          movementDate: importDate,
          sourceCollection: 'import_orders',
          sourceDocId: orderId,
          sourceItemId: line.itemId,
          sourceCode: code,
          reason: 'Nhập kho',
          createdBy,
          operationId
        }))
      })

      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        const next = current + delta.delta
        tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, next, operationId, createdBy), { merge: true })
      }

      tx.set(doc(collection(db, 'activity_logs')), activity('import_orders', 'create', code, orderPayload, operationId))

      })
    } catch (error) {
      await failWarehouseOperation(db, operationId, 'import_create', createdBy, error).catch(() => undefined)
      throw error
    }
    await completeWarehouseOperation(db, {
      operationId,
      action: 'import_create',
      targetCollection: 'import_orders',
      targetId: orderId,
      resultCode: code,
      targetRevision: 1,
      createdBy: createdBy
    })

    invalidateWarehouseCaches()
    return { id: resultId, code: resultCode, operationId, alreadyProcessed }
  }


  function itemProduct(item: any) {
    const id = normalizeId(item?.product_id || item?.product?.id)
    if (!id) throw new Error(`Dòng nhập ${item?.id || ''} thiếu product_id, không thể cập nhật tồn an toàn.`)
    return {
      id,
      legacy_id: item.product_legacy_id || item.legacy_product_id || id,
      product_code: item.product_code || '',
      product_name: item.product_name || '',
      unit: item.unit || ''
    }
  }

  function itemWarehouse(item: any) {
    const id = normalizeId(item?.warehouse_id || item?.warehouse?.id)
    if (!id) throw new Error(`Dòng nhập ${item?.id || ''} thiếu warehouse_id, không thể cập nhật tồn an toàn.`)
    return {
      id,
      legacy_id: item.warehouse_legacy_id || item.legacy_warehouse_id || id,
      name: item.warehouse_name || item.warehouse_code || id,
      warehouse_code: item.warehouse_code || ''
    }
  }


  function exportItemProduct(item: any) {
    const id = normalizeId(item?.product_id || item?.product?.id)
    if (!id) throw new Error(`Dòng xuất ${item?.id || ''} thiếu product_id, không thể cập nhật tồn an toàn.`)
    return {
      id,
      legacy_id: item.product_legacy_id || item.legacy_product_id || id,
      product_code: item.product_code || '',
      product_name: item.product_name || '',
      unit: item.unit || ''
    }
  }

  function exportItemFromWarehouse(item: any) {
    const id = normalizeId(item?.from_warehouse_id || item?.warehouse_id || item?.fromWarehouse?.id)
    if (!id) throw new Error(`Dòng xuất ${item?.id || ''} thiếu kho xuất, không thể cập nhật tồn an toàn.`)
    return {
      id,
      legacy_id: item.from_warehouse_legacy_id || item.warehouse_legacy_id || id,
      name: item.from_warehouse_name || item.warehouse_name || id,
      warehouse_code: item.from_warehouse_code || item.warehouse_code || ''
    }
  }

  function exportItemToWarehouse(item: any) {
    const id = normalizeId(item?.to_warehouse_id || item?.toWarehouse?.id)
    if (!id) return null
    return {
      id,
      legacy_id: item.to_warehouse_legacy_id || id,
      name: item.to_warehouse_name || id,
      warehouse_code: item.to_warehouse_code || ''
    }
  }

  function isRequestGeneratedExport(order: any) {
    return Boolean(
      normalizeId(order?.source_request_id)
      || String(order?.source || '').trim() === 'kingcup_firestore'
      || String(order?.sync_source || '').trim().startsWith('kingcup_firestore:')
    )
  }

  async function updateImportOrder(input: {
    order: any
    existingItems: any[]
    import_date?: string
    supplier?: SupplierDoc | any | null
    note?: string
    operation_id?: string
    expected_revision?: number
    lines: WarehouseLineInput[]
  }) {
    const updatedBy = email()
    if (!updatedBy) throw new Error('Bạn chưa đăng nhập.')
    const orderId = normalizeId(input.order?.id)
    if (!orderId) throw new Error('Thiếu ID phiếu nhập cần sửa.')
    const oldItems = (input.existingItems || []).filter(item => item && item.deleted !== true && item.active !== false)
    const rawLines = input.lines.filter(line => toNumber(line.quantity) > 0)
    if (!rawLines.length) throw new Error('Phiếu nhập phải có ít nhất một dòng hàng.')

    const importDate = input.import_date || input.order?.import_date || todayKey()
    const supplier = input.supplier || {}
    const code = input.order?.code || input.order?.import_code || orderId
    const operationId = operationIdOf(input.operation_id, `import_update:${orderId}:${revisionOf(input.order)}`)
    const expectedRevision = input.expected_revision ?? input.order?.revision ?? 0
    let resultId = orderId
    let resultCode = code
    let resultRevision = revisionOf(input.order)
    let alreadyProcessed = false

    const preparedNew = rawLines.map((line, index) => {
      const product = ensureProduct(line.product)
      const warehouse = ensureWarehouse(line.warehouse, 'kho nhập')
      const quantity = ensurePositiveQuantity(line.quantity)
      const existing = oldItems[index]
      return {
        ...line,
        product,
        warehouse,
        quantity,
        itemId: existing?.id || safeDocId(`${orderId}__${index + 1}`, 'import_item'),
        movementId: safeDocId(`import_update_apply:${orderId}:${index + 1}:${makeId('mv')}`, 'movement')
      }
    })

    const balanceDeltas = new Map<string, BalanceDelta>()
    for (const item of oldItems) {
      const product = itemProduct(item)
      const warehouse = itemWarehouse(item)
      const id = await inventoryBalanceId(product.id, warehouse.id, item.logo)
      applyDelta(balanceDeltas, {
        id,
        delta: -toNumber(item.quantity),
        product,
        warehouse,
        logo: normalizeLogo(item.logo),
        unit: item.unit || product.unit || '',
        movementDate: importDate
      })
    }
    for (const line of preparedNew) {
      const id = await inventoryBalanceId(line.product.id, line.warehouse.id, line.logo)
      applyDelta(balanceDeltas, {
        id,
        delta: line.quantity,
        product: line.product,
        warehouse: line.warehouse,
        logo: normalizeLogo(line.logo),
        unit: line.unit || line.product.unit || '',
        movementDate: importDate
      })
    }

    await claimWarehouseOperation(db, {
      operationId,
      action: 'import_update',
      targetCollection: 'import_orders',
      targetId: orderId,
      resultCode: code,
      createdBy: updatedBy
    })

    try {
      await runTransaction(db, async tx => {
      const operationRef = doc(db, 'warehouse_operations', operationId)
      const operationSnap = await tx.get(operationRef)
      if (!operationSnap.exists()) throw new Error('Không tìm thấy operation pending cho nghiệp vụ kho.')
      const operationData = operationSnap.data() || {}
      assertOperationOwner(operationData, 'import_update', updatedBy)
      if (String(operationData.status || '') === 'completed') {
        const previous = readOperationResult(operationSnap.data(), 'import_update')
        resultId = previous.id || resultId
        resultCode = previous.code || resultCode
        resultRevision = previous.revision || resultRevision
        alreadyProcessed = true
        return

      }
      const orderRef = doc(db, 'import_orders', orderId)
      const currentOrderSnap = await tx.get(orderRef)
      if (!currentOrderSnap.exists()) throw new Error('Phiếu nhập không còn tồn tại.')
      const currentOrder = currentOrderSnap.data() || {}
      if (currentOrder.deleted === true || currentOrder.active === false) throw new Error('Phiếu nhập đã bị xóa.')
      const currentRevision = assertExpectedRevision(currentOrder, expectedRevision, 'Phiếu nhập')
      resultRevision = currentRevision + 1

      const balanceSnaps = new Map<string, any>()
      for (const delta of balanceDeltas.values()) {
        balanceSnaps.set(delta.id, await tx.get(doc(db, 'inventory_balances', delta.id)))
      }
      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        const next = current + delta.delta
        if (next < 0) {
          throw new Error(`Sửa phiếu nhập làm tồn âm: ${productCode(delta.product)} - ${productName(delta.product)} / ${warehouseName(delta.warehouse)}${delta.logo ? ` / ${delta.logo}` : ''}. Tồn hiện tại ${current}, thay đổi ${delta.delta}.`)
        }
      }

      tx.update(doc(db, 'import_orders', orderId), {
        import_date: importDate,
        supplier_id: supplier.id || '',
        supplier_name: supplier.name || supplier.supplier_name || '',
        note: input.note || '',
        updated_by: updatedBy,
        operation_id: operationId,
        last_operation_id: operationId,
        revision: resultRevision,
        updated_at: serverTimestamp()
      })

      oldItems.forEach(item => {
        const product = itemProduct(item)
        const warehouse = itemWarehouse(item)
        const movementId = safeDocId(`import_update_reverse:${orderId}:${item.id}:${makeId('mv')}`, 'movement')
        tx.set(doc(db, 'stock_movements', movementId), movementPayload({
          id: movementId,
          type: 'import_update_reverse',
          direction: 'out',
          quantity: -toNumber(item.quantity),
          product,
          warehouse,
          logo: item.logo,
          unit: item.unit,
          movementDate: importDate,
          sourceCollection: 'import_orders',
          sourceDocId: orderId,
          sourceItemId: item.id,
          sourceCode: code,
          reason: 'Đảo tồn trước khi sửa phiếu nhập',
          createdBy: updatedBy,
          operationId
        }))
      })

      preparedNew.forEach((line, index) => {
        const itemPayload = {
          id: line.itemId,
          import_order_id: orderId,
          product_id: line.product.id,
          product_code: productCode(line.product),
          product_name: productName(line.product),
          warehouse_id: line.warehouse.id,
          warehouse_name: warehouseName(line.warehouse),
          logo: normalizeLogo(line.logo),
          quantity: line.quantity,
          unit: line.unit || line.product.unit || '',
          note: line.note || '',
          legacy_line_key: oldItems[index]?.legacy_line_key || '',
          status: 'completed',
          active: true,
          deleted: false,
          updated_by: updatedBy,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: revisionOf(oldItems[index]) + 1,
          updated_at: serverTimestamp(),
          source: oldItems[index]?.source || input.order?.source || 'nuxt'
        }
        if (oldItems[index]?.id) tx.update(doc(db, 'import_order_items', line.itemId), itemPayload)
        else tx.set(doc(db, 'import_order_items', line.itemId), {
          ...itemPayload,
          created_by: updatedBy,
          created_at: serverTimestamp()
        })
        tx.set(doc(db, 'stock_movements', line.movementId), movementPayload({
          id: line.movementId,
          type: 'import_update_apply',
          direction: 'in',
          quantity: line.quantity,
          product: line.product,
          warehouse: line.warehouse,
          logo: line.logo,
          unit: line.unit,
          movementDate: importDate,
          sourceCollection: 'import_orders',
          sourceDocId: orderId,
          sourceItemId: line.itemId,
          sourceCode: code,
          reason: 'Áp tồn sau khi sửa phiếu nhập',
          createdBy: updatedBy,
          operationId
        }))
      })

      oldItems.slice(preparedNew.length).forEach(item => {
        tx.update(doc(db, 'import_order_items', item.id), {
          deleted: true,
          active: false,
          status: 'deleted',
          deleted_at: serverTimestamp(),
          updated_by: updatedBy,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: revisionOf(item) + 1,
          updated_at: serverTimestamp()
        })
      })

      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        const next = current + delta.delta
        tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, next, operationId, updatedBy), { merge: true })
      }

      tx.set(doc(collection(db, 'activity_logs')), activity('import_orders', 'update', code, {
        id: orderId,
        code,
        import_date: importDate,
        supplier_id: supplier.id || '',
        supplier_name: supplier.name || supplier.supplier_name || '',
        line_count: preparedNew.length
      }, operationId))

      })
    } catch (error) {
      await failWarehouseOperation(db, operationId, 'import_update', updatedBy, error).catch(() => undefined)
      throw error
    }
    await completeWarehouseOperation(db, {
      operationId,
      action: 'import_update',
      targetCollection: 'import_orders',
      targetId: orderId,
      resultCode: code,
      targetRevision: resultRevision,
      createdBy: updatedBy
    })

    invalidateWarehouseCaches()
    return { id: resultId, code: resultCode, revision: resultRevision, operationId, alreadyProcessed }
  }

  async function deleteImportOrder(input: { order: any; existingItems: any[]; reason?: string; operation_id?: string; expected_revision?: number }) {
    const deletedBy = email()
    if (!deletedBy) throw new Error('Bạn chưa đăng nhập.')
    const orderId = normalizeId(input.order?.id)
    if (!orderId) throw new Error('Thiếu ID phiếu nhập cần xóa.')
    const oldItems = (input.existingItems || []).filter(item => item && item.deleted !== true && item.active !== false)
    const importDate = input.order?.import_date || todayKey()
    const code = input.order?.code || input.order?.import_code || orderId
    const operationId = operationIdOf(input.operation_id, `import_delete:${orderId}:${revisionOf(input.order)}`)
    const expectedRevision = input.expected_revision ?? input.order?.revision ?? 0
    let resultId = orderId
    let resultCode = code
    let resultRevision = revisionOf(input.order)
    let alreadyProcessed = false

    const balanceDeltas = new Map<string, BalanceDelta>()
    for (const item of oldItems) {
      const product = itemProduct(item)
      const warehouse = itemWarehouse(item)
      const id = await inventoryBalanceId(product.id, warehouse.id, item.logo)
      applyDelta(balanceDeltas, {
        id,
        delta: -toNumber(item.quantity),
        product,
        warehouse,
        logo: normalizeLogo(item.logo),
        unit: item.unit || product.unit || '',
        movementDate: importDate
      })
    }

    await claimWarehouseOperation(db, {
      operationId,
      action: 'import_delete',
      targetCollection: 'import_orders',
      targetId: orderId,
      resultCode: code,
      createdBy: deletedBy
    })

    try {
      await runTransaction(db, async tx => {
      const operationRef = doc(db, 'warehouse_operations', operationId)
      const operationSnap = await tx.get(operationRef)
      if (!operationSnap.exists()) throw new Error('Không tìm thấy operation pending cho nghiệp vụ kho.')
      const operationData = operationSnap.data() || {}
      assertOperationOwner(operationData, 'import_delete', deletedBy)
      if (String(operationData.status || '') === 'completed') {
        const previous = readOperationResult(operationSnap.data(), 'import_delete')
        resultId = previous.id || resultId
        resultCode = previous.code || resultCode
        resultRevision = previous.revision || resultRevision
        alreadyProcessed = true
        return

      }
      const orderRef = doc(db, 'import_orders', orderId)
      const currentOrderSnap = await tx.get(orderRef)
      if (!currentOrderSnap.exists()) throw new Error('Phiếu nhập không còn tồn tại.')
      const currentOrder = currentOrderSnap.data() || {}
      if (currentOrder.deleted === true || currentOrder.active === false) throw new Error('Phiếu nhập đã được xóa trước đó.')
      const currentRevision = assertExpectedRevision(currentOrder, expectedRevision, 'Phiếu nhập')
      resultRevision = currentRevision + 1

      const balanceSnaps = new Map<string, any>()
      for (const delta of balanceDeltas.values()) {
        balanceSnaps.set(delta.id, await tx.get(doc(db, 'inventory_balances', delta.id)))
      }
      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        const next = current + delta.delta
        if (next < 0) {
          throw new Error(`Xóa phiếu nhập làm tồn âm: ${productCode(delta.product)} - ${productName(delta.product)} / ${warehouseName(delta.warehouse)}${delta.logo ? ` / ${delta.logo}` : ''}. Tồn hiện tại ${current}, cần đảo ${Math.abs(delta.delta)}.`)
        }
      }

      tx.update(doc(db, 'import_orders', orderId), {
        deleted: true,
        active: false,
        status: 'deleted',
        deleted_at: serverTimestamp(),
        updated_by: deletedBy,
        operation_id: operationId,
        last_operation_id: operationId,
        revision: resultRevision,
        updated_at: serverTimestamp()
      })

      oldItems.forEach(item => {
        const product = itemProduct(item)
        const warehouse = itemWarehouse(item)
        const movementId = safeDocId(`import_delete_reverse:${orderId}:${item.id}:${makeId('mv')}`, 'movement')
        tx.update(doc(db, 'import_order_items', item.id), {
          deleted: true,
          active: false,
          status: 'deleted',
          deleted_at: serverTimestamp(),
          updated_by: deletedBy,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: revisionOf(item) + 1,
          updated_at: serverTimestamp()
        })
        tx.set(doc(db, 'stock_movements', movementId), movementPayload({
          id: movementId,
          type: 'import_delete_reverse',
          direction: 'out',
          quantity: -toNumber(item.quantity),
          product,
          warehouse,
          logo: item.logo,
          unit: item.unit,
          movementDate: importDate,
          sourceCollection: 'import_orders',
          sourceDocId: orderId,
          sourceItemId: item.id,
          sourceCode: code,
          reason: input.reason || 'Đảo tồn do xóa phiếu nhập',
          createdBy: deletedBy,
          operationId
        }))
      })

      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        const next = current + delta.delta
        tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, next, operationId, deletedBy), { merge: true })
      }

      tx.set(doc(collection(db, 'activity_logs')), activity('import_orders', 'delete', code, {
        id: orderId,
        code,
        reason: input.reason || ''
      }, operationId))

      })
    } catch (error) {
      await failWarehouseOperation(db, operationId, 'import_delete', deletedBy, error).catch(() => undefined)
      throw error
    }
    await completeWarehouseOperation(db, {
      operationId,
      action: 'import_delete',
      targetCollection: 'import_orders',
      targetId: orderId,
      resultCode: code,
      targetRevision: resultRevision,
      createdBy: deletedBy
    })

    invalidateWarehouseCaches()
    return { id: resultId, code: resultCode, revision: resultRevision, operationId, alreadyProcessed }
  }

  async function createExportOrder(input: {
    export_date?: string
    destination_type?: 'customer' | 'warehouse' | string
    source_order_code?: string
    customer_name?: string
    destination_name?: string
    toWarehouse?: WarehouseDoc | any | null
    source_request_id?: string
    sync_source?: string
    note?: string
    id?: string
    code?: string
    operation_id?: string
    lines: WarehouseLineInput[]
  }) {
    const createdBy = email()
    if (!createdBy) throw new Error('Bạn chưa đăng nhập.')
    const destinationType = input.destination_type || 'customer'
    const exportDate = input.export_date || todayKey()
    const orderId = input.id || makeId('exp')
    const code = input.code || makeCode('PXK')
    const operationId = operationIdOf(input.operation_id, `export_create:${orderId}`)
    let resultId = orderId
    let resultCode = code
    let alreadyProcessed = false
    const rawLines = input.lines.filter(line => toNumber(line.quantity) > 0)
    if (!rawLines.length) throw new Error('Phiếu xuất phải có ít nhất một dòng hàng.')

    const defaultToWarehouse = input.toWarehouse ? ensureWarehouse(input.toWarehouse, 'kho nhận') : null
    const preparedLines = [] as Array<WarehouseLineInput & { product: any; fromWarehouse: any; toWarehouse: any | null; sourceLogo: string; targetLogo: string; quantity: number; itemId: string; outMovementId: string; inMovementId: string }>
    rawLines.forEach((line, index) => {
      const product = ensureProduct(line.product)
      const fromWarehouse = ensureWarehouse(
        line.from_warehouse_id || line.warehouse_id || line.fromWarehouse || line.warehouse || line,
        `kho xuất dòng ${index + 1}`,
      )
      const toWarehouse = destinationType === 'warehouse'
        ? ensureWarehouse(line.to_warehouse_id || line.toWarehouse || defaultToWarehouse, `kho nhận dòng ${index + 1}`)
        : null
      if (toWarehouse && toWarehouse.id === fromWarehouse.id) throw new Error('Kho nhận phải khác kho xuất.')
      const quantity = ensurePositiveQuantity(line.quantity)
      const sourceLogo = toWarehouse ? lineSourceLogo(line) : lineTargetLogo(line)
      const targetLogo = lineTargetLogo(line)
      preparedLines.push({
        ...line,
        product,
        fromWarehouse,
        warehouse: fromWarehouse,
        toWarehouse,
        sourceLogo,
        targetLogo,
        quantity,
        itemId: safeDocId(`${orderId}__${index + 1}`, 'export_item'),
        outMovementId: safeDocId(`export_out:${orderId}:${index + 1}`, 'movement'),
        inMovementId: safeDocId(`transfer_in:${orderId}:${index + 1}`, 'movement')
      })
    })

    const balanceDeltas = new Map<string, BalanceDelta>()
    for (const line of preparedLines) {
      const outId = await inventoryBalanceId(line.product.id, line.fromWarehouse.id, line.sourceLogo)
      applyDelta(balanceDeltas, {
        id: outId,
        delta: -line.quantity,
        product: line.product,
        warehouse: line.fromWarehouse,
        logo: line.sourceLogo,
        unit: line.unit || line.product.unit || '',
        movementDate: exportDate
      })
      if (line.toWarehouse) {
        const inId = await inventoryBalanceId(line.product.id, line.toWarehouse.id, line.targetLogo)
        applyDelta(balanceDeltas, {
          id: inId,
          delta: line.quantity,
          product: line.product,
          warehouse: line.toWarehouse,
          logo: line.targetLogo,
          unit: line.unit || line.product.unit || '',
          movementDate: exportDate
        })
      }
    }

    const firstToWarehouse = preparedLines.find(line => line.toWarehouse)?.toWarehouse || defaultToWarehouse
    const orderPayload = {
      id: orderId,
      code,
      export_code: code,
      export_date: exportDate,
      destination_type: destinationType,
      source_order_code: input.source_order_code || '',
      source_request_id: input.source_request_id || '',
      sync_source: input.sync_source || '',
      customer_name: input.customer_name || '',
      destination_name: destinationType === 'warehouse'
        ? warehouseName(firstToWarehouse)
        : (input.destination_name || input.customer_name || ''),
      to_warehouse_id: firstToWarehouse?.id || '',
      to_warehouse_name: firstToWarehouse ? warehouseName(firstToWarehouse) : '',
      note: input.note || '',
      status: 'completed',
      active: true,
      deleted: false,
      created_by: createdBy,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      operation_id: operationId,
      last_operation_id: operationId,
      revision: 1,
      source: input.source_request_id ? 'kingcup_firestore' : 'nuxt'
    }

    const stockMovementIds = preparedLines.flatMap(line => line.toWarehouse ? [line.outMovementId, line.inMovementId] : [line.outMovementId])

    await claimWarehouseOperation(db, {
      operationId,
      action: 'export_create',
      targetCollection: 'export_orders',
      targetId: orderId,
      resultCode: code,
      createdBy: createdBy
    })

    try {
      await runTransaction(db, async tx => {
      const operationRef = doc(db, 'warehouse_operations', operationId)
      const operationSnap = await tx.get(operationRef)
      if (!operationSnap.exists()) throw new Error('Không tìm thấy operation pending cho nghiệp vụ kho.')
      const operationData = operationSnap.data() || {}
      assertOperationOwner(operationData, 'export_create', createdBy)
      if (String(operationData.status || '') === 'completed') {
        const previous = readOperationResult(operationSnap.data(), 'export_create')
        resultId = previous.id || resultId
        resultCode = previous.code || resultCode
        alreadyProcessed = true
        return

      }
      const balanceSnaps = new Map<string, any>()
      for (const delta of balanceDeltas.values()) {
        balanceSnaps.set(delta.id, await tx.get(doc(db, 'inventory_balances', delta.id)))
      }

      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        const next = current + delta.delta
        if (next < 0) {
          throw new Error(`Không đủ tồn: ${productCode(delta.product)} - ${productName(delta.product)} / ${warehouseName(delta.warehouse)}${delta.logo ? ` / ${delta.logo}` : ''}. Tồn hiện tại ${current}, cần ${Math.abs(delta.delta)}.`)
        }
      }

      tx.set(doc(db, 'export_orders', orderId), orderPayload)
      preparedLines.forEach(line => {
        const itemPayload = {
          id: line.itemId,
          export_order_id: orderId,
          product_id: line.product.id,
          product_code: productCode(line.product),
          product_name: productName(line.product),
          from_warehouse_id: line.fromWarehouse.id,
          from_warehouse_name: warehouseName(line.fromWarehouse),
          to_warehouse_id: line.toWarehouse?.id || '',
          to_warehouse_name: line.toWarehouse ? warehouseName(line.toWarehouse) : '',
          destination_name: orderPayload.destination_name,
          logo: line.targetLogo,
          source_logo: line.sourceLogo,
          target_logo: line.targetLogo,
          quantity: line.quantity,
          unit: line.unit || line.product.unit || '',
          note: line.note || '',
          legacy_line_key: '',
          status: 'completed',
          active: true,
          deleted: false,
          created_by: createdBy,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
          operation_id: operationId,
          last_operation_id: operationId,
          revision: 1,
          source: orderPayload.source
        }
        tx.set(doc(db, 'export_order_items', line.itemId), itemPayload)
        tx.set(doc(db, 'stock_movements', line.outMovementId), movementPayload({
          id: line.outMovementId,
          type: line.toWarehouse ? 'export_transfer_out' : 'export_customer',
          direction: 'out',
          quantity: -line.quantity,
          product: line.product,
          warehouse: line.fromWarehouse,
          logo: line.sourceLogo,
          unit: line.unit,
          movementDate: exportDate,
          sourceCollection: 'export_orders',
          sourceDocId: orderId,
          sourceItemId: line.itemId,
          sourceCode: code,
          reason: line.toWarehouse ? 'Xuất chuyển kho' : 'Xuất tới khách hàng',
          createdBy,
          operationId
        }))
        if (line.toWarehouse) {
          tx.set(doc(db, 'stock_movements', line.inMovementId), movementPayload({
            id: line.inMovementId,
            type: 'export_transfer_in',
            direction: 'in',
            quantity: line.quantity,
            product: line.product,
            warehouse: line.toWarehouse,
            logo: line.targetLogo,
            unit: line.unit,
            movementDate: exportDate,
            sourceCollection: 'export_orders',
            sourceDocId: orderId,
            sourceItemId: line.itemId,
            sourceCode: code,
            reason: 'Nhập từ chuyển kho',
            createdBy,
            operationId
          }))
        }
      })

      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        const next = current + delta.delta
        tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, next, operationId, createdBy), { merge: true })
      }

      tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'create', code, orderPayload, operationId))

      })
    } catch (error) {
      await failWarehouseOperation(db, operationId, 'export_create', createdBy, error).catch(() => undefined)
      throw error
    }
    await completeWarehouseOperation(db, {
      operationId,
      action: 'export_create',
      targetCollection: 'export_orders',
      targetId: orderId,
      resultCode: code,
      targetRevision: 1,
      createdBy: createdBy
    })

    invalidateWarehouseCaches()
    return { id: resultId, code: resultCode, stockMovementIds, operationId, alreadyProcessed }
  }


  async function updateExportOrder(input: {
    order: any
    existingItems: any[]
    export_date?: string
    destination_type?: 'customer' | 'warehouse' | string
    source_order_code?: string
    customer_name?: string
    destination_name?: string
    toWarehouse?: WarehouseDoc | any | null
    note?: string
    operation_id?: string
    expected_revision?: number
    lines: WarehouseLineInput[]
  }) {
    const updatedBy = email()
    if (!updatedBy) throw new Error('Bạn chưa đăng nhập.')
    const order = input.order || {}
    const orderId = normalizeId(order.id)
    if (!orderId) throw new Error('Thiếu ID phiếu xuất cần sửa.')
    if (isRequestGeneratedExport(order)) {
      throw new Error('Phiếu xuất sinh từ yêu cầu sale chỉ được xem, không được sửa trực tiếp tại trang Xuất kho thật.')
    }
    if (order.deleted === true || order.active === false || ['cancelled', 'deleted'].includes(String(order.status || ''))) {
      throw new Error('Phiếu xuất đã hủy/xóa, không thể sửa.')
    }

    const oldItems = (input.existingItems || []).filter(item => item && item.deleted !== true && item.active !== false)
    if (!oldItems.length) throw new Error('Phiếu xuất không có chi tiết cũ để cập nhật tồn an toàn.')

    const destinationType = input.destination_type || order.destination_type || 'customer'
    const exportDate = input.export_date || order.export_date || todayKey()
    const code = order.code || order.export_code || orderId
    const operationId = operationIdOf(input.operation_id, `export_update:${orderId}:${revisionOf(order)}`)
    const expectedRevision = input.expected_revision ?? order.revision ?? 0
    let resultId = orderId
    let resultCode = code
    let resultRevision = revisionOf(order)
    let alreadyProcessed = false
    const rawLines = input.lines.filter(line => toNumber(line.quantity) > 0)
    if (!rawLines.length) throw new Error('Phiếu xuất phải có ít nhất một dòng hàng.')

    const defaultToWarehouse = destinationType === 'warehouse' && input.toWarehouse
      ? ensureWarehouse(input.toWarehouse, 'kho nhận')
      : null
    const preparedNew = rawLines.map((line, index) => {
      const product = ensureProduct(line.product)
      const fromWarehouse = ensureWarehouse(
        line.from_warehouse_id || line.warehouse_id || line.fromWarehouse || line.warehouse || line,
        `kho xuất dòng ${index + 1}`,
      )
      const toWarehouse = destinationType === 'warehouse'
        ? ensureWarehouse(line.to_warehouse_id || line.toWarehouse || defaultToWarehouse, `kho nhận dòng ${index + 1}`)
        : null
      if (toWarehouse && toWarehouse.id === fromWarehouse.id) throw new Error('Kho nhận phải khác kho xuất.')
      const quantity = ensurePositiveQuantity(line.quantity)
      const existing = oldItems[index]
      const sourceLogo = toWarehouse ? lineSourceLogo(line) : lineTargetLogo(line)
      const targetLogo = lineTargetLogo(line)
      return {
        ...line,
        product,
        fromWarehouse,
        warehouse: fromWarehouse,
        toWarehouse,
        sourceLogo,
        targetLogo,
        quantity,
        itemId: existing?.id || safeDocId(`${orderId}__${index + 1}`, 'export_item'),
        outMovementId: safeDocId(`export_update_apply_out:${orderId}:${index + 1}:${makeId('mv')}`, 'movement'),
        inMovementId: safeDocId(`export_update_apply_in:${orderId}:${index + 1}:${makeId('mv')}`, 'movement')
      }
    })

    const balanceDeltas = new Map<string, BalanceDelta>()

    for (const item of oldItems) {
      const product = exportItemProduct(item)
      const fromWarehouse = exportItemFromWarehouse(item)
      const toWarehouse = exportItemToWarehouse(item)
      const quantity = ensurePositiveQuantity(item.quantity, 'Số lượng cũ')
      const sourceLogo = exportItemSourceLogo(item)
      const targetLogo = exportItemTargetLogo(item)
      const sourceId = await inventoryBalanceId(product.id, fromWarehouse.id, sourceLogo)
      applyDelta(balanceDeltas, {
        id: sourceId,
        delta: quantity,
        product,
        warehouse: fromWarehouse,
        logo: sourceLogo,
        unit: item.unit || product.unit || '',
        movementDate: exportDate
      })
      if (toWarehouse) {
        const destinationId = await inventoryBalanceId(product.id, toWarehouse.id, targetLogo)
        applyDelta(balanceDeltas, {
          id: destinationId,
          delta: -quantity,
          product,
          warehouse: toWarehouse,
          logo: targetLogo,
          unit: item.unit || product.unit || '',
          movementDate: exportDate
        })
      }
    }

    for (const line of preparedNew) {
      const sourceId = await inventoryBalanceId(line.product.id, line.fromWarehouse.id, line.sourceLogo)
      applyDelta(balanceDeltas, {
        id: sourceId,
        delta: -line.quantity,
        product: line.product,
        warehouse: line.fromWarehouse,
        logo: line.sourceLogo,
        unit: line.unit || line.product.unit || '',
        movementDate: exportDate
      })
      if (line.toWarehouse) {
        const destinationId = await inventoryBalanceId(line.product.id, line.toWarehouse.id, line.targetLogo)
        applyDelta(balanceDeltas, {
          id: destinationId,
          delta: line.quantity,
          product: line.product,
          warehouse: line.toWarehouse,
          logo: line.targetLogo,
          unit: line.unit || line.product.unit || '',
          movementDate: exportDate
        })
      }
    }

    const firstToWarehouse = preparedNew.find(line => line.toWarehouse)?.toWarehouse || defaultToWarehouse
    const nextDestinationName = destinationType === 'warehouse'
      ? warehouseName(firstToWarehouse)
      : (input.destination_name || input.customer_name || '')

    await claimWarehouseOperation(db, {
      operationId,
      action: 'export_update',
      targetCollection: 'export_orders',
      targetId: orderId,
      resultCode: code,
      createdBy: updatedBy
    })

    try {
      await runTransaction(db, async tx => {
      const operationRef = doc(db, 'warehouse_operations', operationId)
      const operationSnap = await tx.get(operationRef)
      if (!operationSnap.exists()) throw new Error('Không tìm thấy operation pending cho nghiệp vụ kho.')
      const operationData = operationSnap.data() || {}
      assertOperationOwner(operationData, 'export_update', updatedBy)
      if (String(operationData.status || '') === 'completed') {
        const previous = readOperationResult(operationSnap.data(), 'export_update')
        resultId = previous.id || resultId
        resultCode = previous.code || resultCode
        resultRevision = previous.revision || resultRevision
        alreadyProcessed = true
        return

      }
      const orderRef = doc(db, 'export_orders', orderId)
      const currentOrderSnap = await tx.get(orderRef)
      if (!currentOrderSnap.exists()) throw new Error('Phiếu xuất không còn tồn tại.')
      const currentOrder = currentOrderSnap.data() || {}
      if (isRequestGeneratedExport(currentOrder)) {
        throw new Error('Phiếu xuất sinh từ yêu cầu sale không được sửa trực tiếp.')
      }
      if (currentOrder.deleted === true || currentOrder.active === false || ['cancelled', 'deleted'].includes(String(currentOrder.status || ''))) {
        throw new Error('Phiếu xuất đã hủy/xóa, không thể sửa.')
      }
      const currentRevision = assertExpectedRevision(currentOrder, expectedRevision, 'Phiếu xuất')
      resultRevision = currentRevision + 1

      const balanceSnaps = new Map<string, any>()
      for (const delta of balanceDeltas.values()) {
        balanceSnaps.set(delta.id, await tx.get(doc(db, 'inventory_balances', delta.id)))
      }

      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        const next = current + delta.delta
        if (next < 0) {
          throw new Error(`Sửa phiếu xuất làm tồn âm: ${productCode(delta.product)} - ${productName(delta.product)} / ${warehouseName(delta.warehouse)}${delta.logo ? ` / ${delta.logo}` : ''}. Tồn hiện tại ${current}, thay đổi ${delta.delta}.`)
        }
      }

      tx.update(orderRef, {
        export_date: exportDate,
        destination_type: destinationType,
        source_order_code: input.source_order_code || '',
        customer_name: destinationType === 'warehouse' ? '' : (input.customer_name || ''),
        destination_name: nextDestinationName,
        to_warehouse_id: firstToWarehouse?.id || '',
        to_warehouse_name: firstToWarehouse ? warehouseName(firstToWarehouse) : '',
        note: input.note || '',
        updated_by: updatedBy,
        operation_id: operationId,
        last_operation_id: operationId,
        revision: resultRevision,
        updated_at: serverTimestamp()
      })

      oldItems.forEach(item => {
        const product = exportItemProduct(item)
        const fromWarehouse = exportItemFromWarehouse(item)
        const toWarehouse = exportItemToWarehouse(item)
        const quantity = toNumber(item.quantity)
        const sourceLogo = exportItemSourceLogo(item)
        const targetLogo = exportItemTargetLogo(item)

        const sourceReverseId = safeDocId(`export_update_reverse_source:${orderId}:${item.id}:${makeId('mv')}`, 'movement')
        tx.set(doc(db, 'stock_movements', sourceReverseId), movementPayload({
          id: sourceReverseId,
          type: 'export_update_reverse_source',
          direction: 'in',
          quantity,
          product,
          warehouse: fromWarehouse,
          logo: sourceLogo,
          unit: item.unit,
          movementDate: exportDate,
          sourceCollection: 'export_orders',
          sourceDocId: orderId,
          sourceItemId: item.id,
          sourceCode: code,
          reason: 'Hoàn biến động kho nguồn trước khi sửa phiếu xuất',
          createdBy: updatedBy,
          operationId
        }))

        if (toWarehouse) {
          const destinationReverseId = safeDocId(`export_update_reverse_destination:${orderId}:${item.id}:${makeId('mv')}`, 'movement')
          tx.set(doc(db, 'stock_movements', destinationReverseId), movementPayload({
            id: destinationReverseId,
            type: 'export_update_reverse_destination',
            direction: 'out',
            quantity: -quantity,
            product,
            warehouse: toWarehouse,
            logo: targetLogo,
            unit: item.unit,
            movementDate: exportDate,
            sourceCollection: 'export_orders',
            sourceDocId: orderId,
            sourceItemId: item.id,
            sourceCode: code,
            reason: 'Đảo biến động kho nhận trước khi sửa phiếu chuyển kho',
            createdBy: updatedBy,
            operationId
          }))
        }
      })

      preparedNew.forEach((line, index) => {
        const oldItem = oldItems[index]
        const itemPayload = {
          id: line.itemId,
          export_order_id: orderId,
          product_id: line.product.id,
          product_code: productCode(line.product),
          product_name: productName(line.product),
          from_warehouse_id: line.fromWarehouse.id,
          from_warehouse_name: warehouseName(line.fromWarehouse),
          to_warehouse_id: line.toWarehouse?.id || '',
          to_warehouse_name: line.toWarehouse ? warehouseName(line.toWarehouse) : '',
          destination_name: nextDestinationName,
          logo: line.targetLogo,
          source_logo: line.sourceLogo,
          target_logo: line.targetLogo,
          quantity: line.quantity,
          unit: line.unit || line.product.unit || '',
          note: line.note || '',
          legacy_line_key: oldItem?.legacy_line_key || '',
          status: 'completed',
          active: true,
          deleted: false,
          updated_by: updatedBy,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: revisionOf(oldItem) + 1,
          updated_at: serverTimestamp(),
          source: oldItem?.source || order.source || 'nuxt'
        }

        if (oldItem?.id) {
          const { source: _source, ...mutableItemPayload } = itemPayload
          tx.update(doc(db, 'export_order_items', line.itemId), mutableItemPayload)
        } else {
          tx.set(doc(db, 'export_order_items', line.itemId), {
            ...itemPayload,
            created_by: updatedBy,
            created_at: serverTimestamp()
          })
        }

        tx.set(doc(db, 'stock_movements', line.outMovementId), movementPayload({
          id: line.outMovementId,
          type: line.toWarehouse ? 'export_transfer_out' : 'export_customer',
          direction: 'out',
          quantity: -line.quantity,
          product: line.product,
          warehouse: line.fromWarehouse,
          logo: line.sourceLogo,
          unit: line.unit,
          movementDate: exportDate,
          sourceCollection: 'export_orders',
          sourceDocId: orderId,
          sourceItemId: line.itemId,
          sourceCode: code,
          reason: line.toWarehouse ? 'Áp lại xuất chuyển kho sau khi sửa' : 'Áp lại xuất tới khách sau khi sửa',
          createdBy: updatedBy,
          operationId
        }))

        if (line.toWarehouse) {
          tx.set(doc(db, 'stock_movements', line.inMovementId), movementPayload({
            id: line.inMovementId,
            type: 'export_transfer_in',
            direction: 'in',
            quantity: line.quantity,
            product: line.product,
            warehouse: line.toWarehouse,
            logo: line.targetLogo,
            unit: line.unit,
            movementDate: exportDate,
            sourceCollection: 'export_orders',
            sourceDocId: orderId,
            sourceItemId: line.itemId,
            sourceCode: code,
            reason: 'Áp lại nhập chuyển kho sau khi sửa',
            createdBy: updatedBy,
            operationId
          }))
        }
      })

      oldItems.slice(preparedNew.length).forEach(item => {
        tx.update(doc(db, 'export_order_items', item.id), {
          deleted: true,
          active: false,
          status: 'deleted',
          deleted_at: serverTimestamp(),
          deleted_by: updatedBy,
          updated_by: updatedBy,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: revisionOf(item) + 1,
          updated_at: serverTimestamp()
        })
      })

      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, current + delta.delta, operationId, updatedBy), { merge: true })
      }

      tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'update', code, {
        id: orderId,
        code,
        destination_type: destinationType,
        line_count: preparedNew.length
      }, operationId))

      })
    } catch (error) {
      await failWarehouseOperation(db, operationId, 'export_update', updatedBy, error).catch(() => undefined)
      throw error
    }
    await completeWarehouseOperation(db, {
      operationId,
      action: 'export_update',
      targetCollection: 'export_orders',
      targetId: orderId,
      resultCode: code,
      targetRevision: resultRevision,
      createdBy: updatedBy
    })

    invalidateWarehouseCaches()
    return { id: resultId, code: resultCode, revision: resultRevision, operationId, alreadyProcessed }
  }

  async function deleteExportOrder(input: {
    order: any
    existingItems: any[]
    reason?: string
    operation_id?: string
    expected_revision?: number
  }) {
    const deletedBy = email()
    if (!deletedBy) throw new Error('Bạn chưa đăng nhập.')
    const order = input.order || {}
    const orderId = normalizeId(order.id)
    if (!orderId) throw new Error('Thiếu ID phiếu xuất cần hủy.')
    if (isRequestGeneratedExport(order)) {
      throw new Error('Phiếu xuất sinh từ yêu cầu sale không được hủy tại trang Xuất kho thật. Phải xử lý bằng luồng yêu cầu xuất riêng.')
    }
    if (order.deleted === true || order.active === false || ['cancelled', 'deleted'].includes(String(order.status || ''))) {
      throw new Error('Phiếu xuất đã được hủy trước đó.')
    }

    const oldItems = (input.existingItems || []).filter(item => item && item.deleted !== true && item.active !== false)
    if (!oldItems.length) throw new Error('Phiếu xuất không có chi tiết để hoàn tồn.')
    const exportDate = order.export_date || todayKey()
    const code = order.code || order.export_code || orderId
    const reason = String(input.reason || '').trim() || 'Hủy phiếu xuất kho'
    const operationId = operationIdOf(input.operation_id, `export_cancel:${orderId}:${revisionOf(order)}`)
    const expectedRevision = input.expected_revision ?? order.revision ?? 0
    let resultId = orderId
    let resultCode = code
    let resultRevision = revisionOf(order)
    let alreadyProcessed = false

    const balanceDeltas = new Map<string, BalanceDelta>()
    for (const item of oldItems) {
      const product = exportItemProduct(item)
      const fromWarehouse = exportItemFromWarehouse(item)
      const toWarehouse = exportItemToWarehouse(item)
      const quantity = ensurePositiveQuantity(item.quantity)
      const sourceLogo = exportItemSourceLogo(item)
      const targetLogo = exportItemTargetLogo(item)

      const sourceId = await inventoryBalanceId(product.id, fromWarehouse.id, sourceLogo)
      applyDelta(balanceDeltas, {
        id: sourceId,
        delta: quantity,
        product,
        warehouse: fromWarehouse,
        logo: sourceLogo,
        unit: item.unit || product.unit || '',
        movementDate: exportDate
      })

      if (toWarehouse) {
        const destinationId = await inventoryBalanceId(product.id, toWarehouse.id, targetLogo)
        applyDelta(balanceDeltas, {
          id: destinationId,
          delta: -quantity,
          product,
          warehouse: toWarehouse,
          logo: targetLogo,
          unit: item.unit || product.unit || '',
          movementDate: exportDate
        })
      }
    }

    await claimWarehouseOperation(db, {
      operationId,
      action: 'export_cancel',
      targetCollection: 'export_orders',
      targetId: orderId,
      resultCode: code,
      createdBy: deletedBy
    })

    try {
      await runTransaction(db, async tx => {
      const operationRef = doc(db, 'warehouse_operations', operationId)
      const operationSnap = await tx.get(operationRef)
      if (!operationSnap.exists()) throw new Error('Không tìm thấy operation pending cho nghiệp vụ kho.')
      const operationData = operationSnap.data() || {}
      assertOperationOwner(operationData, 'export_cancel', deletedBy)
      if (String(operationData.status || '') === 'completed') {
        const previous = readOperationResult(operationSnap.data(), 'export_cancel')
        resultId = previous.id || resultId
        resultCode = previous.code || resultCode
        resultRevision = previous.revision || resultRevision
        alreadyProcessed = true
        return

      }
      const orderRef = doc(db, 'export_orders', orderId)
      const currentOrderSnap = await tx.get(orderRef)
      if (!currentOrderSnap.exists()) throw new Error('Phiếu xuất không còn tồn tại.')
      const currentOrder = currentOrderSnap.data() || {}
      if (isRequestGeneratedExport(currentOrder)) {
        throw new Error('Phiếu xuất sinh từ yêu cầu sale không được hủy trực tiếp.')
      }
      if (currentOrder.deleted === true || currentOrder.active === false) {
        throw new Error('Phiếu xuất đã được hủy trước đó.')
      }
      const currentRevision = assertExpectedRevision(currentOrder, expectedRevision, 'Phiếu xuất')
      resultRevision = currentRevision + 1

      const balanceSnaps = new Map<string, any>()
      for (const delta of balanceDeltas.values()) {
        balanceSnaps.set(delta.id, await tx.get(doc(db, 'inventory_balances', delta.id)))
      }

      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        const next = current + delta.delta
        if (next < 0) {
          throw new Error(`Không thể hủy phiếu vì kho nhận đã sử dụng hàng: ${productCode(delta.product)} - ${productName(delta.product)} / ${warehouseName(delta.warehouse)}${delta.logo ? ` / ${delta.logo}` : ''}. Tồn hiện tại ${current}, cần hoàn ${Math.abs(delta.delta)}.`)
        }
      }

      tx.update(orderRef, {
        deleted: true,
        active: false,
        status: 'cancelled',
        deleted_at: serverTimestamp(),
        deleted_by: deletedBy,
        deleted_reason: reason,
        cancelled_at: serverTimestamp(),
        cancelled_by: deletedBy,
        cancel_reason: reason,
        updated_by: deletedBy,
        operation_id: operationId,
        last_operation_id: operationId,
        revision: resultRevision,
        updated_at: serverTimestamp()
      })

      oldItems.forEach(item => {
        const product = exportItemProduct(item)
        const fromWarehouse = exportItemFromWarehouse(item)
        const toWarehouse = exportItemToWarehouse(item)
        const quantity = toNumber(item.quantity)
        const sourceLogo = exportItemSourceLogo(item)
        const targetLogo = exportItemTargetLogo(item)

        tx.update(doc(db, 'export_order_items', item.id), {
          deleted: true,
          active: false,
          status: 'cancelled',
          deleted_at: serverTimestamp(),
          deleted_by: deletedBy,
          deleted_reason: reason,
          updated_by: deletedBy,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: revisionOf(item) + 1,
          updated_at: serverTimestamp()
        })

        const sourceReverseId = safeDocId(`export_cancel_reverse_source:${orderId}:${item.id}:${makeId('mv')}`, 'movement')
        tx.set(doc(db, 'stock_movements', sourceReverseId), movementPayload({
          id: sourceReverseId,
          type: 'export_cancel_reverse_source',
          direction: 'in',
          quantity,
          product,
          warehouse: fromWarehouse,
          logo: sourceLogo,
          unit: item.unit,
          movementDate: exportDate,
          sourceCollection: 'export_orders',
          sourceDocId: orderId,
          sourceItemId: item.id,
          sourceCode: code,
          reason,
          createdBy: deletedBy,
          operationId
        }))

        if (toWarehouse) {
          const destinationReverseId = safeDocId(`export_cancel_reverse_destination:${orderId}:${item.id}:${makeId('mv')}`, 'movement')
          tx.set(doc(db, 'stock_movements', destinationReverseId), movementPayload({
            id: destinationReverseId,
            type: 'export_cancel_reverse_destination',
            direction: 'out',
            quantity: -quantity,
            product,
            warehouse: toWarehouse,
            logo: targetLogo,
            unit: item.unit,
            movementDate: exportDate,
            sourceCollection: 'export_orders',
            sourceDocId: orderId,
            sourceItemId: item.id,
            sourceCode: code,
            reason,
            createdBy: deletedBy,
            operationId
          }))
        }
      })

      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, current + delta.delta, operationId, deletedBy), { merge: true })
      }

      tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'cancel', code, {
        id: orderId,
        code,
        reason
      }, operationId))

      })
    } catch (error) {
      await failWarehouseOperation(db, operationId, 'export_cancel', deletedBy, error).catch(() => undefined)
      throw error
    }
    await completeWarehouseOperation(db, {
      operationId,
      action: 'export_cancel',
      targetCollection: 'export_orders',
      targetId: orderId,
      resultCode: code,
      targetRevision: resultRevision,
      createdBy: deletedBy
    })

    invalidateWarehouseCaches()
    return { id: resultId, code: resultCode, revision: resultRevision, operationId, alreadyProcessed }
  }


  async function createInventoryAdjustment(input: {
    adjustment_date?: string
    product: ProductDoc | any
    warehouse: WarehouseDoc | any
    logo?: string
    quantity: number
    unit?: string
    reason?: string
    note?: string
    operation_id?: string
  }) {
    const createdBy = email()
    if (!createdBy) throw new Error('Bạn chưa đăng nhập.')
    const product = ensureProduct(input.product)
    const warehouse = ensureWarehouse(input.warehouse, 'kho')
    const quantity = signedNumber(input.quantity)
    const adjustmentDate = input.adjustment_date || todayKey()
    const adjustmentId = makeId('adj')
    const operationId = operationIdOf(input.operation_id, `inventory_adjust:${adjustmentId}`)
    let resultId = adjustmentId
    let alreadyProcessed = false
    const movementId = safeDocId(`adjust:${adjustmentId}`, 'movement')
    const balanceKey = await inventoryBalanceId(product.id, warehouse.id, input.logo)
    const delta: BalanceDelta = {
      id: balanceKey,
      delta: quantity,
      product,
      warehouse,
      logo: normalizeLogo(input.logo),
      unit: input.unit || product.unit || '',
      movementDate: adjustmentDate
    }

    const payload = {
      id: adjustmentId,
      adjustment_date: adjustmentDate,
      product_id: product.id,
      product_code: productCode(product),
      product_name: productName(product),
      warehouse_id: warehouse.id,
      warehouse_name: warehouseName(warehouse),
      logo: normalizeLogo(input.logo),
      quantity,
      unit: input.unit || product.unit || '',
      reason: input.reason || '',
      note: input.note || '',
      status: 'completed',
      active: true,
      deleted: false,
      created_by: createdBy,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      operation_id: operationId,
      last_operation_id: operationId,
      revision: 1,
      source: 'nuxt'
    }

    await claimWarehouseOperation(db, {
      operationId,
      action: 'inventory_adjust',
      targetCollection: 'inventory_adjustments',
      targetId: adjustmentId,
      resultCode: '',
      createdBy: createdBy
    })

    try {
      await runTransaction(db, async tx => {
      const operationRef = doc(db, 'warehouse_operations', operationId)
      const operationSnap = await tx.get(operationRef)
      if (!operationSnap.exists()) throw new Error('Không tìm thấy operation pending cho nghiệp vụ kho.')
      const operationData = operationSnap.data() || {}
      assertOperationOwner(operationData, 'inventory_adjust', createdBy)
      if (String(operationData.status || '') === 'completed') {
        const previous = readOperationResult(operationSnap.data(), 'inventory_adjust')
        resultId = previous.id || resultId
        alreadyProcessed = true
        return

      }
      const balanceRef = doc(db, 'inventory_balances', balanceKey)
      const snap = await tx.get(balanceRef)
      const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
      const next = current + quantity
      if (next < 0) throw new Error(`Điều chỉnh làm tồn âm. Tồn hiện tại ${current}, điều chỉnh ${quantity}.`)

      tx.set(doc(db, 'inventory_adjustments', adjustmentId), payload)
      tx.set(doc(db, 'stock_movements', movementId), movementPayload({
        id: movementId,
        type: 'adjustment',
        direction: 'adjust',
        quantity,
        product,
        warehouse,
        logo: input.logo,
        unit: input.unit,
        movementDate: adjustmentDate,
        sourceCollection: 'inventory_adjustments',
        sourceDocId: adjustmentId,
        sourceItemId: adjustmentId,
        sourceCode: adjustmentId,
        reason: input.reason || input.note || 'Điều chỉnh tồn',
        createdBy,
        operationId
      }))
      tx.set(balanceRef, balancePayload(delta, next, operationId, createdBy), { merge: true })
      tx.set(doc(collection(db, 'activity_logs')), activity('inventory_adjustments', 'create', adjustmentId, payload, operationId))

      })
    } catch (error) {
      await failWarehouseOperation(db, operationId, 'inventory_adjust', createdBy, error).catch(() => undefined)
      throw error
    }
    await completeWarehouseOperation(db, {
      operationId,
      action: 'inventory_adjust',
      targetCollection: 'inventory_adjustments',
      targetId: adjustmentId,
      resultCode: '',
      targetRevision: 1,
      createdBy: createdBy
    })

    invalidateWarehouseCaches()
    return { id: resultId, operationId, alreadyProcessed }
  }

  async function processExportRequestToExportOrder(input: {
    request: any
    orderSummaryPatch?: Record<string, any>
    customer_name?: string
    note?: string
    export_date?: string
    timeline?: any[]
    notification_recipients?: string[]
    operation_id?: string
    expected_revision?: number
    warehouse?: WarehouseDoc | any
    lines: Array<{ source_order_id?: string; source_order_item_id?: string; product: ProductDoc | any; warehouse?: WarehouseDoc | any; fromWarehouse?: WarehouseDoc | any; from_warehouse_id?: string; warehouse_id?: string; logo?: string; quantity: number; unit?: string; note?: string }>
  }) {
    const createdBy = email()
    if (!createdBy) throw new Error('Bạn chưa đăng nhập.')

    const request = input.request || {}
    const requestDocId = String(request.id || request.request_id || '').trim()
    if (!requestDocId) throw new Error('Thiếu ID yêu cầu xuất kho.')
    if (!canReleaseExportRequest(request)) {
      throw new Error('Yêu cầu không còn ở trạng thái được phép cho xuất hoặc đang có phiếu xuất hoạt động.')
    }

    const expectedRevision = input.expected_revision ?? request.revision ?? 0
    const releaseSequence = nextExportReleaseSequence(request)
    const orderId = requestExportOrderId(requestDocId, releaseSequence)
    const baseCode = `PXK-${request.request_id || requestDocId}`
    const code = safeDocId(releaseSequence <= 1 ? baseCode : `${baseCode}-${releaseSequence}`, 'PXK')
    const operationId = operationIdOf(input.operation_id, `export_request_release:${requestDocId}:${releaseSequence}`)
    const fallbackWarehouse = input.warehouse ? ensureWarehouse(input.warehouse, 'kho xuất mặc định') : null
    const exportDate = input.export_date || request.export_date || todayKey()
    let resultId = orderId
    let resultCode = code
    let resultRevision = 1
    let alreadyProcessed = false

    const rawLines = input.lines.filter(line => toNumber(line.quantity) > 0)
    if (!rawLines.length) throw new Error('Yêu cầu xuất kho chưa có dòng hàng hợp lệ.')

    const preparedLines = [] as Array<{ sourceOrderId: string; sourceOrderItemId: string; product: any; fromWarehouse: any; logo: string; unit?: string; note?: string; quantity: number; itemId: string; outMovementId: string }>
    rawLines.forEach((line, index) => {
      const product = ensureProduct(line.product)
      const fromWarehouse = ensureWarehouse(
        line.from_warehouse_id || line.warehouse_id || line.fromWarehouse || line.warehouse || fallbackWarehouse || line,
        `kho xuất dòng ${index + 1}`,
      )
      const quantity = ensurePositiveQuantity(line.quantity)
      preparedLines.push({
        sourceOrderId: String(line.source_order_id || request.order_id || '').trim(),
        sourceOrderItemId: String(line.source_order_item_id || '').trim(),
        product,
        fromWarehouse,
        logo: lineTargetLogo(line),
        unit: line.unit || product.unit || '',
        note: line.note || '',
        quantity,
        itemId: safeDocId(`${orderId}__${index + 1}`, 'export_item'),
        outMovementId: safeDocId(`export_out:${orderId}:${index + 1}`, 'movement')
      })
    })

    const balanceDeltas = new Map<string, BalanceDelta>()
    for (const line of preparedLines) {
      const outId = await inventoryBalanceId(line.product.id, line.fromWarehouse.id, line.logo)
      applyDelta(balanceDeltas, {
        id: outId,
        delta: -line.quantity,
        product: line.product,
        warehouse: line.fromWarehouse,
        logo: normalizeLogo(line.logo),
        unit: line.unit || line.product.unit || '',
        movementDate: exportDate
      })
    }

    const stockMovementIds = preparedLines.map(line => line.outMovementId)
    const actualSummary = preparedLines.map(line => ({
      source_order_id: line.sourceOrderId,
      source_order_item_id: line.sourceOrderItemId,
      product_id: line.product?.id || '',
      product_code: productCode(line.product),
      product_name: productName(line.product),
      logo: normalizeLogo(line.logo),
      warehouse_id: line.fromWarehouse?.id || '',
      warehouse_name: warehouseName(line.fromWarehouse),
      quantity: toNumber(line.quantity),
      unit: line.unit || line.product?.unit || ''
    }))
    const orderPayload = {
      id: orderId,
      code,
      export_code: code,
      export_date: exportDate,
      destination_type: 'customer',
      source_order_code: request.order_code || '',
      source_request_id: requestDocId,
      sync_source: `kingcup_firestore:${requestDocId}`,
      customer_name: input.customer_name || request.customer_name || '',
      destination_name: input.customer_name || request.customer_name || '',
      note: input.note || '',
      status: 'completed',
      active: true,
      deleted: false,
      created_by: createdBy,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
      operation_id: operationId,
      last_operation_id: operationId,
      revision: 1,
      source: 'kingcup_firestore',
      ...buildGeneratedExportLifecycleFields({
        requestId: requestDocId,
        requestRevision: expectedRevision,
        releaseSequence,
        operationId,
      }),
    }

    const handledBy = createdBy
    const saleRecipients = Array.isArray(input.notification_recipients)
      ? Array.from(new Set(input.notification_recipients.map(normalizeEmail).filter(Boolean)))
        .filter(recipient => recipient !== handledBy)
      : resolveSaleNotificationRecipients({ request, actorEmail: handledBy })
    const notificationRefs = saleRecipients.map(() => doc(collection(db, 'notifications')))

    await claimWarehouseOperation(db, {
      operationId,
      action: 'export_request_release',
      targetCollection: 'export_orders',
      targetId: orderId,
      resultCode: code,
      createdBy,
    })

    try {
      await runTransaction(db, async tx => {
        const operationRef = doc(db, 'warehouse_operations', operationId)
        const requestRef = doc(db, 'order_export_requests', requestDocId)
        const exportRef = doc(db, 'export_orders', orderId)
        const operationSnap = await tx.get(operationRef)
        const requestSnap = await tx.get(requestRef)
        const exportSnap = await tx.get(exportRef)
        if (!operationSnap.exists()) throw new Error('Không tìm thấy operation pending cho nghiệp vụ kho.')
        if (!requestSnap.exists()) throw new Error('Yêu cầu xuất kho không còn tồn tại.')
        const operationData = operationSnap.data() || {}
        assertOperationOwner(operationData, 'export_request_release', createdBy)
        if (String(operationData.status || '') === 'completed') {
          const previous = readOperationResult(operationData, 'export_request_release')
          resultId = previous.id || resultId
          resultCode = previous.code || resultCode
          resultRevision = previous.revision || resultRevision
          alreadyProcessed = true
          return
        }

        const currentRequest = { ...requestSnap.data(), id: requestSnap.id }
        const currentActiveExportId = activeExportOrderId(currentRequest)
        if (String(currentRequest.status || '') === 'da_xuat' && currentActiveExportId) {
          if (currentActiveExportId !== orderId || !exportSnap.exists()) {
            throw new Error('Yêu cầu đã liên kết với một phiếu xuất khác. Hãy tải lại dữ liệu.')
          }
          alreadyProcessed = true
          resultId = currentActiveExportId
          resultCode = String(currentRequest.warehouse_export_code || code)
          return
        }

        const currentRevision = assertExpectedRevision(currentRequest, expectedRevision, 'Yêu cầu xuất kho')
        const currentSequence = nextExportReleaseSequence(currentRequest)
        if (!canReleaseExportRequest(currentRequest)) {
          throw new Error('Yêu cầu vừa được tài khoản khác cập nhật nên không thể cho xuất.')
        }
        if (currentSequence !== releaseSequence || requestExportOrderId(requestDocId, currentSequence) !== orderId) {
          throw new Error('Vòng đời xuất kho đã thay đổi. Hãy tải lại trước khi cho xuất.')
        }
        if (exportSnap.exists()) throw new Error('ID phiếu xuất của vòng đời này đã tồn tại.')

        const sourceOrderId = String(currentRequest.order_id || '').trim()
        if (!sourceOrderId || preparedLines.some(line => (
          !line.sourceOrderItemId || line.sourceOrderId !== sourceOrderId
        ))) {
          throw new Error('Phiếu xuất thiếu tham chiếu chính xác tới dòng đơn hàng nguồn.')
        }
        const sourceOrderSnap = await tx.get(doc(db, 'orders', sourceOrderId))
        const sourceItemSnaps = new Map<string, any>()
        for (const sourceItemId of new Set(preparedLines.map(line => line.sourceOrderItemId))) {
          sourceItemSnaps.set(sourceItemId, await tx.get(doc(db, 'order_items', sourceItemId)))
        }
        const sourceValidationError = validateWarehouseReleaseSources({
          request: currentRequest,
          order: sourceOrderSnap.exists() ? { ...sourceOrderSnap.data(), id: sourceOrderSnap.id } : {},
          orderItems: Array.from(sourceItemSnaps.values())
            .filter(snapshot => snapshot.exists())
            .map(snapshot => ({ ...snapshot.data(), id: snapshot.id })),
          releaseLines: preparedLines.map(line => ({
            source_order_id: line.sourceOrderId,
            source_order_item_id: line.sourceOrderItemId,
            product: line.product,
            logo: line.logo,
            quantity: line.quantity,
          })),
        })
        if (sourceValidationError) throw new Error(sourceValidationError)

        const balanceSnaps = new Map<string, any>()
        for (const delta of balanceDeltas.values()) {
          balanceSnaps.set(delta.id, await tx.get(doc(db, 'inventory_balances', delta.id)))
        }
        for (const delta of balanceDeltas.values()) {
          const snap = balanceSnaps.get(delta.id)
          const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
          const next = current + delta.delta
          if (next < 0) {
            throw new Error(`Không đủ tồn: ${productCode(delta.product)} - ${productName(delta.product)} / ${warehouseName(delta.warehouse)}${delta.logo ? ` / ${delta.logo}` : ''}. Tồn hiện tại ${current}, cần ${Math.abs(delta.delta)}.`)
          }
        }

        tx.set(exportRef, orderPayload)
        preparedLines.forEach(line => {
          tx.set(doc(db, 'export_order_items', line.itemId), {
            id: line.itemId,
            export_order_id: orderId,
            source_order_id: line.sourceOrderId,
            source_order_item_id: line.sourceOrderItemId,
            product_id: line.product.id,
            product_code: productCode(line.product),
            product_name: productName(line.product),
            from_warehouse_id: line.fromWarehouse.id,
            from_warehouse_name: warehouseName(line.fromWarehouse),
            to_warehouse_id: '',
            to_warehouse_name: '',
            destination_name: orderPayload.destination_name,
            logo: normalizeLogo(line.logo),
            source_logo: normalizeLogo(line.logo),
            target_logo: normalizeLogo(line.logo),
            quantity: line.quantity,
            unit: line.unit || line.product.unit || '',
            note: line.note || '',
            legacy_line_key: '',
            status: 'completed',
            active: true,
            deleted: false,
            created_by: createdBy,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            operation_id: operationId,
            last_operation_id: operationId,
            revision: 1,
            source: 'kingcup_firestore'
          })
          tx.set(doc(db, 'stock_movements', line.outMovementId), movementPayload({
            id: line.outMovementId,
            type: 'export_customer',
            direction: 'out',
            quantity: -line.quantity,
            product: line.product,
            warehouse: line.fromWarehouse,
            logo: line.logo,
            unit: line.unit,
            movementDate: exportDate,
            sourceCollection: 'export_orders',
            sourceDocId: orderId,
            sourceItemId: line.itemId,
            sourceCode: code,
            reason: 'Xuất theo yêu cầu OrderKingcup',
            createdBy,
            operationId
          }))
        })
        for (const delta of balanceDeltas.values()) {
          const snap = balanceSnaps.get(delta.id)
          const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
          tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, current + delta.delta, operationId, createdBy), { merge: true })
        }

        let currentTimeline: any[] = []
        try {
          const parsed = JSON.parse(String(currentRequest.request_timeline_json || '[]'))
          currentTimeline = Array.isArray(parsed) ? parsed : []
        } catch {}
        const nextTimeline = appendExportLifecycleTimeline(currentTimeline, {
          action: 'warehouse_export',
          title: 'Kho cho xuất kho',
          actor: handledBy,
          actorName: appUser.value?.display_name || handledBy,
          time: new Date().toISOString(),
          status: 'da_xuat',
          note: input.note || '',
          exportOrderId: orderId,
          exportCode: code,
        })
        tx.update(requestRef, {
          ...buildReleasedRequestPatch({
            request: currentRequest,
            exportOrderId: orderId,
            exportCode: code,
            actor: handledBy,
            note: input.note || '',
            operationId,
            releaseSequence,
            actualSummaryJson: JSON.stringify(actualSummary),
            stockMovementIds,
            timelineJson: JSON.stringify(nextTimeline),
          }),
          warehouse_handled_at: serverTimestamp(),
          exported_at: serverTimestamp(),
          actual_exported_at: serverTimestamp(),
          revision: currentRevision + 1,
          updated_at: serverTimestamp(),
        })
        resultRevision = 1
        if (request.order_id && input.orderSummaryPatch) {
          tx.update(doc(db, 'orders', request.order_id), {
            ...input.orderSummaryPatch,
            updated_at: serverTimestamp()
          })
        }
        tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'create_from_request', code, orderPayload, operationId))
        tx.set(doc(collection(db, 'activity_logs')), activity('order_export_requests', 'warehouse_export', request.request_id || requestDocId, {
          request_id: request.request_id || requestDocId,
          export_order_id: orderId,
          export_code: code,
          release_sequence: releaseSequence,
        }, operationId))
        notificationRefs.forEach((notificationRef, index) => {
          tx.set(notificationRef, buildNotificationPayload({
            type: 'warehouse_export_request_released',
            title: 'Kho đã cho xuất hàng',
            message: `${request.request_id || requestDocId} · Đã tạo phiếu xuất ${code}.`,
            route: '/export-requests',
            entity_collection: 'order_export_requests',
            entity_id: requestDocId,
            entity_code: request.request_id || requestDocId,
            created_by: handledBy,
            to_email: saleRecipients[index],
            metadata: {
              order_id: request.order_id || '',
              order_code: request.order_code || '',
              export_order_id: orderId,
              export_code: code,
              release_sequence: releaseSequence,
            },
          }))
        })
      })
    } catch (error) {
      await failWarehouseOperation(db, operationId, 'export_request_release', createdBy, error).catch(() => undefined)
      throw error
    }

    await completeWarehouseOperation(db, {
      operationId,
      action: 'export_request_release',
      targetCollection: 'export_orders',
      targetId: resultId,
      resultCode,
      targetRevision: resultRevision,
      createdBy,
    })
    invalidateWarehouseCaches()
    return {
      id: resultId,
      code: resultCode,
      stockMovementIds,
      alreadyProcessed,
      notificationCount: alreadyProcessed ? 0 : saleRecipients.length,
      releaseSequence,
      revision: resultRevision,
    }
  }

  async function cancelExportRequestRelease(input: {
    request: any
    orderSummaryPatch?: Record<string, any>
    reason: string
    timeline?: any[]
    notification_recipients?: string[]
    operation_id?: string
    expected_request_revision?: number
    expected_export_revision?: number
  }) {
    const cancelledBy = email()
    if (!cancelledBy) throw new Error('Bạn chưa đăng nhập.')
    const request = input.request || {}
    const requestDocId = String(request.id || request.request_id || '').trim()
    if (!requestDocId) throw new Error('Thiếu ID yêu cầu xuất kho.')
    if (!canCancelExportRequestRelease(request)) throw new Error('Yêu cầu không có phiếu xuất đang hoạt động để hủy.')
    const exportOrderId = activeExportOrderId(request)
    const reason = String(input.reason || '').trim()
    if (!reason) throw new Error('Vui lòng nhập lý do hủy xuất kho.')
    const expectedRequestRevision = input.expected_request_revision ?? request.revision ?? 0
    const expectedExportRevision = input.expected_export_revision ?? 1
    const operationId = operationIdOf(input.operation_id, `export_request_cancel:${requestDocId}:${expectedRequestRevision}`)

    let summary: any[] = []
    try {
      const parsed = JSON.parse(String(request.actual_export_summary_json || '[]'))
      summary = Array.isArray(parsed) ? parsed : []
    } catch {}
    if (!summary.length) {
      throw new Error('Yêu cầu thiếu tóm tắt xuất thực tế nên chưa thể hoàn tồn an toàn. Cần đối soát dữ liệu trước khi hủy.')
    }

    const preparedLines = summary.map((line, index) => {
      const product = ensureProduct({
        id: line.product_id,
        product_code: line.product_code,
        product_name: line.product_name,
        unit: line.unit,
      })
      const fromWarehouse = ensureWarehouse({
        id: line.warehouse_id,
        name: line.warehouse_name,
      }, `kho xuất dòng ${index + 1}`)
      return {
        product,
        fromWarehouse,
        logo: normalizeLogo(line.logo),
        unit: line.unit || product.unit || '',
        quantity: ensurePositiveQuantity(line.quantity),
        itemId: safeDocId(`${exportOrderId}__${index + 1}`, 'export_item'),
        reverseMovementId: safeDocId(`export_request_cancel:${exportOrderId}:${index + 1}:${operationId}`, 'movement'),
      }
    })

    const balanceDeltas = new Map<string, BalanceDelta>()
    for (const line of preparedLines) {
      const balanceId = await inventoryBalanceId(line.product.id, line.fromWarehouse.id, line.logo)
      applyDelta(balanceDeltas, {
        id: balanceId,
        delta: line.quantity,
        product: line.product,
        warehouse: line.fromWarehouse,
        logo: line.logo,
        unit: line.unit,
        movementDate: request.export_date || todayKey(),
      })
    }

    const saleRecipients = Array.isArray(input.notification_recipients)
      ? Array.from(new Set(input.notification_recipients.map(normalizeEmail).filter(Boolean)))
        .filter(recipient => recipient !== cancelledBy)
      : resolveSaleNotificationRecipients({ request, actorEmail: cancelledBy })
    const notificationRefs = saleRecipients.map(() => doc(collection(db, 'notifications')))
    let exportCode = String(request.warehouse_export_code || exportOrderId)
    let resultRevision = expectedExportRevision
    let alreadyProcessed = false

    await claimWarehouseOperation(db, {
      operationId,
      action: 'export_request_cancel',
      targetCollection: 'export_orders',
      targetId: exportOrderId,
      resultCode: exportCode,
      createdBy: cancelledBy,
    })

    try {
      await runTransaction(db, async tx => {
        const operationRef = doc(db, 'warehouse_operations', operationId)
        const requestRef = doc(db, 'order_export_requests', requestDocId)
        const exportRef = doc(db, 'export_orders', exportOrderId)
        const operationSnap = await tx.get(operationRef)
        const requestSnap = await tx.get(requestRef)
        const exportSnap = await tx.get(exportRef)
        if (!operationSnap.exists()) throw new Error('Không tìm thấy operation pending cho nghiệp vụ hủy xuất.')
        if (!requestSnap.exists()) throw new Error('Yêu cầu xuất kho không còn tồn tại.')
        if (!exportSnap.exists()) throw new Error('Không tìm thấy phiếu xuất liên kết để hoàn tồn.')
        const operationData = operationSnap.data() || {}
        assertOperationOwner(operationData, 'export_request_cancel', cancelledBy)
        if (String(operationData.status || '') === 'completed') {
          const previous = readOperationResult(operationData, 'export_request_cancel')
          exportCode = previous.code || exportCode
          resultRevision = previous.revision || resultRevision
          alreadyProcessed = true
          return
        }

        const currentRequest = { ...requestSnap.data(), id: requestSnap.id }
        const currentExport = { ...exportSnap.data(), id: exportSnap.id }
        if (currentExport.deleted === true || currentExport.active === false || String(currentExport.status || '') === 'cancelled') {
          if (String(currentRequest.status || '') === 'da_tiep_nhan' && !activeExportOrderId(currentRequest)) {
            alreadyProcessed = true
            resultRevision = revisionOf(currentExport)
            return
          }
          throw new Error('Phiếu xuất đã hủy nhưng yêu cầu chưa được mở lại đúng trạng thái.')
        }
        assertExpectedRevision(currentRequest, expectedRequestRevision, 'Yêu cầu xuất kho')
        const currentExportRevision = assertExpectedRevision(currentExport, expectedExportRevision, 'Phiếu xuất kho')
        const linkError = exportLifecycleLinkError(currentRequest, currentExport)
        if (linkError) throw new Error(linkError)
        if (!canCancelExportRequestRelease(currentRequest)) throw new Error('Yêu cầu vừa thay đổi nên không thể hủy xuất.')
        if (String(currentExport.destination_type || 'customer') !== 'customer') {
          throw new Error('Luồng yêu cầu Sale hiện chỉ hỗ trợ hoàn phiếu xuất tới khách.')
        }
        exportCode = String(currentExport.code || currentExport.export_code || exportCode)
        resultRevision = currentExportRevision + 1

        const itemSnaps = new Map<string, any>()
        for (const line of preparedLines) {
          itemSnaps.set(line.itemId, await tx.get(doc(db, 'export_order_items', line.itemId)))
        }
        const balanceSnaps = new Map<string, any>()
        for (const delta of balanceDeltas.values()) {
          balanceSnaps.set(delta.id, await tx.get(doc(db, 'inventory_balances', delta.id)))
        }
        for (const line of preparedLines) {
          const itemSnap = itemSnaps.get(line.itemId)
          if (!itemSnap?.exists()) throw new Error(`Thiếu chi tiết phiếu xuất ${line.itemId}, không thể hoàn tồn.`)
          const item = itemSnap.data() || {}
          if (String(item.export_order_id || '') !== exportOrderId || item.deleted === true || item.active === false) {
            throw new Error(`Chi tiết phiếu xuất ${line.itemId} không còn hợp lệ để hoàn tồn.`)
          }
        }

        tx.update(exportRef, {
          lifecycle_status: 'cancelled',
          deleted: true,
          active: false,
          status: 'cancelled',
          deleted_at: serverTimestamp(),
          deleted_by: cancelledBy,
          deleted_reason: reason,
          cancelled_at: serverTimestamp(),
          cancelled_by: cancelledBy,
          cancel_reason: reason,
          updated_by: cancelledBy,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: resultRevision,
          updated_at: serverTimestamp(),
        })
        preparedLines.forEach(line => {
          const itemSnap = itemSnaps.get(line.itemId)
          const itemRevision = revisionOf(itemSnap.data() || {})
          tx.update(doc(db, 'export_order_items', line.itemId), {
            deleted: true,
            active: false,
            status: 'cancelled',
            deleted_at: serverTimestamp(),
            deleted_by: cancelledBy,
            deleted_reason: reason,
            updated_by: cancelledBy,
            operation_id: operationId,
            last_operation_id: operationId,
            revision: itemRevision + 1,
            updated_at: serverTimestamp(),
          })
          tx.set(doc(db, 'stock_movements', line.reverseMovementId), movementPayload({
            id: line.reverseMovementId,
            type: 'export_request_cancel_reverse',
            direction: 'in',
            quantity: line.quantity,
            product: line.product,
            warehouse: line.fromWarehouse,
            logo: line.logo,
            unit: line.unit,
            movementDate: request.export_date || todayKey(),
            sourceCollection: 'export_orders',
            sourceDocId: exportOrderId,
            sourceItemId: line.itemId,
            sourceCode: exportCode,
            reason,
            createdBy: cancelledBy,
            operationId,
          }))
        })
        for (const delta of balanceDeltas.values()) {
          const snap = balanceSnaps.get(delta.id)
          const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
          tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, current + delta.delta, operationId, cancelledBy), { merge: true })
        }

        let currentTimeline: any[] = []
        try {
          const parsed = JSON.parse(String(currentRequest.request_timeline_json || '[]'))
          currentTimeline = Array.isArray(parsed) ? parsed : []
        } catch {}
        const nextTimeline = appendExportLifecycleTimeline(currentTimeline, {
          action: 'warehouse_export_cancel',
          title: 'Kho hủy xuất và hoàn tồn',
          actor: cancelledBy,
          actorName: appUser.value?.display_name || cancelledBy,
          time: new Date().toISOString(),
          status: 'da_tiep_nhan',
          note: reason,
          exportOrderId,
          exportCode,
        })
        tx.update(requestRef, {
          ...buildCancelledReleaseRequestPatch({
            request: currentRequest,
            exportOrder: currentExport,
            actor: cancelledBy,
            reason,
            operationId,
            timelineJson: JSON.stringify(nextTimeline),
          }),
          warehouse_handled_at: serverTimestamp(),
          last_cancelled_at: serverTimestamp(),
          revision: revisionOf(currentRequest) + 1,
          updated_at: serverTimestamp(),
        })
        if (request.order_id && input.orderSummaryPatch) {
          tx.update(doc(db, 'orders', request.order_id), {
            ...input.orderSummaryPatch,
            updated_at: serverTimestamp(),
          })
        }
        tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'cancel_from_request', exportCode, {
          request_id: request.request_id || requestDocId,
          export_order_id: exportOrderId,
          reason,
        }, operationId))
        tx.set(doc(collection(db, 'activity_logs')), activity('order_export_requests', 'warehouse_export_cancel', request.request_id || requestDocId, {
          export_order_id: exportOrderId,
          export_code: exportCode,
          reason,
        }, operationId))
        notificationRefs.forEach((notificationRef, index) => {
          tx.set(notificationRef, buildNotificationPayload({
            type: 'warehouse_export_request_cancelled',
            title: 'Kho đã hủy xuất và hoàn tồn',
            message: `${request.request_id || requestDocId} · Phiếu ${exportCode} đã được hủy. Lý do: ${reason}`,
            route: '/export-requests',
            entity_collection: 'order_export_requests',
            entity_id: requestDocId,
            entity_code: request.request_id || requestDocId,
            created_by: cancelledBy,
            to_email: saleRecipients[index],
            metadata: {
              order_id: request.order_id || '',
              order_code: request.order_code || '',
              export_order_id: exportOrderId,
              export_code: exportCode,
              reason,
            },
          }))
        })
      })
    } catch (error) {
      await failWarehouseOperation(db, operationId, 'export_request_cancel', cancelledBy, error).catch(() => undefined)
      throw error
    }

    await completeWarehouseOperation(db, {
      operationId,
      action: 'export_request_cancel',
      targetCollection: 'export_orders',
      targetId: exportOrderId,
      resultCode: exportCode,
      targetRevision: resultRevision,
      createdBy: cancelledBy,
    })
    invalidateWarehouseCaches()
    return {
      id: exportOrderId,
      code: exportCode,
      revision: resultRevision,
      operationId,
      alreadyProcessed,
      notificationCount: alreadyProcessed ? 0 : saleRecipients.length,
    }
  }

  async function getInventoryBalanceId(productId: string, warehouseId: string, logo?: string) {
    return inventoryBalanceId(productId, warehouseId, logo)
  }

  async function readInventoryBalance(productId: string, warehouseId: string, logo?: string) {
    const id = await inventoryBalanceId(productId, warehouseId, logo)
    const snap = await getDoc(doc(db, 'inventory_balances', id))
    return snap.exists() ? { id: snap.id, ...snap.data() } : null
  }

  return {
    createImportOrder,
    updateImportOrder,
    deleteImportOrder,
    createExportOrder,
    updateExportOrder,
    deleteExportOrder,
    createInventoryAdjustment,
    processExportRequestToExportOrder,
    cancelExportRequestRelease,
    getInventoryBalanceId,
    readInventoryBalance
  }
}
