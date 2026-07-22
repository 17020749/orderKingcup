export const NAV_SECTION_DEFINITIONS = [
  { key: 'business', label: 'Kinh doanh', order: 10, grouped: true },
  { key: 'warehouse', label: 'Kho', order: 20, grouped: true },
  { key: 'standalone', label: '', order: 30, grouped: false },
  { key: 'settings', label: 'Cài đặt', order: 40, grouped: true },
]

export const APP_ACCESS_MODULES = [
  { key: 'dashboard', path: '/dashboard', label: 'Dashboard', permission: 'page.dashboard', navSection: 'business', navOrder: 10 },
  { key: 'orders', path: '/orders', label: 'Đơn hàng', permission: 'page.orders', navSection: 'business', navOrder: 20 },
  { key: 'export_requests', path: '/export-requests', label: 'Yêu cầu xuất kho', permission: 'page.export_requests', navSection: 'business', navOrder: 30 },
  { key: 'customers', path: '/customers', label: 'Khách hàng', permission: 'page.customers', navSection: 'business', navOrder: 40 },
  { key: 'payments', path: '/payments', label: 'Thanh toán', permission: 'page.payments', navSection: 'business', navOrder: 50 },
  { key: 'invoices', path: '/invoices', label: 'Hóa đơn', permission: 'page.invoices', navSection: 'business', navOrder: 60 },

  { key: 'imports', path: '/imports', label: 'Nhập kho', permission: 'page.imports', navSection: 'warehouse', navOrder: 10 },
  { key: 'warehouse_export_requests', path: '/warehouse-export-requests', label: 'Xử lý yêu cầu xuất', permission: 'page.warehouse_export_requests', navSection: 'warehouse', navOrder: 20 },
  { key: 'exports', path: '/exports', label: 'Phiếu xuất kho', permission: 'page.exports', navSection: 'warehouse', navOrder: 30 },
  { key: 'inventory_adjustments', path: '/inventory-adjustments', label: 'Điều chỉnh tồn', permission: 'page.inventory_adjustments', navSection: 'warehouse', navOrder: 40 },
  { key: 'inventory', path: '/inventory', label: 'Tồn kho', permission: 'page.inventory', navSection: 'warehouse', navOrder: 50 },
  { key: 'warehouse_settings', path: '/warehouse-settings', label: 'Danh mục kho', permission: 'page.warehouse_settings', navSection: 'warehouse', navOrder: 60 },
  { key: 'shipments', path: '/shipments', label: 'Vận chuyển', permission: 'page.shipments', navSection: 'warehouse', navOrder: 70 },

  { key: 'products', path: '/products', label: 'Sản phẩm', permission: 'page.products', navSection: 'standalone', navOrder: 10 },
  { key: 'printing', path: '/printing', label: 'Tiến độ in ấn', permission: 'page.printing', navSection: 'standalone', navOrder: 20 },

  { key: 'activity_logs', path: '/activity-logs', label: 'Nhật ký hoạt động', permission: 'page.activity_logs', navSection: 'settings', navOrder: 10 },
  { key: 'settings_users', path: '/settings/users', label: 'Người dùng & quyền', adminOnly: true, navSection: 'settings', navOrder: 20 },
  { key: 'permission_audit', path: '/settings/permission-audit', label: 'Kiểm tra quyền', adminOnly: true, navSection: 'settings', navOrder: 30 },
  { key: 'settings_general', path: '/settings/general', label: 'Cài đặt chung', permission: 'page.settings', navSection: 'settings', navOrder: 40 },
]

export const NON_ASSIGNABLE_PERMISSION_KEYS = [
  'users.view',
  'users.manage',
  'roles.view',
  'roles.manage',
]

