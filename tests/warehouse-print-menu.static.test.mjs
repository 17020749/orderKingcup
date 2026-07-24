import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('warehouse request page prints entirely from request snapshots', () => {
  const page = readFileSync('pages/warehouse-export-requests.vue', 'utf8')
  assert.ok(page.includes('<WarehousePrintMenu'))
  assert.ok(page.includes(':request="row"'))
  assert.ok(!page.includes(':order="orders.find'))
  assert.ok(!page.includes('loadScopedOrders'))
  assert.ok(!page.includes('loadScopedOrderItems'))
  assert.ok(!page.includes('itemsByOrder'))
})

test('warehouse print menu has three choices without order or customer reads', () => {
  const component = readFileSync('components/WarehousePrintMenu.vue', 'utf8')
  for (const label of ['Phiếu xuất kho', 'Tem gửi bưu điện', 'Tem gửi nhà xe']) {
    assert.ok(component.includes(label))
  }
  assert.ok(component.includes('tu_choi'))
  assert.ok(component.includes('requestLineProgress'))
  assert.ok(component.includes('export.print'))
  assert.ok(component.includes('bus_transport.view'))
  assert.ok(!component.includes("collection(db, 'orders')"))
  assert.ok(!component.includes("doc(db, 'customers'"))
  assert.ok(!component.includes('props.order'))
})

test('request and parcel print modals use snapshot recipient data only', () => {
  const requestModal = readFileSync('components/ExportRequestPrintModal.vue', 'utf8')
  const parcelModal = readFileSync('components/ParcelLabelPrintModal.vue', 'utf8')
  const documentBuilder = readFileSync('utils/parcelLabelPrintDocuments.ts', 'utf8')
  assert.ok(requestModal.includes('receiver_name'))
  assert.ok(requestModal.includes('receiver_phone'))
  assert.ok(requestModal.includes('receiver_address'))
  assert.ok(!requestModal.includes("getOne('customers'"))
  assert.ok(!requestModal.includes('OrderDoc'))
  assert.ok(parcelModal.includes('request?.receiver_name'))
  assert.ok(parcelModal.includes('request?.receiver_phone'))
  assert.ok(parcelModal.includes('request?.receiver_address'))
  assert.ok(!parcelModal.includes('CustomerDoc'))
  assert.ok(!parcelModal.includes('OrderDoc'))
  assert.ok(documentBuilder.includes('class="center package-cell">&nbsp;</td>'))
})

test('warehouse request actions have a defined pure status patch helper', () => {
  const page = readFileSync('pages/warehouse-export-requests.vue', 'utf8')
  const helper = readFileSync('utils/fallbackOrderPatch.ts', 'utf8')

  assert.ok(page.includes('const orderPatch = fallbackOrderPatch(nextStatus)'))
  assert.ok(page.includes("orderSummaryPatch: fallbackOrderPatch('da_xuat')"))
  assert.ok(page.includes("orderSummaryPatch: fallbackOrderPatch('da_tiep_nhan')"))
  assert.ok(helper.includes('export function fallbackOrderPatch'))
  assert.ok(helper.includes("nextStatus === 'da_xuat'"))
  assert.ok(helper.includes("nextStatus === 'da_tiep_nhan'"))
  assert.ok(helper.includes("nextStatus === 'tu_choi'"))
  assert.ok(!helper.includes("collection(db, 'orders')"))
  assert.ok(!helper.includes("doc(db, 'orders'"))
  assert.ok(!helper.includes('customers'))
})
