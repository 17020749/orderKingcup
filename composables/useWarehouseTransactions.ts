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

type WarehouseLineInput = {
  product: ProductDoc | any
  warehouse?: WarehouseDoc | any
  fromWarehouse?: WarehouseDoc | any
  toWarehouse?: WarehouseDoc | any | null
  logo?: string
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
  if (!id) throw new Error('Thiếu sản phẩm hoặc sản phẩm chưa có Firestore ID.')
  return { ...product, id }
}

function ensureWarehouse(warehouse: any, label = 'kho') {
  const id = normalizeId(warehouse?.id || warehouse?.firestore_id)
  if (!id) throw new Error(`Thiếu ${label} hoặc ${label} chưa có Firestore ID.`)
  return { ...warehouse, id }
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

function applyDelta(map: Map<string, BalanceDelta>, delta: BalanceDelta) {
  const current = map.get(delta.id)
  if (!current) {
    map.set(delta.id, { ...delta })
    return
  }
  current.delta += delta.delta
}

function balancePayload(delta: BalanceDelta, nextQuantity: number) {
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
    source: 'nuxt'
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
    'order_export_requests', 'orders', 'activity_logs'
  ].forEach(name => invalidateScopedCache(name))
}

export function useWarehouseTransactions() {
  const { db } = useFirebaseServices()
  const { appUser } = useAuth()

  function email() {
    return normalizeEmail(appUser.value?.email || '')
  }

  function activity(module: string, action: string, itemCode: string, after: any) {
    return {
      module,
      action,
      item_code: itemCode,
      item_name: after?.code || after?.import_code || after?.export_code || after?.product_name || itemCode,
      changed_by: email(),
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
    lines: WarehouseLineInput[]
  }) {
    const createdBy = email()
    if (!createdBy) throw new Error('Bạn chưa đăng nhập.')
    const rawLines = input.lines.filter(line => toNumber(line.quantity) > 0)
    if (!rawLines.length) throw new Error('Phiếu nhập phải có ít nhất một dòng hàng.')

    const importDate = input.import_date || todayKey()
    const orderId = makeId('imp')
    const code = makeCode('PNK')
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
      source: 'nuxt'
    }

    await runTransaction(db, async tx => {
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
          createdBy
        }))
      })

      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        const next = current + delta.delta
        tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, next), { merge: true })
      }

      tx.set(doc(collection(db, 'activity_logs')), activity('import_orders', 'create', code, orderPayload))
    })

    invalidateWarehouseCaches()
    return { id: orderId, code }
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

  async function updateImportOrder(input: {
    order: any
    existingItems: any[]
    import_date?: string
    supplier?: SupplierDoc | any | null
    note?: string
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

    await runTransaction(db, async tx => {
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
          createdBy: updatedBy
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
          createdBy: updatedBy
        }))
      })

      oldItems.slice(preparedNew.length).forEach(item => {
        tx.update(doc(db, 'import_order_items', item.id), {
          deleted: true,
          active: false,
          status: 'deleted',
          deleted_at: serverTimestamp(),
          updated_by: updatedBy,
          updated_at: serverTimestamp()
        })
      })

      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        const next = current + delta.delta
        tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, next), { merge: true })
      }

      tx.set(doc(collection(db, 'activity_logs')), activity('import_orders', 'update', code, {
        id: orderId,
        code,
        import_date: importDate,
        supplier_id: supplier.id || '',
        supplier_name: supplier.name || supplier.supplier_name || '',
        line_count: preparedNew.length
      }))
    })

    invalidateWarehouseCaches()
    return { id: orderId, code }
  }

  async function deleteImportOrder(input: { order: any; existingItems: any[]; reason?: string }) {
    const deletedBy = email()
    if (!deletedBy) throw new Error('Bạn chưa đăng nhập.')
    const orderId = normalizeId(input.order?.id)
    if (!orderId) throw new Error('Thiếu ID phiếu nhập cần xóa.')
    const oldItems = (input.existingItems || []).filter(item => item && item.deleted !== true && item.active !== false)
    const importDate = input.order?.import_date || todayKey()
    const code = input.order?.code || input.order?.import_code || orderId

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

    await runTransaction(db, async tx => {
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
          createdBy: deletedBy
        }))
      })

      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        const next = current + delta.delta
        tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, next), { merge: true })
      }

      tx.set(doc(collection(db, 'activity_logs')), activity('import_orders', 'delete', code, {
        id: orderId,
        code,
        reason: input.reason || ''
      }))
    })

    invalidateWarehouseCaches()
    return { id: orderId, code }
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
    lines: WarehouseLineInput[]
  }) {
    const createdBy = email()
    if (!createdBy) throw new Error('Bạn chưa đăng nhập.')
    const destinationType = input.destination_type || 'customer'
    const exportDate = input.export_date || todayKey()
    const orderId = input.id || makeId('exp')
    const code = input.code || makeCode('PXK')
    const rawLines = input.lines.filter(line => toNumber(line.quantity) > 0)
    if (!rawLines.length) throw new Error('Phiếu xuất phải có ít nhất một dòng hàng.')

    const defaultToWarehouse = input.toWarehouse ? ensureWarehouse(input.toWarehouse, 'kho nhận') : null
    const preparedLines = [] as Array<WarehouseLineInput & { product: any; fromWarehouse: any; toWarehouse: any | null; quantity: number; itemId: string; outMovementId: string; inMovementId: string }>
    rawLines.forEach((line, index) => {
      const product = ensureProduct(line.product)
      const fromWarehouse = ensureWarehouse(line.fromWarehouse || line.warehouse, 'kho xuất')
      const toWarehouse = destinationType === 'warehouse'
        ? ensureWarehouse(line.toWarehouse || defaultToWarehouse, 'kho nhận')
        : null
      if (toWarehouse && toWarehouse.id === fromWarehouse.id) throw new Error('Kho nhận phải khác kho xuất.')
      const quantity = ensurePositiveQuantity(line.quantity)
      preparedLines.push({
        ...line,
        product,
        fromWarehouse,
        warehouse: fromWarehouse,
        toWarehouse,
        quantity,
        itemId: safeDocId(`${orderId}__${index + 1}`, 'export_item'),
        outMovementId: safeDocId(`export_out:${orderId}:${index + 1}`, 'movement'),
        inMovementId: safeDocId(`transfer_in:${orderId}:${index + 1}`, 'movement')
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
      if (line.toWarehouse) {
        const inId = await inventoryBalanceId(line.product.id, line.toWarehouse.id, line.logo)
        applyDelta(balanceDeltas, {
          id: inId,
          delta: line.quantity,
          product: line.product,
          warehouse: line.toWarehouse,
          logo: normalizeLogo(line.logo),
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
      source: input.source_request_id ? 'kingcup_firestore' : 'nuxt'
    }

    const stockMovementIds = preparedLines.flatMap(line => line.toWarehouse ? [line.outMovementId, line.inMovementId] : [line.outMovementId])

    await runTransaction(db, async tx => {
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
          logo: line.logo,
          unit: line.unit,
          movementDate: exportDate,
          sourceCollection: 'export_orders',
          sourceDocId: orderId,
          sourceItemId: line.itemId,
          sourceCode: code,
          reason: line.toWarehouse ? 'Xuất chuyển kho' : 'Xuất tới khách hàng',
          createdBy
        }))
        if (line.toWarehouse) {
          tx.set(doc(db, 'stock_movements', line.inMovementId), movementPayload({
            id: line.inMovementId,
            type: 'export_transfer_in',
            direction: 'in',
            quantity: line.quantity,
            product: line.product,
            warehouse: line.toWarehouse,
            logo: line.logo,
            unit: line.unit,
            movementDate: exportDate,
            sourceCollection: 'export_orders',
            sourceDocId: orderId,
            sourceItemId: line.itemId,
            sourceCode: code,
            reason: 'Nhập từ chuyển kho',
            createdBy
          }))
        }
      })

      for (const delta of balanceDeltas.values()) {
        const snap = balanceSnaps.get(delta.id)
        const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
        const next = current + delta.delta
        tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, next), { merge: true })
      }

      tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'create', code, orderPayload))
    })

    invalidateWarehouseCaches()
    return { id: orderId, code, stockMovementIds }
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
  }) {
    const createdBy = email()
    if (!createdBy) throw new Error('Bạn chưa đăng nhập.')
    const product = ensureProduct(input.product)
    const warehouse = ensureWarehouse(input.warehouse, 'kho')
    const quantity = signedNumber(input.quantity)
    const adjustmentDate = input.adjustment_date || todayKey()
    const adjustmentId = makeId('adj')
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
      source: 'nuxt'
    }

    await runTransaction(db, async tx => {
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
        createdBy
      }))
      tx.set(balanceRef, balancePayload(delta, next), { merge: true })
      tx.set(doc(collection(db, 'activity_logs')), activity('inventory_adjustments', 'create', adjustmentId, payload))
    })

    invalidateWarehouseCaches()
    return { id: adjustmentId }
  }

  async function processExportRequestToExportOrder(input: {
    request: any
    orderSummaryPatch?: Record<string, any>
    warehouse: WarehouseDoc | any
    customer_name?: string
    note?: string
    export_date?: string
    timeline?: any[]
    lines: Array<{ product: ProductDoc | any; logo?: string; quantity: number; unit?: string; note?: string }>
  }) {
    const createdBy = email()
    if (!createdBy) throw new Error('Bạn chưa đăng nhập.')

    const request = input.request || {}
    const requestDocId = String(request.id || request.request_id || '').trim()
    if (!requestDocId) throw new Error('Thiếu ID yêu cầu xuất kho.')

    const warehouse = ensureWarehouse(input.warehouse, 'kho xuất')
    const exportDate = input.export_date || request.export_date || todayKey()
    const orderId = safeDocId(`request_export__${requestDocId}`, 'export')
    const code = safeDocId(`PXK-${request.request_id || requestDocId}`, 'PXK')
    const rawLines = input.lines.filter(line => toNumber(line.quantity) > 0)
    if (!rawLines.length) throw new Error('Yêu cầu xuất kho chưa có dòng hàng hợp lệ.')

    const preparedLines = [] as Array<{ product: any; fromWarehouse: any; logo?: string; unit?: string; note?: string; quantity: number; itemId: string; outMovementId: string }>
    rawLines.forEach((line, index) => {
      const product = ensureProduct(line.product)
      const quantity = ensurePositiveQuantity(line.quantity)
      preparedLines.push({
        product,
        fromWarehouse: warehouse,
        logo: line.logo,
        unit: line.unit || product.unit || '',
        note: line.note || '',
        quantity,
        itemId: safeDocId(`${orderId}__${index + 1}`, 'export_item'),
        outMovementId: safeDocId(`export_out:${orderId}:${index + 1}`, 'movement')
      })
    })

    const balanceDeltas = new Map<string, BalanceDelta>()
    for (const line of preparedLines) {
      const outId = await inventoryBalanceId(line.product.id, warehouse.id, line.logo)
      applyDelta(balanceDeltas, {
        id: outId,
        delta: -line.quantity,
        product: line.product,
        warehouse,
        logo: normalizeLogo(line.logo),
        unit: line.unit || line.product.unit || '',
        movementDate: exportDate
      })
    }

    const stockMovementIds = preparedLines.map(line => line.outMovementId)
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
      source: 'kingcup_firestore'
    }

    const handledBy = createdBy
    const handledAt = new Date().toISOString()
    const timeline = Array.isArray(input.timeline) ? input.timeline : []
    const nextTimeline = [...timeline, {
      action: 'warehouse_export',
      title: 'Kho cho xuất kho',
      actor: handledBy,
      actor_name: appUser.value?.display_name || handledBy,
      time: handledAt,
      status: 'da_xuat',
      note: input.note || ''
    }]

    let alreadyProcessed = false
    await runTransaction(db, async tx => {
      const requestRef = doc(db, 'order_export_requests', requestDocId)
      const exportRef = doc(db, 'export_orders', orderId)
      const requestSnap = await tx.get(requestRef)
      const exportSnap = await tx.get(exportRef)
      const balanceSnaps = new Map<string, any>()
      for (const delta of balanceDeltas.values()) {
        balanceSnaps.set(delta.id, await tx.get(doc(db, 'inventory_balances', delta.id)))
      }

      if (!requestSnap.exists()) throw new Error('Yêu cầu xuất kho không còn tồn tại.')
      const currentRequest = requestSnap.data() || {}
      alreadyProcessed = String(currentRequest.status || '') === 'da_xuat'
        || String(currentRequest.export_order_id || currentRequest.warehouse_export_order_id || '').trim() !== ''

      if (!alreadyProcessed && !exportSnap.exists()) {
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
          const itemPayload = {
            id: line.itemId,
            export_order_id: orderId,
            product_id: line.product.id,
            product_code: productCode(line.product),
            product_name: productName(line.product),
            from_warehouse_id: warehouse.id,
            from_warehouse_name: warehouseName(warehouse),
            to_warehouse_id: '',
            to_warehouse_name: '',
            destination_name: orderPayload.destination_name,
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
            source: 'kingcup_firestore'
          }
          tx.set(doc(db, 'export_order_items', line.itemId), itemPayload)
          tx.set(doc(db, 'stock_movements', line.outMovementId), movementPayload({
            id: line.outMovementId,
            type: 'export_customer',
            direction: 'out',
            quantity: -line.quantity,
            product: line.product,
            warehouse,
            logo: line.logo,
            unit: line.unit,
            movementDate: exportDate,
            sourceCollection: 'export_orders',
            sourceDocId: orderId,
            sourceItemId: line.itemId,
            sourceCode: code,
            reason: 'Xuất theo yêu cầu OrderKingcup',
            createdBy
          }))
        })

        for (const delta of balanceDeltas.values()) {
          const snap = balanceSnaps.get(delta.id)
          const current = snap.exists() ? toNumber(snap.data()?.quantity) : 0
          const next = current + delta.delta
          tx.set(doc(db, 'inventory_balances', delta.id), balancePayload(delta, next), { merge: true })
        }
        tx.set(doc(collection(db, 'activity_logs')), activity('export_orders', 'create_from_request', code, orderPayload))
      }

      if (!alreadyProcessed) {
        tx.update(requestRef, {
          status: 'da_xuat',
          warehouse_export_code: code,
          warehouse_export_id: orderId,
          warehouse_export_order_id: orderId,
          export_order_id: orderId,
          warehouse_handled_by: handledBy,
          warehouse_handled_at: serverTimestamp(),
          warehouse_note: input.note || '',
          exported_at: serverTimestamp(),
          actual_exported_at: serverTimestamp(),
          actual_export_summary_json: JSON.stringify(preparedLines.map(line => ({
            product_id: line.product?.id || '',
            product_code: productCode(line.product),
            product_name: productName(line.product),
            logo: normalizeLogo(line.logo),
            quantity: toNumber(line.quantity),
            unit: line.unit || line.product?.unit || ''
          }))),
          stock_movement_ids: stockMovementIds,
          request_timeline_json: JSON.stringify(nextTimeline),
          updated_at: serverTimestamp()
        })
        if (request.order_id && input.orderSummaryPatch) {
          tx.update(doc(db, 'orders', request.order_id), {
            warehouse_fulfillment_status: input.orderSummaryPatch.warehouse_fulfillment_status || 'da_xuat_1_phan',
            warehouse_request_status: input.orderSummaryPatch.warehouse_request_status || 'da_xuat',
            updated_at: serverTimestamp()
          })
        }
        tx.set(doc(collection(db, 'activity_logs')), activity('order_export_requests', 'warehouse_export', request.request_id || requestDocId, {
          request_id: request.request_id || requestDocId,
          export_order_id: orderId,
          export_code: code
        }))
      }
    })

    invalidateWarehouseCaches()
    return { id: orderId, code, stockMovementIds, alreadyProcessed }
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
    createInventoryAdjustment,
    processExportRequestToExportOrder,
    getInventoryBalanceId,
    readInventoryBalance
  }
}
