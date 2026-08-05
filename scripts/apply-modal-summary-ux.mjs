import fs from 'node:fs'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function write(path, content) {
  fs.writeFileSync(path, content)
}

function replaceOnce(path, before, after) {
  const source = read(path)
  const count = source.split(before).length - 1
  if (count !== 1) {
    throw new Error(`${path}: expected exactly one match, found ${count}: ${before.slice(0, 120)}`)
  }
  write(path, source.replace(before, after))
}

function replaceSection(path, startMarker, endMarker, replacement) {
  const source = read(path)
  const start = source.indexOf(startMarker)
  if (start < 0) throw new Error(`${path}: start marker not found: ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  if (end < 0) throw new Error(`${path}: end marker not found: ${endMarker}`)
  write(path, source.slice(0, start) + replacement + source.slice(end))
}

function patchBaseModal() {
  const path = 'components/BaseModal.vue'
  replaceOnce(
    path,
    `      <div class="modal-header">
        <h3 style="margin: 0">{{ title }}</h3>
        <button class="modal-close" type="button" @click="$emit('close')">
          ×
        </button>
      </div>`,
    `      <div class="modal-header">
        <h3 style="margin: 0">{{ title }}</h3>
        <div v-if="$slots['header-actions']" class="modal-header-actions">
          <slot name="header-actions" />
        </div>
        <button class="modal-close" type="button" @click="$emit('close')">
          ×
        </button>
      </div>`,
  )

  replaceOnce(
    path,
    `</template>
`,
    `</template>

<style scoped>
.modal-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.modal-header h3 {
  flex: 1 1 220px;
  min-width: 0;
}
.modal-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}
.modal-close {
  flex: 0 0 auto;
}
</style>
`,
  )
}

function patchRecordDetailModal() {
  const path = 'components/RecordDetailModal.vue'
  replaceOnce(
    path,
    `  hiddenFields?: string[]
}>(), {`,
    `  hiddenFields?: string[]
  includeUnlistedFields?: boolean
  columns?: 2 | 3 | 4
  linkFields?: string[]
}>(), {`,
  )
  replaceOnce(
    path,
    `  hiddenFields: () => ['search_text']
})`,
    `  hiddenFields: () => ['search_text'],
  includeUnlistedFields: true,
  columns: 2,
  linkFields: () => []
})`,
  )
  replaceOnce(
    path,
    `  const order = [...props.fieldOrder, ...keys.filter(key => !props.fieldOrder.includes(key)).sort()]`,
    `  const order = props.includeUnlistedFields
    ? [...props.fieldOrder, ...keys.filter(key => !props.fieldOrder.includes(key)).sort()]
    : [...props.fieldOrder]`,
  )
  replaceOnce(
    path,
    `function isLongValue(key: string, value: any) {
  const text = displayValue(key, value)
  return key.endsWith('_json') || key === 'note' || key.includes('address') || text.length > 100 || text.includes('\\n')
}
`,
    `function isLongValue(key: string, value: any) {
  const text = displayValue(key, value)
  return key.endsWith('_json') || key === 'note' || key.includes('address') || text.length > 100 || text.includes('\\n')
}

