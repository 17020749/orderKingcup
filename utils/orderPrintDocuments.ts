import { safeJsonParse, toNumber } from '~/utils/format'

export type CommercialPrintKind = 'quotation' | 'order' | 'payment'

export type PrintCustomer = {
  company?: string
  contact?: string
  phone?: string
  taxCode?: string
  billingAddress?: string
  shippingAddress?: string
}

export type DeliveryPrintRow = {
  productCode?: string
  productName?: string
  logo?: string
  unit?: string
  quantity?: number
  packingStandard?: string | number
  boxQuantity?: number
  oddQuantity?: number
}

type CommercialPrintOptions = {
  kind: CommercialPrintKind
  order: any
  items: any[]
  customer?: any
  depositPercent?: number
  paymentDepositAmount?: number
  assetBase?: string
}

type DeliveryPrintOptions = {
  order: any
  request: any
  customer?: any
  rows: DeliveryPrintRow[]
  warehouseName?: string
  assetBase?: string
}

function escapeHtml(value: any) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatNumber(value: any) {
  return toNumber(value).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
}

function formatMoney(value: any) {
  return toNumber(value).toLocaleString('vi-VN')
}

function toDate(value: any) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateParts(value: any) {
  const date = toDate(value)
  if (!date) return { day: '', month: '', year: '' }
  return {
    day: String(date.getDate()).padStart(2, '0'),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    year: String(date.getFullYear()),
  }
}

function absoluteAsset(assetBase: string | undefined, path: string) {
  const base = assetBase || (typeof window !== 'undefined' ? window.location.origin : '')
  if (!base) return path
  return new URL(path, base).href
}

function customerData(order: any, customer: any): PrintCustomer {
  const row = customer || {}
  return {
    company: row.company_name || row.customer_name || order.customer_name || '',
    contact: row.customer_name || order.customer_name || '',
    phone: row.phone || order.phone || '',
    taxCode: row.tax_code || order.tax_code || '',
    billingAddress: row.billing_address || order.billing_address || '',
    shippingAddress: row.shipping_address || order.shipping_address || '',
  }
}

function flattenOrderItems(items: any[]) {
  return (items || []).flatMap((item: any) => {
    const logoLines = safeJsonParse(item.logo_json || item.logos_json || item.logos, [])
    if (Array.isArray(logoLines) && logoLines.length) {
      return logoLines.map((line: any) => {
        const quantity = toNumber(line.quantity ?? line.qty)
        const unitPrice = toNumber(line.unit_price ?? item.unit_price)
        return {
          productCode: item.product_code || '',
          productName: item.product_name || '',
          logo: line.logo || '',
          unit: item.unit || '',
          quantity,
          unitPrice,
          lineTotal: toNumber(line.line_total) || quantity * unitPrice,
        }
      })
    }

    const quantity = toNumber(item.quantity)
    const unitPrice = toNumber(item.unit_price)
    return [{
      productCode: item.product_code || '',
      productName: item.product_name || '',
      logo: '',
      unit: item.unit || '',
      quantity,
      unitPrice,
      lineTotal: toNumber(item.line_total) || quantity * unitPrice,
    }]
  }).filter((item: any) => item.productName || item.productCode || item.quantity)
}

function productDisplayName(item: any) {
  const base = item.productName || item.productCode || '-'
  return item.logo ? `${base} - Logo: ${item.logo}` : base
}

function padRows<T>(rows: T[], count = 15): Array<T | null> {
  return [...rows, ...Array.from({ length: Math.max(0, count - rows.length) }, () => null)]
}

