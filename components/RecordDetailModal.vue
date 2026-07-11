<script setup lang="ts">
import { formatDateTime, money, safeJsonParse } from '~/utils/format'

const props = withDefaults(defineProps<{
  title: string
  record: Record<string, any>
  fieldOrder?: string[]
  labels?: Record<string, string>
  moneyFields?: string[]
  dateFields?: string[]
  hiddenFields?: string[]
}>(), {
  fieldOrder: () => [],
  labels: () => ({}),
  moneyFields: () => [],
  dateFields: () => [],
  hiddenFields: () => ['search_text']
})

defineEmits<{ close: [] }>()

const commonLabels: Record<string, string> = {
  id: 'ID Firestore',
  firestore_id: 'Firestore ID',
  created_at: 'Ngày giờ tạo',
  updated_at: 'Ngày giờ cập nhật',
  deleted_at: 'Ngày giờ xóa',
  created_by: 'Người tạo',
  updated_by: 'Người cập nhật',
  owner_email: 'Email chủ dữ liệu',
  sale_email: 'Email sale',
  sale_name: 'Sale phụ trách',
  active: 'Đang hoạt động',
  deleted: 'Đã xóa',
  status: 'Trạng thái',
  note: 'Ghi chú',
  customer_code: 'Mã khách hàng',
  customer_name: 'Tên khách hàng',
  company_name: 'Tên công ty',
  phone: 'Số điện thoại',
  email: 'Email',
  tax_code: 'Mã số thuế',
  billing_address: 'Địa chỉ hóa đơn',
  shipping_address: 'Địa chỉ giao hàng',
  source: 'Nguồn khách hàng',
  order_id: 'ID đơn hàng',
  order_code: 'Mã đơn hàng',
  order_date: 'Ngày giờ đơn hàng',
  order_status: 'Trạng thái đơn hàng',
  payment_status: 'Trạng thái thanh toán',
  payment_date: 'Ngày thanh toán',
  payment_type: 'Loại thanh toán',
  amount: 'Số tiền',
  method: 'Phương thức',
  cod_status: 'Trạng thái COD',
  carrier: 'Đơn vị vận chuyển',
  tracking_code: 'Mã vận đơn',
  shipping_fee: 'Phí vận chuyển',
  cod_amount: 'Tiền COD',
  shipping_status: 'Trạng thái vận chuyển',
  shipped_date: 'Ngày gửi',
  delivered_date: 'Ngày giao',
  receiver_name: 'Người nhận',
  receiver_phone: 'SĐT người nhận',
  receiver_address: 'Địa chỉ nhận',
  invoice_number: 'Số hóa đơn',
  invoice_date: 'Ngày hóa đơn',
  invoice_amount: 'Giá trị hóa đơn',
  invoice_status: 'Trạng thái hóa đơn',
  module: 'Phân hệ',
  action: 'Hành động',
  item_code: 'Mã dữ liệu',
  item_name: 'Tên dữ liệu',
  changed_by: 'Người thao tác',
  before_json: 'Dữ liệu trước',
  after_json: 'Dữ liệu sau'
}

const defaultDateFields = new Set([
  'created_at', 'updated_at', 'deleted_at', 'order_date', 'payment_date',
  'shipped_date', 'delivered_date', 'invoice_date', 'requested_at',
  'warehouse_handled_at', 'export_date'
])
const defaultMoneyFields = new Set([
  'amount', 'shipping_fee', 'cod_amount', 'invoice_amount', 'subtotal_no_vat',
  'vat_amount', 'total_vat', 'actual_revenue', 'paid_amount', 'debt_amount',
  'unit_price', 'line_total'
])

const orderedEntries = computed(() => {
  const record = props.record || {}
  const hidden = new Set(props.hiddenFields)
  const keys = Object.keys(record).filter(key => !hidden.has(key))
  const order = [...props.fieldOrder, ...keys.filter(key => !props.fieldOrder.includes(key)).sort()]
  return Array.from(new Set(order))
    .filter(key => Object.prototype.hasOwnProperty.call(record, key) && !hidden.has(key))
    .map(key => ({ key, label: props.labels[key] || commonLabels[key] || key, value: record[key] }))
})

function isDateField(key: string) {
  return props.dateFields.includes(key) || defaultDateFields.has(key) || key.endsWith('_at') || key.endsWith('_date')
}

function isMoneyField(key: string) {
  return props.moneyFields.includes(key) || defaultMoneyFields.has(key)
}

function displayValue(key: string, value: any) {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'boolean') return value ? 'Có' : 'Không'
  if (isDateField(key)) return formatDateTime(value) || String(value)
  if (isMoneyField(key)) return money(value)
  if (Array.isArray(value)) return value.length ? value.join(', ') : '-'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  if (key.endsWith('_json')) {
    const parsed = safeJsonParse(value, value)
    return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)
  }
  return String(value)
}

function isLongValue(key: string, value: any) {
  const text = displayValue(key, value)
  return key.endsWith('_json') || key === 'note' || key.includes('address') || text.length > 100 || text.includes('\n')
}
</script>

<template>
  <BaseModal :title="title" size="xl" :show-footer="false" @close="$emit('close')">
    <div class="record-detail-grid">
      <div
        v-for="entry in orderedEntries"
        :key="entry.key"
        class="record-detail-item"
        :class="{ wide: isLongValue(entry.key, entry.value) }"
      >
        <label>{{ entry.label }}</label>
        <pre v-if="isLongValue(entry.key, entry.value)">{{ displayValue(entry.key, entry.value) }}</pre>
        <strong v-else>{{ displayValue(entry.key, entry.value) }}</strong>
      </div>
    </div>
    <slot />
  </BaseModal>
</template>

<style scoped>
.record-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.record-detail-item {
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: #f8fafc;
  padding: 11px 12px;
  min-width: 0;
}
.record-detail-item.wide { grid-column: 1 / -1; }
.record-detail-item label {
  display: block;
  color: #64748b;
  font-size: 12px;
  margin-bottom: 5px;
}
.record-detail-item strong,
.record-detail-item pre {
  margin: 0;
  color: #0f172a;
  font-size: 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
}
@media (max-width: 720px) {
  .record-detail-grid { grid-template-columns: 1fr; }
  .record-detail-item.wide { grid-column: auto; }
}
</style>
