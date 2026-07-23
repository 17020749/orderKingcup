import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('xử lý yêu cầu xuất kho hiển thị menu in riêng theo từng dòng', () => {
  const page = readFileSync('pages/warehouse-export-requests.vue', 'utf8')
  assert.match(page, /<WarehousePrintMenu/)
  assert.match(page, /:request="row"/)
})

test('menu in có đúng ba lựa chọn và kiểm tra phiếu xuất đang hoạt động', () => {
  const component = readFileSync('components/WarehousePrintMenu.vue', 'utf8')
  for (const label of ['Phiếu xuất kho', 'Tem gửi bưu điện', 'Tem gửi nhà xe']) {
    assert.match(component, new RegExp(label))
  }
  assert.match(component, /activeExportOrderId/)
  assert.match(component, /export\.view/)
  assert.match(component, /export\.print/)
  assert.match(component, /bus_transport\.view/)
})

test('mẫu tem không tự điền số kiện và dùng sản phẩm/logo của export_order_items', () => {
  const documentBuilder = readFileSync('utils/parcelLabelPrintDocuments.ts', 'utf8')
  const modal = readFileSync('components/ParcelLabelPrintModal.vue', 'utf8')
  assert.match(documentBuilder, /class="center package-cell">&nbsp;<\/td>/)
  assert.match(modal, /item\.product_name/)
  assert.match(modal, /item\.logo \|\| item\.target_logo \|\| item\.source_logo/)
})
