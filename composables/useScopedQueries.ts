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
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe
} from 'firebase/firestore'
import type {
  AnyDoc,
  CustomerDoc,
  ExportOrderDoc,
  ExportOrderItemDoc,
  ImportOrderDoc,
  ImportOrderItemDoc,
  InventoryAdjustmentDoc,
  InventoryBalanceDoc,
  InvoiceDoc,
  OrderDoc,
  OrderItemDoc,
  PaymentDoc,
  PrintOrderDoc,
  PrintOrderItemDoc,
  ProductDoc,
  ShipmentDoc,
  StockMovementDoc,
  SupplierDoc,
  UnitDoc,
  WarehouseDoc
} from '~/types/models'
import { isActive } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
import { permissionDebug } from '~/utils/permissionDebug'

type CacheEntry = {
  expiresAt: number
  rows: AnyDoc[]
}

type ListOptions = {
  cacheKey?: string
  ttlMs?: number
  force?: boolean
  silent?: boolean
}

type RealtimeRowsHandler<T extends AnyDoc> = (rows: T[]) => void
type RealtimeErrorHandler = (error: any) => void

export type CursorPage<T extends AnyDoc> = {
  rows: T[]
  cursor: QueryDocumentSnapshot<DocumentData> | null
  hasMore: boolean
  mode: 'cursor' | 'full'
}

export const EXPORT_REQUEST_OWNER_FIELDS = [
  'requested_by',
  'order_owner_email',
  'order_created_by',
  'order_sale_email',
]

const memoryCache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<AnyDoc[]>>()
const STORAGE_PREFIX = 'kingcup.query-cache.v2.'

function uniqueById<T extends AnyDoc>(rows: T[]) {
  const map = new Map<string, T>()
  rows.forEach(row => {
    if (row.id) map.set(row.id, row)
  })
  return Array.from(map.values())
}

function sortNewest<T extends AnyDoc>(rows: T[], fallbackField = 'created_at') {
  return [...rows].sort((a, b) =>
    String(b.created_at || b[fallbackField] || '').localeCompare(String(a.created_at || a[fallbackField] || ''))
  )
}

function sortByName<T extends AnyDoc>(rows: T[]) {
  return [...rows].filter(row => row.deleted !== true).sort((a, b) =>
    String(a.name || a.warehouse_name || a.supplier_name || '').localeCompare(String(b.name || b.warehouse_name || b.supplier_name || ''), 'vi')
  )
}

function sortByWarehouseAndProduct<T extends AnyDoc>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const warehouseCompare = String(a.warehouse_name || a.warehouse_id || '').localeCompare(String(b.warehouse_name || b.warehouse_id || ''), 'vi')
    if (warehouseCompare) return warehouseCompare
    const productCompare = String(a.product_name || a.product_code || '').localeCompare(String(b.product_name || b.product_code || ''), 'vi')
    if (productCompare) return productCompare
    return String(a.logo || '').localeCompare(String(b.logo || ''), 'vi')
  })
}

function storageKey(key: string) {
  return `${STORAGE_PREFIX}${key}`
}

function readCache<T extends AnyDoc>(key: string): T[] | null {
  const now = Date.now()
  const memory = memoryCache.get(key)
  if (memory && memory.expiresAt > now) return memory.rows as T[]
  if (memory) memoryCache.delete(key)

  if (import.meta.server) return null
  try {
    const raw = sessionStorage.getItem(storageKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry
    if (!parsed?.expiresAt || parsed.expiresAt <= now || !Array.isArray(parsed.rows)) {
      sessionStorage.removeItem(storageKey(key))
      return null
    }
    memoryCache.set(key, parsed)
    return parsed.rows as T[]
  } catch {
    return null
  }
}

function toSessionValue(value: any): any {
  if (value == null || typeof value !== 'object') return value
  if (typeof value.toDate === 'function') {
    const date = value.toDate()
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : String(value)
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(toSessionValue)
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, toSessionValue(item)])
  )
}

