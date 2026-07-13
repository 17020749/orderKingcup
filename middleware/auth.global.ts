import { permissionDebug } from '~/utils/permissionDebug'

const ROUTE_PERMISSIONS: Array<[string, string]> = [
  ['/dashboard', 'page.dashboard'],
  ['/orders', 'page.orders'],
  ['/export-requests', 'page.export_requests'],
  ['/warehouse-export-requests', 'page.warehouse_export_requests'],
  ['/imports', 'page.imports'],
  ['/exports', 'page.exports'],
  ['/inventory', 'page.inventory'],
  ['/inventory-adjustments', 'page.inventory_adjustments'],
  ['/warehouse-settings', 'page.warehouse_settings'],
  ['/customers', 'page.customers'],
  ['/products', 'page.products'],
  ['/payments', 'page.payments'],
  ['/shipments', 'page.shipments'],
  ['/invoices', 'page.invoices'],
  ['/activity-logs', 'page.activity_logs'],
  ['/settings', 'page.settings']
]

export default defineNuxtRouteMiddleware(async (to) => {
  if (process.server) return
  const { initAuth, isLoggedIn, hasAccess, hasPermission, isAdmin } = useAuth()
  await initAuth()
  if (to.path === '/login') return
  if (!isLoggedIn.value) return navigateTo('/login')
  if (!hasAccess.value) return navigateTo('/login?denied=1')
  if (to.path === '/forbidden') return
  if (to.path.startsWith('/settings/users') && !isAdmin.value) return navigateTo('/forbidden', { replace: true })

  const required = ROUTE_PERMISSIONS.find(([prefix]) => to.path === prefix || to.path.startsWith(`${prefix}/`))?.[1]
  if (required && !hasPermission(required)) {
    permissionDebug({
      module: 'route', action: 'navigate', stage: 'denied', documentId: to.path,
      checks: [{ name: 'Quyền mở route', required, actual: 'missing', passed: false }]
    })
    return navigateTo('/forbidden', { replace: true })
  }
})
