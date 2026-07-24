<script setup lang="ts">
import { buildDeliveryPrintHtml, openPrintDocument, type DeliveryPrintRow } from '~/utils/orderPrintDocuments'
import { safeJsonParse, toNumber } from '~/utils/format'

const props = defineProps<{ request: any }>()
const emit = defineEmits<{ close: [] }>()
const { requestLineProgress } = useWarehouseLogic()
const { showToast } = useUi()

const snapshot = computed(() => {
  const payload = safeJsonParse(props.request?.payload_json, {})
  return {
    customerId: props.request?.customer_id || payload?.customer_id || '',
    receiverName: props.request?.receiver_name || payload?.receiver_name || props.request?.customer_name || payload?.customer_name || '',
    receiverPhone: props.request?.receiver_phone || payload?.receiver_phone || '',
    receiverAddress: props.request?.receiver_address || payload?.receiver_address || '',
  }
})

const printOrder = computed(() => ({
  id: props.request?.order_id || '',
  order_code: props.request?.order_code || props.request?.request_id || props.request?.id || '',
  order_date: props.request?.order_date || props.request?.requested_at || props.request?.created_at || '',
  customer_id: snapshot.value.customerId,
  customer_name: snapshot.value.receiverName,
  phone: snapshot.value.receiverPhone,
  shipping_address: snapshot.value.receiverAddress,
  billing_address: snapshot.value.receiverAddress,
  sale_name: props.request?.sale_name || safeJsonParse(props.request?.payload_json, {})?.sale_name || '',
}))

const printRows = computed<DeliveryPrintRow[]>(() => requestLineProgress(props.request).map((line: any) => {
  const requested = toNumber(line.requested_qty)
  const exported = toNumber(line.exported_qty)
  return {
    productCode: line.product_code || '',
    productName: line.product_name || '',
    logo: line.logo || '',
    unit: line.unit || '',
    quantity: exported > 0 ? exported : requested,
    packingStandard: line.packing_standard || '',
    boxQuantity: toNumber(line.box_quantity),
    oddQuantity: toNumber(line.odd_quantity),
  }
}).filter((line: DeliveryPrintRow) => toNumber(line.quantity) > 0))

function warehouseName() {
  const request = props.request || {}
  const payload = safeJsonParse(request.payload_json, {})
  const firstItem = Array.isArray(payload?.items) ? payload.items[0] : null
  return String(request.warehouse_name || request.export_warehouse_name || request.from_warehouse_name || payload?.warehouse_name || payload?.warehouse?.name || firstItem?.warehouse_name || firstItem?.from_warehouse_name || '')
}

function printDocument() {
  const html = buildDeliveryPrintHtml({
    order: printOrder.value,
    request: props.request,
    customer: {
      customer_name: snapshot.value.receiverName,
      phone: snapshot.value.receiverPhone,
      shipping_address: snapshot.value.receiverAddress,
      billing_address: snapshot.value.receiverAddress,
    },
    rows: printRows.value,
    warehouseName: warehouseName(),
    assetBase: window.location.origin,
  })
  openPrintDocument(html, () => showToast('Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up cho trang này.', 'error'))
}
</script>

<template>
  <BaseModal title="In phiếu xuất hàng" size="lg" :show-footer="false" @close="emit('close')">
    <div class="request-summary">
      <div><label>Mã yêu cầu</label><strong>{{ request.request_id || request.id }}</strong></div>
      <div><label>Đơn hàng</label><strong>{{ printOrder.order_code || '-' }}</strong></div>
      <div><label>Khách hàng</label><strong>{{ snapshot.receiverName || '-' }}</strong></div>
      <div><label>Số dòng in</label><strong>{{ printRows.length }}</strong></div>
    </div>
    <div class="print-card">
      <div class="print-icon">🖨</div>
      <div><strong>Phiếu xuất kho và biên bản bàn giao</strong><small>Dữ liệu lấy từ snapshot yêu cầu xuất kho, không đọc lại đơn hàng.</small></div>
      <button type="button" class="btn primary" @click="printDocument">In phiếu</button>
    </div>
  </BaseModal>
</template>

<style scoped>
.request-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
.request-summary > div { padding: 11px 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; }
.request-summary label, .request-summary strong { display: block; }
.request-summary label { margin-bottom: 3px; color: #64748b; font-size: 12px; }
.print-card { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 14px; border: 1px solid #dbe4ff; border-radius: 14px; }
.print-icon { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; background: #eef2ff; font-size: 20px; }
.print-card strong, .print-card small { display: block; }
.print-card small { margin-top: 4px; color: #64748b; }
@media (max-width: 650px) { .request-summary { grid-template-columns: 1fr; } .print-card { grid-template-columns: 40px minmax(0, 1fr); } .print-card .btn { grid-column: 1 / -1; width: 100%; } }
</style>
