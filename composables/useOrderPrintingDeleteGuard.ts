import { collection, getDocs, query, where } from 'firebase/firestore'
import type { OrderDoc, PrintOrderDoc } from '~/types/models'

function cleanIds(orders: OrderDoc[]) {
  return Array.from(new Set(
    (Array.isArray(orders) ? orders : [])
      .map(order => String(order?.id || '').trim())
      .filter(Boolean),
  ))
}

function chunks<T>(values: T[], size = 30) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

export function useOrderPrintingDeleteGuard() {
  const { db } = useFirebaseServices()

  async function fetchGroup(orderIds: string[]) {
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
    const ids = cleanIds(orders)
    if (!ids.length) return [] as PrintOrderDoc[]
    const groups = await Promise.all(chunks(ids).map(fetchGroup))
    const unique = new Map<string, PrintOrderDoc>()
    groups.flat().forEach(row => unique.set(row.id, row))
    return Array.from(unique.values())
  }

  async function loadPrintingProgressForOrder(orderId: string) {
    const id = String(orderId || '').trim()
    if (!id) return [] as PrintOrderDoc[]
    return fetchGroup([id])
  }

  return {
    loadPrintingProgressForOrders,
    loadPrintingProgressForOrder,
  }
}
