<script setup lang="ts">
import type { BusTransportDoc } from '~/types/models'
import { openPrintDocument } from '~/utils/orderPrintDocuments'
import { buildParcelLabelPrintHtml, type ParcelLabelType } from '~/utils/parcelLabelPrintDocuments'
import { safeJsonParse } from '~/utils/format'

const props = defineProps<{
  type: ParcelLabelType
  sourceCode: string
  items: Array<Record<string, any>>
  busTransport?: BusTransportDoc | null
  request?: Record<string, any> | null
}>()

const emit = defineEmits<{ close: [] }>()
const { showToast } = useUi()
const isBusCarrier = computed(() => props.type === 'bus_carrier')
const title = computed(() => isBusCarrier.value ? 'In tem gửi nhà xe' : 'In tem gửi bưu điện')
const requestPayload = computed(() => safeJsonParse(props.request?.payload_json, {}))
const receiverName = computed(() => String(props.request?.receiver_name || requestPayload.value?.receiver_name || props.busTransport?.receiver_name || props.request?.customer_name || '').trim())
const receiverPhone = computed(() => String(props.request?.receiver_phone || requestPayload.value?.receiver_phone || props.busTransport?.receiver_phone || '').trim())
const receiverAddress = computed(() => String(props.request?.receiver_address || requestPayload.value?.receiver_address || props.busTransport?.receiver_address || '').trim())
const orderCode = computed(() => String(props.request?.order_code || props.busTransport?.order_code || props.sourceCode || '').trim())

const printRows = computed(() => props.items.filter(item => item && item.deleted !== true && item.active !== false).map(item => ({
  productName: item.product_name || '', productCode: item.product_code || '', logo: item.logo || item.target_logo || item.source_logo || '',
})))

function printDocument() {
  const transport = props.busTransport as any
  const html = buildParcelLabelPrintHtml({
    type: props.type, receiverName: receiverName.value, receiverPhone: receiverPhone.value, receiverAddress: receiverAddress.value,
    orderCode: orderCode.value, rows: printRows.value, carrierName: transport?.carrier_name || '', carrierPhone: transport?.carrier_phone || '',
    vehiclePlate: transport?.vehicle_plate || '', driverName: transport?.driver_name || '', departureAt: transport?.departure_at || '', note: transport?.note || '',
  })
  openPrintDocument(html, () => showToast('Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up cho trang này.', 'error'))
}
</script>

<template>
  <BaseModal :title="title" size="xl" :show-footer="false" @close="emit('close')">
    <div class="label-summary">
      <div><label>Mã yêu cầu/Phiếu</label><strong>{{ sourceCode }}</strong></div>
      <div><label>Loại phiếu</label><strong>{{ isBusCarrier ? 'Gửi nhà xe' : 'Gửi bưu điện' }}</strong></div>
      <div><label>Đơn hàng</label><strong>{{ orderCode || '-' }}</strong></div>
      <div><label>Sản phẩm</label><strong>{{ printRows.length }} dòng</strong></div>
    </div>
    <div class="receiver-box">
      <div><label>Người nhận</label><strong>{{ receiverName || '-' }}</strong></div>
      <div><label>Số điện thoại</label><strong>{{ receiverPhone || '-' }}</strong></div>
      <div class="full"><label>Địa chỉ nhận</label><strong>{{ receiverAddress || '-' }}</strong></div>
    </div>
    <div v-if="isBusCarrier" class="carrier-box">
      <strong>Thông tin nhà xe</strong><div>{{ busTransport?.carrier_name || 'Chưa nhập tên nhà xe' }}</div>
      <div class="small subtle">{{ [busTransport?.carrier_phone, busTransport?.vehicle_plate, busTransport?.driver_name].filter(Boolean).join(' · ') || 'Chưa có SĐT, biển số hoặc tên chủ xe/tài xế' }}</div>
    </div>
    <div class="table-wrap" style="margin-top:14px">
      <table style="min-width:720px"><thead><tr><th>STT</th><th>Tên hàng hóa</th><th>Số kiện</th><th>Logo</th></tr></thead>
        <tbody><tr v-for="(row,index) in printRows" :key="`${row.productCode}|${row.logo}|${index}`"><td>{{ index + 1 }}</td><td><b>{{ row.productName || '-' }}</b><div class="small subtle">{{ row.productCode || '' }}</div></td><td></td><td>{{ row.logo || '-' }}</td></tr><tr v-if="!printRows.length"><td colspan="4" class="empty">Yêu cầu chưa có sản phẩm để in.</td></tr></tbody>
      </table>
    </div>
    <div class="modal-actions"><button type="button" class="btn" @click="emit('close')">Đóng</button><button type="button" class="btn primary" :disabled="!printRows.length" @click="printDocument">In phiếu</button></div>
  </BaseModal>
</template>

<style scoped>
.label-summary, .receiver-box { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
.label-summary > div, .receiver-box > div, .carrier-box { padding: 11px 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
.receiver-box { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.receiver-box .full { grid-column: 1 / -1; }
.label-summary label, .label-summary strong, .receiver-box label, .receiver-box strong { display: block; }
.label-summary label, .receiver-box label { margin-bottom: 3px; color: #64748b; font-size: 12px; }
.carrier-box { margin-top: 14px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
@media (max-width: 800px) { .label-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .label-summary, .receiver-box { grid-template-columns: 1fr; } .receiver-box .full { grid-column: auto; } .modal-actions { flex-direction: column-reverse; } .modal-actions .btn { width: 100%; } }
</style>
