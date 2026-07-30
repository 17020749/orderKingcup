import {
  collection,
  getDocs,
  limit as queryLimit,
  onSnapshot,
  orderBy,
  or,
  query,
  startAfter,
  where,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore'
import type { OrderDoc } from '~/types/models'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import {
  EXPORT_REQUEST_HISTORY_PAGE_SIZE,
  EXPORT_REQUEST_WINDOW_OWNER_FIELDS,
  EXPORT_REQUEST_QUEUE_LIMIT,
  EXPORT_REQUEST_QUEUE_PAGE_SIZE,
  EXPORT_REQUEST_WINDOW_STATES,
  isVisibleExportRequest,
  mergeExportRequestWindows,
  safeExportRequestPageSize,
} from '~/utils/exportRequestWindow.mjs'

export type ExportRequestPage = {
  rows: any[]
  cursor: QueryDocumentSnapshot<DocumentData> | null
  hasMore: boolean
}

type RealtimeRowsHandler = (
  rows: any[],
  cursor: QueryDocumentSnapshot<DocumentData> | null,
) => void
type RealtimeErrorHandler = (error: any) => void

type OrderRequestCacheEntry = {
  expiresAt: number
  rows: any[]
}

const orderRequestCache = new Map<string, OrderRequestCacheEntry>()
const ORDER_REQUEST_CACHE_TTL_MS = 20_000

export function clearExportRequestOrderCache() {
  orderRequestCache.clear()
}

function listenerErrorCode(error: any) {
  return String(error?.code || '').replace(/^firestore\//, '')
}

function isRetryableListenerError(error: any) {
  return [
    'aborted',
    'cancelled',
    'deadline-exceeded',
    'internal',
    'resource-exhausted',
    'unavailable',
    'unknown',
  ].includes(listenerErrorCode(error))
}

function listenQueryWithRetry(
  target: Query<DocumentData>,
  onRows: RealtimeRowsHandler,
  onError: RealtimeErrorHandler,
): Unsubscribe {
  let active = true
  let unsubscribe: Unsubscribe | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryAttempt = 0
  const retryDelays = [1000, 2000, 5000, 10000, 30000]

  const connect = () => {
    if (!active) return
    unsubscribe = onSnapshot(
      target,
      snapshot => {
        if (!active) return
        retryAttempt = 0
        clearExportRequestOrderCache()
        const rows = snapshot.docs.map(item => ({
          ...item.data(),
          id: item.id,
          firestore_id: item.id,
        }))
        onRows(rows, snapshot.docs.at(-1) || null)
      },
      error => {
        if (!active) return
        unsubscribe = null
        onError(error)
        if (!isRetryableListenerError(error)) return
        const delay = retryDelays[Math.min(retryAttempt, retryDelays.length - 1)]
        retryAttempt += 1
        retryTimer = setTimeout(() => {
          retryTimer = null
          connect()
        }, delay)
      },
    )
  }

  connect()
  return () => {
    active = false
    unsubscribe?.()
    unsubscribe = null
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
  }
}

export function useExportRequestQueries() {
  const { db } = useFirebaseServices()
  const { appUser, authorizationCacheKey, hasPermission } = useAuth()

  function email() {
    return String(appUser.value?.email || '').trim().toLowerCase()
  }

  function canAll(permission: string) {
    return hasPermission('*') || hasPermission(permission)
  }

  function canReadScopedRequests() {
    return canAll('export_requests.view_all')
      || hasPermission('export_requests.view')
      || hasPermission('orders.warehouse_export')
      || hasPermission('orders.edit')
      || hasPermission('orders.delete')
  }

  function canReadWarehouseRequests() {
    return canAll('page.warehouse_export_requests')
      || hasPermission('export_requests.accept')
      || hasPermission('export_requests.reject')
      || hasPermission('export_requests.release')
      || hasPermission('export_requests.process')
  }

  function ownerFilter(currentEmail: string) {
    return or(...EXPORT_REQUEST_WINDOW_OWNER_FIELDS.map(field => where(field, '==', currentEmail)))
  }

  function visibleScopedRows(rows: any[], orders: OrderDoc[]) {
    if (canAll('export_requests.view_all')) {
      return mergeExportRequestWindows(rows.filter(isVisibleExportRequest), [])
    }
    const currentEmail = email()
    const ownedOrderIds = new Set(orders.map(order => String(order?.id || '').trim()).filter(Boolean))
    return mergeExportRequestWindows(rows.filter(row => (
      isVisibleExportRequest(row)
      && (
        EXPORT_REQUEST_WINDOW_OWNER_FIELDS.some(field => (
          String(row?.[field] || '').trim().toLowerCase() === currentEmail
        ))
        || ownedOrderIds.has(String(row?.order_id || '').trim())
      )
    )), [])
  }

  function scopedQueueQuery() {
    const currentEmail = email()
    if (!currentEmail) return null
    return query(
      collection(db, 'order_export_requests'),
      where('window_state', '==', EXPORT_REQUEST_WINDOW_STATES.queue),
      ownerFilter(currentEmail),
      orderBy('sort_at', 'desc'),
      queryLimit(EXPORT_REQUEST_QUEUE_LIMIT),
    )
  }

  function warehouseQueueQuery() {
    return query(
      collection(db, 'order_export_requests'),
      where('window_state', '==', EXPORT_REQUEST_WINDOW_STATES.queue),
      orderBy('sort_at', 'desc'),
      queryLimit(EXPORT_REQUEST_QUEUE_LIMIT),
    )
  }

  function listenScopedExportRequests(
    orders: OrderDoc[],
    onRows: RealtimeRowsHandler,
    onError: RealtimeErrorHandler,
  ): Unsubscribe {
    if (!canReadScopedRequests()) {
      onRows([], null)
      return () => {}
    }

    const target = canAll('export_requests.view_all')
      ? warehouseQueueQuery()
      : scopedQueueQuery()
    if (!target) {
      onRows([], null)
      return () => {}
    }

    return listenQueryWithRetry(
      target,
      (rows, cursor) => onRows(visibleScopedRows(rows, orders), cursor),
      onError,
    )
  }

  function listenWarehouseExportRequests(
    onRows: RealtimeRowsHandler,
    onError: RealtimeErrorHandler,
  ): Unsubscribe {
    if (!canReadWarehouseRequests()) {
      onRows([], null)
      return () => {}
    }

    return listenQueryWithRetry(
      warehouseQueueQuery(),
      (rows, cursor) => onRows(
        mergeExportRequestWindows(rows.filter(isVisibleExportRequest), []),
        cursor,
      ),
      onError,
    )
  }

  async function fetchWindowPage(input: {
    windowState: string
    scoped: boolean
    orders?: OrderDoc[]
    cursor?: QueryDocumentSnapshot<DocumentData> | null
    pageSize?: number
  }): Promise<ExportRequestPage> {
    const safeSize = safeExportRequestPageSize(input.pageSize, EXPORT_REQUEST_HISTORY_PAGE_SIZE)
    const constraints: any[] = [
      where('window_state', '==', input.windowState),
    ]
    if (input.scoped && !canAll('export_requests.view_all')) {
      const currentEmail = email()
      if (!currentEmail) return { rows: [], cursor: null, hasMore: false }
      constraints.push(ownerFilter(currentEmail))
    }
    constraints.push(orderBy('sort_at', 'desc'))
    if (input.cursor) constraints.push(startAfter(input.cursor))
    constraints.push(queryLimit(safeSize + 1))

    const snapshot = await getDocs(query(
      collection(db, 'order_export_requests'),
      ...constraints,
    ))
    const pageDocs = snapshot.docs.slice(0, safeSize)
    const rawRows = pageDocs.map(item => ({
      ...item.data(),
      id: item.id,
      firestore_id: item.id,
    }))
    const rows = input.scoped
      ? visibleScopedRows(rawRows, input.orders || [])
      : mergeExportRequestWindows(rawRows.filter(isVisibleExportRequest), [])

    return {
      rows,
      cursor: pageDocs.at(-1) || null,
      hasMore: snapshot.docs.length > safeSize,
    }
  }

  async function loadScopedExportRequestHistoryPage(
    orders: OrderDoc[] = [],
    cursor: QueryDocumentSnapshot<DocumentData> | null = null,
    pageSize = EXPORT_REQUEST_HISTORY_PAGE_SIZE,
  ) {
    if (!canReadScopedRequests()) return { rows: [], cursor: null, hasMore: false }
    return fetchWindowPage({
      windowState: EXPORT_REQUEST_WINDOW_STATES.history,
      scoped: true,
      orders,
      cursor,
      pageSize,
    })
  }

  async function loadWarehouseExportRequestHistoryPage(
    cursor: QueryDocumentSnapshot<DocumentData> | null = null,
    pageSize = EXPORT_REQUEST_HISTORY_PAGE_SIZE,
  ) {
    if (!canReadWarehouseRequests()) return { rows: [], cursor: null, hasMore: false }
    return fetchWindowPage({
      windowState: EXPORT_REQUEST_WINDOW_STATES.history,
      scoped: false,
      cursor,
      pageSize,
    })
  }

  async function loadScopedExportRequestQueuePage(
    orders: OrderDoc[] = [],
    cursor: QueryDocumentSnapshot<DocumentData> | null = null,
    pageSize = EXPORT_REQUEST_QUEUE_PAGE_SIZE,
  ) {
    if (!canReadScopedRequests() || !cursor) return { rows: [], cursor: null, hasMore: false }
    return fetchWindowPage({
      windowState: EXPORT_REQUEST_WINDOW_STATES.queue,
      scoped: true,
      orders,
      cursor,
      pageSize,
    })
  }

  async function loadWarehouseExportRequestQueuePage(
    cursor: QueryDocumentSnapshot<DocumentData> | null = null,
    pageSize = EXPORT_REQUEST_QUEUE_PAGE_SIZE,
  ) {
    if (!canReadWarehouseRequests() || !cursor) return { rows: [], cursor: null, hasMore: false }
    return fetchWindowPage({
      windowState: EXPORT_REQUEST_WINDOW_STATES.queue,
      scoped: false,
      cursor,
      pageSize,
    })
  }

  async function loadExportRequestsForOrder(orderId: string, force = false) {
    const id = String(orderId || '').trim()
    if (!id || !canReadScopedRequests()) return [] as any[]

    const cacheKey = `${String(authorizationCacheKey.value || 'anonymous')}:${id}`
    const cached = orderRequestCache.get(cacheKey)
    if (!force && cached && cached.expiresAt > Date.now()) return cached.rows

    const snapshot = await getDocs(query(
      collection(db, 'order_export_requests'),
      where('order_id', '==', id),
    ))
    const rows = mergeExportRequestWindows(
      snapshot.docs.map(item => ({
        ...item.data(),
        id: item.id,
        firestore_id: item.id,
      })).filter(isVisibleExportRequest),
      [],
    )
    orderRequestCache.set(cacheKey, {
      expiresAt: Date.now() + ORDER_REQUEST_CACHE_TTL_MS,
      rows,
    })
    return rows
  }

  function invalidateExportRequestsForOrder(orderId?: string) {
    const id = String(orderId || '').trim()
    const authPrefix = `${String(authorizationCacheKey.value || 'anonymous')}:`
    for (const key of Array.from(orderRequestCache.keys())) {
      if (!key.startsWith(authPrefix)) continue
      if (!id || key === `${authPrefix}${id}`) orderRequestCache.delete(key)
    }
  }

  return {
    listenScopedExportRequests,
    listenWarehouseExportRequests,
    loadScopedExportRequestHistoryPage,
    loadWarehouseExportRequestHistoryPage,
    loadScopedExportRequestQueuePage,
    loadWarehouseExportRequestQueuePage,
    loadExportRequestsForOrder,
    invalidateExportRequestsForOrder,
  }
}
