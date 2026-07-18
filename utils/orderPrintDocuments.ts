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
  return `${toNumber(value).toLocaleString('vi-VN')} đ`
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

function commonCss() {
  return `
    @page { size: A4 portrait; margin: 8mm 9mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #111; }
    body { font-family: "Times New Roman", serif; font-size: 12px; }
    .print-toolbar { position: sticky; top: 0; z-index: 10; display: flex; justify-content: flex-end; gap: 8px; padding: 10px; background: #eef2ff; border-bottom: 1px solid #c7d2fe; }
    .print-toolbar button { border: 1px solid #94a3b8; background: #fff; border-radius: 7px; padding: 8px 14px; cursor: pointer; font: 600 13px Arial, sans-serif; }
    .print-toolbar button.primary { color: #fff; background: #1d4ed8; border-color: #1d4ed8; }
    .sheet { width: 192mm; min-height: 275mm; margin: 0 auto; padding: 2mm 1mm; }
    .header { display: grid; grid-template-columns: 48mm minmax(0, 1fr); align-items: start; gap: 7mm; min-height: 29mm; }
    .logo { width: 46mm; height: auto; margin-top: 1mm; }
    .company { text-align: center; font-size: 11px; line-height: 1.45; padding-top: .5mm; }
    .company strong { display: block; color: #d60000; font-size: 16px; margin-bottom: 2px; }
    .company-contact { display: grid; grid-template-columns: 1fr 1fr; column-gap: 7mm; }
    .company-contact span:first-child { text-align: right; }
    .company-contact span:last-child { text-align: left; }
    h1 { margin: 3mm 0 2mm; text-align: center; font-size: 24px; line-height: 1.1; text-transform: uppercase; }
    .meta { display: grid; grid-template-columns: 1fr 72mm; gap: 8mm; margin-bottom: 2mm; }
    .meta-right { font-size: 12px; line-height: 1.7; }
    .date-parts { display: inline-grid; grid-template-columns: auto 8mm auto 8mm auto 13mm; align-items: baseline; column-gap: 1mm; white-space: nowrap; }
    .date-value { min-width: 0; text-align: center; border-bottom: 0; }
    .code-row { display: grid; grid-template-columns: 25mm 1fr; column-gap: 2mm; }
    .info { line-height: 1.75; margin-bottom: 2mm; }
    .info-row { display: grid; grid-template-columns: 34mm minmax(0, 1fr); min-height: 5mm; }
    .info-row.two { grid-template-columns: 34mm minmax(0, 1fr) 25mm 42mm; }
    .info-row.sale { grid-template-columns: 38mm minmax(0, 1fr) 25mm 42mm; }
    .intro { margin: 1.5mm 0 2mm; line-height: 1.35; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #111; padding: 1.2mm 1.4mm; vertical-align: middle; }
    th { background: #b9d2f6; font-weight: 700; text-align: center; }
    td.center { text-align: center; }
    td.right { text-align: right; }
    .items td { height: 6.3mm; }
    .summary-label { font-weight: 700; }
    .summary-value { font-weight: 700; text-align: right; }
    .grand-total { color: #e00000; }
    .notes { margin-top: 2.5mm; font-size: 10.5px; line-height: 1.35; }
    .notes strong { display: block; margin-bottom: 1mm; }
    .notes p { margin: .8mm 0; }
    .bottom-grid { display: grid; grid-template-columns: minmax(0, 1fr) 34mm; align-items: end; gap: 6mm; margin-top: 2mm; }
    .qr-wrap { text-align: center; font: 700 8px Arial, sans-serif; }
    .qr-wrap img { width: 28mm; height: 28mm; display: block; margin: 1mm auto; }
    .qr-top { color: #1260a8; white-space: nowrap; }
    .qr-bank { color: #e11d2e; }
    .bank-info { margin-top: 2mm; font-size: 11px; line-height: 1.45; }
    .bank-info strong { display: block; }
    .closing { margin-top: 4mm; font-size: 11px; }
    .delivery-title { font-size: 22px; margin-top: 2mm; }
    .delivery-meta { width: 72mm; margin-left: auto; margin-bottom: 2mm; line-height: 1.7; }
    .packing-head { background: #b9d2f6; }
    .signatures { margin-top: 12mm; display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; font-weight: 700; font-size: 14px; }
    .signatures small { display: block; font-weight: 400; font-style: italic; margin-top: 1mm; }
    .legal-notes { margin-top: 3mm; font-size: 10.5px; line-height: 1.45; }
    .legal-notes p { margin: .7mm 0; }
    @media screen {
      body { padding: 10px 0 30px; background: #e5e7eb; }
      .sheet { background: #fff; box-shadow: 0 8px 30px rgba(15, 23, 42, .18); }
    }
    @media print {
      .print-toolbar { display: none !important; }
      body { background: #fff; }
      .sheet { width: auto; min-height: auto; margin: 0; padding: 0; box-shadow: none; }
      thead { display: table-header-group; }
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

function headerHtml(assetBase?: string) {
  return `
    <div class="header">
      <img class="logo" src="${absoluteAsset(assetBase, '/kingcup-logo.svg')}" alt="KINGCUP">
      <div class="company">
        <strong>CÔNG TY TNHH KINGCUP VIỆT NAM</strong>
        <div>Địa chỉ: Số 01 ngách 17 ngõ 1333 Giải Phóng, Hoàng Mai, TP. Hà Nội, Việt Nam</div>
        <div class="company-contact"><span>Liên hệ: 033.570.2223</span><span>Web: https://baobikingcup.vn/</span></div>
        <div>Email: vietnamkingcup@gmail.com</div>
      </div>
    </div>`
}

function metaHtml(order: any, dateLabel: string, codeLabel: string, value?: any) {
  const date = dateParts(value || order.order_date || order.created_at)
  return `
    <div class="meta">
      <div></div>
      <div class="meta-right">
        <div class="date-parts">
          <span>Ngày</span><span class="date-value">${escapeHtml(date.day)}</span>
          <span>Tháng</span><span class="date-value">${escapeHtml(date.month)}</span>
          <span>Năm</span><span class="date-value">${escapeHtml(date.year)}</span>
        </div>
        <div class="code-row"><strong>${escapeHtml(codeLabel)}</strong><span>${escapeHtml(order.order_code || order.id || '')}</span></div>
      </div>
    </div>`
}

function commercialTerms(kind: CommercialPrintKind, depositPercent: number) {
  const third = kind === 'order'
    ? `3. Chính sách Thanh toán: Quý khách vui lòng tạm ứng ${formatNumber(depositPercent)}% giá trị đơn hàng ngay sau khi xác nhận mẫu và báo giá.`
    : '3. Chính sách Thanh toán: Quý khách vui lòng tạm ứng 50% giá trị đơn hàng ngay sau khi xác nhận mẫu và báo giá.'
  const fifth = kind === 'payment'
    ? '5. Thanh toán trước khi giao hàng.'
    : '5. Tiến độ sản xuất: Thời gian hoàn thiện cụ thể theo từng đơn hàng, tính từ khi nhận đủ tiền cọc; không bao gồm Thứ 7, Chủ Nhật và các ngày Lễ, Tết theo quy định.'

  return [
    '1. Sản phẩm & Pháp lý: Đầy đủ giấy tờ chứng nhận chất lượng và nguồn gốc xuất xứ.',
    '2. Số lượng sản xuất: Do đặc thù ngành in ấn, số lượng thực tế có thể dao động ±10% so với đơn đặt hàng. Quyết toán sẽ căn cứ trên số lượng thực giao.',
    third,
    '4. Báo giá & Thuế: Giá niêm yết đã bao gồm thuế VAT. Báo giá có hiệu lực tại thời điểm cung cấp và hỗ trợ giữ giá trong vòng 03 ngày.',
    fifth,
  ]
}

export function buildCommercialPrintHtml(options: CommercialPrintOptions) {
  const { kind, order, items, customer, assetBase } = options
  const rows = flattenOrderItems(items)
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
  const dateLabel = kind === 'quotation' ? 'Ngày BG' : 'Ngày ĐH'
  const intro = kind === 'quotation'
    ? 'Chúng tôi xin gửi tới quý khách hàng báo giá chi tiết như sau:'
    : kind === 'order'
      ? 'Chúng tôi xin gửi tới quý khách hàng nội dung đặt hàng chi tiết như sau:'
      : 'Chúng tôi xin gửi tới quý khách hàng nội dung thanh toán chi tiết như sau:'
  const saleName = order.sale_name || order.sale_display_name || ''
  const salePhone = order.sale_phone || order.sale_phone_number || ''
  const itemRows = rows.map((item: any, index) => `
    <tr>
      <td class="center">${index + 1}</td>
      <td>${escapeHtml(productDisplayName(item))}</td>
      <td class="center">${escapeHtml(item.unit || '')}</td>
      <td class="right">${formatNumber(item.quantity)}</td>
      <td class="right">${formatMoney(item.unitPrice)}</td>
      <td class="right">${formatMoney(item.lineTotal)}</td>
    </tr>`).join('')

  const extraSummaryRows = kind === 'order'
    ? `<tr><td class="summary-label">Số tiền cần đặt cọc (${formatNumber(depositPercent)}%)</td><td class="summary-value grand-total">${formatMoney(orderDeposit)}</td></tr>`
    : kind === 'payment'
      ? `<tr><td class="summary-label">Số tiền cần đặt cọc</td><td class="summary-value">${formatMoney(paymentDeposit)}</td></tr>
         <tr><td class="summary-label">Số tiền cần thanh toán</td><td class="summary-value grand-total">${formatMoney(paymentRemaining)}</td></tr>`
      : ''
  const summaryRowspan = kind === 'quotation' ? 3 : kind === 'order' ? 4 : 5
  const terms = commercialTerms(kind, depositPercent)
  const bankPrompt = kind === 'quotation'
    ? 'Nếu Quý khách đồng ý báo giá xin vui lòng thanh toán tiền cọc theo thông tin sau:'
    : kind === 'order'
      ? 'Quý khách xin vui lòng thanh toán tiền cọc theo thông tin sau:'
      : 'Quý khách vui lòng thanh toán số tiền còn lại theo thông tin sau:'

  return pageShell(`${title} - ${order.order_code || ''}`, `
    <section class="sheet">
      ${headerHtml(assetBase)}
      <h1>${title}</h1>
      ${metaHtml(order, dateLabel, codeLabel)}
      <div class="info">
        <div class="info-row"><strong>Tên Công ty/HKD:</strong><span>${escapeHtml(info.company)}</span></div>
        <div class="info-row"><strong>Mã số thuế:</strong><span>${escapeHtml(info.taxCode)}</span></div>
        <div class="info-row two"><strong>Người đặt hàng:</strong><span>${escapeHtml(info.contact)}</span><strong>SĐT:</strong><span>${escapeHtml(info.phone)}</span></div>
        <div class="info-row"><strong>Địa chỉ hóa đơn:</strong><span>${escapeHtml(info.billingAddress)}</span></div>
        <div class="info-row"><strong>Địa chỉ giao hàng:</strong><span>${escapeHtml(info.shippingAddress)}</span></div>
        <div class="info-row sale"><strong>Nhân viên kinh doanh:</strong><span>${escapeHtml(saleName)}</span><strong>SĐT:</strong><span>${escapeHtml(salePhone)}</span></div>
      </div>
      <div class="intro">
        <div>Lời đầu tiên, KingCup Việt Nam xin trân trọng cảm ơn quý khách đã quan tâm tới sản phẩm của công ty chúng tôi.</div>
        <div>${intro}</div>
      </div>
      <table class="items">
        <colgroup><col style="width:7%"><col style="width:43%"><col style="width:8%"><col style="width:10%"><col style="width:15%"><col style="width:17%"></colgroup>
        <thead><tr><th>STT</th><th>TÊN SẢN PHẨM</th><th>ĐVT</th><th>SỐ LƯỢNG</th><th>ĐƠN GIÁ</th><th>THÀNH TIỀN</th></tr></thead>
        <tbody>
          ${itemRows}
          <tr><td colspan="4" rowspan="${summaryRowspan}"><strong>Ghi chú:</strong> ${escapeHtml(order.note || 'Đơn giá chưa bao gồm vận chuyển')}</td><td class="summary-label">Cộng tiền hàng</td><td class="summary-value">${formatMoney(subtotal)}</td></tr>
          <tr><td class="summary-label">Thuế VAT (${formatNumber(vatRate)}%)</td><td class="summary-value">${formatMoney(vatAmount)}</td></tr>
          <tr><td class="summary-label">Thành tiền</td><td class="summary-value grand-total">${formatMoney(total)}</td></tr>
          ${extraSummaryRows}
        </tbody>
      </table>
      <div class="bottom-grid">
        <div>
          <div class="notes">
            <strong>Lưu ý:</strong>
            ${terms.map(term => `<p>${escapeHtml(term)}</p>`).join('')}
          </div>
          <div class="bank-info">
            <div>${escapeHtml(bankPrompt)}</div>
            <strong>CÔNG TY TNHH KINGCUP VIỆT NAM</strong>
            <strong>STK: 5699 8899 - Techcombank</strong>
          </div>
        </div>
        <div class="qr-wrap">
          <div class="qr-top">VIETQR · napas 247</div>
          <img src="${absoluteAsset(assetBase, '/kingcup-bank-qr.svg')}" alt="QR thanh toán">
          <div class="qr-bank">TECHCOMBANK</div>
        </div>
      </div>
      <div class="closing">Chúng tôi rất mong muốn nhận được sự hồi âm của Quý khách hàng trong thời gian sớm nhất. Chân thành cảm ơn!</div>
    </section>`)
}

function packingNumber(value: any) {
  const match = String(value || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return match ? toNumber(match[0]) : 0
}

export function buildDeliveryPrintHtml(options: DeliveryPrintOptions) {
  const { order, request, customer, warehouseName, assetBase } = options
  const info = customerData(order, customer)
  const rows = (options.rows || []).filter(row => row.productName || row.productCode || toNumber(row.quantity))
  const note = safeJsonParse(request.payload_json, {}).note || request.warehouse_note || ''
  const saleName = order.sale_name || order.sale_display_name || safeJsonParse(request.payload_json, {}).sale_name || ''
  const salePhone = order.sale_phone || order.sale_phone_number || ''
  let totalQuantity = 0
  let totalBoxes = 0
  const itemRows = rows.map((item: DeliveryPrintRow, index) => {
    const quantity = toNumber(item.quantity)
    const standard = packingNumber(item.packingStandard)
    const boxes = toNumber(item.boxQuantity) || (standard > 0 ? Math.floor(quantity / standard) : 0)
    const odd = toNumber(item.oddQuantity) || (standard > 0 ? quantity % standard : 0)
    totalQuantity += quantity
    totalBoxes += boxes
    const name = item.logo ? `${item.productName || item.productCode} - Logo: ${item.logo}` : (item.productName || item.productCode || '')
    return `<tr>
      <td class="center">${index + 1}</td>
      <td>${escapeHtml(name)}</td>
      <td class="center">${escapeHtml(item.unit || '')}</td>
      <td class="right">${formatNumber(quantity)}</td>
      <td class="right">${standard ? formatNumber(standard) : escapeHtml(item.packingStandard || '')}</td>
      <td class="right">${boxes ? formatNumber(boxes) : ''}</td>
      <td class="right">${odd ? formatNumber(odd) : ''}</td>
    </tr>`
  }).join('')

  const exportDate = request.export_date || request.warehouse_handled_at || request.updated_at || request.requested_at || order.order_date

  return pageShell(`Phiếu xuất kho - ${request.request_id || order.order_code || ''}`, `
    <section class="sheet">
      ${headerHtml(assetBase)}
      <h1 class="delivery-title">PHIẾU XUẤT KHO VÀ BIÊN BẢN BÀN GIAO</h1>
      <div class="delivery-meta">
        ${metaHtml(order, 'Ngày', 'Mã ĐH:', exportDate).replace('<div class="meta">', '<div class="meta" style="display:block;margin:0">').replace('<div></div>', '')}
      </div>
      <div class="info">
        <div class="info-row"><strong>Tên Công ty/HKD:</strong><span>${escapeHtml(info.company)}</span></div>
        <div class="info-row two"><strong>Họ tên người nhận:</strong><span>${escapeHtml(info.contact)}</span><strong>Số điện thoại:</strong><span>${escapeHtml(info.phone)}</span></div>
        <div class="info-row"><strong>Địa chỉ người nhận:</strong><span>${escapeHtml(info.shippingAddress || info.billingAddress)}</span></div>
        <div class="info-row"><strong>Lý do xuất kho:</strong><span>Xuất kho bán hàng cho ${escapeHtml(info.company || info.contact)}</span></div>
        <div class="info-row"><strong>Xuất tại kho:</strong><span>${escapeHtml(warehouseName || '')}</span></div>
        <div class="info-row sale"><strong>Nhân viên kinh doanh:</strong><span>${escapeHtml(saleName)}</span><strong>SĐT:</strong><span>${escapeHtml(salePhone)}</span></div>
        ${note ? `<div class="info-row"><strong>Ghi chú:</strong><span>${escapeHtml(note)}</span></div>` : ''}
      </div>
      <table class="items">
        <colgroup><col style="width:7%"><col style="width:34%"><col style="width:8%"><col style="width:11%"><col style="width:14%"><col style="width:13%"><col style="width:13%"></colgroup>
        <thead>
          <tr><th rowspan="2">STT</th><th rowspan="2">TÊN HÀNG</th><th rowspan="2">ĐVT</th><th rowspan="2">SỐ LƯỢNG</th><th colspan="3" class="packing-head">DIỄN GIẢI ĐÓNG GÓI</th></tr>
          <tr><th>Quy cách<br>(chiếc/thùng)</th><th>Số thùng</th><th>Số dư lẻ<br>(chiếc)</th></tr>
        </thead>
        <tbody>
          ${itemRows}
          <tr><td></td><td class="center"><strong>Cộng</strong></td><td class="center"><strong>x</strong></td><td class="right"><strong>${formatNumber(totalQuantity)}</strong></td><td></td><td class="right"><strong>${totalBoxes ? formatNumber(totalBoxes) : ''}</strong></td><td></td></tr>
        </tbody>
      </table>
      <div class="legal-notes">
        <strong>Lưu ý:</strong>
        <p>- Biên bản này được xác nhận bởi hai bên.</p>
        <p>- Người nhận kiểm tra sản lượng ngay tại thời điểm bàn giao hàng hóa. Khiếu nại phát sinh sau bàn giao bên bán không xử lý.</p>
        <p>- Người nhận xác nhận bên bán đã giao đúng loại hàng và số lượng hàng như trên.</p>
        <p>- Phiếu xuất kho được làm thành 02 bản, mỗi bên giữ 01 bản có giá trị pháp lý như nhau.</p>
        <p>* Trường hợp hàng hóa thiếu, nhầm, bên nhận khiếu nại trong thời gian không quá 02 ngày.</p>
      </div>
      <div class="signatures">
        <div>Thủ kho<small>(Ký, họ tên)</small></div>
        <div>Người giao hàng<small>(Ký, họ tên)</small></div>
        <div>Người nhận hàng<small>(Ký, họ tên)</small></div>
      </div>
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
