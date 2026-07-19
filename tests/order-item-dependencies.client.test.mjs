import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  collectOrderItemDependencies,
  validateOrderItemEdit,
  validateWarehouseReleaseSources,
} from '../utils/orderItemDependencies.mjs'

const order = { id: 'order-a', warehouse_fulfillment_status: 'chua_xuat' }
const previousItems = [
  { id: 'item-b', product_id: 'product-b', product_code: 'B', product_name: 'Bình B', quantity: 10 },
  {
    id: 'item-logo', product_id: 'product-logo', product_code: 'LOGO', product_name: 'Áo logo',
    logo_json: JSON.stringify([{ logo: 'Trước', quantity: 6 }, { logo: 'Sau', quantity: 4 }]),
  },
]

function request(status, items, extra = {}) {
  return {
    id: `request-${status}`,
    order_id: order.id,
    status,
    active: true,
    deleted: false,
    payload_json: JSON.stringify({ items }),
    ...extra,
  }
}

function printData(items) {
  return {
    printOrders: [{ id: 'print-a', order_id: order.id, status: 'active', active: true }],
    printItems: items.map(item => ({ print_order_id: 'print-a', status: 'active', active: true, ...item })),
  }
}

test('cho phép thêm sản phẩm mới mà không bị các tham chiếu cũ cản trở', () => {
  const error = validateOrderItemEdit({
    order,
    previousItems,
    nextItems: [...previousItems, { id: 'item-c', product_id: 'product-c', product_code: 'C', quantity: 3 }],
    exportRequests: [request('da_tiep_nhan', [{ order_item_id: 'item-b', product_id: 'product-b', product_code: 'B', export_quantity: 4 }])],
  })
  assert.equal(error, '')
})

test('khóa xóa hoặc thay sản phẩm đang nằm trong phiếu xuất', () => {
  const dependency = request('cho_xu_ly', [
    { order_item_id: 'item-b', product_id: 'product-b', product_code: 'B', export_quantity: 4 },
  ])
  assert.match(validateOrderItemEdit({ order, previousItems, nextItems: previousItems.filter(item => item.id !== 'item-b'), exportRequests: [dependency] }), /không thể xóa hoặc thay/)
  assert.match(validateOrderItemEdit({
    order,
    previousItems,
    nextItems: previousItems.map(item => item.id === 'item-b' ? { ...item, product_id: 'product-c', product_code: 'C' } : item),
    exportRequests: [dependency],
  }), /không thể xóa hoặc thay/)
})

test('khóa xóa logo đang nằm trong tiến độ in nhưng vẫn cho tăng hoặc giảm số lượng', () => {
  const printing = printData([{ source_order_item_id: 'item-logo', product_id: 'product-logo', product_code: 'LOGO', logo: 'Trước' }])
  const removedLogo = previousItems.map(item => item.id !== 'item-logo' ? item : {
    ...item,
    logo_json: JSON.stringify([{ logo: 'Sau', quantity: 4 }]),
  })
  assert.match(validateOrderItemEdit({ order, previousItems, nextItems: removedLogo, ...printing }), /tiến độ in/)

  for (const nextQuantity of [2, 12]) {
    const changed = previousItems.map(item => item.id !== 'item-logo' ? item : {
      ...item,
      logo_json: JSON.stringify([{ logo: 'Trước', quantity: nextQuantity }, { logo: 'Sau', quantity: 4 }]),
    })
    assert.equal(validateOrderItemEdit({ order, previousItems, nextItems: changed, ...printing }), '')
  }
})

test('cho giảm đúng bằng tổng đang xử lý và đã xuất, chặn thấp hơn và không tính trùng một phiếu', () => {
  const open = request('da_tiep_nhan', [{
    order_item_id: 'item-b', product_id: 'product-b', product_code: 'B',
    export_quantity: 3, processed_quantity: 3, exported_quantity: 1,
  }])
  const released = request('da_xuat', [{
    order_item_id: 'item-b', product_id: 'product-b', product_code: 'B', export_quantity: 2,
  }], {
    actual_export_summary_json: JSON.stringify([{
      source_order_item_id: 'item-b', product_id: 'product-b', product_code: 'B', quantity: 2,
    }]),
  })
  const dependencies = collectOrderItemDependencies({ previousItems, exportRequests: [open, released] })
  assert.equal(dependencies.commitments.get('item-b|'), 5)

  const atFloor = previousItems.map(item => item.id === 'item-b' ? { ...item, quantity: 5 } : item)
  const belowFloor = previousItems.map(item => item.id === 'item-b' ? { ...item, quantity: 4 } : item)
  assert.equal(validateOrderItemEdit({ order, previousItems, nextItems: atFloor, exportRequests: [open, released] }), '')
  assert.match(validateOrderItemEdit({ order, previousItems, nextItems: belowFloor, exportRequests: [open, released] }), /không thể giảm số lượng/)
})

test('phiếu bị từ chối hoặc xóa không khóa sản phẩm và không tạo số lượng cam kết', () => {
  const ignored = [
    request('tu_choi', [{ order_item_id: 'item-b', product_code: 'B', export_quantity: 10 }]),
    { ...request('da_tiep_nhan', [{ order_item_id: 'item-b', product_code: 'B', export_quantity: 10 }]), deleted: true, active: false },
  ]
  assert.equal(validateOrderItemEdit({
    order,
    previousItems,
    nextItems: previousItems.filter(item => item.id !== 'item-b'),
    exportRequests: ignored,
  }), '')
})

test('khóa toàn bộ chỉnh sửa khi đơn đã xuất đủ, kể cả chỉ thêm sản phẩm', () => {
  const error = validateOrderItemEdit({
    order: { ...order, warehouse_fulfillment_status: 'da_xuat_du' },
    previousItems,
    nextItems: [...previousItems, { id: 'new', product_id: 'new', product_code: 'NEW', quantity: 1 }],
  })
  assert.match(error, /toàn bộ nội dung đơn đã bị khóa/)
})

test('dữ liệu cũ không có order_item_id chỉ được đối chiếu khi sản phẩm + logo là duy nhất', () => {
  const legacy = request('cho_xu_ly', [{ product_code: 'B', logo: '', export_quantity: 2 }])
  assert.match(validateOrderItemEdit({
    order,
    previousItems: [previousItems[0], { ...previousItems[0], id: 'item-b-duplicate' }],
    nextItems: previousItems,
    exportRequests: [legacy],
  }), /bị trùng.*không thể đối chiếu/)
})

test('chốt chặn cuối chỉ cho xuất khi dòng, sản phẩm, logo và số lượng còn tồn tại trong đơn', () => {
  const exportRequest = request('da_tiep_nhan', [{
    order_item_id: 'item-b', product_id: 'product-b', product_code: 'B', export_quantity: 4,
  }])
  const validLine = {
    source_order_id: order.id,
    source_order_item_id: 'item-b',
    product: { id: 'product-b', product_code: 'B' },
    logo: '',
    quantity: 4,
  }
  assert.equal(validateWarehouseReleaseSources({
    request: exportRequest,
    order,
    orderItems: previousItems,
    releaseLines: [validLine],
  }), '')
  assert.match(validateWarehouseReleaseSources({
    request: exportRequest,
    order,
    orderItems: previousItems.filter(item => item.id !== 'item-b'),
    releaseLines: [validLine],
  }), /Không tìm thấy dòng đơn hàng/)
  assert.match(validateWarehouseReleaseSources({
    request: exportRequest,
    order,
    orderItems: [{ ...previousItems[0], quantity: 3 }],
    releaseLines: [validLine],
  }), /không đủ để xuất 4/)
})
