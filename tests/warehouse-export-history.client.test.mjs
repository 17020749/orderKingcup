import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  buildWarehouseExportHistoryRows,
  isDateTimeInRange,
  matchesWarehouseExportHistoryFilters,
} from '../utils/warehouseExportHistory.mjs'

const exportOrders = [
  {
    id: 'export-a',
    code: 'PXK-001',
    export_date: '2026-08-06',
    source_order_code: 'ORD-001',
    source_request_id: 'request-a',
    customer_name: 'Khách A',
    destination_type: 'customer',
    created_by: 'warehouse@kingcup.vn',
    created_at: '2026-08-06T08:30:00+07:00',
    active: true,
  },
  {
    id: 'export-external',
    code: 'PXK-NGOAI-001',
    export_date: '2026-08-06',
    source_order_code: 'ORD-002',
    source_request_id: 'request-b',
    customer_name: 'Khách B',
    release_mode: 'external_no_inventory',
    affects_inventory: false,
    created_by: 'warehouse@kingcup.vn',
    created_at: '2026-08-06T09:45:00+07:00',
    active: true,
  },
  {
    id: 'export-cancelled',
    code: 'PXK-HUY',
    status: 'cancelled',
    active: false,
  },
]

const exportItems = [
  {
    id: 'item-a',
    export_order_id: 'export-a',
    source_order_id: 'order-a',
    product_id: 'product-a',
    product_code: 'SP-A',
    product_name: 'Sản phẩm A',
    from_warehouse_id: 'warehouse-a',
    from_warehouse_name: 'Kho Thịnh Liệt',
    source_logo: 'KINGCUP',
    quantity: 12,
    unit: 'Chiếc',
    active: true,
  },
  {
    id: 'item-b',
    export_order_id: 'export-external',
    source_order_id: 'order-b',
    product_id: 'product-b',
    product_code: 'SP-B',
    product_name: 'Sản phẩm B',
    from_warehouse_id: '',
    from_warehouse_name: 'Xuất ngoài hệ thống',
    logo: '',
    quantity: 5,
    unit: 'Bộ',
    affects_inventory: false,
    active: true,
  },
  {
    id: 'item-cancelled',
    export_order_id: 'export-cancelled',
    product_code: 'SP-X',
    quantity: 99,
    active: true,
  },
]

const requests = [
  {
    id: 'request-a',
    request_id: 'YCXK-001',
    order_id: 'order-a',
    order_code: 'ORD-001',
    customer_name: 'Khách A',
    order_created_by: 'creator-a@kingcup.vn',
    order_sale_email: 'sale-a@kingcup.vn',
    requested_by: 'sale-a@kingcup.vn',
    actual_exported_at: '2026-08-06T08:35:00+07:00',
    payload_json: JSON.stringify({ sale_name: 'Sale A' }),
    active: true,
  },
  {
    id: 'request-b',
    request_id: 'YCXK-002',
    order_id: 'order-b',
    order_code: 'ORD-002',
    customer_name: 'Khách B',
    order_created_by: 'creator-b@kingcup.vn',
    order_sale_email: 'sale-b@kingcup.vn',
    external_exported_at: '2026-08-06T09:50:00+07:00',
    payload_json: JSON.stringify({ sale_name: 'Sale B' }),
    active: true,
  },
]

const orders = [
  {
    id: 'order-a',
    order_code: 'ORD-001',
    customer_name: 'Khách A',
    sale_name: 'Sale A',
    sale_email: 'sale-a@kingcup.vn',
    created_by: 'creator-a@kingcup.vn',
    active: true,
  },
  {
    id: 'order-b',
    order_code: 'ORD-002',
    customer_name: 'Khách B',
    sale_name: 'Sale B',
    sale_email: 'sale-b@kingcup.vn',
    created_by: 'creator-b@kingcup.vn',
    active: true,
  },
]

test('ghép lịch sử theo từng dòng phiếu xuất với kho, đơn, khách, Sale và người tạo đơn', () => {
  const rows = buildWarehouseExportHistoryRows({ exportOrders, exportItems, requests, orders })
  assert.equal(rows.length, 2)

  const standard = rows.find(row => row.export_order_id === 'export-a')
  assert.ok(standard)
  assert.equal(standard.export_code, 'PXK-001')
  assert.equal(standard.request_code, 'YCXK-001')
  assert.equal(standard.order_code, 'ORD-001')
  assert.equal(standard.customer_name, 'Khách A')
  assert.equal(standard.warehouse_name, 'Kho Thịnh Liệt')
  assert.equal(standard.product_code, 'SP-A')
  assert.equal(standard.product_name, 'Sản phẩm A')
  assert.equal(standard.logo, 'KINGCUP')
  assert.equal(standard.quantity, 12)
  assert.equal(standard.sale_name, 'Sale A')
  assert.equal(standard.sale_email, 'sale-a@kingcup.vn')
  assert.equal(standard.order_created_by, 'creator-a@kingcup.vn')
  assert.equal(standard.exported_by, 'warehouse@kingcup.vn')
  assert.equal(standard.affects_inventory, true)
})