export const PERMISSION_DEPENDENCIES = {
  'page.dashboard': ['dashboard.view'],
  'dashboard.view': ['page.dashboard'],

  'page.orders': ['orders.view'],
  'orders.view': ['page.orders'],
  'orders.view_all': ['page.orders'],
  'orders.create': ['page.orders', 'orders.view', 'customers.view', 'products.view'],
  'orders.edit': ['page.orders', 'orders.view'],
  'orders.edit_fulfilled': ['orders.edit'],
  'orders.delete': ['page.orders', 'orders.view'],
  'orders.print': ['page.orders', 'orders.view'],
  'orders.pdf': ['page.orders', 'orders.view'],
  'orders.export': ['page.orders', 'orders.view'],
  'orders.import': ['page.orders', 'orders.view'],
  'orders.warehouse_export': ['page.export_requests', 'export_requests.view', 'orders.view'],

  'page.export_requests': ['export_requests.view', 'orders.view'],
  'export_requests.view': ['page.export_requests', 'orders.view'],
  'export_requests.view_all': ['page.export_requests'],
  'export_requests.delete': ['page.export_requests', 'export_requests.view', 'orders.view'],
  'export_requests.accept': ['page.warehouse_export_requests'],
  'export_requests.reject': ['page.warehouse_export_requests'],
  'export_requests.release': ['page.warehouse_export_requests', 'inventory.view', 'export.view'],
  'export_requests.process': ['page.warehouse_export_requests', 'inventory.view', 'export.view'],

  'page.imports': ['import.view'],
  'import.view': ['page.imports'],
  'import.create': ['page.imports', 'import.view'],
  'import.edit': ['page.imports', 'import.view'],
  'import.delete': ['page.imports', 'import.view'],
  'import.print': ['page.imports', 'import.view'],
  'import.pdf': ['page.imports', 'import.view'],
  'import.export': ['page.imports', 'import.view'],
  'import.import': ['page.imports', 'import.view'],

  'page.exports': ['export.view'],
  'export.view': ['page.exports'],
  'export.create': ['page.exports', 'export.view'],
  'export.edit': ['page.exports', 'export.view'],
  'export.delete': ['page.exports', 'export.view'],
  'export.print': ['page.exports', 'export.view'],
  'export.pdf': ['page.exports', 'export.view'],
  'export.export': ['page.exports', 'export.view'],
  'export.import': ['page.exports', 'export.view'],

  'page.inventory': ['inventory.view'],
  'inventory.view': ['page.inventory'],
  'page.inventory_adjustments': ['inventory.view'],
  'inventory.adjust': ['page.inventory_adjustments', 'inventory.view'],
  'inventory.export': ['page.inventory', 'inventory.view'],
  'inventory.import': ['page.inventory', 'inventory.view'],
  'stock_movements.view': ['page.inventory', 'inventory.view'],

  'page.warehouse_settings': ['warehouses.view', 'suppliers.view', 'units.view'],
  'warehouses.view': ['page.warehouse_settings'],
  'warehouses.manage': ['page.warehouse_settings', 'warehouses.view'],
  'suppliers.view': ['page.warehouse_settings'],
  'suppliers.manage': ['page.warehouse_settings', 'suppliers.view'],
  'units.view': ['page.warehouse_settings'],
  'units.manage': ['page.warehouse_settings', 'units.view'],

  'page.customers': ['customers.view'],
  'customers.view': ['page.customers'],
  'customers.orders_view': ['page.customers', 'customers.view', 'orders.view'],
  'customers.create': ['page.customers', 'customers.view'],
  'customers.edit': ['page.customers', 'customers.view'],
  'customers.delete': ['page.customers', 'customers.view'],

  'page.products': ['products.view'],
  'products.view': ['page.products'],
  'products.create': ['page.products', 'products.view'],
  'products.edit': ['page.products', 'products.view'],
  'products.delete': ['page.products', 'products.view'],

  'page.payments': ['payments.view', 'orders.view'],
  'payments.view': ['page.payments', 'orders.view'],
  // Relation pages need to read the complete parent order in transactions.
  // The Rules still require the child module's own view_all for child actions.
  'payments.view_all': ['page.payments', 'orders.view_all'],
  'payments.create': ['page.payments', 'payments.view', 'orders.view'],
  'payments.edit': ['page.payments', 'payments.view', 'orders.view'],
  'payments.delete': ['page.payments', 'payments.view', 'orders.view'],
  'payments.export': ['page.payments', 'payments.view'],

  'page.printing': ['printing.view'],
  'printing.view': ['page.printing'],
  'printing.orders_view': ['page.printing'],
  'printing.view_all': ['page.printing'],
  'printing.create': ['page.printing', 'printing.view', 'printing.orders_view'],
  'printing.edit': ['page.printing', 'printing.view'],
  'printing.delete': ['page.printing', 'printing.view'],

  'page.shipments': ['shipments.view', 'orders.view'],
  'shipments.view': ['page.shipments', 'orders.view'],
  'shipments.view_all': ['page.shipments', 'orders.view_all'],
  'shipments.create': ['page.shipments', 'shipments.view', 'orders.view'],
  'shipments.edit': ['page.shipments', 'shipments.view', 'orders.view'],
  'shipments.delete': ['page.shipments', 'shipments.view', 'orders.view'],

  'page.invoices': ['invoices.view', 'orders.view'],
  'invoices.view': ['page.invoices', 'orders.view'],
  'invoices.view_all': ['page.invoices', 'orders.view_all'],
  'invoices.create': ['page.invoices', 'invoices.view', 'orders.view'],
  'invoices.edit': ['page.invoices', 'invoices.view', 'orders.view'],
  'invoices.delete': ['page.invoices', 'invoices.view', 'orders.view'],

  'page.settings': ['settings.view'],
  'settings.view': ['page.settings'],
  'settings.manage': ['page.settings', 'settings.view'],

  'page.activity_logs': ['activity_logs.view'],
  'activity_logs.view': ['page.activity_logs'],
}

