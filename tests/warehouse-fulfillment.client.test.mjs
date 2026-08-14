import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildWarehouseFulfillmentRows } from '../utils/warehouseFulfillment.mjs'

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
