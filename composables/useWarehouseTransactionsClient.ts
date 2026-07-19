import { doc, getDoc } from 'firebase/firestore'
import { useWarehouseCostTransactions } from '~/composables/useWarehouseCostTransactions'
// @ts-ignore Shared ESM helper is also executed directly by Node client tests.
import {
  inventoryBalanceId,
  preflightExportStock,
} from '~/utils/warehouseExportPreflight.mjs'

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

  async function processExportRequestToExportOrder(input: any) {
    const fallbackWarehouse = input?.warehouse || null
    const lines = (input?.lines || []).map((line: any) => ({
      ...line,
      fromWarehouse:
        line?.fromWarehouse
        || line?.warehouse
        || line?.from_warehouse_id
        || line?.warehouse_id
        || fallbackWarehouse,
    }))
    const preflightInput = { ...input, lines, warehouse: fallbackWarehouse }
    await checkExportStock(preflightInput, 'customer')
    try {
      return await base.processExportRequestToExportOrder(input)
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
