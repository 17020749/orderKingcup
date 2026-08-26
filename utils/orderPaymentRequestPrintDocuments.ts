import { toNumber } from '~/utils/format'

export type PaymentRequestPrintKind = 'payment_request' | 'advance_request'

type PaymentRequestPrintOptions = {
  kind: PaymentRequestPrintKind
  order: any
  customer?: any
  depositPercent?: number
  paidDepositAmount?: number
}

function escapeHtml(value: any) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function toDate(value: any) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function dateParts(value: any = new Date()) {
  const date = toDate(value) || new Date()
  return {
    day: String(date.getDate()).padStart(2, '0'),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    year: String(date.getFullYear()),
  }
}

function formatMoney(value: any) {
  return toNumber(value).toLocaleString('vi-VN', { maximumFractionDigits: 0 })
}

function cleanPercent(value: any) {
  return Math.max(0, Math.min(100, toNumber(value)))
}

function orderTotal(order: any) {
  return Math.max(0, toNumber(
    order?.payable_amount
    || order?.actual_revenue
    || order?.total_vat
    || order?.grand_total
    || order?.total_amount,
  ))
}

function customerData(order: any, customer: any) {
  const row = customer || {}
  return {
    company: row.company_name || row.customer_name || order?.customer_name || '',
    taxCode: row.tax_code || order?.tax_code || '',
    address: row.billing_address || row.address || row.shipping_address || order?.billing_address || order?.shipping_address || '',
  }
}

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']

function readThreeDigits(value: number, full = false) {
  const hundred = Math.floor(value / 100)
  const ten = Math.floor((value % 100) / 10)
  const unit = value % 10
  const words: string[] = []

  if (hundred > 0 || full) {
    words.push(`${DIGITS[hundred]} trăm`)
    if (ten === 0 && unit > 0) words.push('lẻ')
  }
  if (ten > 1) {
    words.push(`${DIGITS[ten]} mươi`)
    if (unit === 1) words.push('mốt')
    else if (unit === 5) words.push('lăm')
    else if (unit > 0) words.push(DIGITS[unit])
  } else if (ten === 1) {
    words.push('mười')
    if (unit === 5) words.push('lăm')
    else if (unit > 0) words.push(DIGITS[unit])
  } else if (unit > 0) {
    words.push(DIGITS[unit])
  }
  return words.join(' ')
}

