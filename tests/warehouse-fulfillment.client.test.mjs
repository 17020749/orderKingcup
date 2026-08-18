import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildWarehouseFulfillmentRows,
  orderWarehouseFulfillmentSummaryFromRequests,
} from '../utils/warehouseFulfillment.mjs'

const item = {
  id: 'order-item-cup',
  product_id: 'cup-12oz',
  product_code: 'CUP-12OZ',
  product_name: 'Ly 12oz',
  unit: 'cái',
  logo_json: JSON.stringify([
    { logo: 'Kingcup', quantity: 10 },
    { logo: '', quantity: 8 },
  ]),
}

test('xuất row không logo không được ghi nhận vào row có logo đứng trước', () => {
  const rows = buildWarehouseFulfillmentRows([item], [{
    id: 'request-no-logo',
    status: 'da_xuat',
    payload_json: JSON.stringify({
      items: [{
        source_order_item_id: 'order-item-cup',
        product_id: 'cup-12oz',
        product_code: 'CUP-12OZ',
        logo: '',
        export_quantity: 3,
      }],
    }),
  }])

  assert.deepEqual(rows.map(row => ({
    logo: row.logo,
    requested: row.requested_qty,
    exported: row.exported_qty,
  })), [
    { logo: 'Kingcup', requested: 0, exported: 0 },
    { logo: '', requested: 3, exported: 3 },
  ])
})

test('yêu cầu legacy không logo cũng chỉ phân bổ vào row không logo', () => {
  const rows = buildWarehouseFulfillmentRows([item], [{
    id: 'legacy-request-no-logo',
    status: 'da_xuat',
    payload_json: JSON.stringify({
      items: [{ product_code: 'CUP-12OZ', logo: '', export_quantity: 2 }],
    }),
  }])

  assert.equal(rows[0].exported_qty, 0)
  assert.equal(rows[1].exported_qty, 2)
})

function request(id, status, quantity, orderQuantity = 10) {
  return {
    id,
    status,
    active: true,
    deleted: false,
    payload_json: JSON.stringify({
      items: [{
        source_order_item_id: 'order-item-a',
        product_id: 'product-a',
        product_code: 'PRODUCT-A',
        order_quantity: orderQuantity,
        export_quantity: quantity,
      }],
    }),
  }
}

test('order summary keeps pending priority when a sibling request was exported', () => {
  assert.deepEqual(orderWarehouseFulfillmentSummaryFromRequests([
    request('released', 'da_xuat', 4),
    request('pending', 'cho_xu_ly', 6),
  ]), {
    warehouse_fulfillment_status: 'da_xuat_1_phan',
    warehouse_request_status: 'cho_xu_ly',
  })
})

test('order summary keeps accepted priority when a sibling request remains accepted', () => {
  assert.deepEqual(orderWarehouseFulfillmentSummaryFromRequests([
    request('released', 'da_xuat', 4),
    request('accepted', 'da_tiep_nhan', 6),
  ]), {
    warehouse_fulfillment_status: 'da_xuat_1_phan',
    warehouse_request_status: 'da_tiep_nhan',
  })
})

test('rejected siblings do not override a released request summary', () => {
  assert.deepEqual(orderWarehouseFulfillmentSummaryFromRequests([
    request('released', 'da_xuat', 10),
    request('rejected', 'tu_choi', 2),
  ]), {
    warehouse_fulfillment_status: 'da_xuat_du',
    warehouse_request_status: 'da_xuat',
  })
})