function commonCss() {
  return `
    @page { size: A4 portrait; margin: 19.05mm 6.35mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { font-family: Roboto, Arial, sans-serif; font-size: 7.2pt; }
    .print-toolbar { position: sticky; top: 0; z-index: 20; display: flex; justify-content: flex-end; gap: 8px; padding: 10px; background: #eef2ff; border-bottom: 1px solid #c7d2fe; }
    .print-toolbar button { border: 1px solid #94a3b8; background: #fff; border-radius: 7px; padding: 8px 14px; cursor: pointer; font: 600 13px Arial, sans-serif; }
    .print-toolbar button.primary { color: #fff; background: #1d4ed8; border-color: #1d4ed8; }
    .sheet { width: 197.3mm; margin: 0 auto; }
    table.form-sheet { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .form-sheet td, .form-sheet th { border: .75pt solid #000; padding: 0 1.2mm; vertical-align: middle; overflow: hidden; }
    .form-sheet td { height: 11.34pt; }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: 700; }
    .company-title { height: 17.82pt; text-align: center; color: #f00; font-size: 10.08pt; font-weight: 700; white-space: nowrap; }
    .company-line { height: 11.34pt; font-size: 7.2pt; white-space: nowrap; }
    .logo-cell { padding: 0 1mm !important; vertical-align: top !important; }
    .logo-cell img { width: 16mm; height: auto; margin-top: 1mm; display: block; }
    .blank-cell { background: #fff; }
    .doc-title { font-family: "Times New Roman", serif; font-size: 20.16pt; font-weight: 700; text-align: center; white-space: nowrap; }
    .delivery-title { font-family: "Times New Roman", serif; font-size: 16.56pt; font-weight: 700; text-align: center; white-space: nowrap; }
    .date-cell { font-size: 7.2pt; text-align: center; white-space: nowrap; }
    .code-cell { font-size: 7.92pt; }
    .info-cell { font-size: 8.64pt; }
    .intro-cell { font-size: 8.64pt; }
    .product-head th { height: 18.36pt; background: #a4c2f4; font-size: 8.64pt; font-weight: 700; text-align: center; }
    .delivery-head th { background: #fff; font-size: 8.64pt; font-weight: 700; text-align: center; }
    .item-row td { height: 11.34pt; font-size: 8.64pt; }
    .summary-note { font-size: 7.92pt; vertical-align: middle !important; }
    .summary-label, .summary-value { height: 11.34pt; font-size: 8.64pt; font-weight: 700; }
    .summary-value { text-align: center; }
    .red { color: #f00; }
    .spacer-row td { height: 5.94pt; }
    .note-title { font-size: 8.64pt; font-weight: 700; }
    .note-line { font-size: 7.2pt; line-height: 1.15; }
    .note-line.tall { height: 17.82pt; }
    .note-line.taller { height: 18.9pt; }
    .bank-prompt { font-size: 8.64pt; }
    .bank-name { font-family: "Times New Roman", serif; font-size: 7.92pt; font-weight: 700; text-align: center; color: #081b3a; }
    .bank-account { font-family: "Times New Roman", serif; font-size: 8.64pt; font-weight: 700; text-align: center; }
    .qr-cell { padding: 0 !important; text-align: center; vertical-align: middle !important; }
    .qr-cell img { width: 21.6mm; height: 24.48mm; object-fit: contain; }
    .closing { font-size: 7.92pt; }
    .delivery-note-box { height: 43.2pt !important; font-size: 7.92pt; vertical-align: top !important; padding-top: 2mm !important; white-space: pre-wrap; }
    .delivery-subhead { height: 25.92pt !important; font-size: 9.36pt; font-weight: 700; text-align: center; line-height: 1.15; }
    .delivery-legal { font-size: 7.92pt; }
    .signature-cell { height: 31.32pt !important; font-size: 9.36pt; font-weight: 700; text-align: center; vertical-align: top !important; padding-top: 4mm !important; }
    .signature-cell small { display: block; margin-top: .7mm; font-size: 7.2pt; font-weight: 400; font-style: italic; }
    @media screen {
      body { padding: 12px 0 30px; background: #e5e7eb; }
      .sheet { background: #fff; box-shadow: 0 8px 30px rgba(15,23,42,.18); }
    }
    @media print {
      .print-toolbar { display: none !important; }
      body { background: #fff; }
      .sheet { width: 100%; margin: 0; box-shadow: none; }
      tr { break-inside: avoid; }
    }
  `
}

function pageShell(title: string, body: string) {
  return `<!doctype html>
  <html lang="vi">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${escapeHtml(title)}</title>
      <style>${commonCss()}</style>
    </head>
    <body>
      <div class="print-toolbar">
        <button onclick="window.close()">Đóng</button>
        <button class="primary" onclick="window.print()">In phiếu</button>
      </div>
      ${body}
    </body>
  </html>`
}

