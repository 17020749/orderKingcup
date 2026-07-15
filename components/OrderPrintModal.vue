<script setup lang="ts">
import type { OrderDoc, OrderItemDoc } from '~/types/models'
import { safeJsonParse, toNumber } from '~/utils/format'

const props = defineProps<{
  order: OrderDoc
  items: OrderItemDoc[]
  requests?: any[]
}>()

const emit = defineEmits<{ close: [] }>()
const { getOne } = useRepo()
const { showToast } = useUi()
const customer = ref<any>(null)

const printChoices = [
  { key: 'quotation', title: 'Phiếu báo giá', description: 'Bảng sản phẩm, đơn giá, VAT và điều khoản báo giá.' },
  { key: 'order', title: 'Phiếu đặt hàng', description: 'Xác nhận nội dung đặt hàng và tổng giá trị đơn.' },
  { key: 'delivery', title: 'Phiếu xuất kho', description: 'Phiếu xuất kho và biên bản bàn giao hàng hóa.' }
] as const

type PrintKind = typeof printChoices[number]['key']

watch(
  () => props.order?.customer_id,
  async customerId => {
    customer.value = null
    if (!customerId) return
    try {
      customer.value = await getOne('customers', String(customerId))
    } catch {
      // Đơn hàng vẫn có tên và số điện thoại dự phòng nên việc in không bị chặn.
    }
  },
  { immediate: true }
)

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

function formatDate(value: any) {
  const date = toDate(value)
  return date ? date.toLocaleDateString('vi-VN') : ''
}

function absoluteAsset(path: string) {
  return new URL(path, window.location.origin).href
}

function customerData() {
  const row = customer.value || {}
  return {
    company: row.company_name || row.customer_name || props.order.customer_name || '',
    contact: row.customer_name || props.order.customer_name || '',
    phone: row.phone || props.order.phone || '',
    taxCode: row.tax_code || (props.order as any).tax_code || '',
    billingAddress: row.billing_address || (props.order as any).billing_address || '',
    shippingAddress: row.shipping_address || (props.order as any).shipping_address || '',
  }
}

function flattenItems() {
  return (props.items || []).flatMap((item: any) => {
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
          packingStandard: item.packing_standard || '',
          boxQuantity: 0,
          oddQuantity: 0,
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
      packingStandard: item.packing_standard || '',
      boxQuantity: toNumber(item.box_quantity),
      oddQuantity: toNumber(item.odd_quantity),
    }]
  }).filter((item: any) => item.productName || item.productCode || item.quantity)
}

function productDisplayName(item: any) {
  const base = item.productName || item.productCode || '-'
  return item.logo ? `${base} - Logo: ${item.logo}` : base
}

