import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import { useWarehouseCostTransactions } from '~/composables/useWarehouseCostTransactions'
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

export function useWarehouseTransactionsClient() {
  const base = useWarehouseCostTransactions()
  const { db } = useFirebaseServices()

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
    processExportRequestToExportOrder,
  }
}