function companyRows(assetBase?: string) {
  return `
    <tr>
      <td class="logo-cell" colspan="2" rowspan="4"><img src="${absoluteAsset(assetBase, '/kingcup-logo.svg')}" alt="KINGCUP"></td>
      <td class="blank-cell" rowspan="4"></td>
      <td class="company-title" colspan="4">CÔNG TY TNHH KINGCUP VIỆT NAM</td>
    </tr>
    <tr><td class="company-line" colspan="4">Địa chỉ: Số 01 ngách 17 ngõ 1333 Giải Phóng, Hoàng Mai, TP.Hà Nội, Việt Nam</td></tr>
    <tr><td class="company-line" colspan="4">Liên hệ: 033.570.2223&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Web: https://baobikingcup.vn/</td></tr>
    <tr><td class="company-line" colspan="4">Email: vietnamkingcup@gmail.com</td></tr>`
}

function commercialColumnGroup(kind: CommercialPrintKind) {
  const widths = kind === 'quotation'
    ? [9.29, 62.43, 10.43, 14.43, 22.43, 11, 19.29]
    : kind === 'order'
      ? [9.29, 62.43, 10.43, 14.43, 25.57, 15, 14.14]
      : [9.29, 62.43, 10.43, 14.43, 26.86, 11, 15.43]
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
  const date = dateParts(order.order_date || order.created_at)
  const title = kind === 'quotation' ? 'PHIẾU BÁO GIÁ' : kind === 'order' ? 'PHIẾU ĐẶT HÀNG' : 'PHIẾU THANH TOÁN'
  const codeLabel = kind === 'quotation' ? 'Số BG:' : 'Mã ĐH:'
  const intro = kind === 'quotation'
    ? 'Chúng tôi xin gửi tới đến quý khách hàng báo giá chi tiết như sau:'
    : kind === 'order'
      ? 'Chúng tôi xin gửi tới đến quý khách hàng nội dung đặt hàng chi tiết như sau:'
      : 'Chúng tôi xin gửi tới đến quý khách hàng nội dung thanh toán chi tiết như sau:'
  const saleName = order.sale_name || order.sale_display_name || ''
  const salePhone = order.sale_phone || order.sale_phone_number || ''
  const itemRows = printedRows.map((item: any, index) => `
    <tr class="item-row">
      <td class="center">${index + 1}</td>
      <td>${item ? escapeHtml(productDisplayName(item)) : ''}</td>
      <td class="center">${item ? escapeHtml(item.unit || '') : ''}</td>
      <td class="center">${item ? formatNumber(item.quantity) : ''}</td>
      <td class="right">${item ? formatMoney(item.unitPrice) : ''}</td>
      <td class="center" colspan="2">${item ? formatMoney(item.lineTotal) : '0'}</td>
    </tr>`).join('')

  const extraSummaryRows = kind === 'order'
    ? `<tr><td class="summary-label">Số tiền cần đặt cọc (${formatNumber(depositPercent)}%)</td><td class="summary-value red" colspan="2">${formatMoney(orderDeposit)}</td></tr>`
    : kind === 'payment'
      ? `<tr><td class="summary-label">Số tiền cần đặt cọc</td><td class="summary-value" colspan="2">${formatMoney(paymentDeposit)}</td></tr>
         <tr><td class="summary-label">Số tiền cần thanh toán</td><td class="summary-value red" colspan="2">${formatMoney(paymentRemaining)}</td></tr>`
      : ''
  const summaryRowspan = kind === 'quotation' ? 3 : kind === 'order' ? 4 : 5
  const terms = commercialTerms(kind, depositPercent)
  const bankPrompt = kind === 'quotation'
    ? 'Nếu Quý khách đồng ý báo giá xin vui lòng thanh toán tiền cọc theo thông tin sau:'
    : kind === 'order'
      ? 'Quý khách xin vui lòng thanh toán tiền cọc theo thông tin sau:'
      : 'Quý khách vui lòng thanh toán số tiền còn lại theo thông tin sau:'
  const qrStartRowspan = 6

  return pageShell(`${title} - ${order.order_code || ''}`, `
    <section class="sheet">
      <table class="form-sheet">
        ${commercialColumnGroup(kind)}
        <tbody>
          ${companyRows(assetBase)}
          <tr><td colspan="7" style="height:11.34pt"></td></tr>
          <tr>
            <td></td>
            <td class="doc-title" colspan="3" rowspan="2">${title}</td>
            <td class="date-cell" colspan="3">Ngày&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${escapeHtml(date.day)}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Tháng&nbsp;&nbsp;&nbsp;&nbsp;${escapeHtml(date.month)}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Năm&nbsp;&nbsp;&nbsp;&nbsp;${escapeHtml(date.year)}</td>
          </tr>
          <tr><td></td><td class="code-cell right" colspan="3"><strong>${codeLabel}</strong>&nbsp; ${escapeHtml(order.order_code || order.id || '')}</td></tr>
          <tr><td class="info-cell" colspan="7"><strong>Tên Công ty/HKD:</strong>&nbsp; ${escapeHtml(info.company)}</td></tr>
          <tr><td class="info-cell" colspan="7"><strong>Mã số thuế:</strong>&nbsp; ${escapeHtml(info.taxCode)}</td></tr>
          <tr><td class="info-cell" colspan="4"><strong>Người đặt hàng:</strong>&nbsp; ${escapeHtml(info.contact)}</td><td class="info-cell" colspan="3"><strong>SĐT:</strong>&nbsp; ${escapeHtml(info.phone)}</td></tr>
          <tr><td class="info-cell" colspan="7"><strong>Địa chỉ hóa đơn:</strong>&nbsp; ${escapeHtml(info.billingAddress)}</td></tr>
          <tr><td class="info-cell" colspan="7"><strong>Địa chỉ giao hàng:</strong>&nbsp; ${escapeHtml(info.shippingAddress)}</td></tr>
          <tr><td class="info-cell" colspan="4"><strong>Nhân viên kinh doanh:</strong>&nbsp; ${escapeHtml(saleName)}</td><td class="info-cell" colspan="3"><strong>SĐT:</strong>&nbsp; ${escapeHtml(salePhone)}</td></tr>
          <tr><td class="intro-cell" colspan="7">Lời đầu tiên, KingCup Việt Nam xin trân trọng cảm ơn quý khách đã quan tâm tới sản phẩm của công ty chúng tôi.</td></tr>
          <tr><td class="intro-cell" colspan="7">${intro}</td></tr>
          <tr class="product-head"><th>STT</th><th>TÊN SẢN PHẨM</th><th>ĐVT</th><th>SỐ LƯỢNG</th><th>ĐƠN GIÁ</th><th colspan="2">THÀNH TIỀN</th></tr>
          ${itemRows}
          <tr>
            <td class="summary-note" colspan="4" rowspan="${summaryRowspan}"><strong>Ghi Chú:</strong> ${escapeHtml(order.note || 'Đơn giá chưa bao gồm vận chuyển')}</td>
            <td class="summary-label">Cộng tiền hàng</td><td class="summary-value" colspan="2">${formatMoney(subtotal)}</td>
          </tr>
          <tr><td class="summary-label">Thuế VAT (${formatNumber(vatRate)}%)</td><td class="summary-value" colspan="2">${formatMoney(vatAmount)}</td></tr>
          <tr><td class="summary-label">Thành tiền</td><td class="summary-value red" colspan="2">${formatMoney(total)}</td></tr>
          ${extraSummaryRows}
          <tr class="spacer-row"><td colspan="7"></td></tr>
          <tr><td class="note-title" colspan="7">Lưu ý:</td></tr>
          <tr><td class="note-line" colspan="7">${escapeHtml(terms[0])}</td></tr>
          <tr><td class="note-line tall" colspan="7">${escapeHtml(terms[1])}</td></tr>
          <tr><td class="note-line" colspan="7">${escapeHtml(terms[2])}</td></tr>
          <tr><td class="note-line tall" colspan="5">${escapeHtml(terms[3])}</td><td class="qr-cell" colspan="2" rowspan="${qrStartRowspan}"><img src="${absoluteAsset(assetBase, '/kingcup-bank-qr.svg')}" alt="QR thanh toán"></td></tr>
          <tr><td class="note-line taller" colspan="5">${escapeHtml(terms[4])}</td></tr>
          <tr><td class="bank-prompt" colspan="5">${escapeHtml(bankPrompt)}</td></tr>
          <tr><td class="bank-name" colspan="2">CÔNG TY TNHH KINGCUP VIỆT NAM</td><td colspan="3"></td></tr>
          <tr><td class="bank-account" colspan="2">STK: 5699 8899 - Techcombank</td><td colspan="3"></td></tr>
          <tr><td colspan="5"></td></tr>
          <tr><td class="closing" colspan="7">Chúng tôi rất mong muốn nhận được sự hồi âm của Quý khách hàng trong thời gian sớm nhất. Chân thành cảm ơn!</td></tr>
        </tbody>
      </table>
    </section>`)
}

