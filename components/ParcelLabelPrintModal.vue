<script setup lang="ts">
import type { BusTransportDoc, ExportOrderDoc, ExportOrderItemDoc, OrderDoc } from '~/types/models'
import { openPrintDocument } from '~/utils/orderPrintDocuments'
import { buildParcelLabelPrintHtml, type ParcelLabelType } from '~/utils/parcelLabelPrintDocuments'

const props = defineProps<{
  type: ParcelLabelType
  exportOrder: ExportOrderDoc
  items: ExportOrderItemDoc[]
  busTransport?: BusTransportDoc | null
  request?: Record<string, any> | null
  order?: OrderDoc | null
}>()

const emit = defineEmits<{ close: [] }>()
const { showToast } = useUi()

const form = reactive({
  receiver_name: '',
  receiver_phone: '',
  receiver_address: '',
  order_code: '',
})

const isBusCarrier = computed(() => props.type === 'bus_carrier')
const title = computed(() => isBusCarrier.value ? 'In tem gửi nhà xe' : 'In tem gửi bưu điện')

function exportCode() {
  return String(props.exportOrder.code || props.exportOrder.export_code || props.exportOrder.id || '').trim()
}

function resetForm() {
  const exportRow = props.exportOrder as any
  const transport = props.busTransport as any
  const request = props.request as any
  const order = props.order as any
  Object.assign(form, {
    receiver_name: transport?.receiver_name
      || exportRow.receiver_name
      || exportRow.customer_name
      || request?.customer_name
      || order?.customer_name
      || '',
    receiver_phone: transport?.receiver_phone
      || exportRow.receiver_phone
      || exportRow.customer_phone
      || exportRow.phone
      || order?.phone
      || '',
    receiver_address: transport?.receiver_address
      || exportRow.receiver_address
      || exportRow.destination_address
      || exportRow.shipping_address
      || exportRow.billing_address
      || '',
    order_code: transport?.order_code
      || exportRow.source_order_code
      || request?.order_code
      || order?.order_code
      || exportCode(),
  })
}

watch(
  () => [props.type, props.exportOrder.id, props.busTransport?.id],
  resetForm,
  { immediate: true },
)

const printRows = computed(() => props.items
  .filter(item => item && item.deleted !== true && item.active !== false)
  .map(item => ({
    productName: item.product_name || '',
    productCode: item.product_code || '',
    logo: item.logo || item.target_logo || item.source_logo || '',
  })))

function printDocument() {
  const transport = props.busTransport as any
  const html = buildParcelLabelPrintHtml({
    type: props.type,
    receiverName: form.receiver_name,
    receiverPhone: form.receiver_phone,
    receiverAddress: form.receiver_address,
    orderCode: form.order_code,
    rows: printRows.value,
    carrierName: transport?.carrier_name || '',
    carrierPhone: transport?.carrier_phone || '',
    vehiclePlate: transport?.vehicle_plate || '',
    driverName: transport?.driver_name || '',
    departureAt: transport?.departure_at || '',
    note: transport?.note || '',
  })
  openPrintDocument(html, () => showToast('Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up cho trang này.', 'error'))
}
</script>

<template>
  <BaseModal :title="title" size="xl" :show-footer="false" @close="emit('close')">
    <div class="label-summary">
      <div><label>Mã phiếu xuất</label><strong>{{ exportCode() }}</strong></div>
      <div><label>Loại phiếu</label><strong>{{ isBusCarrier ? 'Gửi nhà xe' : 'Gửi bưu điện' }}</strong></div>
      <div><label>Sản phẩm</label><strong>{{ printRows.length }} dòng</strong></div>
      <div v-if="isBusCarrier"><label>Đơn vận chuyển</label><strong>{{ busTransport?.transport_code || 'Chưa có' }}</strong></div>
    </div>

    <div class="form-grid">
      <div class="form-group"><label>Người nhận</label><input v-model="form.receiver_name" class="input" /></div>
      <div class="form-group"><label>Số điện thoại</label><input v-model="form.receiver_phone" class="input" /></div>
      <div class="form-group full"><label>Địa chỉ</label><input v-model="form.receiver_address" class="input" /></div>
      <div class="form-group"><label>Mã đơn hàng</label><input v-model="form.order_code" class="input" /></div>
    </div>

    <div v-if="isBusCarrier" class="carrier-box">
      <strong>Thông tin nhà xe</strong>
      <div>{{ busTransport?.carrier_name || 'Chưa nhập tên nhà xe' }}</div>
      <div class="small subtle">
        {{ [busTransport?.carrier_phone, busTransport?.vehicle_plate, busTransport?.driver_name].filter(Boolean).join(' · ') || 'Chưa có SĐT, biển số hoặc tên chủ xe/tài xế' }}
      </div>
    </div>

    <div class="table-wrap" style="margin-top:14px">
      <table style="min-width:720px">
        <thead><tr><th>STT</th><th>Tên hàng hóa</th><th>Số kiện</th><th>Logo</th></tr></thead>
        <tbody>
          <tr v-for="(row,index) in printRows" :key="`${row.productCode}|${row.logo}|${index}`">
            <td>{{ index + 1 }}</td>
            <td><b>{{ row.productName || '-' }}</b><div class="small subtle">{{ row.productCode || '' }}</div></td>
            <td></td>
            <td>{{ row.logo || '-' }}</td>
          </tr>
          <tr v-if="!printRows.length"><td colspan="4" class="empty">Phiếu xuất chưa có sản phẩm để in.</td></tr>
        </tbody>
      </table>
    </div>

    <div class="modal-actions">
      <button type="button" class="btn" @click="emit('close')">Đóng</button>
      <button type="button" class="btn primary" :disabled="!printRows.length" @click="printDocument">In phiếu</button>
    </div>
  </BaseModal>
</template>

<style scoped>
.label-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.label-summary > div,
.carrier-box {
  padding: 11px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
}
.label-summary label,
.label-summary strong { display: block; }
.label-summary label { margin-bottom: 3px; color: #64748b; font-size: 12px; }
.form-group.full { grid-column: 1 / -1; }
.carrier-box { margin-top: 14px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
@media (max-width: 800px) {
  .label-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .label-summary { grid-template-columns: 1fr; }
  .modal-actions { flex-direction: column-reverse; }
  .modal-actions .btn { width: 100%; }
}
</style>
