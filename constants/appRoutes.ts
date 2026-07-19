// @ts-ignore Shared ESM manifest is also executed directly by Node client tests.
import {
  APP_ACCESS_MODULES,
  findAppAccessRule,
  firstAllowedAccessModule,
} from '~/constants/accessMatrix.mjs'

export type AppRoutePermission = {
  key: string
  path: string
  permission?: string
  label: string
  adminOnly?: boolean
  navSection: string
  navOrder: number
}

export const APP_ROUTE_PERMISSIONS: AppRoutePermission[] = APP_ACCESS_MODULES.map((route: any) => ({
  key: route.key,
  path: route.path,
  permission: route.permission,
  label: route.label,
  adminOnly: route.adminOnly === true,
  navSection: route.navSection,
  navOrder: route.navOrder,
}))

export function appRoutePermission(path: string) {
  return findAppAccessRule(path) as AppRoutePermission | null
}

export function firstAllowedAppRoute(permissions: string[] = [], isAdmin = false) {
  return firstAllowedAccessModule(permissions, isAdmin) as AppRoutePermission | null
}
