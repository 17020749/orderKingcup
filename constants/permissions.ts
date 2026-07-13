export type PermissionItem = { key: string; group: string; name: string }

export const PERMISSION_CATALOG: PermissionItem[] = [
  { key: '*', group: 'Quản trị', name: 'Toàn quyền hệ thống' },
  { key: 'page.dashboard', group: 'Tab / Menu', name: 'Xem tab Dashboard' },
  { key: 'page.orders', group: 'Tab / Menu', name: 'Xem tab Đơn hàng' },
  { key: 'page.export_requests', group: 'Tab / Menu', name: 'Xem tab Yêu cầu xuất kho' },
  { key: 'page.imports', group: 'Tab / Menu', name: 'Xem tab Nhập kho' },
  { key: 'page.exports', group: 'Tab / Menu', name: 'Xem tab Xuất kho thật' },
  { key: 'page.inventory', group: 'Tab / Menu', name: 'Xem tab Tồn kho' },
  { key: 'page.inventory_adjustments', group: 'Tab / Menu', name: 'Xem tab Điều chỉnh tồn' },
  { key: 'page.warehouse_settings', group: 'Tab / Menu', name: 'Xem tab Danh mục kho' },
  { key: 'page.customers', group: 'Tab / Menu', name: 'Xem tab Khách hàng' },
  { key: 'page.products', group: 'Tab / Menu', name: 'Xem tab Sản phẩm' },
  { key: 'page.payments', group: 'Tab / Menu', name: 'Xem tab Thanh toán' },
  { key: 'page.shipments', group: 'Tab / Menu', name: 'Xem tab Vận chuyển' },
  { key: 'page.invoices', group: 'Tab / Menu', name: 'Xem tab Hóa đơn' },
  { key: 'page.settings', group: 'Tab / Menu', name: 'Xem tab Cài đặt' },
  { key: 'page.activity_logs', group: 'Tab / Menu', name: 'Xem tab Nhật ký' },
  { key: 'dashboard.view', group: 'Dashboard', name: 'Xem dữ liệu dashboard' },
  { key: 'orders.view', group: 'Đơn hàng', name: 'Xem đơn hàng của mình' },
  { key: 'orders.view_all', group: 'Đơn hàng', name: 'Xem tất cả đơn hàng' },
  { key: 'orders.create', group: 'Đơn hàng', name: 'Tạo đơn hàng' },
  { key: 'orders.edit', group: 'Đơn hàng', name: 'Sửa đơn hàng của mình' },
  { key: 'orders.edit_fulfilled', group: 'Đơn hàng', name: 'Sửa đơn đã xuất đủ' },
  { key: 'orders.delete', group: 'Đơn hàng', name: 'Xóa đơn hàng' },
  { key: 'orders.print', group: 'Đơn hàng', name: 'In đơn hàng' },
  { key: 'orders.pdf', group: 'Đơn hàng', name: 'Xuất PDF đơn hàng' },
  { key: 'orders.export', group: 'Đơn hàng', name: 'Xuất Excel đơn hàng' },
  { key: 'orders.import', group: 'Đơn hàng', name: 'Import Excel đơn hàng' },
  { key: 'orders.warehouse_export', group: 'Phiếu xuất kho', name: 'Tạo/sửa phiếu xuất kho của mình' },
  { key: 'export_requests.view', group: 'Phiếu xuất kho', name: 'Xem phiếu xuất kho của mình' },
  { key: 'export_requests.view_all', group: 'Phiếu xuất kho', name: 'Xem tất cả phiếu xuất kho' },
  { key: 'export_requests.process', group: 'Phiếu xuất kho', name: 'Warehouse xử lý phiếu xuất kho' },
  { key: 'export_requests.delete', group: 'Yêu cầu xuất kho', name: 'Xóa yêu cầu xuất kho chưa xuất' },

  { key: 'import.view', group: 'Nhập kho', name: 'Xem phiếu nhập kho' },
  { key: 'import.create', group: 'Nhập kho', name: 'Tạo phiếu nhập kho' },
  { key: 'import.edit', group: 'Nhập kho', name: 'Sửa phiếu nhập kho' },
  { key: 'import.delete', group: 'Nhập kho', name: 'Xóa phiếu nhập kho' },
  { key: 'import.print', group: 'Nhập kho', name: 'In phiếu nhập kho' },
  { key: 'import.pdf', group: 'Nhập kho', name: 'Xuất PDF phiếu nhập kho' },
  { key: 'import.export', group: 'Nhập kho', name: 'Xuất Excel nhập kho' },
  { key: 'import.import', group: 'Nhập kho', name: 'Import Excel nhập kho' },

  { key: 'export.view', group: 'Xuất kho thật', name: 'Xem phiếu xuất kho thật' },
  { key: 'export.create', group: 'Xuất kho thật', name: 'Tạo phiếu xuất kho thật' },
  { key: 'export.edit', group: 'Xuất kho thật', name: 'Sửa phiếu xuất kho thật' },
  { key: 'export.delete', group: 'Xuất kho thật', name: 'Xóa phiếu xuất kho thật' },
  { key: 'export.print', group: 'Xuất kho thật', name: 'In phiếu xuất kho thật' },
  { key: 'export.pdf', group: 'Xuất kho thật', name: 'Xuất PDF phiếu xuất kho thật' },
  { key: 'export.export', group: 'Xuất kho thật', name: 'Xuất Excel xuất kho' },
  { key: 'export.import', group: 'Xuất kho thật', name: 'Import Excel xuất kho' },

  { key: 'inventory.view', group: 'Tồn kho', name: 'Xem tồn kho' },
  { key: 'inventory.adjust', group: 'Tồn kho', name: 'Điều chỉnh tồn kho' },
  { key: 'inventory.export', group: 'Tồn kho', name: 'Xuất Excel tồn kho' },
  { key: 'inventory.import', group: 'Tồn kho', name: 'Import tồn kho' },
  { key: 'stock_movements.view', group: 'Tồn kho', name: 'Xem lịch sử biến động kho' },

  { key: 'warehouses.view', group: 'Danh mục kho', name: 'Xem kho' },
  { key: 'warehouses.manage', group: 'Danh mục kho', name: 'Thêm/sửa/xóa kho' },
  { key: 'suppliers.view', group: 'Danh mục kho', name: 'Xem nhà cung cấp' },
  { key: 'suppliers.manage', group: 'Danh mục kho', name: 'Thêm/sửa/xóa nhà cung cấp' },
  { key: 'units.view', group: 'Danh mục kho', name: 'Xem đơn vị tính' },
  { key: 'units.manage', group: 'Danh mục kho', name: 'Thêm/sửa/xóa đơn vị tính' },

  { key: 'customers.view', group: 'Khách hàng', name: 'Xem khách hàng' },
  { key: 'customers.create', group: 'Khách hàng', name: 'Thêm khách hàng' },
  { key: 'customers.edit', group: 'Khách hàng', name: 'Sửa khách hàng' },
  { key: 'customers.delete', group: 'Khách hàng', name: 'Xóa khách hàng' },
  { key: 'products.view', group: 'Sản phẩm', name: 'Xem/chọn sản phẩm' },
  { key: 'products.create', group: 'Sản phẩm', name: 'Thêm sản phẩm' },
  { key: 'products.edit', group: 'Sản phẩm', name: 'Sửa sản phẩm' },
  { key: 'products.delete', group: 'Sản phẩm', name: 'Xóa sản phẩm' },
  { key: 'payments.view', group: 'Thanh toán', name: 'Xem phiếu thanh toán của mình' },
  { key: 'payments.view_all', group: 'Thanh toán', name: 'Xem tất cả phiếu thanh toán' },
  { key: 'payments.create', group: 'Thanh toán', name: 'Tạo phiếu thanh toán' },
  { key: 'payments.edit', group: 'Thanh toán', name: 'Sửa phiếu thanh toán của mình' },
  { key: 'payments.delete', group: 'Thanh toán', name: 'Xóa phiếu thanh toán' },
  { key: 'payments.export', group: 'Thanh toán', name: 'Xuất Excel thanh toán' },
  ...['shipments', 'invoices'].flatMap(module => [
    { key: `${module}.view`, group: module === 'shipments' ? 'Vận chuyển' : 'Hóa đơn', name: 'Xem dữ liệu' },
    { key: `${module}.create`, group: module === 'shipments' ? 'Vận chuyển' : 'Hóa đơn', name: 'Thêm dữ liệu' },
    { key: `${module}.edit`, group: module === 'shipments' ? 'Vận chuyển' : 'Hóa đơn', name: 'Sửa dữ liệu' },
    { key: `${module}.delete`, group: module === 'shipments' ? 'Vận chuyển' : 'Hóa đơn', name: 'Xóa dữ liệu' }
  ]),
  { key: 'users.view', group: 'Cài đặt', name: 'Xem người dùng' },
  { key: 'users.manage', group: 'Cài đặt', name: 'Thêm/sửa/xóa người dùng' },
  { key: 'roles.view', group: 'Cài đặt', name: 'Xem vai trò và quyền' },
  { key: 'roles.manage', group: 'Cài đặt', name: 'Thêm/sửa/xóa vai trò và quyền' },
  { key: 'settings.view', group: 'Cài đặt', name: 'Xem cài đặt' },
  { key: 'settings.manage', group: 'Cài đặt', name: 'Sửa cài đặt' },
  { key: 'activity_logs.view', group: 'Nhật ký', name: 'Xem nhật ký hoạt động' }
]

