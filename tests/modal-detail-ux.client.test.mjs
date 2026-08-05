import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')

test('order modal only shows requested overview fields and moves four sections to a secondary modal', () => {
  const source = read('pages/orders.vue')
  const mainStart = source.indexOf('<RecordDetailModal')
  const mainEnd = source.indexOf('</RecordDetailModal>', mainStart)
  const main = source.slice(mainStart, mainEnd)
  assert.match(main, /title="Tổng quan đơn hàng"/)
  assert.match(main, /include-unlisted-fields="false"/)
  assert.match(main, /Chi tiết đơn hàng/)
  assert.doesNotMatch(main, /Chi tiết sản phẩm và tiến độ xuất/)
  const secondary = source.slice(source.indexOf('v-if="showOrderBreakdownModal'))
  for (const heading of [
    'Chi tiết sản phẩm và tiến độ xuất',
    'Các lần yêu cầu/xuất kho',
    'Chi tiết từng lần xuất theo sản phẩm',
    'Sản phẩm trong đơn hàng',
  ]) assert.match(secondary, new RegExp(heading.replace('/', '\\/')))
  for (const field of [
    'order_code','customer_code','user_code','order_classification','customer_name','phone',
    'sale_name','created_by','created_at','order_status','subtotal_no_vat','vat_rate',
    'vat_amount','total_vat','discount_amount','payable_amount','actual_revenue','paid_amount',
    'debt_amount','payment_status','invoice_status','warehouse_fulfillment_status',
    'cod_amount_total','computed_payment_status','shipping_fee','shipment_status','shipping_fee_total',
  ]) assert.ok(main.includes(`'${field}'`), `missing order field ${field}`)
})

test('payment and invoice detail modals show only requested fields with Vietnamese labels', () => {
  const payments = read('pages/payments.vue')
  assert.match(payments, /recipient_name: 'Tài khoản người nhận'/)
  assert.match(payments, /recipient_account_number: 'STK người nhận'/)
  assert.match(payments, /recipient_bank_name: 'Ngân hàng người nhận'/)
  assert.match(payments, /link-fields="\['sender_image_url'\]"/)
  assert.match(payments, /include-unlisted-fields="false"/)

  const invoices = read('pages/invoices.vue')
  assert.match(invoices, /invoice_amount: 'Giá trị hóa đơn'/)
  assert.match(invoices, /billing_address: 'Địa chỉ hóa đơn'/)
  assert.match(invoices, /include-unlisted-fields="false"/)
})

test('record detail supports compact columns, strict fields and header actions', () => {
  const detail = read('components/RecordDetailModal.vue')
  const modal = read('components/BaseModal.vue')
  assert.match(detail, /includeUnlistedFields/)
  assert.match(detail, /linkFields/)
  assert.match(detail, /slot name="actions"/)
  assert.match(modal, /slot name="header-actions"/)
})

test('inventory movement type is translated before display', () => {
  const source = read('pages/inventory.vue')
  assert.match(source, /function movementTypeLabel/)
  assert.match(source, /export_customer: 'Xuất cho khách hàng'/)
  assert.match(source, /export_transfer_in: 'Nhập chuyển kho'/)
  assert.match(source, /\{\{ movementTypeLabel\(movement\) \}\}/)
})
