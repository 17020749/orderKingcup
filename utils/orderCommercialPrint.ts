import { toNumber } from '~/utils/format'
import {
  absoluteAsset, customerData, escapeHtml, flattenOrderItems, formatMoney, formatNumber,
  headerHtml, headingHtml, padRows, pageShell, productDisplayName,
  type CommercialPrintKind,
} from '~/utils/orderPrintShared'

type CommercialPrintOptions = {
  kind: CommercialPrintKind
  order: any
  items: any[]
  customer?: any
  depositPercent?: number
  paymentDepositAmount?: number
  assetBase?: string
}

function commercialColumnGroup(kind: CommercialPrintKind) {
  const widths = kind === 'quotation'
    ? [9.29, 62.43, 10.43, 14.43, 22.43, 30.29]
    : kind === 'order'
      ? [9.29, 62.43, 10.43, 14.43, 25.57, 29.14]
      : [9.29, 62.43, 10.43, 14.43, 26.86, 26.43]
  const total = widths.reduce((sum, value) => sum + value, 0)
  return `<colgroup>${widths.map(value => `<col style="width:${(value / total * 100).toFixed(4)}%">`).join('')}</colgroup>`
}

function commercialTerms(kind: CommercialPrintKind, depositPercent: number) {
  const third = kind === 'order'
    ? `3. Chính sách Thanh toán: Quý khách vui lòng tạm ứng ${formatNumber(depositPercent)}% giá trị đơn hàng ngay sau khi xác nhận mẫu và báo giá.`
    : '3. Chính sách Thanh toán: Quý khách vui lòng tạm ứng 50% giá trị đơn hàng ngay sau khi xác nhận mẫu và báo giá.'
  const fifth = kind === 'payment'
    ? '5. Thanh toán trước khi giao hàng'
    : '5. Tiến độ sản xuất: * Thời gian hoàn thiện cụ thể theo từng đơn hàng, tính từ khi nhận đủ tiền cọc. Lưu ý: Thời gian không bao gồm Thứ 7, Chủ Nhật và các ngày Lễ, Tết theo quy định.'
  return [
    '1. Sản phẩm & Pháp lý: Đầy đủ giấy tờ chứng nhận chất lượng và nguồn gốc xuất xứ.',
    '2. Số lượng sản xuất: Do đặc thù ngành in ấn, số lượng thực tế có thể dao động ±10% so với đơn đặt hàng. Quyết toán sẽ căn cứ trên số lượng thực giao',
    third,
    '4. Báo giá & Thuế: * Giá niêm yết đã bao gồm thuế VAT. Báo giá có hiệu lực tại thời điểm cung cấp và hỗ trợ giữ giá trong vòng 03 ngày.',
    fifth,
  ]
}

