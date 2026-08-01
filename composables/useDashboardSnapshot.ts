import { QUERY_CACHE_POLICIES } from '~/constants/cachePolicies'
import { isActive, toNumber } from '~/utils/format'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import {
  buildDashboardSnapshot,
  DASHBOARD_SOURCE_COLLECTIONS,
} from '~/utils/dashboardSnapshot.mjs'
import {
  cachedQuery,
  invalidateQueryCacheTags,
} from '~/composables/useQueryCache'

export const DASHBOARD_CACHE_NAMESPACE = 'dashboard:snapshot:v2'
export const DASHBOARD_CACHE_TAGS = [
  'dashboard:snapshot',
  ...DASHBOARD_SOURCE_COLLECTIONS.map(collectionName => `collection:${collectionName}`),
]

export function invalidateDashboardSnapshotCache() {
  return invalidateQueryCacheTags(DASHBOARD_CACHE_TAGS)
}

export function useDashboardSnapshot() {
  const {
    loadScopedOrders,
    loadScopedOrderItems,
    loadScopedPayments,
    loadScopedExportRequests,
    loadScopedCustomers,
    loadProducts,
    loadScopedShipments,
    loadPrintOrders,
    loadPrintOrderItems,
  } = useScopedQueriesClient()
  const { authorizationCacheKey, hasPermission } = useAuth()
  const { computePaymentStatus } = useOrderLogic()

  async function fetchSnapshot() {
    // A snapshot refresh must reach Firestore instead of composing another layer
    // of short-lived list cache. Repeated Dashboard visits are served by the
    // outer permission-scoped snapshot cache.
    const orders = (await loadScopedOrders(true)).filter(isActive)
    const [customers, products, requests, payments, items, shipments, printOrders, printItems] = await Promise.all([
      hasPermission('customers.view') ? loadScopedCustomers(true) : [],
      hasPermission('products.view') ? loadProducts(true) : [],
      loadScopedExportRequests(orders, true),
      loadScopedPayments(orders, true),
      loadScopedOrderItems(orders, true),
      loadScopedShipments(true),
      loadPrintOrders(true),
      loadPrintOrderItems(true),
    ])

    return buildDashboardSnapshot({
      orders,
      customers,
      products,
      requests,
      payments,
      items,
      shipments,
      printOrders,
      printItems,
      computePaymentStatus,
      isActive,
      toNumber,
      now: new Date(),
    })
  }

  function loadDashboardSnapshot(force = false) {
    return cachedQuery({
      authKey: String(authorizationCacheKey.value || 'anonymous'),
      namespace: DASHBOARD_CACHE_NAMESPACE,
      params: { schema: 2 },
      tags: DASHBOARD_CACHE_TAGS,
      policy: QUERY_CACHE_POLICIES.dashboardSnapshot,
      force,
      fetcher: fetchSnapshot,
      onBackgroundError: error => {
        console.warn('[KINGCUP_CACHE] Không thể làm mới Dashboard trong nền.', error)
      },
    })
  }

  return {
    loadDashboardSnapshot,
    invalidateDashboardSnapshotCache,
  }
}
