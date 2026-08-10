import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
} from 'firebase/firestore'
import { useWarehouseCostTransactions } from '~/composables/useWarehouseCostTransactions'
import { invalidateScopedCache } from '~/composables/useScopedQueries'
import { roundQuantity } from '~/utils/warehouseLotAllocation'
// @ts-ignore Shared ESM helper is also executed directly by Node client tests.
import {
  inventoryBalanceId,
  preflightExportStock,
} from '~/utils/warehouseExportPreflight.mjs'
// @ts-ignore Shared ESM helper is also executed directly by Node client tests.
import { alignExportRequestLineProducts } from '~/utils/warehouseExportRequestIdentity.mjs'
// @ts-ignore Shared ESM helper is also executed directly by Node client tests.
import {
  canonicalWarehouseLogo,
  selectEquivalentWarehouseBalance,
  warehouseLogoLookupVariants,
} from '~/utils/warehouseLogoIdentity.mjs'
// @ts-ignore Shared ESM helper is also executed directly by Node client tests.
import { importUpdateMode } from '~/utils/warehouseImportUpdateMode.mjs'

export function useWarehouseTransactionsClient() {
  const base = useWarehouseCostTransactions()
  const { db } = useFirebaseServices()
  const { appUser } = useAuth()

  async function loadBalance(input: { productId: string; warehouseId: string; logo: string }) {
    const balanceId = await inventoryBalanceId(input.productId, input.warehouseId, input.logo)
    const snapshot = await getDoc(doc(db, 'inventory_balances', balanceId))
    return snapshot.exists() ? snapshot.data() || {} : { quantity: 0, lots: [] }
  }

  async function checkExportStock(input: any, destinationType?: string) {
    return preflightExportStock({
      lines: input?.lines || [],
      destination_type: destinationType || input?.destination_type || 'customer',
      fallbackWarehouse: input?.warehouse || null,
      loadBalance,
    })
  }

  async function createExportOrder(input: any) {
    await checkExportStock(input)
    try {
      return await base.createExportOrder(input)
    } catch (error: any) {
      if (String(error?.message || '').includes('Không đủ tồn theo lô')) {
        await checkExportStock(input)
      }
      throw error
    }
  }

  function productIdOf(line: any) {
    return String(
      line?.product?.id
      || line?.product?.firestore_id
      || line?.product?.product_id
      || line?.product_id
      || '',
    ).trim()
  }

  function warehouseIdOf(line: any) {
    const warehouse = line?.fromWarehouse || line?.warehouse || null
    if (typeof warehouse === 'string') return warehouse.trim()
    return String(
      warehouse?.id
      || warehouse?.firestore_id
      || line?.from_warehouse_id
      || line?.warehouse_id
      || '',
    ).trim()
  }

  function inventoryLogoOf(line: any) {
    if (line && Object.prototype.hasOwnProperty.call(line, 'target_logo')) {
      return String(line.target_logo || '').trim()
    }
    return String(line?.logo || '').trim()
  }

  function text(value: any) {
    return String(value || '').trim()
  }

  function numberOf(value: any) {
    const parsed = Number(value || 0)
    return Number.isFinite(parsed) ? parsed : 0
  }

  function revisionOf(value: any) {
    const revision = numberOf(value?.revision ?? value)
    return Math.max(0, Math.floor(revision))
  }

  function roundMoney(value: any) {
    return Math.round(numberOf(value) * 100) / 100
  }

  function lineVatRate(line: any) {
    return Math.max(0, Math.min(100, numberOf(line?.vat_rate ?? line?.vat_percent ?? 0)))
  }

  function lineUnitCostWithVat(line: any) {
    const unitCost = roundMoney(line?.unit_cost)
    return roundMoney(unitCost * (1 + lineVatRate(line) / 100))
  }

  function lineCost(line: any) {
    return roundMoney(roundQuantity(line?.quantity) * lineUnitCostWithVat(line))
  }

  function productCodeOf(line: any, existing: any) {
    return text(line?.product?.product_code || line?.product?.code || existing?.product_code)
  }

  function productNameOf(line: any, existing: any) {
    return text(line?.product?.product_name || line?.product?.name || existing?.product_name)
  }

  function warehouseNameOf(line: any, existing: any) {
    const warehouse = line?.warehouse
    if (typeof warehouse === 'string') return text(existing?.warehouse_name || warehouse)
    return text(warehouse?.name || warehouse?.warehouse_name || existing?.warehouse_name || warehouseIdOf(line))
  }

  function actorEmail() {
    return text(appUser.value?.email).toLowerCase()
  }

  function invalidateImportMetadataCaches() {
    ;[
      'import_orders',
      'import_order_items',
      'inventory_balances',
      'activity_logs',
      'warehouse_operations',
    ].forEach(name => invalidateScopedCache(name))
  }

  async function claimImportMetadataOperation(input: {
    operationId: string
    orderId: string
    code: string
    actor: string
  }) {
    let replay: any = null
    await runTransaction(db, async tx => {
      const ref = doc(db, 'warehouse_operations', input.operationId)
      const snapshot = await tx.get(ref)
      if (snapshot.exists()) {
        const data = snapshot.data() || {}
        if (text(data.action) !== 'import_update' || text(data.created_by).toLowerCase() !== input.actor) {
          throw new Error('operation_id đã được dùng cho nghiệp vụ khác.')
        }
        if (text(data.status) === 'completed') {
          replay = {
            id: text(data.target_id || input.orderId),
            code: text(data.result_code || input.code),
            revision: revisionOf(data.target_revision),
          }
          return
        }
        if (text(data.status) === 'processing') {
          throw new Error('Nghiệp vụ này đang được xử lý ở phiên khác.')
        }
        tx.update(ref, {
          status: 'processing',
          processing_at: serverTimestamp(),
          failed_at: null,
          failure_message: '',
          result_code: input.code,
          target_revision: 0,
        })
        return
      }

      tx.set(ref, {
        id: input.operationId,
        operation_id: input.operationId,
        action: 'import_update',
        target_collection: 'import_orders',
        target_id: input.orderId,
        result_code: input.code,
        target_revision: 0,
        created_by: input.actor,
        status: 'processing',
        processing_at: serverTimestamp(),
        created_at: serverTimestamp(),
        active: true,
        deleted: false,
      })
    })
    return replay
  }

  async function failImportMetadataOperation(operationId: string, actor: string, error: any) {
    await runTransaction(db, async tx => {
      const ref = doc(db, 'warehouse_operations', operationId)
      const snapshot = await tx.get(ref)
      if (!snapshot.exists()) return
      const data = snapshot.data() || {}
      if (text(data.created_by).toLowerCase() !== actor) return
      if (text(data.status) !== 'processing') return
      tx.update(ref, {
        status: 'failed',
        failed_at: serverTimestamp(),
        failure_message: String(error?.message || error || 'Nghiệp vụ kho thất bại').slice(0, 500),
      })
    })
  }

  async function updateImportOrderMetadataOnly(input: any) {
    const actor = actorEmail()
    if (!actor) throw new Error('Bạn chưa đăng nhập.')

    const orderId = text(input?.order?.id)
    if (!orderId) throw new Error('Thiếu ID phiếu nhập cần sửa.')
    const code = text(input?.order?.code || input?.order?.import_code || orderId)
    const oldItems = (Array.isArray(input?.existingItems) ? input.existingItems : [])
      .filter((item: any) => item && item.deleted !== true && item.active !== false)
    const rawLines = (Array.isArray(input?.lines) ? input.lines : [])
      .filter((line: any) => roundQuantity(line?.quantity) > 0)
    if (oldItems.length !== rawLines.length || !rawLines.length) {
      throw new Error('Thay đổi số dòng hàng phải đi qua kiểm tra tồn kho.')
    }

    const expectedRevision = revisionOf(input?.expected_revision ?? input?.order?.revision)
    const nextImportDate = text(input?.import_date || input?.order?.import_date).slice(0, 10)
    const supplier = input?.supplier || {}
    const supplierId = text(supplier?.id || supplier?.supplier_id)
    const supplierName = text(supplier?.name || supplier?.supplier_name)
    const operationId = text(input?.operation_id) || `import_update_metadata:${orderId}:${expectedRevision}`

    const prepared = rawLines.map((line: any, index: number) => {
      const existing = oldItems[index]
      const quantity = roundQuantity(line.quantity)
      return {
        line,
        existing,
        quantity,
        itemId: text(existing.id),
        lotId: text(existing.lot_id),
        productId: productIdOf(line),
        warehouseId: warehouseIdOf(line),
        logo: text(line.logo),
        unit: text(line.unit || existing.unit),
        unitCost: roundMoney(line.unit_cost),
        vatRate: lineVatRate(line),
        unitCostWithVat: lineUnitCostWithVat(line),
        lineCost: lineCost(line),
        expiryDate: text(line.expiry_date).slice(0, 10),
        note: text(line.note),
      }
    })

    const replay = await claimImportMetadataOperation({ operationId, orderId, code, actor })
    if (replay) return { ...replay, operationId, alreadyProcessed: true, updateMode: 'metadata' }

    const balanceEntries = new Map<string, { ref: any; pairs: any[] }>()
    for (const row of prepared) {
      if (!row.productId || !row.warehouseId) continue
      const balanceId = await inventoryBalanceId(row.productId, row.warehouseId, row.logo)
      if (!balanceEntries.has(balanceId)) {
        balanceEntries.set(balanceId, {
          ref: doc(db, 'inventory_balances', balanceId),
          pairs: [],
        })
      }
      balanceEntries.get(balanceId)!.pairs.push(row)
    }

    try {
      let nextRevision = expectedRevision + 1
      await runTransaction(db, async tx => {
        const operationRef = doc(db, 'warehouse_operations', operationId)
        const orderRef = doc(db, 'import_orders', orderId)
        const operationSnap = await tx.get(operationRef)
        const orderSnap = await tx.get(orderRef)
        const balanceSnapshots = new Map<string, any>()
        for (const [balanceId, entry] of balanceEntries) {
          balanceSnapshots.set(balanceId, await tx.get(entry.ref))
        }

        if (!operationSnap.exists() || text(operationSnap.data()?.status) !== 'processing') {
          throw new Error('Operation sửa phiếu nhập không hợp lệ.')
        }
        if (text(operationSnap.data()?.action) !== 'import_update') {
          throw new Error('Operation sửa phiếu nhập không đúng nghiệp vụ.')
        }
        if (text(operationSnap.data()?.created_by).toLowerCase() !== actor) {
          throw new Error('Operation sửa phiếu nhập không thuộc người dùng hiện tại.')
        }
        if (!orderSnap.exists()) throw new Error('Phiếu nhập không còn tồn tại.')
        const current = orderSnap.data() || {}
        if (revisionOf(current) !== expectedRevision) {
          throw new Error('Phiếu nhập đã được cập nhật ở phiên khác. Hãy tải lại trang.')
        }
        if (current.deleted === true || current.active === false) throw new Error('Phiếu nhập đã bị xóa.')
        nextRevision = revisionOf(current) + 1

        tx.update(orderRef, {
          import_date: nextImportDate,
          supplier_id: supplierId,
          supplier_name: supplierName,
          total_quantity: roundQuantity(prepared.reduce((sum: number, row: any) => sum + row.quantity, 0)),
          total_cost: roundMoney(prepared.reduce((sum: number, row: any) => sum + row.lineCost, 0)),
          note: text(input?.note),
          updated_by: actor,
          operation_id: operationId,
          last_operation_id: operationId,
          revision: nextRevision,
          updated_at: serverTimestamp(),
        })

        prepared.forEach((row: any) => {
          tx.update(doc(db, 'import_order_items', row.itemId), {
            product_id: row.productId,
            product_code: productCodeOf(row.line, row.existing),
            product_name: productNameOf(row.line, row.existing),
            warehouse_id: row.warehouseId,
            warehouse_name: warehouseNameOf(row.line, row.existing),
            logo: row.logo,
            quantity: row.quantity,
            unit: row.unit,
            unit_cost: row.unitCost,
            vat_rate: row.vatRate,
            vat_percent: row.vatRate,
            unit_cost_with_vat: row.unitCostWithVat,
            line_cost: row.lineCost,
            expiry_date: row.expiryDate,
            note: row.note,
            updated_by: actor,
            operation_id: operationId,
            last_operation_id: operationId,
            revision: revisionOf(row.existing) + 1,
            updated_at: serverTimestamp(),
          })
        })

        for (const [balanceId, entry] of balanceEntries) {
          const snapshot = balanceSnapshots.get(balanceId)
          if (!snapshot?.exists()) continue
          const balance = snapshot.data() || {}
          if (!Array.isArray(balance.lots) || !balance.lots.length) continue

          let changed = false
          const lots = balance.lots.map((lot: any) => {
            const row = entry.pairs.find((candidate: any) => candidate.lotId && text(lot?.id) === candidate.lotId)
            if (!row) return lot
            changed = true
            return {
              ...lot,
              expiry_date: row.expiryDate,
              unit: row.unit,
              supplier_id: supplierId,
              supplier_name: supplierName,
            }
          })

          if (changed) {
            tx.update(entry.ref, {
              lots,
              updated_by: actor,
              last_operation_id: operationId,
              updated_at: serverTimestamp(),
            })
          }
        }

        tx.update(operationRef, {
          status: 'completed',
          completed_at: serverTimestamp(),
          result_code: code,
          target_revision: nextRevision,
          failure_message: '',
        })

        tx.set(doc(collection(db, 'activity_logs')), {
          module: 'import_orders',
          action: 'update',
          item_code: code,
          item_name: code,
          changed_by: actor,
          after_json: JSON.stringify({
            id: orderId,
            line_count: prepared.length,
            inventory_unchanged: true,
            update_mode: 'metadata',
          }),
          created_at: serverTimestamp(),
          active: true,
          deleted: false,
        })
      })

      invalidateImportMetadataCaches()
      return { id: orderId, code, revision: nextRevision, operationId, alreadyProcessed: false, updateMode: 'metadata' }
    } catch (error) {
      await failImportMetadataOperation(operationId, actor, error).catch(() => undefined)
      throw error
    }
  }

  async function updateImportOrder(input: any) {
    if (importUpdateMode(input) === 'metadata') {
      return updateImportOrderMetadataOnly(input)
    }

    try {
      return await base.updateImportOrder(input)
    } catch (error: any) {
      const message = String(error?.message || '')
      if (message.includes('Không tìm thấy lô của dòng nhập')) {
        throw new Error(
          'Lô nhập không còn tồn khả dụng hoặc đã được xuất hết. Bạn vẫn có thể sửa giá nhập, VAT, nhà cung cấp, hạn dùng và ghi chú; không thể đổi sản phẩm, kho, logo, số lượng hoặc ngày nhập sau khi lô đã được sử dụng.',
        )
      }
      throw error
    }
  }

  async function loadEquivalentBalanceRows(input: { productId: string; warehouseId: string; logo: string }) {
    const rows = new Map<string, any>()

    for (const variant of warehouseLogoLookupVariants(input.logo)) {
      const balanceId = await inventoryBalanceId(input.productId, input.warehouseId, variant)
      if (rows.has(balanceId)) continue
      const snapshot = await getDoc(doc(db, 'inventory_balances', balanceId))
      if (snapshot.exists()) rows.set(snapshot.id, { ...snapshot.data(), id: snapshot.id })
    }

    let selection = selectEquivalentWarehouseBalance(Array.from(rows.values()), input)
    if (selection.ambiguous || selection.positive.length === 1) return Array.from(rows.values())

    // Legacy data can contain a visually identical logo whose raw string also
    // contains whitespace/zero-width characters that cannot be reconstructed
    // from the request. Query only this product + warehouse as a compatibility
    // fallback, then compare the logo canonically on the client.
    try {
      const snapshot = await getDocs(query(
        collection(db, 'inventory_balances'),
        where('product_id', '==', input.productId),
        where('warehouse_id', '==', input.warehouseId),
      ))
      snapshot.docs.forEach(item => {
        if (!rows.has(item.id)) rows.set(item.id, { ...item.data(), id: item.id })
      })
      selection = selectEquivalentWarehouseBalance(Array.from(rows.values()), input)
    } catch {
      // The exact/NFC/NFD lookup above still preserves the old behavior if a
      // legacy environment cannot run the compatibility query.
    }

    return Array.from(rows.values())
  }

  async function resolveExportRequestInventoryLines(lines: any[]) {
    const balanceRowsByKey = new Map<string, Promise<any[]>>()
    const resolved: any[] = []

    for (const line of lines) {
      const productId = productIdOf(line)
      const warehouseId = warehouseIdOf(line)
      const requestedLogo = inventoryLogoOf(line)
      const canonicalLogo = canonicalWarehouseLogo(requestedLogo)

      if (!productId || !warehouseId || !canonicalLogo) {
        resolved.push(line)
        continue
      }

      const key = `${warehouseId}\u0000${productId}\u0000${canonicalLogo}`
      if (!balanceRowsByKey.has(key)) {
        balanceRowsByKey.set(key, loadEquivalentBalanceRows({
          productId,
          warehouseId,
          logo: requestedLogo,
        }))
      }

      const rows = await balanceRowsByKey.get(key)!
      const selection = selectEquivalentWarehouseBalance(rows, {
        productId,
        warehouseId,
        logo: requestedLogo,
      })

      if (selection.ambiguous) {
        throw new Error(
          `Phát hiện nhiều dòng tồn đang cùng được hiểu là logo "${canonicalLogo}" cho sản phẩm này trong cùng kho. Vui lòng đối soát/gộp tồn logo trùng trước khi xuất để tránh trừ nhầm kho.`,
        )
      }

      if (!selection.balance) {
        resolved.push(line)
        continue
      }

      const resolvedLogo = String(selection.balance.logo ?? requestedLogo).trim()
      resolved.push({
        ...line,
        // Với xuất cho khách, source/target logo là cùng một logo. Giữ đúng
        // raw logo của balance cũ để transaction hash về đúng document đang có tồn.
        logo: resolvedLogo,
        source_logo: resolvedLogo,
        target_logo: resolvedLogo,
      })
    }

    return resolved
  }

  async function processExportRequestToExportOrder(input: any) {
    const fallbackWarehouse = input?.warehouse || null
    const linesWithWarehouse = (input?.lines || []).map((line: any) => ({
      ...line,
      fromWarehouse:
        line?.fromWarehouse
        || line?.warehouse
        || line?.from_warehouse_id
        || line?.warehouse_id
        || fallbackWarehouse,
    }))
    const alignedLines = alignExportRequestLineProducts(input?.request || {}, linesWithWarehouse)
    const lines = await resolveExportRequestInventoryLines(alignedLines)
    const preflightInput = { ...input, lines, warehouse: fallbackWarehouse }
    await checkExportStock(preflightInput, 'customer')
    try {
      return await base.processExportRequestToExportOrder(preflightInput)
    } catch (error: any) {
      if (String(error?.message || '').includes('Không đủ tồn theo lô')) {
        await checkExportStock(preflightInput, 'customer')
      }
      throw error
    }
  }

  return {
    ...base,
    createExportOrder,
    updateImportOrder,
    processExportRequestToExportOrder,
  }
}
