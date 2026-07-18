import {
  collection,
  getDocs,
  or,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore'
import type {
  OrderDoc,
  OrderItemDoc,
  PrintOrderDoc,
  PrintOrderItemDoc,
} from '~/types/models'
import { isActive } from '~/utils/format'

function uniqueById<T extends { id?: string }>(rows: T[]) {
  const result = new Map<string, T>()
  rows.forEach(row => {
    if (row.id) result.set(row.id, row)
  })
  return Array.from(result.values())
}

function chunks<T>(values: T[], size = 30) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

export function usePrintingScopedQueries() {
  const { db } = useFirebaseServices()
  const { appUser, hasPermission } = useAuth()

  const currentEmail = () => String(appUser.value?.email || '').trim().toLowerCase()
  const canViewAll = () => hasPermission('*') || hasPermission('printing.view_all')

  async function fetchRows<T>(name: string, constraints: QueryConstraint[] = []) {
    const snapshot = await getDocs(query(collection(db, name), ...constraints))
    return snapshot.docs.map(item => ({
      ...item.data(),
      id: item.id,
      firestore_id: item.id,
    } as T))
  }

  async function fetchByIds<T>(name: string, field: string, ids: string[]) {
    const cleanIds = Array.from(new Set(ids.map(id => String(id || '').trim()).filter(Boolean)))
    if (!cleanIds.length) return [] as T[]
    const groups = await Promise.all(
      chunks(cleanIds).map(group => fetchRows<T>(name, [where(field, 'in', group)])),
    )
    return uniqueById(groups.flat() as Array<T & { id?: string }>) as T[]
  }

  async function loadOwnSourceOrders() {
    const email = currentEmail()
    if (!email || !hasPermission('printing.orders_view')) return [] as OrderDoc[]
    const filter = or(
      where('owner_email', '==', email),
      where('created_by', '==', email),
      where('sale_email', '==', email),
    )
    return uniqueById(await fetchRows<OrderDoc>('orders', [filter]))
      .filter(isActive)
      .sort((left, right) => String(right.order_date || right.created_at || '').localeCompare(String(left.order_date || left.created_at || '')))
  }

  async function loadPrintingSourceOrders(_force = false) {
    if (canViewAll()) {
      return (await fetchRows<OrderDoc>('orders'))
        .filter(isActive)
        .sort((left, right) => String(right.order_date || right.created_at || '').localeCompare(String(left.order_date || left.created_at || '')))
    }
    return loadOwnSourceOrders()
  }

  async function loadPrintingSourceOrderItems(_force = false) {
    const sourceOrders = await loadPrintingSourceOrders()
    return (await fetchByIds<OrderItemDoc>('order_items', 'order_id', sourceOrders.map(order => order.id)))
      .filter(isActive)
  }

  async function loadPrintOrders(_force = false) {
    if (canViewAll()) {
      return (await fetchRows<PrintOrderDoc>('print_orders'))
        .filter(isActive)
        .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))
    }

    const groups: PrintOrderDoc[][] = []
    const email = currentEmail()
    if (email && hasPermission('printing.view')) {
      groups.push(await fetchRows<PrintOrderDoc>('print_orders', [where('created_by', '==', email)]))
    }
    if (hasPermission('printing.orders_view')) {
      const sourceOrders = await loadOwnSourceOrders()
      groups.push(await fetchByIds<PrintOrderDoc>('print_orders', 'order_id', sourceOrders.map(order => order.id)))
    }

    return uniqueById(groups.flat())
      .filter(isActive)
      .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))
  }

  async function loadPrintOrderItems(_force = false) {
    const printOrders = await loadPrintOrders()
    return (await fetchByIds<PrintOrderItemDoc>('print_order_items', 'print_order_id', printOrders.map(order => order.id)))
      .filter(isActive)
  }

  return {
    loadPrintOrders,
    loadPrintOrderItems,
    loadPrintingSourceOrders,
    loadPrintingSourceOrderItems,
  }
}
