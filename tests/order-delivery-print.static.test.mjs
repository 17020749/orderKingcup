import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('orders print modal adds delivery slip using warehouse template and order item rows', () => {
  const ordersPage = readFileSync('pages/orders.vue', 'utf8')
  const orderPrint = readFileSync('components/OrderPrintModal.vue', 'utf8')
  const requestPrint = readFileSync('components/ExportRequestPrintModal.vue', 'utf8')

  assert.ok(ordersPage.includes(':items="selectedPrintItems"'))
  assert.ok(ordersPage.includes(':requests="selectedPrintRequests"'))
  assert.ok(orderPrint.includes("key: 'delivery'"))
  assert.ok(orderPrint.includes("title: 'Phiếu xuất hàng'"))
  assert.ok(orderPrint.includes('buildDeliveryPrintHtml'))
  assert.ok(requestPrint.includes('buildDeliveryPrintHtml'))
  assert.ok(orderPrint.includes('props.items || []'))
  assert.ok(orderPrint.includes('safeJsonParse(item.logo_json'))
  assert.ok(orderPrint.includes('quantity: toNumber(line.quantity ?? line.qty)'))
  assert.ok(orderPrint.includes('packingStandard: item.packing_standard'))
  assert.ok(orderPrint.includes("kind === 'delivery'"))
  assert.ok(!orderPrint.includes('requestLineProgress'))
})

test('orders delivery slip keeps warehouse request recipient snapshot and only replaces product rows', () => {
  const orderPrint = readFileSync('components/OrderPrintModal.vue', 'utf8')
  const requestPrint = readFileSync('components/ExportRequestPrintModal.vue', 'utf8')

  for (const field of ['receiver_name', 'receiver_phone', 'receiver_address']) {
    assert.ok(orderPrint.includes(field))
    assert.ok(requestPrint.includes(field))
  }
  assert.ok(orderPrint.includes('const deliverySnapshot = computed'))
  assert.ok(orderPrint.includes('const deliveryOrder = computed'))
  assert.ok(orderPrint.includes('const deliveryCustomer = computed'))
  assert.ok(orderPrint.includes('order: deliveryOrder.value'))
  assert.ok(orderPrint.includes('customer: deliveryCustomer.value'))
  assert.ok(orderPrint.includes('rows: deliveryRows.value'))
})

test('orders delivery slip can print without export request and uses latest active request when available', () => {
  const orderPrint = readFileSync('components/OrderPrintModal.vue', 'utf8')

  assert.ok(orderPrint.includes('const deliveryRequest = computed'))
  assert.ok(orderPrint.includes('requestTimeValue(right) - requestTimeValue(left)'))
  assert.ok(orderPrint.includes('request?.deleted !== true'))
  assert.ok(orderPrint.includes('request?.active !== false'))
  assert.ok(orderPrint.includes('request_id: props.order.order_code'))
  assert.ok(orderPrint.includes("showToast('Đơn hàng chưa có sản phẩm để in phiếu xuất hàng.'"))
})