export const ORDER_STATUS_OPTIONS = ['Mới tạo', 'Đã báo giá', 'Đã cọc', 'Đang sản xuất', 'Chờ xuất kho', 'Đang giao', 'Đã hoàn thành', 'Đã hủy']
export const PAYMENT_STATUS_OPTIONS = ['Chưa thanh toán', 'Đã cọc', 'Đã cọc + thanh toán 1 phần', 'Thanh toán một phần', 'Đã thanh toán', 'Thanh toán thừa']
export const PAYMENT_TYPES = ['Cọc', 'Thu 1', 'Thu 2', 'Thu 3', 'Thanh toán đủ']
export const PAYMENT_METHODS = ['Chuyển khoản', 'Tiền mặt']
export const PAYMENT_STATUSES = ['Chưa nhận', 'Đã nhận', 'Giao dịch lỗi']
export const INVOICE_STATUS_OPTIONS = ['Không xuất', 'Yêu cầu xuất', 'HĐ nháp', 'Đã xuất']
export const VAT_RATE_OPTIONS = [0, 8]
export const EXPORT_REQUEST_STATUSES = ['cho_xu_ly', 'dang_xu_ly', 'da_tiep_nhan', 'cho_xuat_kho', 'da_xuat', 'tu_choi', 'loi']


export const WAREHOUSE_EXPORT_ORDER_DESTINATIONS = ['customer', 'warehouse']
export const WAREHOUSE_ORDER_STATUSES = ['draft', 'completed', 'cancelled', 'deleted']
export const STOCK_MOVEMENT_TYPES = ['import', 'export_customer', 'export_transfer_out', 'export_transfer_in', 'adjustment']
