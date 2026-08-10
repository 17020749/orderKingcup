import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const modalSource = readFileSync('components/OrderPrintModal.vue', 'utf8')
const documentSource = readFileSync('utils/orderPaymentRequestPrintDocuments.ts', 'utf8')

test('modal đơn hàng có hai lựa chọn đề nghị thanh toán và đề nghị tạm ứng', () => {
  assert.match(modalSource, /key: 'payment_request'/)
  assert.match(modalSource, /title: 'Mẫu đề nghị thanh toán'/)
  assert.match(modalSource, /key: 'advance_request'/)
  assert.match(modalSource, /title: 'Mẫu đề nghị tạm ứng'/)
})

test('đề nghị thanh toán cấu hình tổng đã tạm ứng từ input số tiền cọc hiện có', () => {
  assert.match(modalSource, /Tổng giá trị đã tạm ứng \(đặt cọc\)/)
  assert.match(modalSource, /v-model\.number="paymentDepositAmount"/)
  assert.match(modalSource, /paidDepositAmount: paymentDepositAmount\.value/)
  assert.match(documentSource, /const paid = Math\.max\(0, toNumber\(options\.paidDepositAmount\)\)/)
  assert.match(documentSource, /const remaining = Math\.max\(0, total - paid\)/)
})

test('đề nghị tạm ứng cấu hình phần trăm và tự tính số tiền đề nghị', () => {
  assert.match(modalSource, /Phần trăm đề nghị tạm ứng \(đặt cọc\)/)
  assert.match(modalSource, /v-model\.number="depositPercent"/)
  assert.match(documentSource, /const percent = cleanPercent\(options\.depositPercent \?\? 50\)/)
  assert.match(documentSource, /const advance = total \* percent \/ 100/)
})

test('mẫu in bám thông số Google Docs: A4, Arial, lề 25.4mm và tiêu đề 15pt', () => {
  assert.match(documentSource, /@page \{ size: A4 portrait; margin: 25\.4mm; \}/)
  assert.match(documentSource, /font-family: Arial, sans-serif/)
  assert.match(documentSource, /font-size: 15pt/)
  assert.match(documentSource, /kind === 'payment_request' \? '1\.15' : '1\.5'/)
})

test('mẫu giữ nguyên các nội dung pháp lý và thông tin ngân hàng chính', () => {
  assert.match(documentSource, /CÔNG TY TNHH KINGCUP VIỆT NAM/)
  assert.match(documentSource, /0111385965/)
  assert.match(documentSource, /56998899/)
  assert.match(documentSource, /5699 8899/)
  assert.match(documentSource, /Ngân hàng TMCP Kỹ Thương Việt Nam \(Techcombank\)/)
  assert.match(documentSource, /GIẤY ĐỀ NGHỊ THANH TOÁN/)
  assert.match(documentSource, /GIẤY ĐỀ NGHỊ TẠM ỨNG/)
})
