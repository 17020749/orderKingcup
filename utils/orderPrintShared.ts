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

export function escapeHtml(value: any) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function formatNumber(value: any) {
  return toNumber(value).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
}

export function formatMoney(value: any) {
  return `${toNumber(value).toLocaleString('vi-VN')} đ`
}

function toDate(value: any) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function dateParts(value: any) {
  const date = toDate(value)
  if (!date) return { day: '', month: '', year: '' }
  return {
    day: String(date.getDate()).padStart(2, '0'),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    year: String(date.getFullYear()),
  }
}

export function absoluteAsset(assetBase: string | undefined, path: string) {
  const base = assetBase || (typeof window !== 'undefined' ? window.location.origin : '')
  if (!base) return path
  return new URL(path, base).href
}

export function customerData(order: any, customer: any): PrintCustomer {
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

export function flattenOrderItems(items: any[]) {
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

export function productDisplayName(item: any) {
  const base = item.productName || item.productCode || '-'
  return item.logo ? `${base} - Logo: ${item.logo}` : base
}

export function padRows<T>(rows: T[], count = 15): Array<T | null> {
  return [...rows.slice(0, count), ...Array.from({ length: Math.max(0, count - rows.length) }, () => null)]
}

function commonCss() {
  return `
    @page { size: A4 portrait; margin: 19.05mm 6.35mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body { font-family: Roboto, Arial, sans-serif; font-size: 8.3529pt; }
    .print-toolbar { position: sticky; top: 0; z-index: 20; display: flex; justify-content: flex-end; gap: 8px; padding: 10px; background: #eef2ff; border-bottom: 1px solid #c7d2fe; }
    .print-toolbar button { border: 1px solid #94a3b8; background: #fff; border-radius: 7px; padding: 8px 14px; cursor: pointer; font: 600 13px Arial, sans-serif; }
    .print-toolbar button.primary { color: #fff; background: #1d4ed8; border-color: #1d4ed8; }
    .sheet { width: 197.3mm; margin: 0 auto; position: relative; }
    .document-header { position: relative; height: 43.3707pt; }
    .brand-logo { position: absolute; left: .54pt; top: 0; width: 133.4872pt; height: 43.3707pt; object-fit: contain; object-position: left top; }
    .company-block { position: absolute; right: 0; top: 0; width: 260pt; text-align: center; }
    .company-title { color: #ff0000; font-size: 9.745pt; line-height: 11.5pt; font-weight: 700; white-space: nowrap; }
    .company-line { font-size: 6.9607pt; line-height: 11pt; white-space: nowrap; }
    .company-contact { display: grid; grid-template-columns: 1fr 1fr; column-gap: 9pt; }
    .company-contact span:first-child { text-align: right; }
    .company-contact span:last-child { text-align: left; }
    .document-heading { display: grid; grid-template-columns: 56.5% 43.5%; height: 38.43pt; padding-top: 8.8pt; }
    .document-title { font-family: "Times New Roman", Times, serif; font-size: 19.49pt; line-height: 23pt; font-weight: 700; text-align: center; white-space: nowrap; }
    .document-meta { padding-top: .5pt; font-size: 6.9607pt; line-height: 13pt; }
    .date-row { display: grid; grid-template-columns: 1fr 1fr 1fr; text-align: center; white-space: nowrap; }
    .code-row { display: grid; grid-template-columns: 1fr 1.55fr; }
    .code-row strong { text-align: right; padding-right: 7pt; font-weight: 400; }
    .info-block { font-size: 8.3529pt; line-height: 14.4569pt; }
    .info-row { display: grid; grid-template-columns: 108pt minmax(0, 1fr); min-height: 14.4569pt; white-space: nowrap; }
    .info-row.orderer { grid-template-columns: 108pt 229pt 38pt minmax(0, 1fr); }
    .info-row.sale { grid-template-columns: 144pt 193pt 38pt minmax(0, 1fr); }
    .intro { font-size: 8.3529pt; line-height: 12.78pt; height: 25.56pt; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .items-table th, .items-table td { border: .75pt solid #000; padding: 0 2.15pt; vertical-align: middle; }
    .items-table thead th { height: 18.47pt; background: #a4c2f4; font-size: 8.3529pt; font-weight: 700; text-align: center; }
    .items-table tbody tr.item-row td { height: 11.1pt; font-size: 8.3529pt; line-height: 10.2pt; }
    .center { text-align: center; }
    .right { text-align: right; }
    .summary-note { vertical-align: middle !important; font-size: 7.6568pt !important; }
    .summary-label, .summary-value { height: 11.244pt; font-family: "Times New Roman", Times, serif; font-size: 8.3529pt; font-weight: 700; }
    .summary-value { text-align: center; }
    .red { color: #ff0000; }
    .notes-area { position: relative; padding-top: 5.8pt; min-height: 155pt; }
    .notes-title { font-size: 8.3529pt; line-height: 11pt; font-weight: 700; }
    .notes-line { font-size: 6.9607pt; line-height: 10.7pt; margin: 0; }
    .notes-line + .notes-line { margin-top: 1.4pt; }
    .bank-prompt { margin-top: 3.2pt; font-size: 8.3529pt; line-height: 12pt; }
    .bank-details { width: 315pt; margin-top: 8pt; text-align: center; color: #081b3a; }
    .bank-name { font-family: "Times New Roman", Times, serif; font-size: 7.6568pt; line-height: 10pt; font-weight: 700; }
    .bank-account { font-family: "Times New Roman", Times, serif; font-size: 8.3529pt; line-height: 12pt; font-weight: 700; color: #000; }
    .qr-image { position: absolute; right: 15.5pt; top: 48.7pt; width: 82.49pt; height: 93.7pt; object-fit: contain; }
    .closing { margin-top: 12.2pt; font-size: 7.6568pt; line-height: 10pt; white-space: nowrap; }
    .delivery-title { font-family: "Times New Roman", Times, serif; font-size: 16.56pt; font-weight: 700; text-align: center; height: 43.2pt; line-height: 43.2pt; white-space: nowrap; }
    .delivery-meta { width: 255pt; margin-left: auto; font-size: 6.9607pt; line-height: 12.2pt; }
    .delivery-info { margin-top: 2pt; font-size: 7.6568pt; line-height: 13pt; }
    .delivery-info-row { display: grid; grid-template-columns: 116pt minmax(0, 1fr); min-height: 13pt; white-space: nowrap; }
    .delivery-info-row.two { grid-template-columns: 116pt 223pt 72pt minmax(0, 1fr); }
    .delivery-note { height: 43.2pt; padding-top: 4pt; font-size: 7.6568pt; white-space: pre-wrap; }
    .delivery-table th, .delivery-table td { border: .75pt solid #000; padding: 0 2pt; vertical-align: middle; }
    .delivery-table thead th { background: #fff; font-size: 7.6568pt; font-weight: 700; text-align: center; }
    .delivery-table thead tr:first-child th { height: 18pt; }
    .delivery-table thead tr:last-child th { height: 26pt; line-height: 10pt; }
    .delivery-table tbody .item-row td { height: 11.1pt; font-size: 7.6568pt; }
    .delivery-total td { height: 13pt; font-family: "Times New Roman", Times, serif; font-size: 9.36pt; font-weight: 700; }
    .delivery-legal { margin-top: 5pt; font-size: 6.9607pt; line-height: 9.8pt; }
    .delivery-legal p { margin: 0; }
    .signatures { margin-top: 14pt; display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; font-family: "Times New Roman", Times, serif; font-size: 9.36pt; font-weight: 700; }
    .signatures small { display: block; margin-top: 1pt; font-family: Roboto, Arial, sans-serif; font-size: 6.9607pt; font-weight: 400; font-style: italic; }
    @media screen { body { padding: 12px 0 30px; background: #e5e7eb; } .sheet { background: #fff; box-shadow: 0 8px 30px rgba(15,23,42,.18); } }
    @media print { .print-toolbar { display: none !important; } body { background: #fff; } .sheet { width: 100%; margin: 0; box-shadow: none; } tr { break-inside: avoid; } }
  `
}

export function pageShell(title: string, body: string) {
  return `<!doctype html><html lang="vi"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap" rel="stylesheet">
    <title>${escapeHtml(title)}</title><style>${commonCss()}</style>
  </head><body><div class="print-toolbar"><button onclick="window.close()">Đóng</button><button class="primary" onclick="window.print()">In phiếu</button></div>${body}</body></html>`
}

export function headerHtml(assetBase?: string) {
  return `<header class="document-header">
    <img class="brand-logo" src="${absoluteAsset(assetBase, '/kingcup-logo.svg')}" alt="KINGCUP">
    <div class="company-block"><div class="company-title">CÔNG TY TNHH KINGCUP VIỆT NAM</div>
      <div class="company-line">Địa chỉ: Số 01 ngách 17 ngõ 1333 Giải Phóng, Hoàng Mai, TP.Hà Nội, Việt Nam</div>
      <div class="company-line company-contact"><span>Liên hệ: 033.570.2223</span><span>Web: https://baobikingcup.vn/</span></div>
      <div class="company-line">Email: vietnamkingcup@gmail.com</div></div>
  </header>`
}

export function headingHtml(title: string, codeLabel: string, code: string, value: any) {
  const date = dateParts(value)
  return `<section class="document-heading"><div class="document-title">${escapeHtml(title)}</div><div class="document-meta">
    <div class="date-row"><span>Ngày${date.day ? ` ${escapeHtml(date.day)}` : ''}</span><span>Tháng${date.month ? ` ${escapeHtml(date.month)}` : ''}</span><span>Năm${date.year ? ` ${escapeHtml(date.year)}` : ''}</span></div>
    <div class="code-row"><strong>${escapeHtml(codeLabel)}</strong><span>${escapeHtml(code)}</span></div>
  </div></section>`
}
