import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('xử lý yêu cầu xuất kho hiển thị menu in theo từng dòng', () => {
  const page = readFileSync('pages/warehouse-export-requests.vue', 'utf8')
  assert.match(page, /<WarehousePrintMenu/)
  assert.match(page, /:request="row"/)
})

test('menu in có đúng ba lựa chọn và chỉ loại yêu cầu từ chối', () => {
  const component = readFileSync('components/WarehousePrintMenu.vue', 'utf8')
  for (const label of ['Phiếu xuất kho', 'Tem gửi bưu điện', 'Tem gửi nhà xe']) {
    assert.match(component, new RegExp(label))
  }
  assert.match(component, /tu_choi/)
  assert.match(component, /ExportRequestPrintModal/)
  assert.match(component, /requestLineProgress/)
  assert.match(component, /export\.print/)
  assert.match(component, /bus_transport\.view/)
  assert.doesNotMatch(component, /status.*===.*da_xuat/)
})

test('mẫu tem để trống số kiện và không có input sửa địa chỉ trước khi in', () => {
  const documentBuilder = readFileSync('utils/parcelLabelPrintDocuments.ts', 'utf8')
  const modal = readFileSync('components/ParcelLabelPrintModal.vue', 'utf8')
  assert.match(documentBuilder, /class="center package-cell">&nbsp;<\/td>/)
  assert.match(modal, /customer\?\.shipping_address/)
  assert.match(modal, /customer\?\.billing_address/)
  assert.doesNotMatch(modal, /v-model="form\.receiver_address"/)
  assert.doesNotMatch(modal, /<input[^>]+Địa chỉ/)
})

test('page nhà xe chọn yêu cầu mọi trạng thái trừ từ chối và lấy khách hàng theo customer_id', () => {
  const page = readFileSync('pages/bus-transport.vue', 'utf8')
  assert.match(page, /collection\(db, 'order_export_requests'\)/)
  assert.match(page, /collection\(db, 'orders'\)/)
  assert.match(page, /getDoc\(doc\(db, 'customers', id\)\)/)
  assert.match(page, /isRejectedRequest/)
  assert.match(page, /source_request_id/)
  assert.doesNotMatch(page, /activeExportOrders/)
})
