import { collection, getDocs, query, where } from 'firebase/firestore'
import type { OrderDoc, PrintOrderDoc, PrintOrderItemDoc } from '~/types/models'
import { isActive } from '~/utils/format'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { SAFE_RELATION_QUERY_CHUNK_SIZE } from '~/utils/orderItemScope.mjs'

function cleanIds(orders: OrderDoc[]) {
  return Array.from(new Set(
    (Array.isArray(orders) ? orders : [])
      .map(order => String(order?.id || '').trim())
      .filter(Boolean),
  ))
}

function chunks<T>(values: T[], size = SAFE_RELATION_QUERY_CHUNK_SIZE) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

export function useOrderPrintingDeleteGuard() {
  const { db } = useFirebaseServices()
  const { hasPermission } = useAuth()

  function canReadOrderPrintingDependencies() {
    return hasPermission('*')
      || hasPermission('orders.edit')
      || hasPermission('orders.delete')
      || hasPermission('printing.orders_view')
      || hasPermission('printing.view_all')
  }

  async function fetchGroup(orderIds: string[]) {
    if (!canReadOrderPrintingDependencies()) return [] as PrintOrderDoc[]
    const snapshot = await getDocs(query(
      collection(db, 'print_orders'),
      where('order_id', 'in', orderIds),
    ))
    return snapshot.docs.map(item => ({
      ...item.data(),
      id: item.id,
      firestore_id: item.id,
    } as PrintOrderDoc))
  }

  async function loadPrintingProgressForOrders(orders: OrderDoc[]) {
    if (!canReadOrderPrintingDependencies()) return [] as PrintOrderDoc[]
    const ids = cleanIds(orders)
    if (!ids.length) return [] as PrintOrderDoc[]
    const groups = await Promise.all(chunks(ids).map(fetchGroup))
    const unique = new Map<string, PrintOrderDoc>()
    groups.flat().forEach(row => unique.set(row.id, row))
    return Array.from(unique.values())
  }

  async function loadPrintingProgressForOrder(orderId: string) {
    if (!canReadOrderPrintingDependencies()) return [] as PrintOrderDoc[]
    const id = String(orderId || '').trim()
    if (!id) return [] as PrintOrderDoc[]
    return fetchGroup([id])
  }

  async function loadPrintingDependenciesForOrders(orders: OrderDoc[]) {
    if (!canReadOrderPrintingDependencies()) {
      return { printOrders: [] as PrintOrderDoc[], printItems: [] as PrintOrderItemDoc[] }
    }
    // Child Rules intentionally deny items whose parent progress was deleted.
    // Excluding inactive parents before building the `in` query keeps one
    // historical soft-delete from rejecting the entire order-list load.
    const printOrders = (await loadPrintingProgressForOrders(orders)).filter(isActive)
    const printOrderIds = printOrders.map(row => row.id).filter(Boolean)
    if (!printOrderIds.length) return { printOrders, printItems: [] as PrintOrderItemDoc[] }

    const groups = await Promise.all(chunks(printOrderIds).map(async ids => {
      const snapshot = await getDocs(query(
        collection(db, 'print_order_items'),
        where('print_order_id', 'in', ids),
      ))
      return snapshot.docs.map(item => ({
        ...item.data(),
        id: item.id,
        firestore_id: item.id,
      } as PrintOrderItemDoc))
    }))
    const unique = new Map<string, PrintOrderItemDoc>()
    groups.flat().forEach(row => unique.set(row.id, row))
    return { printOrders, printItems: Array.from(unique.values()) }
  }

  return {
    loadPrintingProgressForOrders,
    loadPrintingProgressForOrder,
    loadPrintingDependenciesForOrders,
  }
}
