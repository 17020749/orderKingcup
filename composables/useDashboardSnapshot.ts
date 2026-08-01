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

export const DASHBOARD_CACHE_NAMESPACE = 'dashboard:snapshot:v3'
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
  const { loadPrintingDependenciesForOrders } = useOrderPrintingDeleteGuard()
  const { authorizationCacheKey, hasPermission } = useAuth()
  const { computePaymentStatus } = useOrderLogic()

  function canReadPrintingByOrderScope() {
    return hasPermission('*')
      || hasPermission('printing.view_all')
      || hasPermission('printing.orders_view')
      || hasPermission('orders.edit')
      || hasPermission('orders.delete')
  }

  async function loadOptionalSource<T>(
    sourceName: string,
    fallback: T,
    loader: () => Promise<T>,
  ): Promise<T> {
    try {
      return await loader()
    } catch (error) {
      // Dashboard vẫn hiển thị các KPI cốt lõi nếu một nguồn phụ chưa tương
      // thích với Rules hoặc chứa dữ liệu legacy. Không phát toast "không có
      // quyền" chung chung vì lỗi đã được cô lập đúng tại nguồn này.
      console.warn(`[KINGCUP_DASHBOARD] Bỏ qua nguồn ${sourceName}.`, error)
      return fallback
    }
  }

  async function loadDashboardPrinting(orders: any[], forceSources: boolean) {
    const empty = { printOrders: [] as any[], printItems: [] as any[] }

    if (canReadPrintingByOrderScope()) {
      // Không quét toàn bộ print_order_items. Chỉ đọc lệnh in thuộc các đơn mà
      // tài khoản đang nhìn thấy, rồi đọc item theo các parent còn hoạt động.
      // Cách này khớp Firestore Rules và bỏ qua được item legacy bị mồ côi.
      return loadOptionalSource(
        'printing_dependencies',
        empty,
        () => loadPrintingDependenciesForOrders(orders),
      )
    }

    // Giữ tương thích cho nhân sự in chỉ có quyền xem dữ liệu do mình lập.
    if (hasPermission('printing.view')) {
      return loadOptionalSource('printing_owned', empty, async () => {
        const [printOrders, printItems] = await Promise.all([
          loadPrintOrders(forceSources),
          loadPrintOrderItems(forceSources),
        ])
        return { printOrders, printItems }
      })
    }

    return empty
  }

  async function fetchSnapshot(forceSources = false) {
    // Lượt mở Dashboard thông thường được phép dùng cache ngắn hạn của từng
    // collection. Chỉ nút "Làm mới dữ liệu" mới buộc toàn bộ nguồn đọc lại
    // Firestore, tránh nhân đôi lượt đọc giữa cache nguồn và cache snapshot.
    const orders = (await loadScopedOrders(forceSources)).filter(isActive)
    const printingPromise = loadDashboardPrinting(orders, forceSources)

    const [customers, products, requests, payments, items, shipments, printing] = await Promise.all([
      hasPermission('customers.view') ? loadScopedCustomers(forceSources) : [],
      hasPermission('products.view') ? loadProducts(forceSources) : [],
      loadScopedExportRequests(orders, forceSources),
      loadScopedPayments(orders, forceSources),
      loadScopedOrderItems(orders, forceSources),
      loadScopedShipments(forceSources),
      printingPromise,
    ])

    return buildDashboardSnapshot({
      orders,
      customers,
      products,
      requests,
      payments,
      items,
      shipments,
      printOrders: printing.printOrders,
      printItems: printing.printItems,
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
      params: { schema: 3 },
      tags: DASHBOARD_CACHE_TAGS,
      policy: QUERY_CACHE_POLICIES.dashboardSnapshot,
      force,
      fetcher: () => fetchSnapshot(force),
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
