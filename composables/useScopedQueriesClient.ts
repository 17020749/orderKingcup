import {
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import type {
  OrderDoc,
  OrderItemDoc,
  ProductDoc,
  SupplierDoc,
  UnitDoc,
  WarehouseDoc,
} from '~/types/models'
import { QUERY_CACHE_POLICIES } from '~/constants/cachePolicies'
import { isActive } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
import { permissionDebug } from '~/utils/permissionDebug'
// @ts-ignore Shared ESM helpers are executed directly by Node client tests.
import {
  chunkOrderIds,
  filterItemsForVisibleOrders,
  orderItemQueryKey,
  SAFE_RELATION_QUERY_CHUNK_SIZE,
  uniqueOrderIds,
} from '~/utils/orderItemScope.mjs'
import {
  invalidateScopedCache as invalidateBaseScopedCache,
  useScopedQueries as useScopedQueriesBase,
} from '~/composables/useScopedQueries'

const inFlightOrderItems = new Map<string, Promise<OrderItemDoc[]>>()

export function invalidateScopedQueriesClientCache(collectionName?: string) {
  invalidateBaseScopedCache(collectionName)
  if (!collectionName || collectionName === 'order_items') inFlightOrderItems.clear()
}

export function useScopedQueriesClient() {
  const base = useScopedQueriesBase()
  const { db } = useFirebaseServices()
  const { appUser, hasPermission } = useAuth()
  const { showToast } = useUi()
  const { loadReferenceList } = useReferenceDataCache()

  function hasAnyPermission(keys: string[]) {
    return hasPermission('*') || keys.some(key => hasPermission(key))
  }

  async function fetchCollection<T>(name: string) {
    const snapshot = await getDocs(query(collection(db, name)))
    return snapshot.docs.map(item => ({
      ...item.data(),
      id: item.id,
      firestore_id: item.id,
    } as T))
  }

  function sortCatalogRows<T extends Record<string, any>>(rows: T[]) {
    return [...rows]
      .filter(row => row.deleted !== true)
      .sort((a, b) => String(
        a.name || a.warehouse_name || a.supplier_name || '',
      ).localeCompare(String(
        b.name || b.warehouse_name || b.supplier_name || '',
      ), 'vi'))
  }

  async function loadProducts(force = false, includeInactive = false) {
    if (!hasAnyPermission(['products.view', 'inventory.view', 'printing.view'])) return [] as ProductDoc[]
    try {
      return await loadReferenceList<ProductDoc>({
        collectionName: 'products',
        params: { view: 'all', includeInactive },
        policy: QUERY_CACHE_POLICIES.referenceList,
        force,
        fetcher: async () => {
          const rows = await fetchCollection<ProductDoc>('products')
          const visibleRows = includeInactive
            ? rows.filter(row => row.deleted !== true && !['deleted', 'da xoa'].includes(String(row.status || '').trim().toLowerCase()))
            : rows.filter(isActive)
          return visibleRows.sort((a, b) =>
            String(a.product_name || '').localeCompare(String(b.product_name || ''), 'vi')
          )
        },
      })
    } catch (error) {
      showToast(reportFirebaseError(error, 'Không tải được dữ liệu products.'), 'error')
      return [] as ProductDoc[]
    }
  }

  async function loadWarehouses(force = false) {
    if (!hasAnyPermission([
      'warehouses.view', 'warehouses.manage', 'import.view', 'export.view',
      'inventory.view', 'page.warehouse_export_requests', 'export_requests.accept',
      'export_requests.release', 'export_requests.process',
    ])) return [] as WarehouseDoc[]
    try {
      return await loadReferenceList<WarehouseDoc>({
        collectionName: 'warehouses',
        params: { view: 'all' },
        policy: QUERY_CACHE_POLICIES.referenceCatalog,
        force,
        fetcher: async () => sortCatalogRows(await fetchCollection<WarehouseDoc>('warehouses')),
      })
    } catch (error) {
      showToast(reportFirebaseError(error, 'Không tải được dữ liệu warehouses.'), 'error')
      return [] as WarehouseDoc[]
    }
  }

  async function loadSuppliers(force = false) {
    if (!hasAnyPermission(['suppliers.view', 'suppliers.manage', 'import.view', 'printing.view'])) {
      return [] as SupplierDoc[]
    }
    try {
      return await loadReferenceList<SupplierDoc>({
        collectionName: 'suppliers',
        params: { view: 'all' },
        policy: QUERY_CACHE_POLICIES.referenceCatalog,
        force,
        fetcher: async () => sortCatalogRows(await fetchCollection<SupplierDoc>('suppliers')),
      })
    } catch (error) {
      showToast(reportFirebaseError(error, 'Không tải được dữ liệu suppliers.'), 'error')
      return [] as SupplierDoc[]
    }
  }

  async function loadUnits(force = false) {
    if (!hasAnyPermission([
      'units.view', 'units.manage', 'products.view', 'import.view',
      'export.view', 'inventory.view',
    ])) return [] as UnitDoc[]
    try {
      return await loadReferenceList<UnitDoc>({
        collectionName: 'units',
        params: { view: 'all' },
        policy: QUERY_CACHE_POLICIES.referenceCatalog,
        force,
        fetcher: async () => sortCatalogRows(await fetchCollection<UnitDoc>('units')),
      })
    } catch (error) {
      showToast(reportFirebaseError(error, 'Không tải được dữ liệu units.'), 'error')
      return [] as UnitDoc[]
    }
  }

  async function loadScopedOrderItems(orders: OrderDoc[], force = false) {
    if (hasPermission('*') || hasPermission('orders.view_all')) {
      return base.loadScopedOrderItems(orders, force)
    }

    if (!hasPermission('orders.view') && !hasPermission('printing.orders_view') && !hasPermission('customers.orders_view')) {
      return [] as OrderItemDoc[]
    }

    const orderIds = uniqueOrderIds(orders)
    if (!orderIds.length) return [] as OrderItemDoc[]

    const activeEmail = String(appUser.value?.email || '').trim().toLowerCase()
    const requestKey = orderItemQueryKey(activeEmail, orderIds)
    if (!force) {
      const pending = inFlightOrderItems.get(requestKey)
      if (pending) return pending
    }

    const task = (async () => {
      try {
        const chunks = chunkOrderIds(orderIds, SAFE_RELATION_QUERY_CHUNK_SIZE)
        const results = await Promise.allSettled(chunks.map(group => (
          getDocs(query(
            collection(db, 'order_items'),
            where('order_id', 'in', group),
          ))
        )))
        const snapshots = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
        const failedGroups = results.reduce<Array<{ ids: string[]; reason: unknown }>>((failed, result, index) => {
          if (result.status === 'rejected') failed.push({ ids: chunks[index], reason: result.reason })
          return failed
        }, [])
        const rows = snapshots.flatMap(snapshot => snapshot.docs.map(item => ({
          ...item.data(),
          id: item.id,
          firestore_id: item.id,
        } as OrderItemDoc)))
        const visibleRows = filterItemsForVisibleOrders(rows, orderIds) as OrderItemDoc[]

        if (failedGroups.length) {
          failedGroups.forEach(({ ids, reason }, index) => {
            permissionDebug({
              module: 'order_items',
              action: 'query_by_order_id',
              stage: 'query_denied',
              userEmail: activeEmail,
              error: reason,
              payload: {
                failed_order_ids: ids,
                query_group_index: index,
                query_group_size: ids.length,
              },
              note: 'A query group failed; successful groups remain visible.',
            })
          })

          const failedIds = failedGroups.flatMap(group => group.ids)
          const suffix = failedIds.length > 5
            ? ` (${failedIds.slice(0, 5).join(', ')} and ${failedIds.length - 5} more)`
            : ` (${failedIds.join(', ')})`
          showToast(
            reportFirebaseError(
              failedGroups[0].reason,
              `Orders loaded, but product lines failed for ${failedIds.length} order(s)${suffix}.`,
            ),
            'error',
          )
        }

        permissionDebug({
          module: 'order_items',
          action: 'query_by_order_id',
          stage: failedGroups.length ? 'partial' : 'success',
          userEmail: activeEmail,
          payload: {
            visible_order_count: orderIds.length,
            query_chunk_count: chunks.length,
            query_chunk_size: SAFE_RELATION_QUERY_CHUNK_SIZE,
            failed_group_count: failedGroups.length,
            failed_order_ids: failedGroups.flatMap(group => group.ids),
            item_count: visibleRows.length,
          },
          note: 'Dòng sản phẩm được tải theo order_id của các đơn đã qua kiểm tra quyền; không phụ thuộc email sao chép trong dữ liệu legacy.',
        })
        return visibleRows
      } catch (error) {
        permissionDebug({
          module: 'order_items',
          action: 'query_by_order_id',
          stage: 'query_denied',
          userEmail: activeEmail,
          error,
          payload: { visible_order_ids: orderIds },
          note: 'Đơn đã tải được nhưng Firestore từ chối truy vấn dòng sản phẩm theo order_id.',
        })
        showToast(
          reportFirebaseError(
            error,
            'Không tải được sản phẩm của các đơn hàng đã được phép xem.',
          ),
          'error',
        )
        return [] as OrderItemDoc[]
      } finally {
        inFlightOrderItems.delete(requestKey)
      }
    })()

    inFlightOrderItems.set(requestKey, task)
    return task
  }

  function invalidateScopedCache(collectionName?: string) {
    invalidateScopedQueriesClientCache(collectionName)
  }

  return {
    ...base,
    loadProducts,
    loadWarehouses,
    loadSuppliers,
    loadUnits,
    loadScopedOrderItems,
    invalidateScopedCache,
  }
}
