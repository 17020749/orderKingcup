import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import type { ProductDoc, SupplierDoc, WarehouseDoc } from '~/types/models'
import { makeCode, makeId, normalizeEmail, toNumber, todayKey } from '~/utils/format'
import { invalidateScopedCache } from '~/composables/useScopedQueries'
import { useWarehouseTransactions as useLegacyWarehouseTransactions } from '~/composables/useWarehouseTransactions'
import {
  buildNotificationPayload,
  resolveSaleNotificationRecipients,
} from '~/composables/useNotifications'
import {
  allocateInventoryLots,
  normalizeLots,
  parseLotAllocations,
  reconcileOpeningLot,
  restoreInventoryLots,
  roundQuantity,
  type InventoryLotState,
  type LotAllocation,
  type WarehouseIssueStrategy,
} from '~/utils/warehouseLotAllocation'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { validateWarehouseReleaseSources } from '~/utils/orderItemDependencies.mjs'
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

type PricedWarehouseLineInput = {
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
  unit_cost?: number
  expiry_date?: string
  note?: string
}

type BalanceState = {
  id: string
  ref: any
  exists: boolean
  data: any
  quantity: number
  lots: InventoryLotState[]
  product: any
  warehouse: any
  logo: string
  unit: string
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

function positiveQuantity(value: any, label = 'Số lượng') {
  const quantity = roundQuantity(value)
  if (quantity <= 0) throw new Error(`${label} phải lớn hơn 0.`)
  return quantity
}

function nonNegativeCost(value: any) {
  const cost = Math.round(toNumber(value) * 100) / 100
  if (cost < 0) throw new Error('Giá nhập không được âm.')
  return cost
}

function revisionOf(data: any) {
  const value = Number(data?.revision || 0)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function operationIdOf(value: any, fallback: string) {
  return safeDocId(String(value || fallback || makeId('warehouse_operation')).trim(), 'warehouse_operation')
}

function parseStrategy(value: any): WarehouseIssueStrategy {
  if (value === 'fefo' || value === 'smallest_lot_first') return value
  return 'fifo'
}

function settingDefaults() {
  return {
    strategy: 'fifo' as WarehouseIssueStrategy,
    fallback_strategy: 'fifo' as WarehouseIssueStrategy,
    max_lots_per_line: 50,
    revision: 1,
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
  lotAllocations?: LotAllocation[]
}) {
  return {
    id: input.id,
    movement_date: input.movementDate,
    movement_type: input.type,
    direction: input.direction,
    quantity: roundQuantity(input.quantity),
    absolute_quantity: Math.abs(roundQuantity(input.quantity)),
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
    lot_allocations_json: JSON.stringify(input.lotAllocations || []),
    created_by: input.createdBy,
    operation_id: input.operationId,
    created_at: serverTimestamp(),
    active: true,
    deleted: false,
    source: 'nuxt',
  }
}

function balancePayload(state: BalanceState, operationId: string, updatedBy: string) {
  return {
    id: state.id,
    warehouse_id: state.warehouse.id,
    warehouse_legacy_id: state.warehouse.legacy_id || state.warehouse.id,
    warehouse_name: warehouseName(state.warehouse),
    product_id: state.product.id,
    product_legacy_id: state.product.legacy_id || state.product.warehouse_legacy_id || state.product.id,
    product_code: productCode(state.product),
    product_name: productName(state.product),
    logo: normalizeLogo(state.logo),
    quantity: roundQuantity(state.quantity),
    tracked_lot_quantity: roundQuantity(state.lots.reduce((sum, lot) => sum + roundQuantity(lot.available_quantity), 0)),
    lots: state.lots,
    unit: state.unit || state.product.unit || '',
    updated_at: serverTimestamp(),
    last_movement_at: state.movementDate,
    active: true,
    deleted: false,
    source: 'nuxt',
    last_operation_id: operationId,
    updated_by: updatedBy,
  }
}

function activityPayload(module: string, action: string, code: string, data: any, actor: string) {
  return {
    module,
    action,
    item_code: code,
    item_name: code,
    changed_by: actor,
    after_json: JSON.stringify(data),
    created_at: serverTimestamp(),
    active: true,
    deleted: false,
  }
}

function invalidateWarehouseCaches() {
  ;[
    'import_orders', 'import_order_items',
    'export_orders', 'export_order_items',
    'inventory_adjustments', 'inventory_balances', 'stock_movements',
    'order_export_requests', 'orders', 'activity_logs', 'warehouse_operations', 'app_meta',
  ].forEach(name => invalidateScopedCache(name))
}

function isRequestGeneratedExport(order: any) {
  return Boolean(
    String(order?.source_request_id || '').trim()
    || String(order?.source || '').trim() === 'kingcup_firestore'
    || String(order?.sync_source || '').trim().startsWith('kingcup_firestore:'),
  )
}

export function useWarehouseCostTransactions() {
  const { db } = useFirebaseServices()
  const { appUser } = useAuth()
  const legacy = useLegacyWarehouseTransactions()

  function actorEmail() {
    return normalizeEmail(appUser.value?.email)
  }

  async function loadIssueSetting() {
    const snapshot = await getDoc(doc(db, 'app_meta', 'warehouse_issue'))
    if (!snapshot.exists()) return settingDefaults()
    const data = snapshot.data() || {}
    return {
      strategy: parseStrategy(data.strategy),
      fallback_strategy: parseStrategy(data.fallback_strategy),
      max_lots_per_line: Math.max(1, Math.min(100, Math.floor(toNumber(data.max_lots_per_line) || 50))),
      revision: revisionOf(data) || 1,
    }
  }

  async function claimOperation(input: {
    operationId: string
    action: string
    targetCollection: string
    targetId: string
    resultCode?: string
    actor: string
  }) {
    let replay: any = null
    await runTransaction(db, async tx => {
      const ref = doc(db, 'warehouse_operations', input.operationId)
      const snap = await tx.get(ref)
      if (snap.exists()) {
        const data = snap.data() || {}
        if (String(data.action || '') !== input.action || String(data.created_by || '').toLowerCase() !== input.actor.toLowerCase()) {
          throw new Error('operation_id đã được dùng cho nghiệp vụ khác.')
        }
        if (String(data.status || '') === 'completed') {
          replay = {
            id: String(data.target_id || input.targetId),
            code: String(data.result_code || input.resultCode || ''),
            revision: revisionOf({ revision: data.target_revision }),
          }
          return
        }
        if (String(data.status || '') === 'processing') throw new Error('Nghiệp vụ này đang được xử lý ở phiên khác.')
        tx.update(ref, {
          status: 'processing',
          processing_at: serverTimestamp(),
          failed_at: null,
          failure_message: '',
          result_code: input.resultCode || data.result_code || '',
          target_revision: data.target_revision || 0,
        })
        return
      }
      tx.set(ref, {
        id: input.operationId,
        operation_id: input.operationId,
        action: input.action,
        target_collection: input.targetCollection,
        target_id: input.targetId,
        result_code: input.resultCode || '',
        target_revision: 0,
        created_by: input.actor,
        status: 'processing',
        processing_at: serverTimestamp(),
        created_at: serverTimestamp(),
        active: true,
        deleted: false,
        source: 'nuxt',
      })
    })
    return replay
  }

  async function failOperation(operationId: string, actor: string, error: any) {
    await runTransaction(db, async tx => {
      const ref = doc(db, 'warehouse_operations', operationId)
      const snap = await tx.get(ref)
      if (!snap.exists()) return
      const data = snap.data() || {}
      if (String(data.created_by || '').toLowerCase() !== actor.toLowerCase()) return
      if (String(data.status || '') !== 'processing') return
      tx.update(ref, {
        status: 'failed',
        failed_at: serverTimestamp(),
        failure_message: String(error?.message || error || 'Nghiệp vụ kho thất bại').slice(0, 500),
      })
    })
  }

  function completeOperationTx(tx: any, operationId: string, resultCode: string, revision: number) {
    tx.update(doc(db, 'warehouse_operations', operationId), {
      status: 'completed',
      completed_at: serverTimestamp(),
      result_code: resultCode || '',
      target_revision: revision,
      failure_message: '',
    })
  }

  async function buildBalanceRefs(lines: Array<{ product: any; warehouse: any; logo?: string }>) {
    const map = new Map<string, { id: string; ref: any; product: any; warehouse: any; logo: string }>()
    for (const line of lines) {
      const id = await inventoryBalanceId(line.product.id, line.warehouse.id, line.logo)
      if (!map.has(id)) map.set(id, {
        id,
        ref: doc(db, 'inventory_balances', id),
        product: line.product,
        warehouse: line.warehouse,
        logo: normalizeLogo(line.logo),
      })
    }
    return map
  }

  async function readBalanceStates(tx: any, refs: Map<string, any>, movementDate: string) {
    const states = new Map<string, BalanceState>()
    for (const entry of refs.values()) {
      const snap = await tx.get(entry.ref)
      const data = snap.exists() ? snap.data() || {} : {}
      states.set(entry.id, {
        ...entry,
        exists: snap.exists(),
        data,
        quantity: roundQuantity(data.quantity),
        lots: normalizeLots(data.lots),
        unit: data.unit || entry.product.unit || '',
        movementDate,
      })
    }
    return states
  }

  function reconcileState(state: BalanceState) {
    state.lots = reconcileOpeningLot({
      balanceId: state.id,
      balanceQuantity: state.quantity,
      lots: state.lots,
      productId: state.product.id,
      warehouseId: state.warehouse.id,
      logo: state.logo,
      unit: state.unit,
    })
  }

  function addLot(state: BalanceState, lot: InventoryLotState) {
    const existing = state.lots.find(row => row.id === lot.id)
    if (existing) throw new Error(`Lô ${lot.id} đã tồn tại. Hãy tải lại trang.`)
    state.lots.push(lot)
    state.quantity = roundQuantity(state.quantity + lot.available_quantity)
  }

  function removeImportLot(state: BalanceState, item: any) {
    reconcileState(state)
    const lotId = String(item?.lot_id || '').trim()
    if (lotId) {
      const index = state.lots.findIndex(lot => lot.id === lotId)
      if (index < 0) throw new Error(`Không tìm thấy lô của dòng nhập ${item.product_code || item.id}.`)
      const lot = state.lots[index]
      const oldQuantity = positiveQuantity(item.quantity, 'Số lượng nhập cũ')
      if (roundQuantity(lot.available_quantity) + 0.0001 < oldQuantity) {
        throw new Error(`Lô ${item.product_code || item.id} đã được xuất một phần nên không thể sửa/xóa phiếu nhập.`)
      }
      state.lots.splice(index, 1)
      state.quantity = roundQuantity(state.quantity - oldQuantity)
      if (state.quantity < -0.0001) throw new Error('Đảo phiếu nhập làm tồn âm.')
      return
    }

    const allocation = allocateInventoryLots({
      lots: state.lots,
      quantity: positiveQuantity(item.quantity, 'Số lượng nhập cũ'),
      strategy: 'fifo',
      maxLots: 100,
    })
    if (allocation.allocations.some(row => row.source !== 'legacy_opening')) {
      throw new Error('Phiếu nhập cũ chưa có mã lô và tồn đã phát sinh lô mới. Không thể sửa/xóa tự động.')
    }
    state.lots = allocation.lots
    state.quantity = roundQuantity(state.quantity - positiveQuantity(item.quantity))
  }

  function allocateFromState(state: BalanceState, quantity: number, setting: any) {
    reconcileState(state)
    const beforeQuantity = roundQuantity(state.quantity)
    const allocated = allocateInventoryLots({
      lots: state.lots,
      quantity,
      strategy: setting.strategy,
      maxLots: setting.max_lots_per_line,
    })
    state.lots = allocated.lots
    state.quantity = roundQuantity(state.quantity - quantity)
    if (state.quantity < -0.0001) {
      const logoText = normalizeLogo(state.logo)
      throw new Error(
        `Không đủ tồn: ${productCode(state.product)} - ${productName(state.product)} / ${warehouseName(state.warehouse)}${logoText ? ` / logo ${logoText}` : ' / hàng trơn'}. Tồn hiện tại ${beforeQuantity}, cần ${roundQuantity(quantity)}.`,
      )
    }
    return allocated.allocations
  }

  function restoreSourceAllocation(state: BalanceState, allocations: LotAllocation[], quantity: number) {
    state.lots = restoreInventoryLots(state.lots, allocations)
    state.quantity = roundQuantity(state.quantity + quantity)
  }

  function transferLotFromAllocation(input: {
    allocation: LotAllocation
    orderId: string
    itemId: string
    product: any
    warehouse: any
    logo?: string
    unit?: string
    exportDate: string
  }): InventoryLotState {
    const destinationLotId = safeDocId(`transfer__${input.orderId}__${input.itemId}__${input.allocation.lot_id}`, 'transfer_lot')
    input.allocation.destination_lot_id = destinationLotId
    return {
      id: destinationLotId,
      import_order_id: input.allocation.import_order_id || '',
      import_order_item_id: input.allocation.import_order_item_id || '',
      import_code: input.allocation.import_code || '',
      import_date: input.allocation.import_date || input.exportDate,
      expiry_date: input.allocation.expiry_date || '',
      product_id: input.product.id,
      warehouse_id: input.warehouse.id,
      logo: normalizeLogo(input.logo),
      unit: input.unit || input.product.unit || '',
      received_quantity: input.allocation.quantity,
      available_quantity: input.allocation.quantity,
      cost_item_id: input.allocation.cost_item_id || input.allocation.import_order_item_id || '',
      source_lot_id: input.allocation.lot_id,
      transfer_export_order_id: input.orderId,
      transfer_export_item_id: input.itemId,
      source: 'warehouse_transfer',
      status: 'available',
    }
  }

  function removeDestinationTransferLots(state: BalanceState, allocations: LotAllocation[], quantity: number) {
    allocations.forEach(allocation => {
      const destinationLotId = String(allocation.destination_lot_id || '').trim()
      if (!destinationLotId) throw new Error('Phiếu chuyển kho cũ thiếu mã lô đích, không thể sửa/hủy an toàn.')
      const index = state.lots.findIndex(lot => lot.id === destinationLotId)
      if (index < 0) throw new Error(`Lô chuyển ${destinationLotId} đã được sử dụng hoặc không còn tồn tại.`)
      const lot = state.lots[index]
      if (roundQuantity(lot.available_quantity) + 0.0001 < roundQuantity(allocation.quantity)) {
        throw new Error('Kho nhận đã sử dụng hàng chuyển đến nên không thể sửa/hủy phiếu.')
      }
      lot.available_quantity = roundQuantity(lot.available_quantity - allocation.quantity)
      if (lot.available_quantity <= 0.0001) state.lots.splice(index, 1)
    })
    state.quantity = roundQuantity(state.quantity - quantity)
    if (state.quantity < -0.0001) throw new Error('Kho nhận không còn đủ tồn để đảo phiếu chuyển.')
  }

  async function createImportOrder(input: {
    id?: string
    code?: string
    import_date?: string
    supplier?: SupplierDoc | any | null
    note?: string
    operation_id?: string
    lines: PricedWarehouseLineInput[]
  }) {
    const actor = actorEmail()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')
    const importDate = input.import_date || todayKey()
    const orderId = input.id || makeId('imp')
    const code = input.code || makeCode('PNK')
    const operationId = operationIdOf(input.operation_id, `import_create:${orderId}`)
    const supplier = input.supplier || {}
    const rawLines = input.lines.filter(line => roundQuantity(line.quantity) > 0)
    if (!rawLines.length) throw new Error('Phiếu nhập phải có ít nhất một dòng hàng.')

    const prepared = rawLines.map((line, index) => {
      const product = ensureProduct(line.product)
      const warehouse = ensureWarehouse(line.warehouse, 'kho nhập')
      const quantity = positiveQuantity(line.quantity)
      const unitCost = nonNegativeCost(line.unit_cost)
      const itemId = safeDocId(`${orderId}__${index + 1}`, 'import_item')
      const lotId = safeDocId(`lot__${itemId}`, 'lot')
      return {
        ...line,
        product,
        warehouse,
        quantity,
        unitCost,
        itemId,
        lotId,
        movementId: safeDocId(`import:${orderId}:${index + 1}`, 'movement'),
      }
    })

    const replay = await claimOperation({
      operationId,
      action: 'import_create',
      targetCollection: 'import_orders',
      targetId: orderId,
      resultCode: code,
      actor,
    })
    if (replay) return { ...replay, operationId, alreadyProcessed: true }

    const balanceRefs = await buildBalanceRefs(prepared.map(line => ({
      product: line.product,
      warehouse: line.warehouse,
      logo: line.logo,
    })))

    try {
      await runTransaction(db, async tx => {
        const operationRef = doc(db, 'warehouse_operations', operationId)
        const operationSnap = await tx.get(operationRef)
        if (!operationSnap.exists() || operationSnap.data()?.status !== 'processing') throw new Error('Operation nhập kho không hợp lệ.')
        const states = await readBalanceStates(tx, balanceRefs, importDate)

        prepared.forEach(line => {
          const balanceId = Array.from(balanceRefs.values()).find(entry => entry.product.id === line.product.id && entry.warehouse.id === line.warehouse.id && entry.logo === normalizeLogo(line.logo))!.id
          const state = states.get(balanceId)!
          reconcileState(state)
          addLot(state, {
            id: line.lotId,
            import_order_id: orderId,
            import_order_item_id: line.itemId,
            import_code: code,
            import_date: importDate,
            expiry_date: line.expiry_date || '',
            product_id: line.product.id,
            warehouse_id: line.warehouse.id,
            logo: normalizeLogo(line.logo),
            unit: line.unit || line.product.unit || '',
            supplier_id: supplier.id || '',
            supplier_name: supplier.name || supplier.supplier_name || '',
            received_quantity: line.quantity,
            available_quantity: line.quantity,
            cost_item_id: line.itemId,
            source: 'import_order',
            status: 'available',
          })
        })

        tx.set(doc(db, 'import_orders', orderId), {
          id: orderId,
          code,
          import_code: code,
          import_date: importDate,
          supplier_id: supplier.id || '',
          supplier_name: supplier.name || supplier.supplier_name || '',
          total_quantity: roundQuantity(prepared.reduce((sum, line) => sum + line.quantity, 0)),
          total_cost: Math.round(prepared.reduce((sum, line) => sum + line.quantity * line.unitCost, 0) * 100) / 100,
          note: input.note || '',
          status: 'completed',
          active: true,
          deleted: false,
          created_by: actor,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
          operation_id: operationId,
          last_operation_id: operationId,
          revision: 1,
          source: 'nuxt',
        })

        prepared.forEach(line => {
          tx.set(doc(db, 'import_order_items', line.itemId), {
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
            unit_cost: line.unitCost,
            line_cost: Math.round(line.quantity * line.unitCost * 100) / 100,
            expiry_date: line.expiry_date || '',
            lot_id: line.lotId,
            note: line.note || '',
            legacy_line_key: '',
            status: 'completed',
            active: true,
            deleted: false,
            created_by: actor,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            operation_id: operationId,
            last_operation_id: operationId,
            revision: 1,
            source: 'nuxt',
          })
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
            reason: 'Nhập kho theo lô',
            createdBy: actor,
            operationId,
            lotAllocations: [{
              lot_id: line.lotId,
              quantity: line.quantity,
              import_order_id: orderId,
              import_order_item_id: line.itemId,
              import_code: code,
              import_date: importDate,
              cost_item_id: line.itemId,
              source: 'import_order',
            }],
          }))
        })

        states.forEach(state => tx.set(state.ref, balancePayload(state, operationId, actor), { merge: true }))
        tx.set(doc(collection(db, 'activity_logs')), activityPayload('import_orders', 'create', code, { id: orderId, line_count: prepared.length }, actor))
        completeOperationTx(tx, operationId, code, 1)
      })
    } catch (error) {
      await failOperation(operationId, actor, error).catch(() => undefined)
      throw error
    }

    invalidateWarehouseCaches()
    return { id: orderId, code, revision: 1, operationId, alreadyProcessed: false }
  }

  async function updateImportOrder(input: {
    order: any
    existingItems: any[]
    import_date?: string
    supplier?: SupplierDoc | any | null
    note?: string
    operation_id?: string
    expected_revision?: number
    lines: PricedWarehouseLineInput[]
  }) {
    const actor = actorEmail()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')
    const orderId = normalizeId(input.order?.id)
    if (!orderId) throw new Error('Thiếu ID phiếu nhập cần sửa.')
    const code = input.order?.code || input.order?.import_code || orderId
    const importDate = input.import_date || input.order?.import_date || todayKey()
    const supplier = input.supplier || {}
    const operationId = operationIdOf(input.operation_id, `import_update:${orderId}:${revisionOf(input.order)}`)
    const expectedRevision = input.expected_revision ?? input.order?.revision ?? 0
    const oldItems = (input.existingItems || []).filter(item => item && item.deleted !== true && item.active !== false)
    const rawLines = input.lines.filter(line => roundQuantity(line.quantity) > 0)
    if (!rawLines.length) throw new Error('Phiếu nhập phải có ít nhất một dòng hàng.')

    const prepared = rawLines.map((line, index) => {
      const product = ensureProduct(line.product)
      const warehouse = ensureWarehouse(line.warehouse, 'kho nhập')
      const existing = oldItems[index]
      const itemId = existing?.id || safeDocId(`${orderId}__${index + 1}`, 'import_item')
      return {
        ...line,
        product,
        warehouse,
        quantity: positiveQuantity(line.quantity),
        unitCost: nonNegativeCost(line.unit_cost),
        itemId,
        lotId: String(existing?.lot_id || safeDocId(`lot__${itemId}`, 'lot')),
        existing,
      }
    })

    const replay = await claimOperation({ operationId, action: 'import_update', targetCollection: 'import_orders', targetId: orderId, resultCode: code, actor })
    if (replay) return { ...replay, operationId, alreadyProcessed: true }

    const allBalanceLines = [
      ...oldItems.map(item => ({
        product: ensureProduct({ id: item.product_id, product_code: item.product_code, product_name: item.product_name, unit: item.unit }),
        warehouse: ensureWarehouse({ id: item.warehouse_id, name: item.warehouse_name }),
        logo: item.logo,
      })),
      ...prepared.map(line => ({ product: line.product, warehouse: line.warehouse, logo: line.logo })),
    ]
    const balanceRefs = await buildBalanceRefs(allBalanceLines)

    try {
      let nextRevision = revisionOf(input.order) + 1
      await runTransaction(db, async tx => {
        const operationRef = doc(db, 'warehouse_operations', operationId)
        const orderRef = doc(db, 'import_orders', orderId)
        const operationSnap = await tx.get(operationRef)
        const orderSnap = await tx.get(orderRef)
        const states = await readBalanceStates(tx, balanceRefs, importDate)
        if (!operationSnap.exists() || operationSnap.data()?.status !== 'processing') throw new Error('Operation sửa phiếu nhập không hợp lệ.')
        if (!orderSnap.exists()) throw new Error('Phiếu nhập không còn tồn tại.')
        const current = orderSnap.data() || {}
        if (revisionOf(current) !== revisionOf({ revision: expectedRevision })) throw new Error('Phiếu nhập đã được cập nhật ở phiên khác. Hãy tải lại trang.')
        if (current.deleted === true || current.active === false) throw new Error('Phiếu nhập đã bị xóa.')
        nextRevision = revisionOf(current) + 1

        oldItems.forEach(item => {
          const key = Array.from(balanceRefs.values()).find(entry => entry.product.id === item.product_id && entry.warehouse.id === item.warehouse_id && entry.logo === normalizeLogo(item.logo))!.id
          removeImportLot(states.get(key)!, item)
        })

        prepared.forEach(line => {
          const key = Array.from(balanceRefs.values()).find(entry => entry.product.id === line.product.id && entry.warehouse.id === line.warehouse.id && entry.logo === normalizeLogo(line.logo))!.id
          addLot(states.get(key)!, {
            id: line.lotId,
            import_order_id: orderId,
            import_order_item_id: line.itemId,
            import_code: code,
            import_date: importDate,
            expiry_date: line.expiry_date || '',
            product_id: line.product.id,
            warehouse_id: line.warehouse.id,
            logo: normalizeLogo(line.logo),
            unit: line.unit || line.product.unit || '',
            supplier_id: supplier.id || '',
            supplier_name: supplier.name || supplier.supplier_name || '',
            received_quantity: line.quantity,
            available_quantity: line.quantity,
            cost_item_id: line.itemId,
            source: 'import_order',
            status: 'available',
          })
        })

        tx.update(orderRef, {
          import_date: importDate,
          supplier_id: supplier.id || '',
          supplier_name: supplier.name || supplier.supplier_name || '',
          total_quantity: roundQuantity(prepared.reduce((sum, line) => sum + line.quantity, 0)),
          total_cost: Math.round(prepared.reduce((sum, line) => sum + line.quantity * line.unitCost, 0) * 100) / 100,
          note: input.note || '',
          updated_by: actor,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: nextRevision,
          updated_at: serverTimestamp(),
        })

        oldItems.forEach(item => {
          tx.set(doc(db, 'stock_movements', safeDocId(`import_update_reverse:${orderId}:${item.id}:${makeId('mv')}`, 'movement')), movementPayload({
            id: safeDocId(`import_update_reverse:${orderId}:${item.id}:${makeId('mv')}`, 'movement'),
            type: 'import_update_reverse',
            direction: 'out',
            quantity: -positiveQuantity(item.quantity),
            product: ensureProduct({ id: item.product_id, product_code: item.product_code, product_name: item.product_name, unit: item.unit }),
            warehouse: ensureWarehouse({ id: item.warehouse_id, name: item.warehouse_name }),
            logo: item.logo,
            unit: item.unit,
            movementDate: importDate,
            sourceCollection: 'import_orders',
            sourceDocId: orderId,
            sourceItemId: item.id,
            sourceCode: code,
            reason: 'Đảo lô trước khi sửa phiếu nhập',
            createdBy: actor,
            operationId,
          }))
        })

        prepared.forEach((line, index) => {
          const payload = {
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
            unit_cost: line.unitCost,
            line_cost: Math.round(line.quantity * line.unitCost * 100) / 100,
            expiry_date: line.expiry_date || '',
            lot_id: line.lotId,
            note: line.note || '',
            status: 'completed',
            active: true,
            deleted: false,
            updated_by: actor,
            operation_id: operationId,
            last_operation_id: operationId,
            revision: revisionOf(line.existing) + 1,
            updated_at: serverTimestamp(),
          }
          if (line.existing?.id) tx.update(doc(db, 'import_order_items', line.itemId), payload)
          else tx.set(doc(db, 'import_order_items', line.itemId), { ...payload, created_by: actor, created_at: serverTimestamp(), source: 'nuxt', legacy_line_key: '' })
          const movementId = safeDocId(`import_update_apply:${orderId}:${index + 1}:${makeId('mv')}`, 'movement')
          tx.set(doc(db, 'stock_movements', movementId), movementPayload({
            id: movementId,
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
            reason: 'Áp lô sau khi sửa phiếu nhập',
            createdBy: actor,
            operationId,
            lotAllocations: [{ lot_id: line.lotId, quantity: line.quantity, import_order_id: orderId, import_order_item_id: line.itemId, import_code: code, import_date: importDate, cost_item_id: line.itemId, source: 'import_order' }],
          }))
        })

        oldItems.slice(prepared.length).forEach(item => tx.update(doc(db, 'import_order_items', item.id), {
          deleted: true,
          active: false,
          status: 'deleted',
          deleted_at: serverTimestamp(),
          deleted_by: actor,
          updated_by: actor,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: revisionOf(item) + 1,
          updated_at: serverTimestamp(),
        }))

        states.forEach(state => tx.set(state.ref, balancePayload(state, operationId, actor), { merge: true }))
        tx.set(doc(collection(db, 'activity_logs')), activityPayload('import_orders', 'update', code, { id: orderId, line_count: prepared.length }, actor))
        completeOperationTx(tx, operationId, code, nextRevision)
      })
      invalidateWarehouseCaches()
      return { id: orderId, code, revision: nextRevision, operationId, alreadyProcessed: false }
    } catch (error) {
      await failOperation(operationId, actor, error).catch(() => undefined)
      throw error
    }
  }

  async function deleteImportOrder(input: { order: any; existingItems: any[]; reason?: string; operation_id?: string; expected_revision?: number }) {
    const actor = actorEmail()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')
    const orderId = normalizeId(input.order?.id)
    if (!orderId) throw new Error('Thiếu ID phiếu nhập cần xóa.')
    const code = input.order?.code || input.order?.import_code || orderId
    const importDate = input.order?.import_date || todayKey()
    const operationId = operationIdOf(input.operation_id, `import_delete:${orderId}:${revisionOf(input.order)}`)
    const oldItems = (input.existingItems || []).filter(item => item && item.deleted !== true && item.active !== false)
    const lines = oldItems.map(item => ({
      product: ensureProduct({ id: item.product_id, product_code: item.product_code, product_name: item.product_name, unit: item.unit }),
      warehouse: ensureWarehouse({ id: item.warehouse_id, name: item.warehouse_name }),
      logo: item.logo,
    }))
    const balanceRefs = await buildBalanceRefs(lines)
    const replay = await claimOperation({ operationId, action: 'import_delete', targetCollection: 'import_orders', targetId: orderId, resultCode: code, actor })
    if (replay) return { ...replay, operationId, alreadyProcessed: true }

    try {
      let nextRevision = revisionOf(input.order) + 1
      await runTransaction(db, async tx => {
        const operationSnap = await tx.get(doc(db, 'warehouse_operations', operationId))
        const orderRef = doc(db, 'import_orders', orderId)
        const orderSnap = await tx.get(orderRef)
        const states = await readBalanceStates(tx, balanceRefs, importDate)
        if (!operationSnap.exists() || operationSnap.data()?.status !== 'processing') throw new Error('Operation xóa phiếu nhập không hợp lệ.')
        if (!orderSnap.exists()) throw new Error('Phiếu nhập không còn tồn tại.')
        const current = orderSnap.data() || {}
        if (revisionOf(current) !== revisionOf({ revision: input.expected_revision ?? input.order?.revision ?? 0 })) throw new Error('Phiếu nhập đã được cập nhật ở phiên khác.')
        if (current.deleted === true || current.active === false) throw new Error('Phiếu nhập đã được xóa trước đó.')
        nextRevision = revisionOf(current) + 1

        oldItems.forEach(item => {
          const key = Array.from(balanceRefs.values()).find(entry => entry.product.id === item.product_id && entry.warehouse.id === item.warehouse_id && entry.logo === normalizeLogo(item.logo))!.id
          removeImportLot(states.get(key)!, item)
        })

        tx.update(orderRef, {
          deleted: true,
          active: false,
          status: 'deleted',
          deleted_at: serverTimestamp(),
          deleted_by: actor,
          deleted_reason: input.reason || 'Xóa phiếu nhập kho',
          updated_by: actor,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: nextRevision,
          updated_at: serverTimestamp(),
        })
        oldItems.forEach(item => {
          tx.update(doc(db, 'import_order_items', item.id), {
            deleted: true,
            active: false,
            status: 'deleted',
            deleted_at: serverTimestamp(),
            deleted_by: actor,
            updated_by: actor,
            operation_id: operationId,
            last_operation_id: operationId,
            revision: revisionOf(item) + 1,
            updated_at: serverTimestamp(),
          })
          const movementId = safeDocId(`import_delete_reverse:${orderId}:${item.id}:${makeId('mv')}`, 'movement')
          tx.set(doc(db, 'stock_movements', movementId), movementPayload({
            id: movementId,
            type: 'import_delete_reverse',
            direction: 'out',
            quantity: -positiveQuantity(item.quantity),
            product: ensureProduct({ id: item.product_id, product_code: item.product_code, product_name: item.product_name, unit: item.unit }),
            warehouse: ensureWarehouse({ id: item.warehouse_id, name: item.warehouse_name }),
            logo: item.logo,
            unit: item.unit,
            movementDate: importDate,
            sourceCollection: 'import_orders',
            sourceDocId: orderId,
            sourceItemId: item.id,
            sourceCode: code,
            reason: input.reason || 'Đảo lô do xóa phiếu nhập',
            createdBy: actor,
            operationId,
          }))
        })
        states.forEach(state => tx.set(state.ref, balancePayload(state, operationId, actor), { merge: true }))
        tx.set(doc(collection(db, 'activity_logs')), activityPayload('import_orders', 'delete', code, { id: orderId, reason: input.reason || '' }, actor))
        completeOperationTx(tx, operationId, code, nextRevision)
      })
      invalidateWarehouseCaches()
      return { id: orderId, code, revision: nextRevision, operationId, alreadyProcessed: false }
    } catch (error) {
      await failOperation(operationId, actor, error).catch(() => undefined)
      throw error
    }
  }

  async function prepareExportLines(input: any, orderId: string, destinationType: string) {
    const defaultToWarehouse = destinationType === 'warehouse' && input.toWarehouse
      ? ensureWarehouse(input.toWarehouse, 'kho nhận')
      : null
    return (input.lines || []).filter((line: any) => roundQuantity(line.quantity) > 0).map((line: any, index: number) => {
      const product = ensureProduct(line.product)
      const fromWarehouse = ensureWarehouse(
        line.from_warehouse_id || line.warehouse_id || line.fromWarehouse || line.warehouse || line,
        `kho xuất dòng ${index + 1}`,
      )
      const toWarehouse = destinationType === 'warehouse'
        ? ensureWarehouse(line.to_warehouse_id || line.toWarehouse || defaultToWarehouse, `kho nhận dòng ${index + 1}`)
        : null
      if (toWarehouse && toWarehouse.id === fromWarehouse.id) throw new Error('Kho nhận phải khác kho xuất.')
      return {
        ...line,
        product,
        fromWarehouse,
        toWarehouse,
        sourceLogo: toWarehouse ? lineSourceLogo(line) : lineTargetLogo(line),
        targetLogo: lineTargetLogo(line),
        quantity: positiveQuantity(line.quantity),
        itemId: String(line.itemId || safeDocId(`${orderId}__${index + 1}`, 'export_item')),
        outMovementId: safeDocId(`export_out:${orderId}:${index + 1}:${makeId('mv')}`, 'movement'),
        inMovementId: safeDocId(`transfer_in:${orderId}:${index + 1}:${makeId('mv')}`, 'movement'),
      }
    })
  }

  async function createExportOrder(input: any) {
    const actor = actorEmail()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')
    const destinationType = input.destination_type || 'customer'
    const exportDate = input.export_date || todayKey()
    const orderId = input.id || makeId('exp')
    const code = input.code || makeCode('PXK')
    const operationId = operationIdOf(input.operation_id, `export_create:${orderId}`)
    const setting = await loadIssueSetting()
    const lines = await prepareExportLines(input, orderId, destinationType)
    if (!lines.length) throw new Error('Phiếu xuất phải có ít nhất một dòng hàng.')
    const replay = await claimOperation({ operationId, action: 'export_create', targetCollection: 'export_orders', targetId: orderId, resultCode: code, actor })
    if (replay) return { ...replay, operationId, alreadyProcessed: true, stockMovementIds: [] }

    const balanceLines = lines.flatMap((line: any) => [
      { product: line.product, warehouse: line.fromWarehouse, logo: line.sourceLogo },
      ...(line.toWarehouse ? [{ product: line.product, warehouse: line.toWarehouse, logo: line.targetLogo }] : []),
    ])
    const balanceRefs = await buildBalanceRefs(balanceLines)

    try {
      const stockMovementIds: string[] = []
      await runTransaction(db, async tx => {
        const operationSnap = await tx.get(doc(db, 'warehouse_operations', operationId))
        const states = await readBalanceStates(tx, balanceRefs, exportDate)
        if (!operationSnap.exists() || operationSnap.data()?.status !== 'processing') throw new Error('Operation xuất kho không hợp lệ.')

        const firstToWarehouse = lines.find((line: any) => line.toWarehouse)?.toWarehouse || null
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
          destination_name: destinationType === 'warehouse' ? warehouseName(firstToWarehouse) : (input.destination_name || input.customer_name || ''),
          to_warehouse_id: firstToWarehouse?.id || '',
          to_warehouse_name: firstToWarehouse ? warehouseName(firstToWarehouse) : '',
          allocation_strategy: setting.strategy,
          allocation_settings_revision: setting.revision,
          note: input.note || '',
          status: 'completed',
          active: true,
          deleted: false,
          created_by: actor,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
          operation_id: operationId,
          last_operation_id: operationId,
          revision: 1,
          source: input.source_request_id ? 'kingcup_firestore' : 'nuxt',
        }
        tx.set(doc(db, 'export_orders', orderId), orderPayload)

        lines.forEach((line: any) => {
          const sourceKey = Array.from(balanceRefs.values()).find(entry => entry.product.id === line.product.id && entry.warehouse.id === line.fromWarehouse.id && entry.logo === normalizeLogo(line.sourceLogo))!.id
          const sourceState = states.get(sourceKey)!
          const allocations = allocateFromState(sourceState, line.quantity, setting)

          if (line.toWarehouse) {
            const destinationKey = Array.from(balanceRefs.values()).find(entry => entry.product.id === line.product.id && entry.warehouse.id === line.toWarehouse.id && entry.logo === normalizeLogo(line.targetLogo))!.id
            const destinationState = states.get(destinationKey)!
            reconcileState(destinationState)
            allocations.forEach(allocation => addLot(destinationState, transferLotFromAllocation({
              allocation,
              orderId,
              itemId: line.itemId,
              product: line.product,
              warehouse: line.toWarehouse,
              logo: line.targetLogo,
              unit: line.unit,
              exportDate,
            })))
          }

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
            logo: normalizeLogo(line.targetLogo),
            source_logo: normalizeLogo(line.sourceLogo),
            target_logo: normalizeLogo(line.targetLogo),
            quantity: line.quantity,
            unit: line.unit || line.product.unit || '',
            lot_allocations_json: JSON.stringify(allocations),
            allocation_strategy: setting.strategy,
            note: line.note || '',
            legacy_line_key: '',
            status: 'completed',
            active: true,
            deleted: false,
            created_by: actor,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            operation_id: operationId,
            last_operation_id: operationId,
            revision: 1,
            source: orderPayload.source,
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
            reason: line.toWarehouse ? 'Xuất chuyển kho theo cấu hình lô' : 'Xuất tới khách theo cấu hình lô',
            createdBy: actor,
            operationId,
            lotAllocations: allocations,
          }))
          stockMovementIds.push(line.outMovementId)
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
              reason: 'Nhập từ chuyển kho, giữ tham chiếu lô nguồn',
              createdBy: actor,
              operationId,
              lotAllocations: allocations,
            }))
            stockMovementIds.push(line.inMovementId)
          }
        })

        states.forEach(state => tx.set(state.ref, balancePayload(state, operationId, actor), { merge: true }))
        tx.set(doc(collection(db, 'activity_logs')), activityPayload('export_orders', 'create', code, { id: orderId, strategy: setting.strategy, line_count: lines.length }, actor))
        completeOperationTx(tx, operationId, code, 1)
      })
      invalidateWarehouseCaches()
      return { id: orderId, code, revision: 1, stockMovementIds, operationId, alreadyProcessed: false }
    } catch (error) {
      await failOperation(operationId, actor, error).catch(() => undefined)
      throw error
    }
  }

  async function restoreExistingExportToStates(input: {
    states: Map<string, BalanceState>
    refs: Map<string, any>
    items: any[]
  }) {
    input.items.forEach(item => {
      const product = ensureProduct({ id: item.product_id, product_code: item.product_code, product_name: item.product_name, unit: item.unit })
      const fromWarehouse = ensureWarehouse({ id: item.from_warehouse_id, name: item.from_warehouse_name })
      const sourceLogo = exportItemSourceLogo(item)
      const targetLogo = exportItemTargetLogo(item)
      const sourceKey = Array.from(input.refs.values()).find(entry => entry.product.id === product.id && entry.warehouse.id === fromWarehouse.id && entry.logo === sourceLogo)!.id
      const allocations = parseLotAllocations(item.lot_allocations_json)
      if (!allocations.length && item.to_warehouse_id) throw new Error('Phiếu chuyển kho cũ chưa có lịch sử lô, không thể sửa/hủy an toàn.')
      const safeAllocations = allocations.length ? allocations : [{
        lot_id: `opening_restore__${item.id}`,
        quantity: positiveQuantity(item.quantity),
        import_code: 'OPENING',
        import_date: '1970-01-01',
        source: 'legacy_opening',
      }]
      restoreSourceAllocation(input.states.get(sourceKey)!, safeAllocations, positiveQuantity(item.quantity))
      if (item.to_warehouse_id) {
        const toWarehouse = ensureWarehouse({ id: item.to_warehouse_id, name: item.to_warehouse_name })
        const destinationKey = Array.from(input.refs.values()).find(entry => entry.product.id === product.id && entry.warehouse.id === toWarehouse.id && entry.logo === targetLogo)!.id
        removeDestinationTransferLots(input.states.get(destinationKey)!, safeAllocations, positiveQuantity(item.quantity))
      }
    })
  }

  async function updateExportOrder(input: any) {
    const actor = actorEmail()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')
    const order = input.order || {}
    const orderId = normalizeId(order.id)
    if (!orderId) throw new Error('Thiếu ID phiếu xuất cần sửa.')
    if (isRequestGeneratedExport(order)) throw new Error('Phiếu xuất sinh từ yêu cầu Sale không được sửa trực tiếp.')
    const code = order.code || order.export_code || orderId
    const exportDate = input.export_date || order.export_date || todayKey()
    const destinationType = input.destination_type || order.destination_type || 'customer'
    const operationId = operationIdOf(input.operation_id, `export_update:${orderId}:${revisionOf(order)}`)
    const expectedRevision = input.expected_revision ?? order.revision ?? 0
    const oldItems = (input.existingItems || []).filter((item: any) => item && item.deleted !== true && item.active !== false)
    const setting = await loadIssueSetting()
    const lines = await prepareExportLines(input, orderId, destinationType)
    lines.forEach((line: any, index: number) => { line.itemId = oldItems[index]?.id || line.itemId })
    if (!lines.length) throw new Error('Phiếu xuất phải có ít nhất một dòng hàng.')
    const replay = await claimOperation({ operationId, action: 'export_update', targetCollection: 'export_orders', targetId: orderId, resultCode: code, actor })
    if (replay) return { ...replay, operationId, alreadyProcessed: true }

    const oldBalanceLines = oldItems.flatMap((item: any) => {
      const product = ensureProduct({ id: item.product_id, product_code: item.product_code, product_name: item.product_name, unit: item.unit })
      const rows: any[] = [{ product, warehouse: ensureWarehouse({ id: item.from_warehouse_id, name: item.from_warehouse_name }), logo: exportItemSourceLogo(item) }]
      if (item.to_warehouse_id) rows.push({ product, warehouse: ensureWarehouse({ id: item.to_warehouse_id, name: item.to_warehouse_name }), logo: exportItemTargetLogo(item) })
      return rows
    })
    const newBalanceLines = lines.flatMap((line: any) => [
      { product: line.product, warehouse: line.fromWarehouse, logo: line.sourceLogo },
      ...(line.toWarehouse ? [{ product: line.product, warehouse: line.toWarehouse, logo: line.targetLogo }] : []),
    ])
    const refs = await buildBalanceRefs([...oldBalanceLines, ...newBalanceLines])

    try {
      let nextRevision = revisionOf(order) + 1
      await runTransaction(db, async tx => {
        const operationSnap = await tx.get(doc(db, 'warehouse_operations', operationId))
        const orderRef = doc(db, 'export_orders', orderId)
        const orderSnap = await tx.get(orderRef)
        if (!operationSnap.exists() || operationSnap.data()?.status !== 'processing') throw new Error('Operation sửa phiếu xuất không hợp lệ.')
        if (!orderSnap.exists()) throw new Error('Phiếu xuất không còn tồn tại.')
        const current = orderSnap.data() || {}
        if (revisionOf(current) !== revisionOf({ revision: expectedRevision })) throw new Error('Phiếu xuất đã được cập nhật ở phiên khác.')
        if (current.deleted === true || current.active === false) throw new Error('Phiếu xuất đã bị hủy.')
        nextRevision = revisionOf(current) + 1

        await restoreExistingExportToStates({ states, refs, items: oldItems })
        const firstToWarehouse = lines.find((line: any) => line.toWarehouse)?.toWarehouse || null
        tx.update(orderRef, {
          export_date: exportDate,
          destination_type: destinationType,
          source_order_code: input.source_order_code || '',
          customer_name: input.customer_name || '',
          destination_name: destinationType === 'warehouse' ? warehouseName(firstToWarehouse) : (input.destination_name || input.customer_name || ''),
          to_warehouse_id: firstToWarehouse?.id || '',
          to_warehouse_name: firstToWarehouse ? warehouseName(firstToWarehouse) : '',
          allocation_strategy: setting.strategy,
          allocation_settings_revision: setting.revision,
          note: input.note || '',
          updated_by: actor,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: nextRevision,
          updated_at: serverTimestamp(),
        })

        oldItems.forEach((item: any) => {
          const product = ensureProduct({ id: item.product_id, product_code: item.product_code, product_name: item.product_name, unit: item.unit })
          const fromWarehouse = ensureWarehouse({ id: item.from_warehouse_id, name: item.from_warehouse_name })
          const reverseId = safeDocId(`export_update_reverse:${orderId}:${item.id}:${makeId('mv')}`, 'movement')
          tx.set(doc(db, 'stock_movements', reverseId), movementPayload({
            id: reverseId,
            type: 'export_update_reverse',
            direction: 'in',
            quantity: positiveQuantity(item.quantity),
            product,
            warehouse: fromWarehouse,
            logo: exportItemSourceLogo(item),
            unit: item.unit,
            movementDate: exportDate,
            sourceCollection: 'export_orders',
            sourceDocId: orderId,
            sourceItemId: item.id,
            sourceCode: code,
            reason: 'Hoàn lô trước khi sửa phiếu xuất',
            createdBy: actor,
            operationId,
            lotAllocations: parseLotAllocations(item.lot_allocations_json),
          }))
        })

        lines.forEach((line: any, index: number) => {
          const sourceKey = Array.from(refs.values()).find(entry => entry.product.id === line.product.id && entry.warehouse.id === line.fromWarehouse.id && entry.logo === normalizeLogo(line.sourceLogo))!.id
          const allocations = allocateFromState(states.get(sourceKey)!, line.quantity, setting)
          if (line.toWarehouse) {
            const destinationKey = Array.from(refs.values()).find(entry => entry.product.id === line.product.id && entry.warehouse.id === line.toWarehouse.id && entry.logo === normalizeLogo(line.targetLogo))!.id
            const destinationState = states.get(destinationKey)!
            reconcileState(destinationState)
            allocations.forEach(allocation => addLot(destinationState, transferLotFromAllocation({ allocation, orderId, itemId: line.itemId, product: line.product, warehouse: line.toWarehouse, logo: line.targetLogo, unit: line.unit, exportDate })))
          }
          const payload = {
            product_id: line.product.id,
            product_code: productCode(line.product),
            product_name: productName(line.product),
            from_warehouse_id: line.fromWarehouse.id,
            from_warehouse_name: warehouseName(line.fromWarehouse),
            to_warehouse_id: line.toWarehouse?.id || '',
            to_warehouse_name: line.toWarehouse ? warehouseName(line.toWarehouse) : '',
            destination_name: destinationType === 'warehouse' ? warehouseName(firstToWarehouse) : (input.destination_name || input.customer_name || ''),
            logo: normalizeLogo(line.targetLogo),
            source_logo: normalizeLogo(line.sourceLogo),
            target_logo: normalizeLogo(line.targetLogo),
            quantity: line.quantity,
            unit: line.unit || line.product.unit || '',
            lot_allocations_json: JSON.stringify(allocations),
            allocation_strategy: setting.strategy,
            note: line.note || '',
            status: 'completed',
            active: true,
            deleted: false,
            updated_by: actor,
            operation_id: operationId,
            last_operation_id: operationId,
            revision: revisionOf(oldItems[index]) + 1,
            updated_at: serverTimestamp(),
          }
          if (oldItems[index]?.id) tx.update(doc(db, 'export_order_items', line.itemId), payload)
          else tx.set(doc(db, 'export_order_items', line.itemId), { id: line.itemId, export_order_id: orderId, ...payload, created_by: actor, created_at: serverTimestamp(), source: 'nuxt', legacy_line_key: '' })
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
            reason: 'Áp lại xuất theo cấu hình lô',
            createdBy: actor,
            operationId,
            lotAllocations: allocations,
          }))
          if (line.toWarehouse) tx.set(doc(db, 'stock_movements', line.inMovementId), movementPayload({
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
            reason: 'Áp lại nhập chuyển kho theo lô',
            createdBy: actor,
            operationId,
            lotAllocations: allocations,
          }))
        })

        oldItems.slice(lines.length).forEach((item: any) => tx.update(doc(db, 'export_order_items', item.id), {
          deleted: true,
          active: false,
          status: 'deleted',
          deleted_at: serverTimestamp(),
          deleted_by: actor,
          updated_by: actor,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: revisionOf(item) + 1,
          updated_at: serverTimestamp(),
        }))
        states.forEach(state => tx.set(state.ref, balancePayload(state, operationId, actor), { merge: true }))
        tx.set(doc(collection(db, 'activity_logs')), activityPayload('export_orders', 'update', code, { id: orderId, strategy: setting.strategy, line_count: lines.length }, actor))
        completeOperationTx(tx, operationId, code, nextRevision)
      })
      invalidateWarehouseCaches()
      return { id: orderId, code, revision: nextRevision, operationId, alreadyProcessed: false }
    } catch (error) {
      await failOperation(operationId, actor, error).catch(() => undefined)
      throw error
    }
  }

  async function deleteExportOrder(input: any) {
    const actor = actorEmail()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')
    const order = input.order || {}
    const orderId = normalizeId(order.id)
    if (!orderId) throw new Error('Thiếu ID phiếu xuất cần hủy.')
    if (isRequestGeneratedExport(order)) throw new Error('Phiếu xuất sinh từ yêu cầu Sale phải hủy trong luồng yêu cầu xuất riêng.')
    const code = order.code || order.export_code || orderId
    const exportDate = order.export_date || todayKey()
    const operationId = operationIdOf(input.operation_id, `export_cancel:${orderId}:${revisionOf(order)}`)
    const oldItems = (input.existingItems || []).filter((item: any) => item && item.deleted !== true && item.active !== false)
    const balanceLines = oldItems.flatMap((item: any) => {
      const product = ensureProduct({ id: item.product_id, product_code: item.product_code, product_name: item.product_name, unit: item.unit })
      const rows: any[] = [{ product, warehouse: ensureWarehouse({ id: item.from_warehouse_id, name: item.from_warehouse_name }), logo: exportItemSourceLogo(item) }]
      if (item.to_warehouse_id) rows.push({ product, warehouse: ensureWarehouse({ id: item.to_warehouse_id, name: item.to_warehouse_name }), logo: exportItemTargetLogo(item) })
      return rows
    })
    const refs = await buildBalanceRefs(balanceLines)
    const replay = await claimOperation({ operationId, action: 'export_cancel', targetCollection: 'export_orders', targetId: orderId, resultCode: code, actor })
    if (replay) return { ...replay, operationId, alreadyProcessed: true }

    try {
      let nextRevision = revisionOf(order) + 1
      await runTransaction(db, async tx => {
        const operationSnap = await tx.get(doc(db, 'warehouse_operations', operationId))
        const orderRef = doc(db, 'export_orders', orderId)
        const orderSnap = await tx.get(orderRef)
        const states = await readBalanceStates(tx, refs, exportDate)
        if (!operationSnap.exists() || operationSnap.data()?.status !== 'processing') throw new Error('Operation hủy phiếu xuất không hợp lệ.')
        if (!orderSnap.exists()) throw new Error('Phiếu xuất không còn tồn tại.')
        const current = orderSnap.data() || {}
        if (revisionOf(current) !== revisionOf({ revision: input.expected_revision ?? order.revision ?? 0 })) throw new Error('Phiếu xuất đã được cập nhật ở phiên khác.')
        if (current.deleted === true || current.active === false) throw new Error('Phiếu xuất đã được hủy trước đó.')
        nextRevision = revisionOf(current) + 1
        await restoreExistingExportToStates({ states, refs, items: oldItems })

        const reason = input.reason || 'Hủy phiếu xuất kho'
        tx.update(orderRef, {
          deleted: true,
          active: false,
          status: 'cancelled',
          deleted_at: serverTimestamp(),
          deleted_by: actor,
          deleted_reason: reason,
          cancelled_at: serverTimestamp(),
          cancelled_by: actor,
          cancel_reason: reason,
          updated_by: actor,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: nextRevision,
          updated_at: serverTimestamp(),
        })
        oldItems.forEach((item: any) => {
          tx.update(doc(db, 'export_order_items', item.id), {
            deleted: true,
            active: false,
            status: 'cancelled',
            deleted_at: serverTimestamp(),
            deleted_by: actor,
            deleted_reason: reason,
            updated_by: actor,
            operation_id: operationId,
            last_operation_id: operationId,
            revision: revisionOf(item) + 1,
            updated_at: serverTimestamp(),
          })
          const product = ensureProduct({ id: item.product_id, product_code: item.product_code, product_name: item.product_name, unit: item.unit })
          const fromWarehouse = ensureWarehouse({ id: item.from_warehouse_id, name: item.from_warehouse_name })
          const allocations = parseLotAllocations(item.lot_allocations_json)
          const reverseId = safeDocId(`export_cancel_reverse:${orderId}:${item.id}:${makeId('mv')}`, 'movement')
          tx.set(doc(db, 'stock_movements', reverseId), movementPayload({
            id: reverseId,
            type: 'export_cancel_reverse_source',
            direction: 'in',
            quantity: positiveQuantity(item.quantity),
            product,
            warehouse: fromWarehouse,
            logo: exportItemSourceLogo(item),
            unit: item.unit,
            movementDate: exportDate,
            sourceCollection: 'export_orders',
            sourceDocId: orderId,
            sourceItemId: item.id,
            sourceCode: code,
            reason,
            createdBy: actor,
            operationId,
            lotAllocations: allocations,
          }))
          if (item.to_warehouse_id) {
            const destinationReverseId = safeDocId(`export_cancel_reverse_destination:${orderId}:${item.id}:${makeId('mv')}`, 'movement')
            tx.set(doc(db, 'stock_movements', destinationReverseId), movementPayload({
              id: destinationReverseId,
              type: 'export_cancel_reverse_destination',
              direction: 'out',
              quantity: -positiveQuantity(item.quantity),
              product,
              warehouse: ensureWarehouse({ id: item.to_warehouse_id, name: item.to_warehouse_name }),
              logo: exportItemTargetLogo(item),
              unit: item.unit,
              movementDate: exportDate,
              sourceCollection: 'export_orders',
              sourceDocId: orderId,
              sourceItemId: item.id,
              sourceCode: code,
              reason,
              createdBy: actor,
              operationId,
              lotAllocations: allocations,
            }))
          }
        })
        states.forEach(state => tx.set(state.ref, balancePayload(state, operationId, actor), { merge: true }))
        tx.set(doc(collection(db, 'activity_logs')), activityPayload('export_orders', 'cancel', code, { id: orderId, reason }, actor))
        completeOperationTx(tx, operationId, code, nextRevision)
      })
      invalidateWarehouseCaches()
      return { id: orderId, code, revision: nextRevision, operationId, alreadyProcessed: false }
    } catch (error) {
      await failOperation(operationId, actor, error).catch(() => undefined)
      throw error
    }
  }

  async function processExportRequestToExportOrder(input: any) {
    const actor = actorEmail()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')
    const request = input.request || {}
    const requestDocId = String(request.id || request.request_id || '').trim()
    if (!requestDocId) throw new Error('Thiếu ID yêu cầu xuất kho.')
    if (!canReleaseExportRequest(request)) {
      throw new Error('Yêu cầu không còn ở trạng thái được phép cho xuất hoặc đang có phiếu xuất hoạt động.')
    }
    const fallbackWarehouse = input.warehouse ? ensureWarehouse(input.warehouse, 'kho xuất mặc định') : null
    const exportDate = input.export_date || request.export_date || todayKey()
    const expectedRevision = input.expected_revision ?? request.revision ?? 0
    const releaseSequence = nextExportReleaseSequence(request)
    const orderId = requestExportOrderId(requestDocId, releaseSequence)
    const code = safeDocId(`PXK-${request.request_id || requestDocId}${releaseSequence > 1 ? `-${releaseSequence}` : ''}`, 'PXK')
    const operationId = operationIdOf(input.operation_id, `export_request_release:${requestDocId}:${releaseSequence}`)
    const setting = await loadIssueSetting()
    const lines = await prepareExportLines({
      lines: (input.lines || []).map((line: any) => ({
        ...line,
        fromWarehouse: line.fromWarehouse || line.warehouse || line.from_warehouse_id || line.warehouse_id || fallbackWarehouse,
      })),
      destination_type: 'customer',
    }, orderId, 'customer')
    if (!lines.length) throw new Error('Yêu cầu xuất kho chưa có dòng hàng hợp lệ.')
    const replay = await claimOperation({ operationId, action: 'export_request_release', targetCollection: 'export_orders', targetId: orderId, resultCode: code, actor })
    if (replay) return { ...replay, operationId, alreadyProcessed: true, stockMovementIds: [], notificationCount: 0 }
    const refs = await buildBalanceRefs(lines.map((line: any) => ({ product: line.product, warehouse: line.fromWarehouse, logo: line.sourceLogo })))
    const saleRecipients = Array.isArray(input.notification_recipients)
      ? Array.from(new Set(input.notification_recipients.map(normalizeEmail).filter(Boolean))).filter(recipient => recipient !== actor)
      : resolveSaleNotificationRecipients({ request, actorEmail: actor })
    const notificationRefs = saleRecipients.map(() => doc(collection(db, 'notifications')))
    const timeline = Array.isArray(input.timeline) ? input.timeline : []
    const nextTimeline = appendExportLifecycleTimeline(timeline, {
      action: 'warehouse_export',
      title: 'Kho cho xuất kho',
      actor,
      actorName: appUser.value?.display_name || actor,
      time: new Date().toISOString(),
      status: 'da_xuat',
      note: input.note || '',
      exportOrderId: orderId,
      exportCode: code,
    })

    try {
      const stockMovementIds: string[] = []
      let alreadyProcessed = false
      await runTransaction(db, async tx => {
        const operationSnap = await tx.get(doc(db, 'warehouse_operations', operationId))
        const requestRef = doc(db, 'order_export_requests', requestDocId)
        const requestSnap = await tx.get(requestRef)
        const exportRef = doc(db, 'export_orders', orderId)
        const exportSnap = await tx.get(exportRef)
        if (!operationSnap.exists() || operationSnap.data()?.status !== 'processing') throw new Error('Operation cho xuất kho không hợp lệ.')
        if (!requestSnap.exists()) throw new Error('Yêu cầu xuất kho không còn tồn tại.')
        const currentRequest = { ...requestSnap.data(), id: requestSnap.id }
        const currentActiveExportId = activeExportOrderId(currentRequest)
        if (String(currentRequest.status || '') === 'da_xuat' && currentActiveExportId) {
          if (currentActiveExportId !== orderId || !exportSnap.exists()) {
            throw new Error('Yêu cầu đã liên kết với một phiếu xuất khác. Hãy tải lại dữ liệu.')
          }
          alreadyProcessed = true
          completeOperationTx(tx, operationId, code, 1)
          return
        }
        const currentRevision = revisionOf(currentRequest)
        if (currentRevision !== revisionOf({ revision: expectedRevision })) {
          throw new Error('Yêu cầu xuất kho đã được cập nhật ở phiên khác.')
        }
        const currentSequence = nextExportReleaseSequence(currentRequest)
        if (!canReleaseExportRequest(currentRequest)) {
          throw new Error('Yêu cầu vừa được tài khoản khác cập nhật nên không thể cho xuất.')
        }
        if (currentSequence !== releaseSequence || requestExportOrderId(requestDocId, currentSequence) !== orderId) {
          throw new Error('Vòng đời xuất kho đã thay đổi. Hãy tải lại trước khi cho xuất.')
        }
        if (exportSnap.exists()) throw new Error('ID phiếu xuất của vòng đời này đã tồn tại.')

        const sourceOrderId = String(currentRequest.order_id || '').trim()
        if (!sourceOrderId || lines.some((line: any) => (
          !String(line.source_order_item_id || '').trim()
          || String(line.source_order_id || '').trim() !== sourceOrderId
        ))) throw new Error('Phiếu xuất thiếu tham chiếu chính xác tới dòng đơn hàng nguồn.')
        const sourceOrderSnap = await tx.get(doc(db, 'orders', sourceOrderId))
        const sourceItemSnaps = new Map<string, any>()
        for (const sourceItemId of new Set(lines.map((line: any) => String(line.source_order_item_id || '').trim()))) {
          sourceItemSnaps.set(sourceItemId, await tx.get(doc(db, 'order_items', sourceItemId)))
        }
        const sourceValidationError = validateWarehouseReleaseSources({
          request: currentRequest,
          order: sourceOrderSnap.exists() ? { ...sourceOrderSnap.data(), id: sourceOrderSnap.id } : {},
          orderItems: Array.from(sourceItemSnaps.values())
            .filter(snapshot => snapshot.exists())
            .map(snapshot => ({ ...snapshot.data(), id: snapshot.id })),
          releaseLines: lines.map((line: any) => ({
            source_order_id: line.source_order_id,
            source_order_item_id: line.source_order_item_id,
            product: line.product,
            logo: line.targetLogo,
            quantity: line.quantity,
          })),
        })
        if (sourceValidationError) throw new Error(sourceValidationError)
        const states = await readBalanceStates(tx, refs, exportDate)

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
          allocation_strategy: setting.strategy,
          allocation_settings_revision: setting.revision,
          note: input.note || '',
          status: 'completed',
          active: true,
          deleted: false,
          created_by: actor,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
          operation_id: operationId,
          last_operation_id: operationId,
          revision: 1,
          source: 'kingcup_firestore',
          ...buildGeneratedExportLifecycleFields({
            requestId: requestDocId,
            requestRevision: currentRevision,
            operationId,
            releaseSequence,
          }),
        }
        tx.set(exportRef, orderPayload)
        const exportedSummary: any[] = []

        lines.forEach((line: any) => {
          const key = Array.from(refs.values()).find(entry => entry.product.id === line.product.id && entry.warehouse.id === line.fromWarehouse.id && entry.logo === normalizeLogo(line.sourceLogo))!.id
          const allocations = allocateFromState(states.get(key)!, line.quantity, setting)
          tx.set(doc(db, 'export_order_items', line.itemId), {
            id: line.itemId,
            export_order_id: orderId,
            source_order_id: line.source_order_id,
            source_order_item_id: line.source_order_item_id,
            product_id: line.product.id,
            product_code: productCode(line.product),
            product_name: productName(line.product),
            from_warehouse_id: line.fromWarehouse.id,
            from_warehouse_name: warehouseName(line.fromWarehouse),
            to_warehouse_id: '',
            to_warehouse_name: '',
            destination_name: orderPayload.destination_name,
            logo: normalizeLogo(line.targetLogo),
            source_logo: normalizeLogo(line.sourceLogo),
            target_logo: normalizeLogo(line.targetLogo),
            quantity: line.quantity,
            unit: line.unit || line.product.unit || '',
            lot_allocations_json: JSON.stringify(allocations),
            allocation_strategy: setting.strategy,
            note: line.note || '',
            legacy_line_key: '',
            status: 'completed',
            active: true,
            deleted: false,
            created_by: actor,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            operation_id: operationId,
            last_operation_id: operationId,
            revision: 1,
            source: 'kingcup_firestore',
          })
          tx.set(doc(db, 'stock_movements', line.outMovementId), movementPayload({
            id: line.outMovementId,
            type: 'export_customer',
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
            reason: 'Xuất theo yêu cầu và cấu hình lô',
            createdBy: actor,
            operationId,
            lotAllocations: allocations,
          }))
          stockMovementIds.push(line.outMovementId)
          exportedSummary.push({
            source_order_id: line.source_order_id,
            source_order_item_id: line.source_order_item_id,
            product_id: line.product.id,
            product_code: productCode(line.product),
            product_name: productName(line.product),
            warehouse_id: line.fromWarehouse.id,
            warehouse_name: warehouseName(line.fromWarehouse),
            logo: normalizeLogo(line.targetLogo),
            quantity: line.quantity,
            unit: line.unit || line.product.unit || '',
            lot_allocations: allocations,
          })
        })

        states.forEach(state => tx.set(state.ref, balancePayload(state, operationId, actor), { merge: true }))
        tx.update(requestRef, {
          ...buildReleasedRequestPatch({
            request: currentRequest,
            exportOrderId: orderId,
            exportCode: code,
            actor,
            note: input.note || '',
            operationId,
            releaseSequence,
            actualSummaryJson: JSON.stringify(exportedSummary),
            stockMovementIds,
            timelineJson: JSON.stringify(nextTimeline),
          }),
          warehouse_handled_at: serverTimestamp(),
          exported_at: serverTimestamp(),
          actual_exported_at: serverTimestamp(),
          revision: currentRevision + 1,
          updated_at: serverTimestamp(),
        })
        if (request.order_id && input.orderSummaryPatch) tx.update(doc(db, 'orders', request.order_id), {
          warehouse_fulfillment_status: input.orderSummaryPatch.warehouse_fulfillment_status || 'da_xuat_1_phan',
          warehouse_request_status: input.orderSummaryPatch.warehouse_request_status || 'da_xuat',
          updated_at: serverTimestamp(),
        })
        tx.set(doc(collection(db, 'activity_logs')), activityPayload('order_export_requests', 'warehouse_export', request.request_id || requestDocId, { request_id: request.request_id || requestDocId, export_order_id: orderId, export_code: code, strategy: setting.strategy }, actor))
        notificationRefs.forEach((notificationRef, index) => tx.set(notificationRef, buildNotificationPayload({
          type: 'warehouse_export_request_released',
          title: 'Kho đã cho xuất hàng',
          message: `${request.request_id || requestDocId} · Đã tạo phiếu xuất ${code}.`,
          route: '/export-requests',
          entity_collection: 'order_export_requests',
          entity_id: requestDocId,
          entity_code: request.request_id || requestDocId,
          created_by: actor,
          to_email: saleRecipients[index],
          metadata: { order_id: request.order_id || '', order_code: request.order_code || '', export_order_id: orderId, export_code: code },
        })))
        completeOperationTx(tx, operationId, code, 1)
      })
      invalidateWarehouseCaches()
      return {
        id: orderId,
        code,
        stockMovementIds,
        operationId,
        alreadyProcessed,
        notificationCount: alreadyProcessed ? 0 : saleRecipients.length,
        releaseSequence,
        revision: 1,
      }
    } catch (error) {
      await failOperation(operationId, actor, error).catch(() => undefined)
      throw error
    }
  }


  async function cancelExportRequestRelease(input: any) {
    const actor = actorEmail()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')
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

    const lines = summary.map((line: any, index: number) => {
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
      const quantity = positiveQuantity(line.quantity)
      return {
        product,
        fromWarehouse,
        logo: normalizeLogo(line.logo),
        unit: line.unit || product.unit || '',
        quantity,
        itemId: safeDocId(`${exportOrderId}__${index + 1}`, 'export_item'),
        reverseMovementId: safeDocId(`export_request_cancel:${exportOrderId}:${index + 1}:${operationId}`, 'movement'),
        summaryAllocations: Array.isArray(line.lot_allocations) ? line.lot_allocations : [],
      }
    })
    const refs = await buildBalanceRefs(lines.map((line: any) => ({
      product: line.product,
      warehouse: line.fromWarehouse,
      logo: line.logo,
    })))
    const replay = await claimOperation({
      operationId,
      action: 'export_request_cancel',
      targetCollection: 'export_orders',
      targetId: exportOrderId,
      resultCode: String(request.warehouse_export_code || exportOrderId),
      actor,
    })
    if (replay) return { ...replay, operationId, alreadyProcessed: true, notificationCount: 0 }

    const saleRecipients = Array.isArray(input.notification_recipients)
      ? Array.from(new Set(input.notification_recipients.map(normalizeEmail).filter(Boolean))).filter(recipient => recipient !== actor)
      : resolveSaleNotificationRecipients({ request, actorEmail: actor })
    const notificationRefs = saleRecipients.map(() => doc(collection(db, 'notifications')))
    let exportCode = String(request.warehouse_export_code || exportOrderId)
    let resultRevision = expectedExportRevision

    try {
      await runTransaction(db, async tx => {
        const operationRef = doc(db, 'warehouse_operations', operationId)
        const requestRef = doc(db, 'order_export_requests', requestDocId)
        const exportRef = doc(db, 'export_orders', exportOrderId)
        const operationSnap = await tx.get(operationRef)
        const requestSnap = await tx.get(requestRef)
        const exportSnap = await tx.get(exportRef)
        if (!operationSnap.exists() || operationSnap.data()?.status !== 'processing') throw new Error('Operation hủy xuất không hợp lệ.')
        if (!requestSnap.exists()) throw new Error('Yêu cầu xuất kho không còn tồn tại.')
        if (!exportSnap.exists()) throw new Error('Không tìm thấy phiếu xuất liên kết để hoàn tồn.')

        const currentRequest = { ...requestSnap.data(), id: requestSnap.id }
        const currentExport = { ...exportSnap.data(), id: exportSnap.id }
        if (revisionOf(currentRequest) !== revisionOf({ revision: expectedRequestRevision })) {
          throw new Error('Yêu cầu xuất kho đã được cập nhật ở phiên khác.')
        }
        if (revisionOf(currentExport) !== revisionOf({ revision: expectedExportRevision })) {
          throw new Error('Phiếu xuất kho đã được cập nhật ở phiên khác.')
        }
        const linkError = exportLifecycleLinkError(currentRequest, currentExport)
        if (linkError) throw new Error(linkError)
        if (!canCancelExportRequestRelease(currentRequest)) throw new Error('Yêu cầu vừa thay đổi nên không thể hủy xuất.')
        if (String(currentExport.destination_type || 'customer') !== 'customer') {
          throw new Error('Luồng yêu cầu Sale hiện chỉ hỗ trợ hoàn phiếu xuất tới khách.')
        }
        exportCode = String(currentExport.code || currentExport.export_code || exportCode)
        resultRevision = revisionOf(currentExport) + 1

        const itemSnaps = new Map<string, any>()
        for (const line of lines) itemSnaps.set(line.itemId, await tx.get(doc(db, 'export_order_items', line.itemId)))
        const states = await readBalanceStates(tx, refs, request.export_date || todayKey())

        const restoredAllocations = new Map<string, LotAllocation[]>()
        for (const line of lines) {
          const itemSnap = itemSnaps.get(line.itemId)
          if (!itemSnap?.exists()) throw new Error(`Thiếu chi tiết phiếu xuất ${line.itemId}, không thể hoàn tồn.`)
          const item = itemSnap.data() || {}
          if (String(item.export_order_id || '') !== exportOrderId || item.deleted === true || item.active === false) {
            throw new Error(`Chi tiết phiếu xuất ${line.itemId} không còn hợp lệ để hoàn tồn.`)
          }
          const itemAllocations = parseLotAllocations(item.lot_allocations_json)
          const allocations = itemAllocations.length
            ? itemAllocations
            : line.summaryAllocations.length
              ? line.summaryAllocations
              : [{
                  lot_id: `opening_restore__${line.itemId}`,
                  quantity: line.quantity,
                  import_code: 'OPENING',
                  import_date: '1970-01-01',
                  source: 'legacy_opening',
                }]
          const key = Array.from(refs.values()).find(entry => (
            entry.product.id === line.product.id
            && entry.warehouse.id === line.fromWarehouse.id
            && entry.logo === line.logo
          ))!.id
          const state = states.get(key)!
          reconcileState(state)
          restoreSourceAllocation(state, allocations, line.quantity)
          restoredAllocations.set(line.itemId, allocations)
        }

        tx.update(exportRef, {
          lifecycle_status: 'cancelled',
          deleted: true,
          active: false,
          status: 'cancelled',
          deleted_at: serverTimestamp(),
          deleted_by: actor,
          deleted_reason: reason,
          cancelled_at: serverTimestamp(),
          cancelled_by: actor,
          cancel_reason: reason,
          updated_by: actor,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: resultRevision,
          updated_at: serverTimestamp(),
        })
        lines.forEach((line: any) => {
          const item = itemSnaps.get(line.itemId).data() || {}
          const allocations = restoredAllocations.get(line.itemId) || []
          tx.update(doc(db, 'export_order_items', line.itemId), {
            deleted: true,
            active: false,
            status: 'cancelled',
            deleted_at: serverTimestamp(),
            deleted_by: actor,
            deleted_reason: reason,
            updated_by: actor,
            operation_id: operationId,
            last_operation_id: operationId,
            revision: revisionOf(item) + 1,
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
            createdBy: actor,
            operationId,
            lotAllocations: allocations,
          }))
        })
        states.forEach(state => tx.set(state.ref, balancePayload(state, operationId, actor), { merge: true }))

        let currentTimeline: any[] = []
        try {
          const parsed = JSON.parse(String(currentRequest.request_timeline_json || '[]'))
          currentTimeline = Array.isArray(parsed) ? parsed : []
        } catch {}
        const nextTimeline = appendExportLifecycleTimeline(currentTimeline, {
          action: 'warehouse_export_cancel',
          title: 'Kho hủy xuất và hoàn tồn',
          actor,
          actorName: appUser.value?.display_name || actor,
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
            actor,
            reason,
            operationId,
            timelineJson: JSON.stringify(nextTimeline),
          }),
          warehouse_handled_at: serverTimestamp(),
          last_cancelled_at: serverTimestamp(),
          revision: revisionOf(currentRequest) + 1,
          updated_at: serverTimestamp(),
        })
        if (currentRequest.order_id && input.orderSummaryPatch) tx.update(doc(db, 'orders', currentRequest.order_id), {
          warehouse_fulfillment_status: input.orderSummaryPatch.warehouse_fulfillment_status || 'chua_xuat',
          warehouse_request_status: input.orderSummaryPatch.warehouse_request_status || 'da_tiep_nhan',
          updated_at: serverTimestamp(),
        })
        tx.set(doc(collection(db, 'activity_logs')), activityPayload('export_orders', 'cancel_from_request', exportCode, {
          request_id: currentRequest.request_id || requestDocId,
          export_order_id: exportOrderId,
          reason,
        }, actor))
        tx.set(doc(collection(db, 'activity_logs')), activityPayload('order_export_requests', 'warehouse_export_cancel', currentRequest.request_id || requestDocId, {
          export_order_id: exportOrderId,
          export_code: exportCode,
          reason,
        }, actor))
        notificationRefs.forEach((notificationRef, index) => tx.set(notificationRef, buildNotificationPayload({
          type: 'warehouse_export_request_cancelled',
          title: 'Kho đã hủy xuất và hoàn tồn',
          message: `${currentRequest.request_id || requestDocId} · Phiếu ${exportCode} đã được hủy. Lý do: ${reason}`,
          route: '/export-requests',
          entity_collection: 'order_export_requests',
          entity_id: requestDocId,
          entity_code: currentRequest.request_id || requestDocId,
          created_by: actor,
          to_email: saleRecipients[index],
          metadata: {
            order_id: currentRequest.order_id || '',
            order_code: currentRequest.order_code || '',
            export_order_id: exportOrderId,
            export_code: exportCode,
            reason,
          },
        })))
        completeOperationTx(tx, operationId, exportCode, resultRevision)
      })
      invalidateWarehouseCaches()
      return {
        id: exportOrderId,
        code: exportCode,
        revision: resultRevision,
        operationId,
        alreadyProcessed: false,
        notificationCount: saleRecipients.length,
      }
    } catch (error) {
      await failOperation(operationId, actor, error).catch(() => undefined)
      throw error
    }
  }

  async function createInventoryAdjustment(input: any) {
    const actor = actorEmail()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')
    const product = ensureProduct(input.product)
    const warehouse = ensureWarehouse(input.warehouse, 'kho')
    const quantity = roundQuantity(input.quantity)
    if (!quantity) throw new Error('Số lượng điều chỉnh phải khác 0.')
    const date = input.adjustment_date || todayKey()
    const id = makeId('adj')
    const operationId = operationIdOf(input.operation_id, `inventory_adjust:${id}`)
    const setting = await loadIssueSetting()
    const balanceKey = await inventoryBalanceId(product.id, warehouse.id, input.logo)
    const refs = new Map([[balanceKey, { id: balanceKey, ref: doc(db, 'inventory_balances', balanceKey), product, warehouse, logo: normalizeLogo(input.logo) }]])
    const replay = await claimOperation({ operationId, action: 'inventory_adjust', targetCollection: 'inventory_adjustments', targetId: id, actor })
    if (replay) return { ...replay, operationId, alreadyProcessed: true }

    try {
      await runTransaction(db, async tx => {
        const operationSnap = await tx.get(doc(db, 'warehouse_operations', operationId))
        const states = await readBalanceStates(tx, refs, date)
        if (!operationSnap.exists() || operationSnap.data()?.status !== 'processing') throw new Error('Operation điều chỉnh tồn không hợp lệ.')
        const state = states.get(balanceKey)!
        reconcileState(state)
        let allocations: LotAllocation[] = []
        if (quantity > 0) {
          const lotId = safeDocId(`adjustment_lot__${id}`, 'lot')
          addLot(state, {
            id: lotId,
            import_code: 'ADJUSTMENT',
            import_date: date,
            product_id: product.id,
            warehouse_id: warehouse.id,
            logo: normalizeLogo(input.logo),
            unit: input.unit || product.unit || '',
            received_quantity: quantity,
            available_quantity: quantity,
            cost_item_id: '',
            source: 'inventory_adjustment',
            status: 'available',
          })
          allocations = [{ lot_id: lotId, quantity, import_code: 'ADJUSTMENT', import_date: date, source: 'inventory_adjustment' }]
        } else {
          allocations = allocateFromState(state, Math.abs(quantity), setting)
        }
        tx.set(doc(db, 'inventory_adjustments', id), {
          id,
          adjustment_date: date,
          product_id: product.id,
          product_code: productCode(product),
          product_name: productName(product),
          warehouse_id: warehouse.id,
          warehouse_name: warehouseName(warehouse),
          logo: normalizeLogo(input.logo),
          quantity,
          unit: input.unit || product.unit || '',
          lot_allocations_json: JSON.stringify(allocations),
          allocation_strategy: quantity < 0 ? setting.strategy : 'adjustment_lot',
          reason: input.reason || '',
          note: input.note || '',
          status: 'completed',
          active: true,
          deleted: false,
          created_by: actor,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
          operation_id: operationId,
          last_operation_id: operationId,
          revision: 1,
          source: 'nuxt',
        })
        const movementId = safeDocId(`adjust:${id}`, 'movement')
        tx.set(doc(db, 'stock_movements', movementId), movementPayload({
          id: movementId,
          type: 'adjustment',
          direction: 'adjust',
          quantity,
          product,
          warehouse,
          logo: input.logo,
          unit: input.unit,
          movementDate: date,
          sourceCollection: 'inventory_adjustments',
          sourceDocId: id,
          sourceItemId: id,
          sourceCode: id,
          reason: input.reason || input.note || 'Điều chỉnh tồn',
          createdBy: actor,
          operationId,
          lotAllocations: allocations,
        }))
        tx.set(state.ref, balancePayload(state, operationId, actor), { merge: true })
        tx.set(doc(collection(db, 'activity_logs')), activityPayload('inventory_adjustments', 'create', id, { id, quantity }, actor))
        completeOperationTx(tx, operationId, '', 1)
      })
      invalidateWarehouseCaches()
      return { id, operationId, alreadyProcessed: false }
    } catch (error) {
      await failOperation(operationId, actor, error).catch(() => undefined)
      throw error
    }
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
    getInventoryBalanceId: legacy.getInventoryBalanceId,
    readInventoryBalance: legacy.readInventoryBalance,
    loadIssueSetting,
  }
}