function deliveryColumnGroup() {
  const widths = [9.29, 44.86, 10.43, 14.43, 17.71, 14.86, 21]
  const total = widths.reduce((sum, value) => sum + value, 0)
  return `<colgroup>${widths.map(value => `<col style="width:${(value / total * 100).toFixed(4)}%">`).join('')}</colgroup>`
}

function packingNumber(value: any) {
  const match = String(value || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return match ? toNumber(match[0]) : 0
}

export function buildDeliveryPrintHtml(options: DeliveryPrintOptions) {
  const { order, request, customer, warehouseName, assetBase } = options
  const info = customerData(order, customer)
  const rows = (options.rows || []).filter(row => row.productName || row.productCode || toNumber(row.quantity))
  const printedRows = padRows(rows, 15)
  const date = dateParts(request.export_date || request.warehouse_handled_at || request.updated_at || request.requested_at || order.order_date)
  const note = safeJsonParse(request.payload_json, {}).note || request.warehouse_note || ''
  const saleName = order.sale_name || order.sale_display_name || safeJsonParse(request.payload_json, {}).sale_name || ''
  const salePhone = order.sale_phone || order.sale_phone_number || ''
  let totalQuantity = 0
  let totalBoxes = 0
  const itemRows = printedRows.map((item: DeliveryPrintRow | null, index) => {
    if (!item) {
      return `<tr class="item-row"><td class="center">${index + 1}</td><td></td><td></td><td></td><td></td><td></td><td class="center">0</td></tr>`
    }
    const quantity = toNumber(item.quantity)
    const standard = packingNumber(item.packingStandard)
    const boxes = toNumber(item.boxQuantity) || (standard > 0 ? Math.floor(quantity / standard) : 0)
    const odd = toNumber(item.oddQuantity) || (standard > 0 ? quantity % standard : 0)
    totalQuantity += quantity
    totalBoxes += boxes
    const name = item.logo ? `${item.productName || item.productCode} - Logo: ${item.logo}` : (item.productName || item.productCode || '')
    return `<tr class="item-row">
      <td class="center">${index + 1}</td>
      <td>${escapeHtml(name)}</td>
      <td class="center">${escapeHtml(item.unit || '')}</td>
      <td class="center">${formatNumber(quantity)}</td>
      <td class="center">${standard ? formatNumber(standard) : escapeHtml(item.packingStandard || '')}</td>
      <td class="center">${boxes ? formatNumber(boxes) : ''}</td>
      <td class="center">${odd ? formatNumber(odd) : '0'}</td>
    </tr>`
  }).join('')

  return pageShell(`Phiếu xuất kho - ${request.request_id || order.order_code || ''}`, `
    <section class="sheet">
      <table class="form-sheet">
        ${deliveryColumnGroup()}
        <tbody>
          ${companyRows(assetBase)}
          <tr><td class="delivery-title" colspan="7" style="height:43.2pt">PHIẾU XUẤT KHO VÀ BIÊN BẢN BÀN GIAO</td></tr>
          <tr><td colspan="4"></td><td class="date-cell" colspan="3">Ngày&nbsp;&nbsp;${escapeHtml(date.day)}&nbsp;&nbsp;&nbsp;Tháng&nbsp;&nbsp;${escapeHtml(date.month)}&nbsp;&nbsp;&nbsp;Năm&nbsp;&nbsp;${escapeHtml(date.year)}</td></tr>
          <tr><td colspan="4"></td><td class="code-cell" colspan="3"><strong>Mã ĐH:</strong>&nbsp; ${escapeHtml(order.order_code || order.id || '')}</td></tr>
          <tr><td class="info-cell" colspan="7"><strong>Tên Công ty/HKD:</strong>&nbsp; ${escapeHtml(info.company)}</td></tr>
          <tr><td class="info-cell" colspan="4"><strong>Họ tên người nhận hàng:</strong>&nbsp; ${escapeHtml(info.contact)}</td><td class="info-cell" colspan="3"><strong>Số điện thoại:</strong>&nbsp; ${escapeHtml(info.phone)}</td></tr>
          <tr><td class="info-cell" colspan="7"><strong>Địa chỉ người nhận:</strong>&nbsp; ${escapeHtml(info.shippingAddress || info.billingAddress)}</td></tr>
          <tr><td class="info-cell" colspan="7"><strong>Lý do xuất kho:</strong>&nbsp; Xuất kho bán hàng cho ${escapeHtml(info.company || info.contact)}</td></tr>
          <tr><td class="info-cell" colspan="7"><strong>Xuất tại kho:</strong>&nbsp; ${escapeHtml(warehouseName || '')}</td></tr>
          <tr><td class="info-cell" colspan="4"><strong>Nhân viên kinh doanh:</strong>&nbsp; ${escapeHtml(saleName)}</td><td class="info-cell" colspan="3"><strong>SĐT:</strong>&nbsp; ${escapeHtml(salePhone)}</td></tr>
          <tr><td class="delivery-note-box" colspan="7"><strong>LƯU Ý:</strong>&nbsp; ${escapeHtml(note)}</td></tr>
          <tr class="delivery-head"><th rowspan="2">STT</th><th rowspan="2">TÊN HÀNG</th><th rowspan="2">ĐVT</th><th rowspan="2">Số lượng</th><th colspan="3">Diễn giải đóng gói</th></tr>
          <tr class="delivery-head"><th class="delivery-subhead">Quy cách<br>(chiếc/thùng)</th><th class="delivery-subhead">Số thùng</th><th class="delivery-subhead">Số dư lẻ<br>(Chiếc)</th></tr>
          ${itemRows}
          <tr><td></td><td class="center bold" style="font-size:12.96pt">Cộng</td><td class="center bold" style="font-size:12.96pt">x</td><td class="center bold">${formatNumber(totalQuantity)}</td><td></td><td class="center bold">${totalBoxes ? formatNumber(totalBoxes) : ''}</td><td></td></tr>
          <tr class="spacer-row"><td colspan="7"></td></tr>
          <tr><td class="note-title" colspan="7">Lưu ý:</td></tr>
          <tr><td class="delivery-legal" colspan="7">- Biên bản này được xác nhận bởi hai bên.</td></tr>
          <tr><td class="delivery-legal" colspan="7">- Người nhận kiểm tra sản lượng ngay tại thời điểm bàn giao hàng hóa. Khiếu nại phát sinh bên bán không xử lí.</td></tr>
          <tr><td class="delivery-legal" colspan="7">- Người nhận xác nhận bên bán đã giao đúng loại hàng và số lượng hàng như trên.</td></tr>
          <tr><td class="delivery-legal" colspan="7">- Phiếu xuất kho được làm thành 2 bản mỗi bên giữ một bản có giá trị pháp lí như nhau.</td></tr>
          <tr><td class="delivery-legal" colspan="7">* Lưu ý: Trường hợp hàng hóa thiếu, nhầm bên nhận khiếu nại thời gian không quá 2 ngày.</td></tr>
          <tr><td></td><td class="signature-cell" colspan="2">Thủ kho<small>(Ký, họ tên)</small></td><td class="signature-cell" colspan="2">Người giao hàng<small>(Ký, họ tên)</small></td><td class="signature-cell" colspan="2">Người nhận hàng<small>(Ký, họ tên)</small></td></tr>
        </tbody>
      </table>
    </section>`)
}

export function openPrintDocument(html: string, onBlocked?: () => void) {
  const popup = window.open('', '_blank', 'popup=yes,width=1100,height=900')
  if (!popup) {
    onBlocked?.()
    return false
  }
  popup.document.open()
  popup.document.write(html)
  popup.document.close()
  popup.focus()
  window.setTimeout(() => popup.print(), 500)
  return true
}
