<script setup lang="ts">
import type { BusTransportDoc } from '~/types/models'
import { openPrintDocument } from '~/utils/orderPrintDocuments'
import { buildParcelLabelPrintHtml, type ParcelLabelType } from '~/utils/parcelLabelPrintDocuments'
import { safeJsonParse } from '~/utils/format'

const DEFAULT_PRODUCT_NAME = 'Đồ dùng một lần cho quán cà phê, trà sữa'
const DEFAULT_SENDER_CODE = 'T019564009'
const DEFAULT_SENDER_NAME = 'CÔNG TY TNHH KINGCUP VIỆT NAM'
const DEFAULT_SENDER_PHONE = '039 5571728'

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
const requestPayload = safeJsonParse(props.request?.payload_json, {})
const transport = props.busTransport as any

const form = reactive({
  senderCode: DEFAULT_SENDER_CODE,
  senderName: DEFAULT_SENDER_NAME,
  senderPhone: DEFAULT_SENDER_PHONE,
  receiverName: String(props.request?.receiver_name || requestPayload?.receiver_name || transport?.receiver_name || props.request?.customer_name || '').trim(),
  receiverPhone: String(props.request?.receiver_phone || requestPayload?.receiver_phone || transport?.receiver_phone || '').trim(),
  receiverAddress: String(props.request?.receiver_address || requestPayload?.receiver_address || transport?.receiver_address || '').trim(),
  orderCode: String(props.request?.order_code || transport?.order_code || props.sourceCode || '').trim(),
  productName: DEFAULT_PRODUCT_NAME,
  packageCount: '',
  logo: '',
  carrierName: String(transport?.carrier_name || '').trim(),
  carrierPhone: String(transport?.carrier_phone || '').trim(),
  carrierAddress: String(transport?.carrier_address || '').trim(),
  selectedProvinceName: String(transport?.selected_province_name || '').trim(),
  driverName: String(transport?.driver_name || '').trim(),
  departureAt: String(transport?.departure_at || '').trim(),
  note: String(transport?.note || '').trim(),
})

const printRows = computed(() => ([{
  productName: form.productName.trim(),
  productCode: '',
  packageCount: form.packageCount.trim(),
  logo: form.logo.trim(),
}]))

const canPrint = computed(() => Boolean(form.productName.trim()))

function printDocument() {
  if (!canPrint.value) {
    showToast('Vui lòng nhập tên hàng hóa trước khi in.', 'error')
    return
  }

  const html = buildParcelLabelPrintHtml({
    type: props.type,
    senderCode: form.senderCode,
    senderName: form.senderName,
    senderPhone: form.senderPhone,
    receiverName: form.receiverName,
    receiverPhone: form.receiverPhone,
    receiverAddress: form.receiverAddress,
    orderCode: form.orderCode,
    rows: printRows.value,
    carrierName: form.carrierName,
    carrierPhone: form.carrierPhone,
    carrierAddress: form.carrierAddress,
    selectedProvinceName: form.selectedProvinceName,
    driverName: form.driverName,
    departureAt: form.departureAt,
    note: form.note,
  })
  openPrintDocument(html, () => showToast('Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up cho trang này.', 'error'))
}
</script>

