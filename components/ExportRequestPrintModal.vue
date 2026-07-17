<script setup lang="ts">
import type { OrderDoc, OrderItemDoc } from '~/types/models'
import { buildDeliveryPrintHtml, openPrintDocument, type DeliveryPrintRow } from '~/utils/orderPrintDocuments'
import { safeJsonParse, toNumber } from '~/utils/format'

const props = defineProps<{
  request: any
  order: OrderDoc
  items: OrderItemDoc[]
}>()

const emit = defineEmits<{ close: [] }>()
const { getOne } = useRepo()
const { requestLineProgress } = useWarehouseLogic()
const { showToast } = useUi()
const customer = ref<any>(null)

watch(
  () => props.order?.customer_id,
  async customerId => {
    customer.value = null
    if (!customerId) return
    try {
      customer.value = await getOne('customers', String(customerId))
    } catch {
      // Dùng dữ liệu khách hàng dự phòng trong đơn nếu không đọc được collection customers.
    }
  },
  { immediate: true },
)

function normalized(value: any) {
  return String(value || '').trim().toUpperCase()
}

function itemPacking(line: any) {
  const exact = props.items.find((item: any) => {
    if (normalized(item.product_code) !== normalized(line.product_code)) return false
    const logos = safeJsonParse(item.logo_json, [])
    if (!line.logo) return !Array.isArray(logos) || !logos.length
    return Array.isArray(logos) && logos.some((logo: any) => normalized(logo.logo) === normalized(line.logo))
  }) || props.items.find((item: any) => normalized(item.product_code) === normalized(line.product_code))

  return {
    packingStandard: (exact as any)?.packing_standard || '',
    boxQuantity: toNumber((exact as any)?.box_quantity),
    oddQuantity: toNumber((exact as any)?.odd_quantity),
  }
}

const printRows = computed<DeliveryPrintRow[]>(() => requestLineProgress(props.request).map((line: any) => {
  const requested = toNumber(line.requested_qty)
  const exported = toNumber(line.exported_qty)
  const quantity = exported > 0 ? exported : requested
  return {
    productCode: line.product_code || '',
    productName: line.product_name || '',
    logo: line.logo || '',
    unit: line.unit || '',
    quantity,
    ...itemPacking(line),
  }
}).filter((line: DeliveryPrintRow) => toNumber(line.quantity) > 0))

function warehouseName() {
  const request = props.request || {}
  const payload = safeJsonParse(request.payload_json, {})
  const firstItem = Array.isArray(payload?.items) ? payload.items[0] : null
  return String(
    request.warehouse_name
    || request.export_warehouse_name
    || request.from_warehouse_name
    || payload?.warehouse_name
    || payload?.warehouse?.name
    || firstItem?.warehouse_name
    || firstItem?.from_warehouse_name
    || (props.order as any).warehouse_name
    || (props.order as any).export_warehouse_name
    || '',
  )
}

function printDocument() {
  const html = buildDeliveryPrintHtml({
    order: props.order,
    request: props.request,
    customer: customer.value,
    rows: printRows.value,
    warehouseName: warehouseName(),
    assetBase: window.location.origin,
  })
  openPrintDocument(html, () => showToast('Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up cho trang này.', 'error'))
}
</script>

<template>
  <BaseModal
    title="In phiếu xuất hàng"
    size="lg"
    :show-footer="false"
    @close="emit('close')"
  >
    <div class="request-summary">
      <div><label>Mã yêu cầu</label><strong>{{ request.request_id || request.id }}</strong></div>
      <div><label>Đơn hàng</label><strong>{{ order.order_code }}</strong></div>
      <div><label>Khách hàng</label><strong>{{ order.customer_name }}</strong></div>
      <div><label>Số dòng in</label><strong>{{ printRows.length }}</strong></div>
    </div>

    <div class="print-card">
      <div class="print-icon">🖨</div>
      <div>
        <strong>Phiếu xuất kho và biên bản bàn giao</strong>
        <small>Mẫu mới nhất theo tab “PHIẾU XUẤT KHO” trong Google Sheet.</small>
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
