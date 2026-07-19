import { appRoutePermission } from '~/constants/appRoutes'
import { permissionDebug } from '~/utils/permissionDebug'

export default defineNuxtRouteMiddleware(async (to) => {
  if (process.server) return
  const { initAuth, isLoggedIn, hasAccess, hasPermission, isAdmin } = useAuth()
  await initAuth()
  if (to.path === '/login') return
  if (!isLoggedIn.value) return navigateTo('/login')
  if (!hasAccess.value) return navigateTo('/login?denied=1')
  if (to.path === '/forbidden') return

  const accessRule = appRoutePermission(to.path)
  if (!accessRule) return

  const denied = accessRule.adminOnly
    ? !isAdmin.value
    : Boolean(accessRule.permission && !hasPermission(accessRule.permission))
  if (!denied) return

  permissionDebug({
    module: 'route',
    action: 'navigate',
    stage: 'denied',
    documentId: to.path,
    checks: [{
      name: 'Quyền mở route',
      required: accessRule.adminOnly ? 'admin.only' : accessRule.permission,
      actual: 'missing',
      passed: false,
    }],
    payload: { access_module: accessRule.key },
    note: 'Route và sidebar cùng đọc constants/accessMatrix.mjs.',
  })
  return navigateTo('/forbidden', { replace: true })
})