<template>
  <BaseModal :title="title" size="xl" :show-footer="false" @close="emit('close')">
    <div class="label-summary">
      <div><label>Mã yêu cầu/Phiếu</label><strong>{{ sourceCode }}</strong></div>
      <div><label>Loại phiếu</label><strong>{{ isBusCarrier ? 'Gửi nhà xe' : 'Gửi bưu điện' }}</strong></div>
      <div><label>Dòng hàng hóa</label><strong>1 dòng cố định</strong></div>
    </div>

    <div class="edit-hint">Có thể chỉnh sửa các nội dung dưới đây trước khi bấm <strong>In phiếu</strong>.</div>

    <section class="edit-section">
      <h3>Thông tin người gửi</h3>
      <div class="form-grid three-columns">
        <label class="field"><span>Mã người gửi</span><input v-model="form.senderCode" type="text"></label>
        <label class="field"><span>Tên người gửi</span><input v-model="form.senderName" type="text"></label>
        <label class="field"><span>Số điện thoại</span><input v-model="form.senderPhone" type="text"></label>
      </div>
    </section>

    <section class="edit-section">
      <h3>Thông tin người nhận</h3>
      <div class="form-grid two-columns">
        <label class="field"><span>Người nhận</span><input v-model="form.receiverName" type="text"></label>
        <label class="field"><span>Số điện thoại</span><input v-model="form.receiverPhone" type="text"></label>
        <label class="field full"><span>Địa chỉ nhận</span><textarea v-model="form.receiverAddress" rows="2"></textarea></label>
        <label class="field full"><span>Mã đơn hàng</span><input v-model="form.orderCode" type="text"></label>
      </div>
    </section>

    <section v-if="isBusCarrier" class="edit-section">
      <h3>Thông tin nhà xe</h3>
      <div class="form-grid three-columns">
        <label class="field"><span>Tên nhà xe</span><input v-model="form.carrierName" type="text"></label>
        <label class="field"><span>SĐT nhà xe</span><input v-model="form.carrierPhone" type="text"></label>
        <label class="field"><span>Chủ xe/Tài xế</span><input v-model="form.driverName" type="text"></label>
        <label class="field"><span>Tỉnh vận chuyển</span><input v-model="form.selectedProvinceName" type="text"></label>
        <label class="field"><span>Giờ xuất phát</span><input v-model="form.departureAt" type="text"></label>
        <label class="field"><span>Địa chỉ nhà xe</span><input v-model="form.carrierAddress" type="text"></label>
      </div>
    </section>

    <section class="edit-section">
      <h3>Nội dung hàng hóa trên tem</h3>
      <div class="table-wrap">
        <table class="editable-table">
          <thead><tr><th>STT</th><th>Tên hàng hóa</th><th>Số kiện</th><th>Logo</th></tr></thead>
          <tbody>
            <tr>
              <td class="center">1</td>
              <td><textarea v-model="form.productName" rows="2" aria-label="Tên hàng hóa"></textarea></td>
              <td><input v-model="form.packageCount" type="text" aria-label="Số kiện" placeholder="Để trống"></td>
              <td><input v-model="form.logo" type="text" aria-label="Logo" placeholder="Để trống"></td>
            </tr>
          </tbody>
        </table>
      </div>
      <label class="field note-field"><span>Ghi chú trên tem</span><textarea v-model="form.note" rows="2" placeholder="Không bắt buộc"></textarea></label>
    </section>

    <div class="modal-actions">
      <button type="button" class="btn" @click="emit('close')">Đóng</button>
      <button type="button" class="btn primary" :disabled="!canPrint" @click="printDocument">In phiếu</button>
    </div>
  </BaseModal>
</template>

<style scoped>
.label-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
.label-summary > div { padding: 11px 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
.label-summary label, .label-summary strong { display: block; }
.label-summary label { margin-bottom: 3px; color: #64748b; font-size: 12px; }
.edit-hint { margin-bottom: 14px; padding: 10px 12px; border: 1px solid #bfdbfe; border-radius: 10px; background: #eff6ff; color: #1e3a8a; }
.edit-section { margin-top: 14px; padding: 14px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; }
.edit-section h3 { margin: 0 0 12px; font-size: 15px; color: #1e293b; }
.form-grid { display: grid; gap: 10px; }
.form-grid.two-columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.form-grid.three-columns { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.field { display: block; }
.field.full { grid-column: 1 / -1; }
.field span { display: block; margin-bottom: 5px; color: #475569; font-size: 12px; font-weight: 600; }
.field input, .field textarea, .editable-table input, .editable-table textarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #0f172a; font: inherit; outline: none; }
.field input, .editable-table input { min-height: 38px; padding: 8px 10px; }
.field textarea, .editable-table textarea { padding: 8px 10px; resize: vertical; }
.field input:focus, .field textarea:focus, .editable-table input:focus, .editable-table textarea:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, .12); }
.editable-table { min-width: 720px; }
.editable-table th { white-space: nowrap; }
.editable-table th:first-child { width: 64px; }
.editable-table th:nth-child(3) { width: 160px; }
.editable-table th:nth-child(4) { width: 190px; }
.editable-table td { vertical-align: middle; }
.editable-table .center { text-align: center; }
.note-field { margin-top: 12px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
@media (max-width: 800px) {
  .label-summary, .form-grid.three-columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 560px) {
  .label-summary, .form-grid.two-columns, .form-grid.three-columns { grid-template-columns: 1fr; }
  .field.full { grid-column: auto; }
  .modal-actions { flex-direction: column-reverse; }
  .modal-actions .btn { width: 100%; }
}
</style>