test('hiển thị cả phiếu xuất ngoài hệ thống nhưng đánh dấu không ảnh hưởng tồn', () => {
  const rows = buildWarehouseExportHistoryRows({ exportOrders, exportItems, requests, orders })
  const external = rows.find(row => row.export_order_id === 'export-external')
  assert.ok(external)
  assert.equal(external.warehouse_name, 'Xuất ngoài hệ thống')
  assert.equal(external.logo_key, '__NO_LOGO__')
  assert.equal(external.quantity, 5)
  assert.equal(external.release_mode, 'external_no_inventory')
  assert.equal(external.affects_inventory, false)
})

test('không đưa phiếu đã hủy hoặc xóa vào lịch sử đang hoạt động', () => {
  const rows = buildWarehouseExportHistoryRows({ exportOrders, exportItems, requests, orders })
  assert.equal(rows.some(row => row.export_order_id === 'export-cancelled'), false)
})

test('lọc ngày giờ chính xác theo khoảng bao gồm cả hai mốc', () => {
  assert.equal(isDateTimeInRange('2026-08-06T08:35:00+07:00', '2026-08-06T08:35', '2026-08-06T08:35'), true)
  assert.equal(isDateTimeInRange('2026-08-06T08:34:59+07:00', '2026-08-06T08:35', ''), false)
  assert.equal(isDateTimeInRange('2026-08-06T08:36:00+07:00', '', '2026-08-06T08:35'), false)
})

test('bộ lọc tìm kiếm, kho, Sale, logo và ngày giờ kết hợp đúng', () => {
  const rows = buildWarehouseExportHistoryRows({ exportOrders, exportItems, requests, orders })
  const standard = rows.find(row => row.export_order_id === 'export-a')
  assert.ok(standard)

  assert.equal(matchesWarehouseExportHistoryFilters(standard, {
    keyword: 'khách a sp-a',
    warehouse: 'warehouse-a',
    sale: 'sale-a@kingcup.vn',
    logo: 'kingcup',
    from: '2026-08-06T08:30',
    to: '2026-08-06T08:40',
  }), true)
  assert.equal(matchesWarehouseExportHistoryFilters(standard, { warehouse: 'warehouse-b' }), false)
  assert.equal(matchesWarehouseExportHistoryFilters(standard, { sale: 'sale-b@kingcup.vn' }), false)
  assert.equal(matchesWarehouseExportHistoryFilters(standard, { logo: '__NO_LOGO__' }), false)
})

test('page lịch sử chỉ đọc và tái sử dụng SearchableSelect', async () => {
  const [page, accessMatrix, appShell, requestPage] = await Promise.all([
    readFile(new URL('../pages/warehouse-export-history.vue', import.meta.url), 'utf8'),
    readFile(new URL('../constants/accessMatrix.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../components/AppShell.vue', import.meta.url), 'utf8'),
    readFile(new URL('../pages/warehouse-export-requests.vue', import.meta.url), 'utf8'),
  ])

  assert.match(page, /<SearchableSelect/)
  assert.equal((page.match(/type="datetime-local"/g) || []).length, 2)
  assert.doesNotMatch(page, /writeBatch|runTransaction|setDoc|updateDoc|deleteDoc|addDoc/)
  assert.doesNotMatch(page, /Tạo phiếu|Sửa phiếu|Xóa phiếu|btn-delete|btn-edit/)
  assert.match(accessMatrix, /key: 'warehouse_export_history'.*path: '\/warehouse-export-history'.*permission: 'page\.exports'/s)
  assert.doesNotMatch(accessMatrix, /page\.warehouse_export_history|warehouse_export_history\.view/)
  assert.match(appShell, /warehouse_export_history:/)
  assert.equal((requestPage.match(/type="datetime-local"/g) || []).length >= 2, true)
  assert.match(requestPage, /isDateTimeInRange/)
})
