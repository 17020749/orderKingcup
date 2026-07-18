export type AppRoutePermission = {
  path: string
  permission: string
  label: string
}

export const APP_ROUTE_PERMISSIONS: AppRoutePermission[] = [
  { path: '/dashboard', permission: 'page.dashboard', label: 'Dashboard' },
  { path: '/orders', permission: 'page.orders', label: 'Đơn hàng' },
  { path: '/export-requests', permission: 'page.export_requests', label: 'Yêu cầu xuất kho' },
  { path: '/customers', permission: 'page.customers', label: 'Khách hàng' },
  { path: '/payments', permission: 'page.payments', label: 'Thanh toán' },
  { path: '/imports', permission: 'page.imports', label: 'Nhập kho' },
  { path: '/warehouse-export-requests', permission: 'page.warehouse_export_requests', label: 'Xử lý yêu cầu xuất' },
  { path: '/exports', permission: 'page.exports', label: 'Phiếu xuất kho' },
  { path: '/inventory-adjustments', permission: 'page.inventory_adjustments', label: 'Điều chỉnh tồn' },
  { path: '/inventory', permission: 'page.inventory', label: 'Tồn kho' },
  { path: '/warehouse-settings', permission: 'page.warehouse_settings', label: 'Danh mục kho' },
  { path: '/shipments', permission: 'page.shipments', label: 'Vận chuyển' },
  { path: '/products', permission: 'page.products', label: 'Sản phẩm' },
  { path: '/printing', permission: 'page.printing', label: 'Tiến độ in ấn' },
  { path: '/invoices', permission: 'page.invoices', label: 'Hóa đơn' },
  { path: '/activity-logs', permission: 'page.activity_logs', label: 'Nhật ký hoạt động' },
  { path: '/settings/general', permission: 'page.settings', label: 'Cài đặt chung' },
]

export function firstAllowedAppRoute(permissions: string[] = []) {
  const grants = new Set(permissions)
  return APP_ROUTE_PERMISSIONS.find(route => grants.has('*') || grants.has(route.permission)) || null
}
