import { safeJsonParse, toNumber } from '~/utils/format'
import {
  customerData, escapeHtml, formatNumber, headerHtml, headingHtml, padRows, pageShell,
  type DeliveryPrintRow,
} from '~/utils/orderPrintShared'

type DeliveryPrintOptions = {
  order: any
  request: any
  customer?: any
  rows: DeliveryPrintRow[]
  warehouseName?: string
  assetBase?: string
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
  const date = request.export_date || request.warehouse_handled_at || request.updated_at || request.requested_at || order.order_date
  const note = safeJsonParse(request.payload_json, {}).note || request.warehouse_note || ''
  const saleName = order.sale_name || order.sale_display_name || safeJsonParse(request.payload_json, {}).sale_name || ''
  const salePhone = order.sale_phone || order.sale_phone_number || ''
  let totalQuantity = 0
  let totalBoxes = 0
  const itemRows = printedRows.map((item: DeliveryPrintRow | null, index) => {
    if (!item) return `<tr class="item-row"><td class="center">${index + 1}</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`
    const quantity = toNumber(item.quantity)
    const standard = packingNumber(item.packingStandard)
    const boxes = toNumber(item.boxQuantity) || (standard > 0 ? Math.floor(quantity / standard) : 0)
    const odd = toNumber(item.oddQuantity) || (standard > 0 ? quantity % standard : 0)
    totalQuantity += quantity
    totalBoxes += boxes
    const name = item.logo ? `${item.productName || item.productCode} - Logo: ${item.logo}` : (item.productName || item.productCode || '')
    return `<tr class="item-row"><td class="center">${index + 1}</td><td>${escapeHtml(name)}</td><td class="center">${escapeHtml(item.unit || '')}</td><td class="center">${formatNumber(quantity)}</td><td class="center">${standard ? formatNumber(standard) : escapeHtml(item.packingStandard || '')}</td><td class="center">${boxes ? formatNumber(boxes) : ''}</td><td class="center">${odd ? formatNumber(odd) : ''}</td></tr>`
  }).join('')
  const meta = headingHtml('', 'Mã ĐH:', order.order_code || order.id || '', date)
    .replace('<section class="document-heading">', '')
    .replace('<div class="document-title"></div>', '')
    .replace('<div class="document-meta">', '')
    .replace('</div></section>', '')

  return pageShell(`Phiếu xuất kho - ${request.request_id || order.order_code || ''}`, `<section class="sheet">
    ${headerHtml(assetBase)}<div class="delivery-title">PHIẾU XUẤT KHO VÀ BIÊN BẢN BÀN GIAO</div><div class="delivery-meta">${meta}</div>
    <section class="delivery-info">
      <div class="delivery-info-row"><span>Tên Công ty/HKD:</span><span>${escapeHtml(info.company)}</span></div>
      <div class="delivery-info-row two"><span>Họ tên người nhận hàng:</span><span>${escapeHtml(info.contact)}</span><span>Số điện thoại:</span><span>${escapeHtml(info.phone)}</span></div>
      <div class="delivery-info-row"><span>Địa chỉ người nhận:</span><span>${escapeHtml(info.shippingAddress || info.billingAddress)}</span></div>
      <div class="delivery-info-row"><span>Lý do xuất kho:</span><span>Xuất kho bán hàng cho ${escapeHtml(info.company || info.contact)}</span></div>
      <div class="delivery-info-row"><span>Xuất tại kho:</span><span>${escapeHtml(warehouseName || '')}</span></div>
      <div class="delivery-info-row two"><span>Nhân viên kinh doanh:</span><span>${escapeHtml(saleName)}</span><span>SĐT:</span><span>${escapeHtml(salePhone)}</span></div>
    </section><div class="delivery-note"><strong>LƯU Ý:</strong> ${escapeHtml(note)}</div>
    <table class="delivery-table">${deliveryColumnGroup()}<thead><tr><th rowspan="2">STT</th><th rowspan="2">TÊN HÀNG</th><th rowspan="2">ĐVT</th><th rowspan="2">Số lượng</th><th colspan="3">Diễn giải đóng gói</th></tr><tr><th>Quy cách<br>(chiếc/thùng)</th><th>Số thùng</th><th>Số dư lẻ<br>(Chiếc)</th></tr></thead><tbody>${itemRows}
      <tr class="delivery-total"><td></td><td class="center">Cộng</td><td class="center">x</td><td class="center">${formatNumber(totalQuantity)}</td><td></td><td class="center">${totalBoxes ? formatNumber(totalBoxes) : ''}</td><td></td></tr>
    </tbody></table>
    <section class="delivery-legal"><p><strong>Lưu ý:</strong></p><p>- Biên bản này được xác nhận bởi hai bên.</p><p>- Người nhận kiểm tra sản lượng ngay tại thời điểm bàn giao hàng hóa. Khiếu nại phát sinh bên bán không xử lí.</p><p>- Người nhận xác nhận bên bán đã giao đúng loại hàng và số lượng hàng như trên.</p><p>- Phiếu xuất kho được làm thành 2 bản mỗi bên giữ một bản có giá trị pháp lí như nhau.</p><p>* Lưu ý: Trường hợp hàng hóa thiếu, nhầm bên nhận khiếu nại thời gian không quá 2 ngày.</p></section>
    <div class="signatures"><div>Thủ kho<small>(Ký, họ tên)</small></div><div>Người giao hàng<small>(Ký, họ tên)</small></div><div>Người nhận hàng<small>(Ký, họ tên)</small></div></div>
  </section>`)
}
