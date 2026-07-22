import {
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import type { OrderDoc, OrderItemDoc } from '~/types/models'
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
    loadScopedOrderItems,
    invalidateScopedCache,
  }
}