function normalizedLink(key: string, value: any) {
  if (!props.linkFields.includes(key)) return ''
  const text = String(value || '').trim()
  if (!/^https?:\\/\\//i.test(text)) return ''
  return text
}
`,
  )
  replaceOnce(
    path,
    `  <BaseModal :title="title" size="xl" :show-footer="false" @close="$emit('close')">
    <div class="record-detail-grid">`,
    `  <BaseModal :title="title" size="xl" :show-footer="false" @close="$emit('close')">
    <template #header-actions>
      <slot name="actions" />
    </template>
    <div class="record-detail-grid" :class="\`columns-\${props.columns}\`">`,
  )
  replaceOnce(
    path,
    `        <pre v-if="isLongValue(entry.key, entry.value)">{{ displayValue(entry.key, entry.value) }}</pre>
        <strong v-else>{{ displayValue(entry.key, entry.value) }}</strong>`,
    `        <a
          v-if="normalizedLink(entry.key, entry.value)"
          :href="normalizedLink(entry.key, entry.value)"
          target="_blank"
          rel="noopener noreferrer"
        >Mở liên kết</a>
        <pre v-else-if="isLongValue(entry.key, entry.value)">{{ displayValue(entry.key, entry.value) }}</pre>
        <strong v-else>{{ displayValue(entry.key, entry.value) }}</strong>`,
  )
  replaceOnce(
    path,
    `.record-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}`,
    `.record-detail-grid {
  display: grid;
  gap: 12px;
}
.record-detail-grid.columns-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.record-detail-grid.columns-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.record-detail-grid.columns-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }`,
  )
  replaceOnce(
    path,
    `.record-detail-item strong,