export function buildCommercialPrintHtml(options: CommercialPrintOptions) {
  const { kind, order, items, customer, assetBase } = options
  const rows = flattenOrderItems(items)
  const printedRows = padRows(rows, 15)
  const info = customerData(order, customer)
  const subtotal = toNumber(order.subtotal_no_vat) || rows.reduce((sum: number, item: any) => sum + item.lineTotal, 0)
  const vatRate = toNumber(order.vat_rate)
  const vatAmount = toNumber(order.vat_amount) || subtotal * vatRate / 100
  const total = toNumber(order.actual_revenue || order.total_vat) || subtotal + vatAmount
  const depositPercent = Math.max(0, Math.min(100, toNumber(options.depositPercent ?? 50)))
  const orderDeposit = total * depositPercent / 100
  const paymentDeposit = Math.max(0, toNumber(options.paymentDepositAmount))
  const paymentRemaining = Math.max(0, total - paymentDeposit)
  const title = kind === 'quotation' ? 'PHIẾU BÁO GIÁ' : kind === 'order' ? 'PHIẾU ĐẶT HÀNG' : 'PHIẾU THANH TOÁN'
  const codeLabel = kind === 'quotation' ? 'Số BG:' : 'Mã ĐH:'
  const saleName = order.sale_name || order.sale_display_name || ''
  const salePhone = order.sale_phone || order.sale_phone_number || ''
  const itemRows = printedRows.map((item: any, index) => `<tr class="item-row">
    <td class="center">${index + 1}</td><td>${item ? escapeHtml(productDisplayName(item)) : ''}</td>
    <td class="center">${item ? escapeHtml(item.unit || '') : ''}</td><td class="center">${item ? formatNumber(item.quantity) : ''}</td>
    <td class="right">${item ? formatMoney(item.unitPrice) : ''}</td><td class="center">${item ? formatMoney(item.lineTotal) : '0'}</td>
  </tr>`).join('')

  const extraSummaryRows = kind === 'order'
    ? `<tr><td class="summary-label">Số tiền cần đặt cọc (${formatNumber(depositPercent)}%)</td><td class="summary-value red">${formatMoney(orderDeposit)}</td></tr>`
    : kind === 'payment'
      ? `<tr><td class="summary-label">Số tiền cần đặt cọc</td><td class="summary-value">${formatMoney(paymentDeposit)}</td></tr>
         <tr><td class="summary-label">Số tiền cần thanh toán</td><td class="summary-value red">${formatMoney(paymentRemaining)}</td></tr>`
      : ''
  const summaryRowspan = kind === 'quotation' ? 3 : kind === 'order' ? 4 : 5
  const terms = commercialTerms(kind, depositPercent)
  const bankPrompt = kind === 'quotation'
    ? 'Nếu Quý khách đồng ý báo giá xin vui lòng thanh toán tiền cọc theo thông tin sau:'
    : kind === 'order'
      ? 'Quý khách xin vui lòng thanh toán tiền cọc theo thông tin sau:'
      : 'Quý khách vui lòng thanh toán số tiền còn lại theo thông tin sau:'

  return pageShell(`${title} - ${order.order_code || ''}`, `<section class="sheet">
    ${headerHtml(assetBase)}${headingHtml(title, codeLabel, order.order_code || order.id || '', order.order_date || order.created_at)}
    <section class="info-block">
      <div class="info-row"><span>Tên Công ty/HKD:</span><span>${escapeHtml(info.company)}</span></div>
      <div class="info-row"><span>Mã số thuế:</span><span>${escapeHtml(info.taxCode)}</span></div>
      <div class="info-row orderer"><span>Người đặt hàng:</span><span>${escapeHtml(info.contact)}</span><span>SĐT:</span><span>${escapeHtml(info.phone)}</span></div>
      <div class="info-row"><span>Địa chỉ hóa đơn:</span><span>${escapeHtml(info.billingAddress)}</span></div>
      <div class="info-row"><span>Địa chỉ giao hàng:</span><span>${escapeHtml(info.shippingAddress)}</span></div>
      <div class="info-row sale"><span>Nhân viên kinh doanh:</span><span>${escapeHtml(saleName)}</span><span>SĐT:</span><span>${escapeHtml(salePhone)}</span></div>
    </section>
    <section class="intro"><div>Lời đầu tiên, KingCup Việt Nam xin trân trọng cảm ơn quý khách đã qua tâm tới sản phẩm của công ty chúng tôi.</div><div>Chúng tôi xin gửi tới đến quý khách hàng báo giá chi tiết như sau:</div></section>
    <table class="items-table">${commercialColumnGroup(kind)}<thead><tr><th>STT</th><th>TÊN SẢN PHẨM</th><th>ĐVT</th><th>SỐ LƯỢNG</th><th>ĐƠN GIÁ</th><th>THÀNH TIỀN</th></tr></thead><tbody>
      ${itemRows}<tr><td class="summary-note" colspan="4" rowspan="${summaryRowspan}"><strong>Ghi Chú:</strong> ${escapeHtml(order.note || 'Đơn giá chưa bao gồm vận chuyển')}</td><td class="summary-label">Cộng tiền hàng</td><td class="summary-value">${formatMoney(subtotal)}</td></tr>
      <tr><td class="summary-label">Thuế VAT (${formatNumber(vatRate)}%)</td><td class="summary-value">${formatMoney(vatAmount)}</td></tr>
      <tr><td class="summary-label">Thành tiền</td><td class="summary-value red">${formatMoney(total)}</td></tr>${extraSummaryRows}
    </tbody></table>
    <section class="notes-area"><div class="notes-title">Lưu ý:</div>${terms.map(term => `<p class="notes-line">${escapeHtml(term)}</p>`).join('')}
      <div class="bank-prompt">${escapeHtml(bankPrompt)}</div><div class="bank-details"><div class="bank-name">CÔNG TY TNHH KINGCUP VIỆT NAM</div><div class="bank-account">STK: 5699 8899 - Techcombank</div></div>
      <img class="qr-image" src="${absoluteAsset(assetBase, '/kingcup-bank-qr.svg')}" alt="QR thanh toán"><div class="closing">Chúng tôi rất mong muốn nhận được sự hồi âm của Quý khách hàng trong thời gian sớm nhất. Chân thành cảm ơn!</div>
    </section>
  </section>`)
}
