import { APP_ROUTE_PERMISSIONS } from '~/constants/appRoutes'
import { permissionDebug } from '~/utils/permissionDebug'

export default defineNuxtRouteMiddleware(async (to) => {
  if (process.server) return
  const { initAuth, isLoggedIn, hasAccess, hasPermission, isAdmin } = useAuth()
  await initAuth()
  if (to.path === '/login') return
  if (!isLoggedIn.value) return navigateTo('/login')
  if (!hasAccess.value) return navigateTo('/login?denied=1')
  if (to.path === '/forbidden') return
  const adminOnlyRoute = to.path.startsWith('/settings/users')
    || to.path.startsWith('/settings/permission-audit')
  if (adminOnlyRoute && !isAdmin.value) return navigateTo('/forbidden', { replace: true })

  const required = APP_ROUTE_PERMISSIONS.find(route => (
    to.path === route.path || to.path.startsWith(`${route.path}/`)
  ))?.permission
  if (required && !hasPermission(required)) {
    permissionDebug({
      module: 'route', action: 'navigate', stage: 'denied', documentId: to.path,
      checks: [{ name: 'Quyền mở route', required, actual: 'missing', passed: false }]
    })
    return navigateTo('/forbidden', { replace: true })
  }
})