function cleanPermissionList(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean)))
}

export function resolvePermissionDependencies(values, options = {}) {
  const allowNonAssignable = options.allowNonAssignable === true
  const selected = cleanPermissionList(values)
  if (selected.includes('*')) return ['*']

  const result = new Set(selected.filter(permission => (
    allowNonAssignable || !NON_ASSIGNABLE_PERMISSION_KEYS.includes(permission)
  )))
  const queue = Array.from(result)
  while (queue.length) {
    const permission = queue.shift()
    for (const dependency of PERMISSION_DEPENDENCIES[permission] || []) {
      if (result.has(dependency)) continue
      if (!allowNonAssignable && NON_ASSIGNABLE_PERMISSION_KEYS.includes(dependency)) continue
      result.add(dependency)
      queue.push(dependency)
    }
  }
  return Array.from(result).sort((left, right) => left.localeCompare(right))
}

export function missingPermissionDependencies(values) {
  const selected = cleanPermissionList(values)
  if (selected.includes('*')) return []
  const resolved = resolvePermissionDependencies(selected)
  const selectedSet = new Set(selected)
  return resolved.filter(permission => !selectedSet.has(permission))
}

export function removePermissionWithDependents(values, permissionToRemove) {
  const selected = new Set(cleanPermissionList(values))
  selected.delete(permissionToRemove)
  if (permissionToRemove === '*') return []

  let changed = true
  while (changed) {
    changed = false
    for (const permission of Array.from(selected)) {
      const dependencies = PERMISSION_DEPENDENCIES[permission] || []
      if (dependencies.some(dependency => !selected.has(dependency))) {
        selected.delete(permission)
        changed = true
      }
    }
  }
  return Array.from(selected).sort((left, right) => left.localeCompare(right))
}

export function directPermissionDependencies(permission) {
  return [...(PERMISSION_DEPENDENCIES[permission] || [])]
}

export function findAppAccessRule(path) {
  const normalizedPath = String(path || '')
  return APP_ACCESS_MODULES.find(module => (
    normalizedPath === module.path || normalizedPath.startsWith(`${module.path}/`)
  )) || null
}

export function firstAllowedAccessModule(permissions = [], isAdmin = false) {
  const grants = new Set(cleanPermissionList(permissions))
  return APP_ACCESS_MODULES.find(module => (
    module.adminOnly ? isAdmin : grants.has('*') || grants.has(module.permission)
  )) || null
}

export function accessModulesForNavigation() {
  return [...APP_ACCESS_MODULES].sort((left, right) => {
    const leftSection = NAV_SECTION_DEFINITIONS.find(section => section.key === left.navSection)?.order || 999
    const rightSection = NAV_SECTION_DEFINITIONS.find(section => section.key === right.navSection)?.order || 999
    return leftSection - rightSection || left.navOrder - right.navOrder
  })
}
