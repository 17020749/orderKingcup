export type ParcelLabelType = 'post_office' | 'bus_carrier'

export type ParcelLabelRow = {
  productName?: string
  productCode?: string
  logo?: string
}

export type ParcelLabelData = {
  type: ParcelLabelType
  receiverName?: string
  receiverPhone?: string
  receiverAddress?: string
  orderCode?: string
  rows: ParcelLabelRow[]
  carrierName?: string
  carrierPhone?: string
  vehiclePlate?: string
  driverName?: string
  departureAt?: string
  note?: string
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function displayValue(value: unknown) {
  const text = String(value ?? '').trim()
  return text ? escapeHtml(text) : '&nbsp;'
}

function formatDateTime(value: unknown) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw.replace('T', ' ')
  return date.toLocaleString('vi-VN', { hour12: false })
}

function carrierSummary(data: ParcelLabelData) {
  const values = [
    data.carrierName && `Nhà xe: ${data.carrierName}`,
    data.carrierPhone && `SĐT nhà xe: ${data.carrierPhone}`,
    data.vehiclePlate && `Biển số: ${data.vehiclePlate}`,
    data.driverName && `Chủ xe/Tài xế: ${data.driverName}`,
    data.departureAt && `Giờ xuất phát: ${formatDateTime(data.departureAt)}`,
  ].filter(Boolean)
  return values.join(' · ')
}

function itemRows(rows: ParcelLabelRow[]) {
  const normalized = rows.length ? rows : [{}]
  return normalized.map((row, index) => `
    <tr>
      <td class="center">${index + 1}</td>
      <td>
        <strong>${displayValue(row.productName)}</strong>
        ${row.productCode ? `<div class="subtle">${escapeHtml(row.productCode)}</div>` : ''}
      </td>
      <td class="center package-cell">&nbsp;</td>
      <td class="center logo-cell">${displayValue(row.logo)}</td>
    </tr>
  `).join('')
}

export function buildParcelLabelPrintHtml(data: ParcelLabelData) {
  const isBusCarrier = data.type === 'bus_carrier'
  const carrierText = carrierSummary(data)
  const topBanner = isBusCarrier
    ? `<div class="banner carrier-banner">TT Nhà xe: ${carrierText ? escapeHtml(carrierText) : '&nbsp;'}</div>`
    : '<div class="banner warning">HÀNG DỄ VỠ VUI LÒNG NHẸ TAY</div>'
  const bottomBanner = isBusCarrier
    ? '<div class="banner warning bottom-warning">HÀNG DỄ VỠ VUI LÒNG NHẸ TAY</div>'
    : '<div class="banner post-office">Gửi Bưu Điện</div>'

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>${isBusCarrier ? 'Tem gửi nhà xe' : 'Tem gửi bưu điện'} - ${escapeHtml(data.orderCode || '')}</title>
  <style>
    * { box-sizing: border-box; }
    @page { size: A4 landscape; margin: 8mm; }
    body { margin: 0; color: #000; background: #fff; font-family: Arial, Helvetica, sans-serif; }
    .sheet { width: 100%; border: 2px solid #000; }
    .banner { min-height: 66px; display: flex; align-items: center; justify-content: center; padding: 10px 14px; border-bottom: 2px solid #000; text-align: center; font-weight: 800; font-size: 28px; line-height: 1.15; }
    .carrier-banner { font-size: 23px; }
    .sender-receiver { display: grid; grid-template-columns: 1fr 1.7fr; }
    .party { border-bottom: 2px solid #000; }
    .party + .party { border-left: 2px solid #000; }
    .party-title { padding: 8px; border-bottom: 2px solid #000; text-align: center; font-size: 18px; font-weight: 800; }
    .party-body { min-height: 132px; padding: 14px 16px; font-size: 18px; line-height: 1.45; white-space: pre-line; }
    .party-body strong { font-size: 20px; }
    .receiver-line { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 8px; margin-bottom: 7px; }
    .receiver-line span:first-child { font-weight: 700; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border-right: 2px solid #000; border-bottom: 2px solid #000; padding: 9px 10px; vertical-align: middle; font-size: 17px; }
    th:last-child, td:last-child { border-right: 0; }
    th { text-align: center; font-size: 16px; }
    tbody td { min-height: 62px; }
    .col-stt { width: 8%; }
    .col-name { width: 56%; }
    .col-package { width: 15%; }
    .col-logo { width: 21%; }
    .center { text-align: center; }
    .package-cell { min-height: 62px; }
    .logo-cell { font-size: 20px; font-weight: 800; white-space: pre-line; }
    .subtle { margin-top: 4px; font-size: 13px; font-weight: 400; }
    .note { padding: 8px 12px; border-bottom: 2px solid #000; font-size: 14px; }
    .post-office { border-bottom: 0; font-size: 30px; }
    .bottom-warning { border-bottom: 0; font-size: 28px; }
    @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>
  <section class="sheet">
    ${topBanner}
    <div class="sender-receiver">
      <div class="party">
        <div class="party-title">NGƯỜI GỬI</div>
        <div class="party-body"><strong>T019564009</strong>\nCÔNG TY TNHH KINGCUP VIỆT NAM\n039 5571728</div>
      </div>
      <div class="party">
        <div class="party-title">NGƯỜI NHẬN - TRẢ CƯỚC</div>
        <div class="party-body">
          <div class="receiver-line"><span>Người nhận:</span><strong>${displayValue(data.receiverName)}</strong></div>
          <div class="receiver-line"><span>SĐT:</span><strong>${displayValue(data.receiverPhone)}</strong></div>
          <div class="receiver-line"><span>Địa chỉ:</span><strong>${displayValue(data.receiverAddress)}</strong></div>
          <div class="receiver-line"><span>Đơn hàng:</span><strong>${displayValue(data.orderCode)}</strong></div>
        </div>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th class="col-stt">STT</th>
          <th class="col-name">TÊN HÀNG HÓA</th>
          <th class="col-package">SỐ KIỆN</th>
          <th class="col-logo">LOGO</th>
        </tr>
      </thead>
      <tbody>${itemRows(data.rows)}</tbody>
    </table>
    ${data.note ? `<div class="note"><strong>Ghi chú:</strong> ${escapeHtml(data.note)}</div>` : ''}
    ${bottomBanner}
  </section>
  <script>window.addEventListener('load', () => { window.focus(); setTimeout(() => window.print(), 250); });<\/script>
</body>
</html>`
}