function writeCache(key: string, rows: AnyDoc[], ttlMs: number) {
  const entry: CacheEntry = { expiresAt: Date.now() + ttlMs, rows }
  memoryCache.set(key, entry)
  if (import.meta.server) return
  try {
    // Firestore Timestamp objects are converted to ISO strings only for
    // sessionStorage. The in-memory cache keeps the original SDK values.
    sessionStorage.setItem(storageKey(key), JSON.stringify({
      expiresAt: entry.expiresAt,
      rows: rows.map(row => toSessionValue(row))
    }))
  } catch {
    // sessionStorage can be full or disabled. Memory cache is enough as fallback.
  }
}

export function invalidateScopedCache(collectionName?: string) {
  const match = collectionName ? `:${collectionName}:` : ''
  for (const key of Array.from(memoryCache.keys())) {
    if (!collectionName || key.includes(match)) memoryCache.delete(key)
  }
  if (import.meta.server) return
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index)
      if (!key?.startsWith(STORAGE_PREFIX)) continue
      if (!collectionName || key.includes(match)) sessionStorage.removeItem(key)
    }
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function useScopedQueries() {
  const { db } = useFirebaseServices()
  const { appUser, hasPermission } = useAuth()
  const { showToast } = useUi()

  function email() {
    return String(appUser.value?.email || '').trim().toLowerCase()
  }

  function scopePrefix(name: string) {
    const scope = hasPermission('*') || appUser.value?.is_admin === true ? 'admin' : email()
    return `${scope}:${name}:`
  }

  function canAll(permission: string) {
    return hasPermission('*') || hasPermission(permission)
  }

  function isAdminUser() {
    return hasPermission('*') || appUser.value?.is_admin === true
  }


  function hasAnyWarehousePermission(keys: string[]) {
    return isAdminUser() || keys.some(key => hasPermission(key))
  }

  async function fetchCollection<T extends AnyDoc>(name: string, constraints: QueryConstraint[] = []) {
    const snap = await getDocs(query(collection(db, name), ...constraints))
    return snap.docs.map(d => ({ ...d.data(), id: d.id, firestore_id: d.id } as T))
  }


  function cleanIds(rows: Array<{ id?: string }>) {
    return Array.from(new Set(rows.map(row => String(row?.id || '').trim()).filter(Boolean)))
  }

  function chunks<T>(values: T[], size = 30) {
    const result: T[][] = []
    for (let index = 0; index < values.length; index += size) {
      result.push(values.slice(index, index + size))
    }
    return result
  }

  async function fetchByFieldValues<T extends AnyDoc>(name: string, field: string, values: string[]) {
    const cleanValues = Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)))
    if (!cleanValues.length) return [] as T[]
    const groups = await Promise.all(chunks(cleanValues).map(group => (
      fetchCollection<T>(name, [where(field, 'in', group)])
    )))
    return uniqueById(groups.flat() as T[])
  }

  async function fetchOrderedPage<T extends AnyDoc>(
    name: string,
    orderField: string,
    cursor: QueryDocumentSnapshot<DocumentData> | null = null,
    pageSize = 50,
  ): Promise<CursorPage<T>> {
    const safeSize = Math.min(100, Math.max(10, Math.trunc(pageSize) || 50))
    const constraints: QueryConstraint[] = [orderBy(orderField, 'desc')]
    if (cursor) constraints.push(startAfter(cursor))
    constraints.push(queryLimit(safeSize + 1))

    const snapshot = await getDocs(query(collection(db, name), ...constraints))
    const pageDocs = snapshot.docs.slice(0, safeSize)
    return {
      rows: pageDocs.map(item => ({
        ...item.data(),
        id: item.id,
        firestore_id: item.id,
      } as T)),
      cursor: pageDocs.at(-1) || null,
      hasMore: snapshot.docs.length > safeSize,
      mode: 'cursor',
    }
  }

  function fullCursorPage<T extends AnyDoc>(rows: T[]): CursorPage<T> {
    return { rows, cursor: null, hasMore: false, mode: 'full' }
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

  function listenQueryWithRetry<T extends AnyDoc>(
    target: Query<DocumentData>,
    onRows: RealtimeRowsHandler<T>,
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
          onRows(snapshot.docs.map(item => ({
            ...item.data(),
            id: item.id,
            firestore_id: item.id,
          } as T)))
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

  async function listCollection<T extends AnyDoc>(
    name: string,
    constraints: QueryConstraint[] = [],
    options: ListOptions = {}
  ) {
    const ttlMs = options.ttlMs ?? 30_000
    const key = options.cacheKey ? `${scopePrefix(name)}${options.cacheKey}` : ''

    if (key && !options.force) {
      const cached = readCache<T>(key)
      if (cached) return cached
      const pending = inFlight.get(key)
      if (pending) return pending as Promise<T[]>
    }

    const task = fetchCollection<T>(name, constraints)
      .then(rows => {
        if (key) writeCache(key, rows, ttlMs)
        return rows
      })
      .catch(error => {
        if (options.silent) throw error
        permissionDebug({
          module: name,
          action: 'query',
          stage: 'query_denied',
          userEmail: email(),
          error,
          payload: { constraint_count: constraints.length },
          note: 'Query chính bị Firestore Rules từ chối.'
        })
        const message = reportFirebaseError(error, `Không tải được dữ liệu ${name}.`)
        showToast(message, 'error')
        return [] as T[]
      })
      .finally(() => {
        if (key) inFlight.delete(key)
      })

    if (key) inFlight.set(key, task as Promise<AnyDoc[]>)
    return task
  }

  async function listByEmailFields<T extends AnyDoc>(
    name: string,
    fields: string[],
    force = false,
    ttlMs = 30_000
  ) {
    const currentEmail = email()
    if (!currentEmail || !fields.length) return []
    const cacheKey = `owner:${fields.join('|')}`
    const fullKey = `${scopePrefix(name)}${cacheKey}`

    if (!force) {
      const cached = readCache<T>(fullKey)
      if (cached) return cached.filter(isActive) as T[]
      const pending = inFlight.get(fullKey)
      if (pending) return (await pending as T[]).filter(isActive) as T[]
    }

    const task = (async () => {
      try {
        // One OR query is much faster for scoped users than three or four
        // independent network requests. Firestore still evaluates every
        // branch against the same ownership rules.
        const filter = or(...fields.map(field => where(field, '==', currentEmail)))
        const rows = await fetchCollection<T>(name, [filter])
        const unique = uniqueById(rows)
        writeCache(fullKey, unique, ttlMs)
        return unique
      } catch (orError) {
        // Older indexes/projects can reject an OR query. Fall back silently to
        // parallel equality queries so the UI stays compatible.
        try {
          const chunks = await Promise.all(
            fields.map(field => fetchCollection<T>(name, [where(field, '==', currentEmail)]))
          )
          const unique = uniqueById(chunks.flat())
          writeCache(fullKey, unique, ttlMs)
          return unique
        } catch (fallbackError) {
          permissionDebug({
            module: name,
            action: 'scoped_query',
            stage: 'query_denied',
            userEmail: currentEmail,
            error: fallbackError,
            payload: { fields },
            note: 'Cả OR query và query fallback đều bị từ chối.'
          })
          showToast(reportFirebaseError(fallbackError, `Không tải được dữ liệu ${name}.`), 'error')
          return [] as T[]
        }
      } finally {
        inFlight.delete(fullKey)
      }
    })()

    inFlight.set(fullKey, task as Promise<AnyDoc[]>)
    return (await task).filter(isActive) as T[]
  }

  async function loadScopedOrders(force = false) {
    if (canAll('orders.view_all')) {
      return sortNewest(
        (await listCollection<OrderDoc>('orders', [], {
          cacheKey: 'all', ttlMs: 20_000, force
        })).filter(isActive) as OrderDoc[],
        'order_date'
      )
    }
    if (!hasPermission('orders.view')) return []
    const rows = await listByEmailFields<OrderDoc>('orders', ['owner_email', 'created_by', 'sale_email'], force, 20_000)
    return sortNewest(rows, 'order_date')
  }

  async function loadScopedOrderItems(orders: OrderDoc[], force = false) {
    if (canAll('orders.view_all')) {
      const orderIds = cleanIds(orders)
      if (!orderIds.length) return [] as OrderItemDoc[]
      return (await fetchByFieldValues<OrderItemDoc>('order_items', 'order_id', orderIds))
        .filter(isActive) as OrderItemDoc[]
    }
    const orderIds = new Set(orders.map(order => order.id).filter(Boolean))
    if (!orderIds.size) return []

    const byEmail = await listByEmailFields<OrderItemDoc>(
      'order_items',
      ['owner_email', 'created_by', 'sale_email'],
      force,
      20_000
    )
    return uniqueById(byEmail).filter(item => isActive(item) && orderIds.has(item.order_id)) as OrderItemDoc[]
  }

  async function loadScopedPayments(orders: OrderDoc[] = [], force = false) {
    if (canAll('payments.view_all')) {
      return sortNewest(
        (await listCollection<PaymentDoc>('payments', [], {
          cacheKey: 'all', ttlMs: 20_000, force
        })).filter(isActive) as PaymentDoc[],
        'payment_date'
      )
    }
    if (!hasPermission('payments.view')) return []

    const orderIds = new Set(orders.map(order => order.id).filter(Boolean))
    const byEmail = await listByEmailFields<PaymentDoc>('payments', [
      'created_by',
      'order_owner_email',
      'order_created_by',
      'order_sale_email'
    ], force, 20_000)
    return sortNewest(uniqueById(byEmail).filter(payment =>
      isActive(payment)
      && (payment.created_by === email()
        || payment.order_owner_email === email()
        || payment.order_created_by === email()
        || payment.order_sale_email === email()
        || orderIds.has(payment.order_id))
    ) as PaymentDoc[], 'payment_date')
  }

  async function loadScopedExportRequests(orders: OrderDoc[] = [], force = false) {
    // Trang Kingcup chỉ tải toàn bộ khi user có quyền view_all rõ ràng.
    // Quyền export_requests.process được giữ cho nguồn Warehouse xử lý backend,
    // nhưng không tự động làm lộ phiếu của sale khác trên giao diện Kingcup.
    if (canAll('export_requests.view_all')) {
      return sortNewest(
        (await listCollection<AnyDoc>('order_export_requests', [], {
          cacheKey: 'all', ttlMs: 15_000, force
        })).filter(isActive),
        'requested_at'
      )
    }
    if (!hasPermission('export_requests.view') && !hasPermission('orders.warehouse_export') && !hasPermission('orders.edit')) return []

    const currentEmail = email()
    const ownedOrderIds = new Set(orders.map(order => order.id).filter(Boolean))
    const rows = await listByEmailFields<AnyDoc>(
      'order_export_requests',
      EXPORT_REQUEST_OWNER_FIELDS,
      force,
      15_000,
    )

    return sortNewest(uniqueById(rows).filter(row =>
      isActive(row)
      && (
        row.requested_by === currentEmail
        || row.order_owner_email === currentEmail
        || row.order_created_by === currentEmail
        || row.order_sale_email === currentEmail
        || ownedOrderIds.has(row.order_id)
      )
    ), 'requested_at')
  }


  async function loadScopedOrdersPage(
    cursor: QueryDocumentSnapshot<DocumentData> | null = null,
    pageSize = 50,
    force = false,
  ): Promise<CursorPage<OrderDoc>> {
    if (!canAll('orders.view_all')) return fullCursorPage(await loadScopedOrders(force))
    const page = await fetchOrderedPage<OrderDoc>('orders', 'created_at', cursor, pageSize)
    return { ...page, rows: page.rows.filter(isActive) as OrderDoc[] }
  }

  async function loadScopedPaymentsPage(
    orders: OrderDoc[] = [],
    cursor: QueryDocumentSnapshot<DocumentData> | null = null,
    pageSize = 50,
    force = false,
  ): Promise<CursorPage<PaymentDoc>> {
    if (!canAll('payments.view_all')) return fullCursorPage(await loadScopedPayments(orders, force))
    const page = await fetchOrderedPage<PaymentDoc>('payments', 'payment_date', cursor, pageSize)
    return { ...page, rows: page.rows.filter(isActive) as PaymentDoc[] }
  }

  async function loadScopedInvoicesPage(
    cursor: QueryDocumentSnapshot<DocumentData> | null = null,
    pageSize = 50,
    force = false,
  ): Promise<CursorPage<InvoiceDoc>> {
    if (!isAdminUser()) return fullCursorPage(await loadScopedInvoices(force))
    const page = await fetchOrderedPage<InvoiceDoc>('invoices', 'invoice_date', cursor, pageSize)
    return { ...page, rows: page.rows.filter(isActive) as InvoiceDoc[] }
  }

  async function loadScopedShipmentsPage(
    cursor: QueryDocumentSnapshot<DocumentData> | null = null,
    pageSize = 50,
    force = false,
  ): Promise<CursorPage<ShipmentDoc>> {
    if (!isAdminUser()) return fullCursorPage(await loadScopedShipments(force))
    const page = await fetchOrderedPage<ShipmentDoc>('shipments', 'shipped_date', cursor, pageSize)
    return { ...page, rows: page.rows.filter(isActive) as ShipmentDoc[] }
  }

  async function loadImportOrdersPage(
    cursor: QueryDocumentSnapshot<DocumentData> | null = null,
    pageSize = 50,
  ): Promise<CursorPage<ImportOrderDoc>> {
    if (!hasPermission('import.view') && !hasPermission('*')) return fullCursorPage([])
    const page = await fetchOrderedPage<ImportOrderDoc>('import_orders', 'import_date', cursor, pageSize)
    return { ...page, rows: page.rows.filter(isActive) as ImportOrderDoc[] }
  }

  async function loadExportOrdersPage(
    cursor: QueryDocumentSnapshot<DocumentData> | null = null,
    pageSize = 50,
  ): Promise<CursorPage<ExportOrderDoc>> {
    if (!hasPermission('export.view') && !hasPermission('*')) return fullCursorPage([])
    const page = await fetchOrderedPage<ExportOrderDoc>('export_orders', 'export_date', cursor, pageSize)
    return { ...page, rows: page.rows.filter(isActive) as ExportOrderDoc[] }
  }

  async function loadInventoryAdjustmentsPage(
    cursor: QueryDocumentSnapshot<DocumentData> | null = null,
    pageSize = 50,
  ): Promise<CursorPage<InventoryAdjustmentDoc>> {
    if (!hasAnyWarehousePermission(['inventory.view', 'inventory.adjust'])) return fullCursorPage([])
    const page = await fetchOrderedPage<InventoryAdjustmentDoc>('inventory_adjustments', 'adjustment_date', cursor, pageSize)
    return { ...page, rows: page.rows.filter(isActive) as InventoryAdjustmentDoc[] }
  }

  async function loadScopedPaymentsForOrders(orders: OrderDoc[], force = false) {
    const orderIds = cleanIds(orders)
    if (!orderIds.length) return [] as PaymentDoc[]
    const canReadForRelation = canAll('payments.view_all')
      || ['payments.view', 'payments.create', 'payments.edit', 'payments.delete'].some(key => hasPermission(key))
    if (!canReadForRelation) return [] as PaymentDoc[]
    return sortNewest(
      (await fetchByFieldValues<PaymentDoc>('payments', 'order_id', orderIds)).filter(isActive) as PaymentDoc[],
      'payment_date',
    )
  }

  async function loadScopedExportRequestsForOrders(orders: OrderDoc[], force = false) {
    const orderIds = cleanIds(orders)
    if (!orderIds.length) return [] as AnyDoc[]
    if (!canAll('export_requests.view_all')) {
      const visible = await loadScopedExportRequests(orders, force)
      const allowedOrderIds = new Set(orderIds)
      return visible.filter(request => allowedOrderIds.has(request.order_id))
    }
    return sortNewest(
      (await fetchByFieldValues<AnyDoc>('order_export_requests', 'order_id', orderIds)).filter(isActive),
      'requested_at',
    )
  }

  async function loadImportOrderItemsForOrders(orders: ImportOrderDoc[]) {
    if (!hasPermission('import.view') && !hasPermission('*')) return [] as ImportOrderItemDoc[]
    return (await fetchByFieldValues<ImportOrderItemDoc>(
      'import_order_items',
      'import_order_id',
      cleanIds(orders),
    )).filter(isActive) as ImportOrderItemDoc[]
  }

  async function loadExportOrderItemsForOrders(orders: ExportOrderDoc[]) {
    if (!hasPermission('export.view') && !hasPermission('*')) return [] as ExportOrderItemDoc[]
    return (await fetchByFieldValues<ExportOrderItemDoc>(
      'export_order_items',
      'export_order_id',
      cleanIds(orders),
    )).filter(isActive) as ExportOrderItemDoc[]
  }

  async function loadWarehouseExportRequests(force = false) {
    if (!hasAnyWarehousePermission([
      'page.warehouse_export_requests',
      'export_requests.accept',
      'export_requests.reject',
      'export_requests.release',
      'export_requests.process'
    ])) return []
    return sortNewest(
      (await listCollection<AnyDoc>('order_export_requests', [], {
        cacheKey: 'warehouse-all', ttlMs: 15_000, force
      })).filter(isActive),
      'requested_at'
    )
  }

  function listenScopedExportRequests(
    orders: OrderDoc[],
    onRows: RealtimeRowsHandler<AnyDoc>,
    onError: RealtimeErrorHandler,
  ): Unsubscribe {
    const publish = (rows: AnyDoc[]) => {
      const currentEmail = email()
      const ownedOrderIds = new Set(orders.map(order => order.id).filter(Boolean))
      const visibleRows = canAll('export_requests.view_all')
        ? rows
        : rows.filter(row => (
          EXPORT_REQUEST_OWNER_FIELDS.some(field => (
            String(row[field] || '').trim().toLowerCase() === currentEmail
          ))
          || ownedOrderIds.has(row.order_id)
        ))
      invalidateScopedCache('order_export_requests')
      onRows(sortNewest(uniqueById(visibleRows).filter(isActive), 'requested_at'))
    }

    if (canAll('export_requests.view_all')) {
      return listenQueryWithRetry(
        query(collection(db, 'order_export_requests')),
        publish,
        onError,
      )
    }
    if (!hasPermission('export_requests.view') && !hasPermission('orders.warehouse_export') && !hasPermission('orders.edit')) {
      onRows([])
      return () => {}
    }

    const currentEmail = email()
    if (!currentEmail) {
      onRows([])
      return () => {}
    }

    let active = true
    let fallbackStarted = false
    let primaryUnsubscribe: Unsubscribe | null = null
    let fallbackUnsubscribes: Unsubscribe[] = []

    const startFallback = () => {
      if (!active || fallbackStarted) return
      fallbackStarted = true
      primaryUnsubscribe?.()
      primaryUnsubscribe = null

      const chunks = new Map<number, AnyDoc[]>()
      const ready = new Set<number>()
      const publishMerged = () => {
        if (!active || ready.size !== EXPORT_REQUEST_OWNER_FIELDS.length) return
        publish(Array.from(chunks.values()).flat())
      }

      fallbackUnsubscribes = EXPORT_REQUEST_OWNER_FIELDS.map((field, index) => (
        listenQueryWithRetry(
          query(
            collection(db, 'order_export_requests'),
            where(field, '==', currentEmail),
          ),
          rows => {
            chunks.set(index, rows)
            ready.add(index)
            publishMerged()
          },
          onError,
        )
      ))
    }

    primaryUnsubscribe = listenQueryWithRetry(
      query(
        collection(db, 'order_export_requests'),
        or(...EXPORT_REQUEST_OWNER_FIELDS.map(field => where(field, '==', currentEmail))),
      ),
      publish,
      error => {
        if (['failed-precondition', 'invalid-argument', 'permission-denied', 'unimplemented'].includes(listenerErrorCode(error))) {
          startFallback()
          return
        }
        onError(error)
      },
    )

    return () => {
      active = false
      primaryUnsubscribe?.()
      primaryUnsubscribe = null
      fallbackUnsubscribes.forEach(unsubscribe => unsubscribe())
      fallbackUnsubscribes = []
    }
  }

  function listenWarehouseExportRequests(
    onRows: RealtimeRowsHandler<AnyDoc>,
    onError: RealtimeErrorHandler,
  ): Unsubscribe {
    if (!hasAnyWarehousePermission([
      'page.warehouse_export_requests',
      'export_requests.accept',
      'export_requests.reject',
      'export_requests.release',
      'export_requests.process',
    ])) {
      onRows([])
      return () => {}
    }

    return listenQueryWithRetry(
      query(collection(db, 'order_export_requests')),
      rows => {
        invalidateScopedCache('order_export_requests')
        onRows(sortNewest(uniqueById(rows).filter(isActive), 'requested_at'))
      },
      onError,
    )
  }

  async function loadScopedCustomers(force = false) {
    if (isAdminUser()) {
      return (await listCollection<CustomerDoc>('customers', [], {
        cacheKey: 'all', ttlMs: 60_000, force
      })).filter(isActive)
    }
    if (!hasPermission('customers.view')) return []
    return sortNewest(
      await listByEmailFields<CustomerDoc>('customers', ['created_by'], force, 60_000),
      'updated_at'
    )
  }

  async function loadProducts(force = false, includeInactive = false) {
    if (!hasPermission('products.view') && !hasPermission('inventory.view') && !hasPermission('printing.view') && !hasPermission('*')) return []
    const rows = await listCollection<ProductDoc>('products', [], {
      cacheKey: 'all', ttlMs: 300_000, force
    })
    const visibleRows = includeInactive
      ? rows.filter(row => row.deleted !== true && !['deleted', 'da xoa'].includes(String(row.status || '').trim().toLowerCase()))
      : rows.filter(isActive)
    return visibleRows.sort((a, b) =>
      String(a.product_name || '').localeCompare(String(b.product_name || ''), 'vi')
    )
  }

  async function loadWarehouses(force = false) {
    if (!hasAnyWarehousePermission(['warehouses.view', 'warehouses.manage', 'import.view', 'export.view', 'inventory.view', 'page.warehouse_export_requests', 'export_requests.accept', 'export_requests.release', 'export_requests.process'])) return []
    return sortByName(await listCollection<WarehouseDoc>('warehouses', [], {
      cacheKey: 'all', ttlMs: 300_000, force
    }))
  }

  async function loadSuppliers(force = false) {
    if (!hasAnyWarehousePermission(['suppliers.view', 'suppliers.manage', 'import.view', 'printing.view'])) return []
    return sortByName(await listCollection<SupplierDoc>('suppliers', [], {
      cacheKey: 'all', ttlMs: 300_000, force
    }))
  }

  async function loadUnits(force = false) {
    if (!hasAnyWarehousePermission(['units.view', 'units.manage', 'products.view', 'import.view', 'export.view', 'inventory.view'])) return []
    return sortByName(await listCollection<UnitDoc>('units', [], {
      cacheKey: 'all', ttlMs: 300_000, force
    }))
  }

  async function loadImportOrders(force = false) {
    if (!hasPermission('import.view') && !hasPermission('*')) return []
    return sortNewest((await listCollection<ImportOrderDoc>('import_orders', [], {
      cacheKey: 'all', ttlMs: 30_000, force
    })).filter(isActive), 'import_date')
  }

  async function loadImportOrderItems(force = false) {
    if (!hasPermission('import.view') && !hasPermission('*')) return []
    return (await listCollection<ImportOrderItemDoc>('import_order_items', [], {
      cacheKey: 'all', ttlMs: 30_000, force
    })).filter(isActive)
  }

  async function loadExportOrders(force = false) {
    if (!hasPermission('export.view') && !hasPermission('*')) return []
    return sortNewest((await listCollection<ExportOrderDoc>('export_orders', [], {
      cacheKey: 'all', ttlMs: 30_000, force
    })).filter(isActive), 'export_date')
  }

  async function loadExportOrderItems(force = false) {
    if (!hasPermission('export.view') && !hasPermission('*')) return []
    return (await listCollection<ExportOrderItemDoc>('export_order_items', [], {
      cacheKey: 'all', ttlMs: 30_000, force
    })).filter(isActive)
  }

  async function loadInventoryBalances(force = false) {
    if (!hasAnyWarehousePermission(['inventory.view', 'import.view', 'export.view'])) return []
    return sortByWarehouseAndProduct(await listCollection<InventoryBalanceDoc>('inventory_balances', [], {
      cacheKey: 'all', ttlMs: 15_000, force
    }))
  }

  async function loadInventoryAdjustments(force = false) {
    if (!hasAnyWarehousePermission(['inventory.view', 'inventory.adjust'])) return []
    return sortNewest((await listCollection<InventoryAdjustmentDoc>('inventory_adjustments', [], {
      cacheKey: 'all', ttlMs: 30_000, force
    })).filter(isActive), 'adjustment_date')
  }

  async function loadStockMovements(force = false) {
    if (!hasAnyWarehousePermission(['stock_movements.view', 'inventory.view'])) return []
    return sortNewest(await listCollection<StockMovementDoc>('stock_movements', [], {
      cacheKey: 'all', ttlMs: 15_000, force
    }), 'movement_date')
  }

  async function loadScopedShipments(force = false) {
    if (isAdminUser()) {
      return (await listCollection<ShipmentDoc>('shipments', [], {
        cacheKey: 'all', ttlMs: 20_000, force
      })).filter(isActive)
    }
    if (!hasPermission('shipments.view')) return []
    return sortNewest(
      await listByEmailFields<ShipmentDoc>('shipments', [
        'created_by', 'order_owner_email', 'order_created_by', 'order_sale_email'
      ], force, 20_000),
      'shipped_date'
    )
  }

  async function loadPrintOrders(force = false) {
    if (canAll('printing.view_all')) {
      return sortNewest((await listCollection<PrintOrderDoc>('print_orders', [], {
        cacheKey: 'all', ttlMs: 20_000, force
      })).filter(isActive), 'created_at')
    }
    if (!hasPermission('printing.view')) return []
    return sortNewest(
      await listByEmailFields<PrintOrderDoc>('print_orders', ['created_by'], force, 20_000),
      'created_at'
    )
  }

  async function loadPrintingSourceOrders(force = false) {
    if (!hasPermission('printing.view') && !hasPermission('*')) return []
    return sortNewest((await listCollection<OrderDoc>('orders', [], {
      cacheKey: 'printing-source-all', ttlMs: 20_000, force
    })).filter(isActive), 'order_date')
  }

  async function loadPrintingSourceOrderItems(force = false) {
    if (!hasPermission('printing.view') && !hasPermission('*')) return []
    return (await listCollection<OrderItemDoc>('order_items', [], {
      cacheKey: 'printing-source-all', ttlMs: 20_000, force
    })).filter(isActive)
  }

  async function loadPrintOrderItems(force = false) {
    if (canAll('printing.view_all')) {
      return (await listCollection<PrintOrderItemDoc>('print_order_items', [], {
        cacheKey: 'all', ttlMs: 20_000, force
      })).filter(isActive)
    }
    if (!hasPermission('printing.view')) return []
    return (await listByEmailFields<PrintOrderItemDoc>(
      'print_order_items',
      ['created_by'],
      force,
      20_000
    )).filter(isActive)
  }

  async function loadScopedInvoices(force = false) {
    if (isAdminUser()) {
      return (await listCollection<InvoiceDoc>('invoices', [], {
        cacheKey: 'all', ttlMs: 20_000, force
      })).filter(isActive)
    }
    if (!hasPermission('invoices.view')) return []
    return sortNewest(
      await listByEmailFields<InvoiceDoc>('invoices', [
        'created_by', 'order_owner_email', 'order_created_by', 'order_sale_email'
      ], force, 20_000),
      'invoice_date'
    )
  }

  return {
    listCollection,
    loadScopedOrders,
    loadScopedOrdersPage,
    loadScopedOrderItems,
    loadScopedPayments,
    loadScopedPaymentsPage,
    loadScopedPaymentsForOrders,
    loadScopedExportRequests,
    loadScopedExportRequestsForOrders,
    loadWarehouseExportRequests,
    listenScopedExportRequests,
    listenWarehouseExportRequests,
    loadScopedCustomers,
    loadProducts,
    loadWarehouses,
    loadSuppliers,
    loadUnits,
    loadImportOrders,
    loadImportOrdersPage,
    loadImportOrderItems,
    loadImportOrderItemsForOrders,
    loadExportOrders,
    loadExportOrdersPage,
    loadExportOrderItems,
    loadExportOrderItemsForOrders,
    loadInventoryBalances,
    loadInventoryAdjustments,
    loadInventoryAdjustmentsPage,
    loadStockMovements,
    loadPrintOrders,
    loadPrintOrderItems,
    loadPrintingSourceOrders,
    loadPrintingSourceOrderItems,
    loadScopedShipments,
    loadScopedShipmentsPage,
    loadScopedInvoices,
    loadScopedInvoicesPage,
    invalidateScopedCache
  }
}