function moneyInWords(value: any) {
  let amount = Math.round(Math.max(0, toNumber(value)))
  if (!amount) return 'Không đồng'
  const scales = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ']
  const groups: number[] = []
  while (amount > 0) {
    groups.push(amount % 1000)
    amount = Math.floor(amount / 1000)
  }
  const words: string[] = []
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]
    if (!group) continue
    const full = index < groups.length - 1 && group < 100
    const text = readThreeDigits(group, full)
    if (text) words.push(`${text}${scales[index] ? ` ${scales[index]}` : ''}`)
  }
  const sentence = words.join(' ').replace(/\s+/g, ' ').trim()
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} đồng`
}

function sharedCss(kind: PaymentRequestPrintKind) {
  const lineHeight = kind === 'payment_request' ? '1.15' : '1.5'
  return `
    @page { size: A4 portrait; margin: 25.4mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #111; }
    body { font-family: Arial, sans-serif; font-size: 10pt; }
    .toolbar { position: sticky; top: 0; z-index: 5; display: flex; justify-content: flex-end; gap: 8px; padding: 10px; background: #eef2ff; border-bottom: 1px solid #c7d2fe; }
    .toolbar button { border: 1px solid #94a3b8; background: #fff; border-radius: 7px; padding: 8px 14px; cursor: pointer; font: 600 13px Arial, sans-serif; }
    .toolbar button.primary { color: #fff; background: #1d4ed8; border-color: #1d4ed8; }
    .sheet { width: 159.2mm; min-height: 246mm; margin: 0 auto; font-size: 10pt; line-height: ${lineHeight}; }
    .top { display: grid; grid-template-columns: 45% 55%; gap: 8mm; align-items: start; font-weight: 700; margin-bottom: 13mm; }
    .top-left, .top-right { text-align: center; }
    .top-left .code { margin-top: 5mm; font-style: italic; }
    .top-right .motto { margin-top: 4mm; font-style: italic; }
    .top-right .stars { margin-top: 2mm; letter-spacing: .2px; }
    .date-line { text-align: right; font-style: italic; margin-bottom: 4mm; }
    h1 { margin: 0 0 8mm; text-align: center; font-size: 15pt; line-height: 1.15; font-weight: 700; }
    p { margin: 0; }
    .row { margin: 1.2mm 0; }
    .section-title { margin-top: 1.2mm; font-size: 12pt; font-weight: 700; font-style: italic; text-decoration: underline; }
    .payment-request .section-title, .payment-request .emphasis-row { font-size: 12pt; }
    .label-strong { font-weight: 700; }
    .italic { font-style: italic; }
    .underline { text-decoration: underline; }
    .party-title { font-weight: 700; font-style: italic; text-decoration: underline; }
    .content { margin-top: 1mm; }
    .content-line { margin: 1.05mm 0; }
    .amount-line { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; column-gap: 2mm; align-items: baseline; margin: 1.05mm 0; }
    .amount-value { min-width: 30mm; text-align: right; font-weight: 700; }
    .amount-line.strong { font-weight: 700; }
    .words { margin: 1.1mm 0 1.8mm; }
    .body-text { margin: 1.2mm 0; text-align: justify; }
    .bank { margin: 1.5mm 0 1.5mm 16mm; line-height: 1.5; }
    .signature { width: 66mm; margin: 6mm 0 0 auto; text-align: center; font-weight: 700; }
    .signature .hint { margin-top: 5mm; font-weight: 400; font-style: italic; }
    .advance-request .top { margin-bottom: 12mm; }
    .advance-request h1 { margin-bottom: 4mm; }
    .advance-request .section-title { font-size: 10pt; }
    .advance-request .numbered { display: grid; grid-template-columns: 6mm minmax(0, 1fr); column-gap: 2mm; margin: 1.5mm 0 1.5mm 20mm; text-align: justify; }
    .advance-request .bullet { display: grid; grid-template-columns: 6mm minmax(0, 1fr); column-gap: 2mm; margin: .5mm 0 .5mm 20mm; font-weight: 700; }
    .advance-request .bank { margin-left: 16mm; }
    @media screen {
      body { padding: 10px 0 30px; background: #e5e7eb; }
      .sheet { background: #fff; box-shadow: 0 8px 30px rgba(15, 23, 42, .18); padding: 0; }
    }
    @media print {
      .toolbar { display: none !important; }
      body { background: #fff; }
      .sheet { width: auto; min-height: auto; margin: 0; box-shadow: none; }
    }
  `
}

function shell(title: string, kind: PaymentRequestPrintKind, body: string) {
  return `<!doctype html>
  <html lang="vi">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${escapeHtml(title)}</title>
      <style>${sharedCss(kind)}</style>
    </head>
    <body>
      <div class="toolbar">
        <button onclick="window.close()">Đóng</button>
        <button class="primary" onclick="window.print()">In phiếu</button>
      </div>
      ${body}
    </body>
  </html>`
}

function headerHtml() {
  return `
    <div class="top">
      <div class="top-left">
        <div>CÔNG TY TNHH KINGCUP VIỆT NAM</div>
        <div class="code">Số:........./KINGCUP</div>
      </div>
      <div class="top-right">
        <div>CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
        <div class="motto">Độc lập- Tự do- Hạnh phúc</div>
        <div class="stars">======*****======</div>
      </div>
    </div>`
}

function dateLineHtml() {
  const date = dateParts(new Date())
  return `<div class="date-line">Hà Nội , ngày&nbsp; ${date.day}&nbsp; tháng ${date.month}&nbsp; năm ${date.year}</div>`
}

function orderDateText(order: any) {
  const date = dateParts(order?.order_date || order?.created_at)
  return `${date.day}/${date.month}/${date.year}`
}

function paymentRequestHtml(options: PaymentRequestPrintOptions) {
  const { order, customer } = options
  const info = customerData(order, customer)
  const total = orderTotal(order)
  const paid = Math.max(0, toNumber(options.paidDepositAmount))
  const remaining = Math.max(0, total - paid)

  return `
    <main class="sheet payment-request">
      ${headerHtml()}
      ${dateLineHtml()}
      <h1>GIẤY ĐỀ NGHỊ THANH TOÁN</h1>

      <div class="row"><span class="party-title">Bên thanh toán ( Bên B)</span><strong>: ${escapeHtml(info.company || '……………………………………………………….')}</strong></div>
      <div class="row">MST: ${escapeHtml(info.taxCode || '……………………')}</div>
      <div class="row">Địa chỉ : ${escapeHtml(info.address || '…………………………………………………………………………………..')}</div>
      <div class="row"><span class="party-title">Bên đề nghị thanh toán (Bên A)</span><strong>: CÔNG TY TNHH KINGCUP VIỆT NAM</strong></div>
      <div class="row">MST : 0111385965</div>
      <div class="row">Địa chỉ: Số 01 ngách 17 ngõ 1333 Giải Phóng, Phường Hoàng Mai, Thành phố Hà Nội, Việt Nam</div>
      <div class="row">Người đại diện: Ông Nguyễn Đức Chí <span style="display:inline-block;width:30mm"></span> Chức vụ: <strong><em>Giám đốc</em></strong></div>

      <div class="section-title">Nội dung:</div>
      <div class="content">
        <div class="content-line">Căn cứ vào đơn đặt hàng ngày ${escapeHtml(orderDateText(order))} giữa hai bên đã thỏa thuận.</div>
        <div class="amount-line"><span>Tổng giá trị đơn đặt hàng</span><span class="amount-value">${formatMoney(total)}</span><span>VNĐ</span></div>
        <div class="amount-line"><span>Tổng giá trị đã tạm ứng (đặt cọc)</span><span class="amount-value">${formatMoney(paid)}</span><span>VNĐ</span></div>
        <div class="amount-line"><span>Tổng giá trị còn lại cần thanh toán</span><span class="amount-value">${formatMoney(remaining)}</span><span>VNĐ</span></div>
        <div class="amount-line strong emphasis-row"><span>Tổng giá trị còn lại bên B cần thanh toán cho bên A</span><span class="amount-value">${formatMoney(remaining)}</span><span>VNĐ</span></div>
      </div>
      <div class="words"><strong><em>Bằng chữ:</em></strong> <em>${escapeHtml(moneyInWords(remaining))}.</em></div>

      <p class="body-text">Đề nghị Quý Công ty thực hiện thanh toán số tiền nêu trên vào tài khoản của <strong><em>CÔNG TY TNHH KINGCUP VIỆT NAM</em></strong> <em>theo thông tin tài khoản ghi dưới đây.</em></p>
      <div class="bank">
        <div><strong>Chủ tài khoản:</strong> <em>CÔNG TY TNHH KINGCUP VIỆT NAM</em></div>
        <div><strong>Số Tài khoản:</strong> 56998899 – <strong>Ngân hàng techcombank</strong></div>
      </div>
      <p class="body-text">Sau khi nhận được đầy đủ khoản thanh toán, <strong><em>CÔNG TY TNHH KINGCUP VIỆT NAM</em></strong> sẽ thực hiện đầy đủ các nghĩa vụ liên quan theo thỏa thuận giữa hai bên (nếu còn) và tiến hành xuất hóa đơn giá trị gia tăng theo quy định của pháp luật (nếu chưa xuất).</p>
      <p class="body-text">Kính đề nghị Quý Công ty bố trí thanh toán trong thời gian sớm nhất nhằm hoàn tất nghĩa vụ thanh toán theo Đơn đặt hàng và tạo điều kiện để hai bên tiếp tục duy trì mối quan hệ hợp tác lâu dài, ổn định và hiệu quả.</p>
      <p class="body-text"><strong><em>CÔNG TY TNHH KINGCUP VIỆT NAM</em></strong> trân trọng cảm ơn sự hợp tác của Quý Công ty và mong tiếp tục đồng hành cùng Quý Công ty trong các dự án sắp tới.</p>
      <p class="row"><strong><em>Trân trọng cảm ơn!</em></strong></p>

      <div class="signature">
        <div>CÔNG TY TNHH KINGCUP VIỆT NAM</div>
        <div class="hint">(Ký và đóng dấu)</div>
      </div>
    </main>`
}

function advanceRequestHtml(options: PaymentRequestPrintOptions) {
  const { order, customer } = options
  const info = customerData(order, customer)
  const total = orderTotal(order)
  const percent = cleanPercent(options.depositPercent ?? 50)
  const advance = total * percent / 100
  const remainPercent = Math.max(0, 100 - percent)

  return `
    <main class="sheet advance-request">
      ${headerHtml()}
      ${dateLineHtml()}
      <h1>GIẤY ĐỀ NGHỊ TẠM ỨNG</h1>

      <div class="row"><span class="party-title">Bên tạm ứng (Bên B)</span><strong>: ${escapeHtml(info.company || '')}</strong></div>
      <div class="row">MST: ${escapeHtml(info.taxCode || '')}</div>
      <div class="row">Địa chỉ : ${escapeHtml(info.address || '')}</div>
      <div class="row"><span class="party-title">Bên đề nghị thanh toán (Bên A)</span><strong>: CÔNG TY TNHH KINGCUP VIỆT NAM</strong></div>
      <div class="row">MST : 0111385965</div>
      <div class="row">Địa chỉ: Số 01 ngách 17 ngõ 1333 Giải Phóng, Phường Hoàng Mai, Thành phố Hà Nội, Việt Nam</div>
      <div class="row">Người đại diện: Ông Nguyễn Đức Chí <span style="display:inline-block;width:30mm"></span> Chức vụ: <strong><em>Giám đốc</em></strong></div>

      <div class="section-title">Nội dung:</div>
      <div class="numbered"><span>1.</span><span>Căn cứ vào đơn đặt hàng ngày ${escapeHtml(orderDateText(order))} giữa <strong><em>${escapeHtml(info.company || '…………………………………')}</em></strong> và <strong><em>CÔNG TY TNHH KINGCUP VIỆT NAM</em></strong> về việc sản xuất, cung cấp sản phẩm theo yêu cầu của Quý Công ty.</span></div>
      <div class="numbered"><span>2.</span><span>Để đảm bảo tiến độ sản xuất, chuẩn bị nguyên vật liệu và thực hiện đơn hàng đúng thời gian đã thống nhất, <strong>CÔNG TY TNHH KINGCUP VIỆT NAM</strong> kính đề nghị Quý Công ty thực hiện tạm ứng (đặt cọc) <strong>${formatMoney(percent)}%</strong> giá trị đơn hàng, cụ thể như sau:</span></div>
      <div class="bullet"><span>-</span><span>Tổng giá trị đơn hàng <span style="float:right">${formatMoney(total)} VNĐ</span></span></div>
      <div class="bullet"><span>-</span><span>Số tiền đề nghị tạm ứng (đặt cọc) - (${formatMoney(percent)}%): <span style="float:right">${formatMoney(advance)} VNĐ</span></span></div>
      <div class="words"><strong>Bằng chữ:</strong> <em>${escapeHtml(moneyInWords(advance))}.</em></div>

      <p class="body-text">Khoản tiền tạm ứng nêu trên sẽ được sử dụng để triển khai sản xuất và chuẩn bị nguyên vật liệu phục vụ đơn hàng. <strong><em>${formatMoney(remainPercent)}% giá trị còn lại</em></strong> <em>sẽ được Quý Công ty thanh toán sau khi <strong>CÔNG TY TNHH KINGCUP VIỆT NAM</strong> hoàn thành việc giao hàng, hai bên tiến hành nghiệm thu và đối chiếu sản lượng thực tế theo thỏa thuận.</em></p>
      <p class="body-text">Kính đề nghị Quý Công ty chuyển khoản theo thông tin sau:</p>
      <div class="bank">
        <div><strong>Tên tài khoản:</strong> CÔNG TY TNHH KINGCUP VIỆT NAM</div>
        <div><strong>Số tài khoản:</strong> 5699 8899</div>
        <div><strong>Ngân hàng:</strong> Ngân hàng TMCP Kỹ Thương Việt Nam (Techcombank)</div>
      </div>
      <p class="body-text">Rất mong nhận được sự quan tâm, hỗ trợ và hợp tác của Quý Công ty để chúng tôi có thể triển khai đơn hàng đúng tiến độ và đảm bảo chất lượng theo cam kết.</p>
      <p class="body-text">Xin trân trọng cảm ơn!</p>

      <div class="signature">
        <div>CÔNG TY TNHH KINGCUP VIỆT NAM</div>
        <div class="hint">(Ký và đóng dấu)</div>
      </div>
    </main>`
}

export function buildPaymentRequestPrintHtml(options: PaymentRequestPrintOptions) {
  if (options.kind === 'payment_request') {
    return shell('Giấy đề nghị thanh toán', options.kind, paymentRequestHtml(options))
  }
  return shell('Giấy đề nghị tạm ứng', options.kind, advanceRequestHtml(options))
}