.record-detail-item pre {`,
    `.record-detail-item strong,
.record-detail-item pre,
.record-detail-item a {`,
  )
  replaceOnce(
    path,
    `@media (max-width: 720px) {
  .record-detail-grid { grid-template-columns: 1fr; }
  .record-detail-item.wide { grid-column: auto; }
}`,
    `@media (max-width: 1100px) {
  .record-detail-grid.columns-3,
  .record-detail-grid.columns-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  .record-detail-grid,
  .record-detail-grid.columns-2,
  .record-detail-grid.columns-3,
  .record-detail-grid.columns-4 { grid-template-columns: 1fr; }
  .record-detail-item.wide { grid-column: auto; }
}`,
  )
}

function patchOrders() {
  const path = 'pages/orders.vue'
  replaceOnce(
    path,
    `const showDetailModal = ref(false)
const selectedDetail = ref<OrderDoc | null>(null)`,
    `const showDetailModal = ref(false)
const showOrderBreakdownModal = ref(false)
const selectedDetail = ref<OrderDoc | null>(null)`,
  )

  replaceOnce(
    path,
    `const customerOptions = computed(() => customers.value.map(customer => ({`,
    `const orderDetailRecord = computed(() => {
  const row: any = selectedDetail.value
  if (!row) return {}
  return {
    ...row,
    warehouse_fulfillment_status: fulfillmentLabel(row.warehouse_fulfillment_status),
    shipment_status: shipmentStatusLabel(row.shipment_status),
  }
})

const customerOptions = computed(() => customers.value.map(customer => ({`,
  )

  const labelStart = `const orderDetailLabels: Record<string, string> = {`
  const labelEnd = `\n}\n\nfunction warehouseStatusLabel`
  const source = read(path)
  const start = source.indexOf(labelStart)
  const end = source.indexOf(labelEnd, start)
  if (start < 0 || end < 0) throw new Error('pages/orders.vue: orderDetailLabels block not found')
  const labels = `const orderDetailLabels: Record<string, string> = {
  order_code: 'Mã đơn hàng',
  customer_code: 'Mã khách hàng',
  user_code: 'Mã người dùng',
  order_classification: 'Phân loại đơn',
  customer_name: 'Khách hàng',
  phone: 'Số điện thoại',
  sale_name: 'Sale phụ trách',
  created_by: 'Người tạo đơn',
  created_at: 'Ngày giờ tạo',
  order_status: 'Trạng thái đơn',
  subtotal_no_vat: 'Tạm tính chưa VAT',
  vat_rate: 'VAT (%)',
  vat_amount: 'Tiền VAT',
  total_vat: 'Tổng sau VAT',
  discount_amount: 'Số tiền giảm giá',
  payable_amount: 'Giá trị sau giảm giá',
  actual_revenue: 'Tổng tiền đơn',
  paid_amount: 'Đã thu',
  debt_amount: 'Công nợ',
  payment_status: 'Trạng thái thanh toán',
  invoice_status: 'Trạng thái hóa đơn',
  warehouse_fulfillment_status: 'Trạng thái xuất kho',
  cod_amount_total: 'Tổng tiền COD',
  computed_payment_status: 'Trạng thái thanh toán tự động',
  shipping_fee: 'Phí vận chuyển',
  shipment_status: 'Trạng thái vận chuyển',
  shipping_fee_total: 'Tổng phí vận chuyển',
}`
  write(path, source.slice(0, start) + labels + source.slice(end + 2))

  replaceOnce(
    path,
    `async function loadRows(force = false, append = false) {`,
    `function shipmentStatusLabel(status: any) {
  const value = String(status || '').trim()
  const normalized = normalizeText(value).replace(/\\s+/g, '_')
  return ({
    pending: 'Chờ giao',
    cho_giao: 'Chờ giao',
    ready: 'Sẵn sàng giao',
    in_transit: 'Đang giao',
    dang_giao: 'Đang giao',
    shipped: 'Đã gửi',
    delivered: 'Đã giao',
    da_giao: 'Đã giao',
    failed: 'Giao thất bại',
    giao_that_bai: 'Giao thất bại',
    returned: 'Hoàn hàng',
    hoan_hang: 'Hoàn hàng',
    cancelled: 'Đã hủy',
    canceled: 'Đã hủy',
  } as Record<string, string>)[normalized] || value || '-'
}

async function loadRows(force = false, append = false) {`,
  )

  replaceOnce(
    path,
    `function openDetail(row: OrderDoc) {
  selectedDetail.value = row
  showDetailModal.value = true
}`,
    `function openDetail(row: OrderDoc) {
  selectedDetail.value = row
  showOrderBreakdownModal.value = false
  showDetailModal.value = true
}`,
  )

  const updated = read(path)
  const modalStart = `    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"`
  const modalEndMarker = `\n\n    <OrderPrintModal`
  const modalStartIndex = updated.indexOf(modalStart)
  const modalEndIndex = updated.indexOf(modalEndMarker, modalStartIndex)
  if (modalStartIndex < 0 || modalEndIndex < 0) throw new Error('pages/orders.vue: detail modal section not found')
  const oldModal = updated.slice(modalStartIndex, modalEndIndex)
  const slotOpen = oldModal.indexOf(`    >\n`)
  const slotClose = oldModal.lastIndexOf(`\n    </RecordDetailModal>`)
  if (slotOpen < 0 || slotClose < 0) throw new Error('pages/orders.vue: detail modal slot content not found')
  const detailSections = oldModal.slice(slotOpen + `    >\n`.length, slotClose)

  const newModal = `    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      title="Tổng quan đơn hàng"
      :record="orderDetailRecord"
      :labels="orderDetailLabels"
      :field-order="[
        'order_code','customer_code','user_code','order_classification','customer_name','phone','sale_name',
        'created_by','created_at','order_status','subtotal_no_vat','vat_rate','vat_amount','total_vat',
        'discount_amount','payable_amount','actual_revenue','paid_amount','debt_amount','payment_status',
        'invoice_status','warehouse_fulfillment_status','cod_amount_total','computed_payment_status',
        'shipping_fee','shipment_status','shipping_fee_total'
      ]"
      :money-fields="[
        'subtotal_no_vat','vat_amount','total_vat','discount_amount','payable_amount','actual_revenue',
        'paid_amount','debt_amount','cod_amount_total','shipping_fee','shipping_fee_total'
      ]"
      :include-unlisted-fields="false"
      :columns="3"
      @close="showDetailModal = false; showOrderBreakdownModal = false"
    >
      <template #actions>
        <button class="btn primary" type="button" @click="showOrderBreakdownModal = true">
          Chi tiết đơn hàng
        </button>
      </template>
    </RecordDetailModal>

    <BaseModal
      v-if="showOrderBreakdownModal && selectedDetail"
      :title="\`Chi tiết đơn hàng \${selectedDetail.order_code || ''}\`"
      size="full"
      :show-footer="false"
      @close="showOrderBreakdownModal = false"
    >
      <div class="detail-grid" style="margin-bottom:16px">
        <div class="detail-item"><label>Mã đơn hàng</label><strong>{{ selectedDetail.order_code || '-' }}</strong></div>
        <div class="detail-item"><label>Khách hàng</label><strong>{{ selectedDetail.customer_name || '-' }}</strong></div>
        <div class="detail-item"><label>Trạng thái đơn</label><strong>{{ selectedDetail.order_status || '-' }}</strong></div>
        <div class="detail-item"><label>Tổng tiền đơn</label><strong>{{ money(selectedDetail.actual_revenue || selectedDetail.total_vat) }}</strong></div>
      </div>
${detailSections}
    </BaseModal>`

  write(path, updated.slice(0, modalStartIndex) + newModal + updated.slice(modalEndIndex))
}

function patchPayments() {
  const path = 'pages/payments.vue'
  replaceOnce(
    path,
    `function openDetail(row: PaymentRow) {`,
    `const paymentDetailLabels: Record<string, string> = {
  order_code: 'Mã đơn hàng',
  payment_date: 'Ngày thanh toán',
  payment_type: 'Loại thanh toán',
  amount: 'Số tiền',
  method: 'Phương thức',
  recipient_name: 'Tài khoản người nhận',
  recipient_account_number: 'STK người nhận',
  recipient_bank_name: 'Ngân hàng người nhận',
  sender_image_url: 'Link ảnh nhận tiền',
  payment_status: 'Trạng thái thanh toán',
  created_by: 'Người tạo',
  created_at: 'Ngày giờ tạo',
  updated_at: 'Ngày giờ cập nhật',
}

function openDetail(row: PaymentRow) {`,
  )

  replaceSection(
    path,
    `    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      title="Chi tiết thanh toán"`,
    `\n\n    <ConfirmModal`,
    `    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      title="Chi tiết thanh toán"
      :record="selectedDetail"
      :labels="paymentDetailLabels"
      :field-order="[
        'order_code','payment_date','payment_type','amount','method','recipient_name',
        'recipient_account_number','recipient_bank_name','sender_image_url','payment_status',
        'created_by','created_at','updated_at'
      ]"
      :money-fields="['amount']"
      :link-fields="['sender_image_url']"
      :include-unlisted-fields="false"
      :columns="3"
      @close="showDetailModal = false"
    />`,
  )
}

function patchInvoices() {
  const path = 'pages/invoices.vue'
  replaceOnce(
    path,
    `function openDetail(row: InvoiceDoc) {`,
    `const invoiceDetailLabels: Record<string, string> = {
  order_code: 'Mã đơn hàng',
  invoice_number: 'Số hóa đơn',
  invoice_date: 'Ngày hóa đơn',
  invoice_amount: 'Giá trị hóa đơn',
  invoice_status: 'Trạng thái hóa đơn',
  tax_code: 'Mã số thuế',
  company_name: 'Tên công ty',
  billing_address: 'Địa chỉ hóa đơn',
  note: 'Ghi chú',
  created_by: 'Người tạo',
  created_at: 'Ngày giờ tạo',
  updated_at: 'Ngày giờ cập nhật',
}

function openDetail(row: InvoiceDoc) {`,
  )

  replaceSection(
    path,
    `    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      title="Chi tiết hóa đơn"`,
    `\n\n    <ConfirmModal`,
    `    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      title="Chi tiết hóa đơn"
      :record="selectedDetail"
      :labels="invoiceDetailLabels"
      :field-order="[
        'order_code','invoice_number','invoice_date','invoice_amount','invoice_status',
        'tax_code','company_name','billing_address','note','created_by','created_at','updated_at'
      ]"
      :money-fields="['invoice_amount']"
      :include-unlisted-fields="false"
      :columns="3"
      @close="showDetailModal = false"
    />`,
  )
}

function patchInventory() {
  const path = 'pages/inventory.vue'
  replaceOnce(
    path,
    `function differenceClass(row: InventoryAuditRow) {`,
    `function movementTypeLabel(row: StockMovementDoc) {
  const type = String(row.movement_type || '').trim().toLowerCase()
  const exact: Record<string, string> = {
    import: 'Nhập kho',
    import_update_reverse: 'Đảo nhập cũ khi sửa phiếu',
    import_update_apply: 'Ghi nhận nhập mới khi sửa phiếu',
    import_delete_reverse: 'Đảo nhập do xóa phiếu',
    export_customer: 'Xuất cho khách hàng',
    export_transfer_out: 'Xuất chuyển kho',
    export_transfer_in: 'Nhập chuyển kho',
    export_update_reverse_source: 'Hoàn tồn kho nguồn do sửa phiếu xuất',
    export_update_reverse_destination: 'Đảo tồn kho nhận do sửa phiếu xuất',
    export_cancel_reverse_source: 'Hoàn tồn kho nguồn do hủy phiếu xuất',
    export_cancel_reverse_destination: 'Đảo tồn kho nhận do hủy phiếu xuất',
    export_request_cancel_reverse: 'Hoàn tồn do hủy xuất từ yêu cầu',
    adjustment: 'Điều chỉnh tồn kho',
  }
  if (exact[type]) return exact[type]
  if (type.includes('transfer_in')) return 'Nhập chuyển kho'
  if (type.includes('transfer_out')) return 'Xuất chuyển kho'
  if (type.includes('reverse') || type.includes('cancel')) return 'Đảo / hoàn tồn'
  if (type.includes('adjust') || row.direction === 'adjust') return 'Điều chỉnh tồn kho'
  if (row.direction === 'in' || toNumber(row.quantity) > 0) return 'Nhập kho'
  if (row.direction === 'out' || toNumber(row.quantity) < 0) return 'Xuất kho'
  return type || 'Không xác định'
}

function differenceClass(row: InventoryAuditRow) {`,
  )

  replaceOnce(
    path,
    `{{ movement.movement_type || movement.direction }}`,
    `{{ movementTypeLabel(movement) }}`,
  )
}

function writeTests() {
  const test = `import test from 'node:test'
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
  ]) assert.match(secondary, new RegExp(heading.replace('/', '\\\\/')))
  for (const field of [
    'order_code','customer_code','user_code','order_classification','customer_name','phone',
    'sale_name','created_by','created_at','order_status','subtotal_no_vat','vat_rate',
    'vat_amount','total_vat','discount_amount','payable_amount','actual_revenue','paid_amount',
    'debt_amount','payment_status','invoice_status','warehouse_fulfillment_status',
    'cod_amount_total','computed_payment_status','shipping_fee','shipment_status','shipping_fee_total',
  ]) assert.ok(main.includes(\`'\${field}'\`), \`missing order field \${field}\`)
})

test('payment and invoice detail modals show only requested fields with Vietnamese labels', () => {
  const payments = read('pages/payments.vue')
  assert.match(payments, /recipient_name: 'Tài khoản người nhận'/)
  assert.match(payments, /recipient_account_number: 'STK người nhận'/)
  assert.match(payments, /recipient_bank_name: 'Ngân hàng người nhận'/)
  assert.match(payments, /link-fields="\\['sender_image_url'\\]"/)
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
  assert.match(source, /\\{\\{ movementTypeLabel\\(movement\\) \\}\\}/)
})
`
  write('tests/modal-detail-ux.client.test.mjs', test)
}

patchBaseModal()
patchRecordDetailModal()
patchOrders()
patchPayments()
patchInvoices()
patchInventory()
writeTests()

console.log('Applied modal summary UX changes.')
