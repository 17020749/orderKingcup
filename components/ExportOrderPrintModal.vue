<script setup lang="ts">
import type { ExportOrderDoc, ExportOrderItemDoc } from '~/types/models'
import { buildDeliveryPrintHtml, openPrintDocument, type DeliveryPrintRow } from '~/utils/orderPrintDocuments'
import { toNumber } from '~/utils/format'

const props = defineProps<{
  exportOrder: ExportOrderDoc
  items: ExportOrderItemDoc[]
}>()

const emit = defineEmits<{ close: [] }>()
const { showToast } = useUi()

function codeOf(row: ExportOrderDoc) {
  return String(row.code || row.export_code || row.id || '').trim()
}

const printRows = computed<DeliveryPrintRow[]>(() => props.items.map(item => ({
  productCode: item.product_code || '',
  productName: item.product_name || '',
  logo: item.logo || '',
  unit: item.unit || '',
  quantity: toNumber(item.quantity),
  packingStandard: (item as any).packing_standard || '',
  boxQuantity: toNumber((item as any).box_quantity),
  oddQuantity: toNumber((item as any).odd_quantity),
})).filter(item => toNumber(item.quantity) > 0))

const destinationName = computed(() => String(
  props.exportOrder.destination_name
  || props.exportOrder.customer_name
  || (props.exportOrder as any).to_warehouse_name
  || '',
))

function warehouseName() {
  const firstItem = props.items[0] as any
  return String(
    firstItem?.from_warehouse_name
    || firstItem?.warehouse_name
    || (props.exportOrder as any).from_warehouse_name
    || (props.exportOrder as any).warehouse_name
    || '',
  )
}

function printDocument() {
  const row = props.exportOrder as any
  const html = buildDeliveryPrintHtml({
    order: {
      order_code: row.source_order_code || codeOf(props.exportOrder),
      customer_name: row.customer_name || row.destination_name || row.to_warehouse_name || '',
      phone: row.phone || row.customer_phone || row.receiver_phone || '',
      billing_address: row.billing_address || '',
      shipping_address: row.shipping_address || row.destination_address || row.receiver_address || '',
      sale_name: row.sale_name || row.created_by_name || '',
      sale_phone: row.sale_phone || '',
      order_date: row.export_date || row.created_at,
    },
    request: {
      request_id: codeOf(props.exportOrder),
      export_date: row.export_date || row.created_at,
      warehouse_note: row.note || '',
      payload_json: JSON.stringify({ note: row.note || '' }),
    },
    rows: printRows.value,
    warehouseName: warehouseName(),
    assetBase: window.location.origin,
  })
  openPrintDocument(html, () => showToast('Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up cho trang này.', 'error'))
}
</script>

<template>
  <BaseModal
    title="In phiếu xuất kho"
    size="lg"
    :show-footer="false"
    @close="emit('close')"
  >
    <div class="request-summary">
      <div><label>Mã phiếu xuất</label><strong>{{ codeOf(exportOrder) }}</strong></div>
      <div><label>Đơn hàng liên quan</label><strong>{{ exportOrder.source_order_code || '-' }}</strong></div>
      <div><label>Nơi nhận</label><strong>{{ destinationName || '-' }}</strong></div>
      <div><label>Số dòng in</label><strong>{{ printRows.length }}</strong></div>
    </div>

    <div class="print-card">
      <div class="print-icon">🖨</div>
      <div>
        <strong>Phiếu xuất kho và biên bản bàn giao</strong>
        <small>Dùng cùng mẫu in với trang Yêu cầu xuất kho.</small>
      </div>
      <button type="button" class="btn primary" @click="printDocument">In phiếu</button>
    </div>
  </BaseModal>
</template>

<style scoped>
.request-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}

.request-summary > div {
  padding: 11px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
}

.request-summary label,
.request-summary strong {
  display: block;
}

.request-summary label {
  margin-bottom: 3px;
  color: #64748b;
  font-size: 12px;
}

.print-card {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid #dbe4ff;
  border-radius: 14px;
}

.print-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: #eef2ff;
  font-size: 20px;
}

.print-card strong,
.print-card small {
  display: block;
}

.print-card small {
  margin-top: 4px;
  color: #64748b;
}

@media (max-width: 650px) {
  .request-summary { grid-template-columns: 1fr; }
  .print-card { grid-template-columns: 40px minmax(0, 1fr); }
  .print-card .btn { grid-column: 1 / -1; width: 100%; }
}
</style>