function packingNumber(value: any) {
  const match = String(value || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return match ? toNumber(match[0]) : 0
}

function resolveWarehouseName() {
  const requests = props.requests || []
  for (const request of requests) {
    const payload = safeJsonParse(request.payload_json, {})
    const firstItem = Array.isArray(payload?.items) ? payload.items[0] : null
    const candidate = request.warehouse_name
      || request.export_warehouse_name
      || request.from_warehouse_name
      || payload?.warehouse_name
      || payload?.warehouse?.name
      || firstItem?.warehouse_name
      || firstItem?.from_warehouse_name
    if (candidate) return String(candidate)
  }
  return String((props.order as any).warehouse_name || (props.order as any).export_warehouse_name || '')
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
    .header { display: grid; grid-template-columns: 48mm 1fr; align-items: start; gap: 7mm; min-height: 29mm; }
    .logo { width: 46mm; height: auto; margin-top: 1mm; }
    .company { text-align: center; font-size: 11px; line-height: 1.45; }
    .company strong { display: block; color: #d60000; font-size: 16px; margin-bottom: 2px; }
    h1 { margin: 3mm 0 2mm; text-align: center; font-size: 24px; line-height: 1.1; text-transform: uppercase; }
    .meta { display: grid; grid-template-columns: 1fr 65mm; gap: 8mm; margin-bottom: 2mm; }
    .meta-right { font-size: 12px; line-height: 1.7; }
    .info { line-height: 1.75; margin-bottom: 2mm; }
    .info-row { display: grid; grid-template-columns: 34mm 1fr; min-height: 5mm; }
    .info-row.two { grid-template-columns: 34mm 1fr 25mm 42mm; }
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
    .bottom-grid { display: grid; grid-template-columns: 1fr 34mm; align-items: end; gap: 6mm; margin-top: 2mm; }
    .qr-wrap { text-align: center; font: 700 8px Arial, sans-serif; }
    .qr-wrap img { width: 28mm; height: 28mm; display: block; margin: 1mm auto; }
    .qr-top { color: #1260a8; white-space: nowrap; }
    .qr-bank { color: #e11d2e; }
    .closing { margin-top: 4mm; font-size: 11px; }
    .delivery-title { font-size: 22px; margin-top: 2mm; }
    .delivery-meta { width: 72mm; margin-left: auto; line-height: 1.7; }
    .packing-head { background: #fff; }
    .signatures { margin-top: 12mm; display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; font-weight: 700; font-size: 14px; }
    .signatures small { display: block; font-weight: 400; font-style: italic; margin-top: 1mm; }
    .legal-notes { margin-top: 3mm; font-size: 10.5px; line-height: 1.45; }
    .legal-notes p { margin: .7mm 0; }
    @media print {
      .print-toolbar { display: none !important; }
      .sheet { width: auto; min-height: auto; margin: 0; padding: 0; }
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

function headerHtml() {
  return `
    <div class="header">
      <img class="logo" src="${absoluteAsset('/kingcup-logo.svg')}" alt="KINGCUP">
      <div class="company">
        <strong>CÔNG TY TNHH KINGCUP VIỆT NAM</strong>
        <div>Địa chỉ: Số 01 ngách 17 ngõ 1333 Giải Phóng, Hoàng Mai, TP. Hà Nội</div>
        <div>Liên hệ: 033.570.2223 - 0848.999.689</div>
        <div>Email: vietnamkingcup@gmail.com</div>
      </div>
    </div>`
}

function commercialDocument(kind: 'quotation' | 'order') {
  const order = props.order as any
  const customerInfo = customerData()
  const rows = flattenItems()
  const subtotal = toNumber(order.subtotal_no_vat) || rows.reduce((sum: number, item: any) => sum + item.lineTotal, 0)
  const vatRate = toNumber(order.vat_rate)
  const vatAmount = toNumber(order.vat_amount) || subtotal * vatRate / 100
  const total = toNumber(order.actual_revenue || order.total_vat) || subtotal + vatAmount
  const title = kind === 'quotation' ? 'PHIẾU BÁO GIÁ' : 'PHIẾU ĐẶT HÀNG'
  const dateLabel = kind === 'quotation' ? 'Ngày BG' : 'Ngày ĐH'
  const codeLabel = kind === 'quotation' ? 'Số BG' : 'Số ĐH'

    const itemRows = rows.map((item: any, index) => `
  <tr>
    <td class="center">${index + 1}</td>
    <td>${escapeHtml(productDisplayName(item))}</td>
    <td class="center">${escapeHtml(item.unit || '')}</td>
    <td class="right">${formatNumber(item.quantity)}</td>
    <td class="right">${formatMoney(item.unitPrice)}</td>
    <td class="right">${formatMoney(item.lineTotal)}</td>
  </tr>`).join('')


  return pageShell(`${title} - ${order.order_code || ''}`, `
    <section class="sheet">
      ${headerHtml()}
      <h1>${title}</h1>
      <div class="meta">
        <div></div>
        <div class="meta-right">
          <div><strong>${dateLabel}:</strong> ${escapeHtml(formatDate(order.order_date || order.created_at))}</div>
          <div><strong>${codeLabel}:</strong> ${escapeHtml(order.order_code || order.id || '')}</div>
        </div>
      </div>
      <div class="info">
        <div class="info-row"><strong>Tên Công ty/HKD:</strong><span>${escapeHtml(customerInfo.company)}</span></div>
        <div class="info-row"><strong>Mã số thuế:</strong><span>${escapeHtml(customerInfo.taxCode)}</span></div>
        <div class="info-row two"><strong>Người đặt hàng:</strong><span>${escapeHtml(customerInfo.contact)}</span><strong>SĐT:</strong><span>${escapeHtml(customerInfo.phone)}</span></div>
        <div class="info-row"><strong>Địa chỉ hóa đơn:</strong><span>${escapeHtml(customerInfo.billingAddress)}</span></div>
        <div class="info-row"><strong>Địa chỉ giao hàng:</strong><span>${escapeHtml(customerInfo.shippingAddress)}</span></div>
      </div>
      <div class="intro">
        <div>Lời đầu tiên, KingCup Việt Nam xin trân trọng cảm ơn quý khách đã quan tâm tới sản phẩm của công ty chúng tôi.</div>
        <div>Chúng tôi xin gửi tới quý khách hàng ${kind === 'quotation' ? 'báo giá' : 'nội dung đặt hàng'} chi tiết như sau:</div>
      </div>
      <table class="items">
        <colgroup><col style="width:7%"><col style="width:43%"><col style="width:8%"><col style="width:10%"><col style="width:15%"><col style="width:17%"></colgroup>
        <thead><tr><th>STT</th><th>TÊN SẢN PHẨM</th><th>ĐVT</th><th>SỐ LƯỢNG</th><th>ĐƠN GIÁ</th><th>THÀNH TIỀN</th></tr></thead>
        <tbody>
          ${itemRows}
          <tr><td colspan="4" rowspan="3"><strong>Ghi chú:</strong> ${escapeHtml(order.note || 'Đơn giá chưa bao gồm vận chuyển')}</td><td class="summary-label">Cộng tiền hàng</td><td class="summary-value">${formatMoney(subtotal)}</td></tr>
          <tr><td class="summary-label">Thuế VAT (${formatNumber(vatRate)}%)</td><td class="summary-value">${formatMoney(vatAmount)}</td></tr>
          <tr><td class="summary-label">Thành tiền</td><td class="summary-value grand-total">${formatMoney(total)}</td></tr>
        </tbody>
      </table>
      <div class="bottom-grid">
        <div class="notes">
          <strong>Lưu ý:</strong>
          <p>1. Sản phẩm &amp; Pháp lý: Đầy đủ giấy tờ chứng nhận chất lượng và nguồn gốc xuất xứ.</p>
          <p>2. Số lượng sản xuất: Do đặc thù ngành in ấn, số lượng thực tế có thể dao động ±10% so với đơn đặt hàng. Quyết toán căn cứ trên số lượng thực giao.</p>
          <p>3. Chính sách thanh toán: Quý khách vui lòng tạm ứng 50% giá trị đơn hàng sau khi xác nhận mẫu và báo giá.</p>
          <p>4. Báo giá &amp; Thuế: Giá có hiệu lực tại thời điểm cung cấp và được hỗ trợ giữ giá trong vòng 03 ngày.</p>
          <p>5. Tiến độ sản xuất: Thời gian hoàn thiện dự kiến 03 - 05 ngày làm việc kể từ khi nhận đủ tiền cọc; không bao gồm Thứ 7, Chủ Nhật và ngày Lễ, Tết.</p>
        </div>
        <div class="qr-wrap">
          <div class="qr-top">VIETQR · napas 247</div>
          <img src="${absoluteAsset('/kingcup-bank-qr.svg')}" alt="QR thanh toán">
          <div class="qr-bank">TECHCOMBANK</div>
        </div>
      </div>
      <div class="closing">Chúng tôi rất mong nhận được sự hồi âm của Quý khách hàng trong thời gian sớm nhất. Chân thành cảm ơn!</div>
    </section>`)
}

function deliveryDocument() {
  const order = props.order as any
  const customerInfo = customerData()
  const rows = flattenItems()
  const warehouseName = resolveWarehouseName()
    const itemRows = rows.map((item: any, index) => {

    const standard = packingNumber(item.packingStandard)
    const boxes = item.boxQuantity || (standard > 0 ? Math.floor(item.quantity / standard) : 0)
    const odd = item.oddQuantity || (standard > 0 ? item.quantity % standard : 0)
    return `<tr>
      <td class="center">${index + 1}</td>
      <td>${escapeHtml(productDisplayName(item))}</td>
      <td class="center">${escapeHtml(item.unit || '')}</td>
      <td class="right">${formatNumber(item.quantity)}</td>
      <td class="right">${standard ? formatNumber(standard) : escapeHtml(item.packingStandard || '')}</td>
      <td class="right">${boxes ? formatNumber(boxes) : ''}</td>
      <td class="right">${odd ? formatNumber(odd) : ''}</td>
    </tr>`
  }).join('')
  const totalQuantity = rows.reduce((sum: number, item: any) => sum + toNumber(item.quantity), 0)
  const totalBoxes = rows.reduce((sum: number, item: any) => {
    const standard = packingNumber(item.packingStandard)
    return sum + (item.boxQuantity || (standard > 0 ? Math.floor(item.quantity / standard) : 0))
  }, 0)

  return pageShell(`Phiếu xuất kho - ${order.order_code || ''}`, `
    <section class="sheet">
      ${headerHtml()}
      <h1 class="delivery-title">PHIẾU XUẤT KHO VÀ BIÊN BẢN BÀN GIAO</h1>
      <div class="delivery-meta">
        <div><strong>Ngày:</strong> ${escapeHtml(formatDate(order.order_date || order.created_at))}</div>
        <div><strong>Mã ĐH:</strong> ${escapeHtml(order.order_code || order.id || '')}</div>
      </div>
      <div class="info">
        <div class="info-row"><strong>Tên Công ty/HKD:</strong><span>${escapeHtml(customerInfo.company)}</span></div>
        <div class="info-row two"><strong>Họ tên người nhận:</strong><span>${escapeHtml(customerInfo.contact)}</span><strong>Số điện thoại:</strong><span>${escapeHtml(customerInfo.phone)}</span></div>
        <div class="info-row"><strong>Địa chỉ người nhận:</strong><span>${escapeHtml(customerInfo.shippingAddress || customerInfo.billingAddress)}</span></div>
        <div class="info-row"><strong>Lý do xuất kho:</strong><span>Xuất kho bán hàng cho ${escapeHtml(customerInfo.company || customerInfo.contact)}</span></div>
        <div class="info-row"><strong>Xuất tại kho:</strong><span>${escapeHtml(warehouseName)}</span></div>
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

function printDocument(kind: PrintKind) {
  const popup = window.open('', '_blank', 'popup=yes,width=1100,height=900')
  if (!popup) {
    showToast('Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up cho trang này.', 'error')
    return
  }

  const html = kind === 'delivery' ? deliveryDocument() : commercialDocument(kind)
  popup.document.open()
  popup.document.write(html)
  popup.document.close()
  popup.focus()
  window.setTimeout(() => popup.print(), 500)
}
</script>

<template>
  <BaseModal
    title="In chứng từ đơn hàng"
    size="lg"
    :show-footer="false"
    @close="emit('close')"
  >
    <div class="print-order-summary">
      <strong>{{ order.order_code }}</strong>
      <span>{{ order.customer_name }}<template v-if="order.phone"> · {{ order.phone }}</template></span>
    </div>

    <div class="print-choice-grid">
      <button
        v-for="choice in printChoices"
        :key="choice.key"
        type="button"
        class="print-choice"
        @click="printDocument(choice.key)"
      >
        <span class="print-choice-icon">🖨</span>
        <span class="print-choice-content">
          <strong>{{ choice.title }}</strong>
          <small>{{ choice.description }}</small>
        </span>
        <span class="print-choice-arrow">›</span>
      </button>
    </div>
  </BaseModal>
</template>

<style scoped>
.print-order-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  padding: 12px 14px;
  margin-bottom: 14px;
  border: 1px solid #dbe4ff;
  border-radius: 12px;
  background: #f6f8ff;
}

.print-order-summary strong {
  color: #283bb8;
  font-size: 16px;
}

.print-order-summary span {
  color: #64748b;
}

.print-choice-grid {
  display: grid;
  gap: 12px;
}

.print-choice {
  width: 100%;
  display: grid;
  grid-template-columns: 42px 1fr 20px;
  align-items: center;
  gap: 12px;
  padding: 15px 16px;
  border: 1px solid #dce3ef;
  border-radius: 14px;
  background: #fff;
  color: #0f172a;
  text-align: left;
  cursor: pointer;
  transition: border-color .15s ease, box-shadow .15s ease, transform .15s ease;
}

.print-choice:hover {
  border-color: #8091ec;
  box-shadow: 0 8px 22px rgba(46, 62, 158, .12);
  transform: translateY(-1px);
}

.print-choice-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 11px;
  background: #eef2ff;
  font-size: 20px;
}

.print-choice-content {
  display: grid;
  gap: 4px;
}

.print-choice-content strong {
  font-size: 15px;
}

.print-choice-content small {
  color: #64748b;
  line-height: 1.4;
}

.print-choice-arrow {
  color: #64748b;
  font-size: 26px;
}
</style>
