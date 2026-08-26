<script setup lang="ts">
import type { OrderDoc, OrderItemDoc } from '~/types/models'
import {
  buildCommercialPrintHtml,
  buildDeliveryPrintHtml,
  openPrintDocument,
  type CommercialPrintKind,
  type DeliveryPrintRow,
} from '~/utils/orderPrintDocuments'
import { applyCommercialPrintAlignment } from '~/utils/commercialPrintAlignment'
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
const depositPercent = ref(50)
const paymentDepositAmount = ref(0)

type OrderPrintChoiceKey = CommercialPrintKind | 'delivery'

const printChoices: Array<{
  key: OrderPrintChoiceKey
  title: string
  description: string
}> = [
  { key: 'quotation', title: 'Phiếu báo giá', description: 'Mẫu báo giá mới nhất theo Google Sheet.' },
  { key: 'order', title: 'Phiếu đặt hàng', description: 'Có cấu hình phần trăm tiền cọc trước khi in.' },
  { key: 'payment', title: 'Phiếu thanh toán', description: 'Có cấu hình trực tiếp số tiền đặt cọc trước khi in.' },
  { key: 'delivery', title: 'Phiếu xuất hàng', description: 'Giống phiếu ở yêu cầu xuất kho; chỉ thay sản phẩm bằng toàn bộ sản phẩm của đơn.' },
]

watch(
  () => props.order?.customer_id,
  async customerId => {
    customer.value = null
    if (!customerId) return
    try {
      customer.value = await getOne('customers', String(customerId))
    } catch {
      // Đơn hàng vẫn có dữ liệu khách dự phòng nên không chặn việc in.
    }
  },
  { immediate: true },
)

watch(
  () => props.order?.id,
  () => {
    depositPercent.value = 50
    paymentDepositAmount.value = Math.max(0, toNumber((props.order as any)?.paid_amount))
  },
  { immediate: true },
)

const deliveryRows = computed<DeliveryPrintRow[]>(() => (props.items || []).flatMap((item: any) => {
  const logoLines = safeJsonParse(item.logo_json || item.logos_json || item.logos, [])
  if (Array.isArray(logoLines) && logoLines.length) {
    return logoLines.map((line: any) => ({
      productCode: item.product_code || '',
      productName: item.product_name || '',
      logo: line.logo || '',
      unit: item.unit || '',
      quantity: toNumber(line.quantity ?? line.qty),
      packingStandard: item.packing_standard || '',
    }))
  }

  return [{
    productCode: item.product_code || '',
    productName: item.product_name || '',
    logo: '',
    unit: item.unit || '',
    quantity: toNumber(item.quantity),
    packingStandard: item.packing_standard || '',
    boxQuantity: toNumber(item.box_quantity),
    oddQuantity: toNumber(item.odd_quantity),
  }]
}).filter((row: DeliveryPrintRow) => toNumber(row.quantity) > 0))

function requestTimeValue(request: any) {
  const value = request?.exported_at
    || request?.warehouse_handled_at
    || request?.updated_at
    || request?.requested_at
    || request?.created_at
  if (value && typeof value?.toMillis === 'function') return value.toMillis()
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}

const deliveryRequest = computed(() => {
  const activeRequest = [...(props.requests || [])]
    .filter(request => request?.deleted !== true && request?.active !== false)
    .sort((left, right) => requestTimeValue(right) - requestTimeValue(left))[0]
  if (activeRequest) return activeRequest

  return {
    request_id: props.order.order_code || props.order.id || '',
    order_id: props.order.id || '',
    order_code: props.order.order_code || '',
    requested_at: (props.order as any).order_date || (props.order as any).created_at || '',
    export_date: (props.order as any).order_date || (props.order as any).created_at || '',
    payload_json: JSON.stringify({
      note: (props.order as any).note || '',
      sale_name: (props.order as any).sale_name || '',
    }),
  }
})

const deliverySnapshot = computed(() => {
  const request = deliveryRequest.value || {}
  const payload = safeJsonParse(request.payload_json, {})
  return {
    customerId: request.customer_id || payload?.customer_id || props.order.customer_id || '',
    receiverName: request.receiver_name || payload?.receiver_name || props.order.customer_name || '',
    receiverPhone: request.receiver_phone || payload?.receiver_phone || props.order.phone || '',
    receiverAddress: request.receiver_address
      || payload?.receiver_address
      || (props.order as any).shipping_address
      || (props.order as any).billing_address
      || '',
    saleName: request.sale_name || payload?.sale_name || (props.order as any).sale_name || '',
  }
})

const deliveryOrder = computed(() => ({
  ...props.order,
  id: deliveryRequest.value?.order_id || props.order.id || '',
  order_code: deliveryRequest.value?.order_code || props.order.order_code || deliveryRequest.value?.request_id || '',
  order_date: deliveryRequest.value?.order_date
    || deliveryRequest.value?.requested_at
    || deliveryRequest.value?.created_at
    || (props.order as any).order_date
    || '',
  customer_id: deliverySnapshot.value.customerId,
  customer_name: deliverySnapshot.value.receiverName,
  phone: deliverySnapshot.value.receiverPhone,
  shipping_address: deliverySnapshot.value.receiverAddress,
  billing_address: deliverySnapshot.value.receiverAddress,
  sale_name: deliverySnapshot.value.saleName,
}))

const deliveryCustomer = computed(() => ({
  customer_name: deliverySnapshot.value.receiverName,
  phone: deliverySnapshot.value.receiverPhone,
  shipping_address: deliverySnapshot.value.receiverAddress,
  billing_address: deliverySnapshot.value.receiverAddress,
}))

function deliveryWarehouseName() {
  const request = deliveryRequest.value || {}
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
      || '',
  )
}

function printDocument(kind: OrderPrintChoiceKey) {
  if (kind === 'delivery') {
    if (!deliveryRows.value.length) {
      showToast('Đơn hàng chưa có sản phẩm để in phiếu xuất hàng.', 'error')
      return
    }
    const html = buildDeliveryPrintHtml({
      order: deliveryOrder.value,
      request: deliveryRequest.value,
      customer: deliveryCustomer.value,
      rows: deliveryRows.value,
      warehouseName: deliveryWarehouseName(),
      assetBase: window.location.origin,
    })
    openPrintDocument(html, () => showToast('Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up cho trang này.', 'error'))
    return
  }

  const html = buildCommercialPrintHtml({
    kind,
    order: props.order,
    items: props.items,
    customer: customer.value,
    depositPercent: depositPercent.value,
    paymentDepositAmount: paymentDepositAmount.value,
    assetBase: window.location.origin,
  })
  openPrintDocument(
    applyCommercialPrintAlignment(html),
    () => showToast('Trình duyệt đang chặn cửa sổ in. Hãy cho phép pop-up cho trang này.', 'error'),
  )
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
      <div v-for="choice in printChoices" :key="choice.key" class="print-choice">
        <div class="print-choice-icon">🖨</div>
        <div class="print-choice-content">
          <strong>{{ choice.title }}</strong>
          <small>{{ choice.description }}</small>

          <label v-if="choice.key === 'order'" class="print-config" @click.stop>
            <span>Phần trăm đặt cọc</span>
            <span class="input-with-suffix">
              <input v-model.number="depositPercent" class="input" type="number" min="0" max="100" step="1">
              <b>%</b>
            </span>
          </label>

          <label v-if="choice.key === 'payment'" class="print-config" @click.stop>
            <span>Số tiền đặt cọc</span>
            <span class="input-with-suffix money-input">
              <input v-model.number="paymentDepositAmount" class="input" type="number" min="0" step="1000">
              <b>đ</b>
            </span>
          </label>
        </div>
        <button type="button" class="btn primary print-button" @click="printDocument(choice.key)">In phiếu</button>
      </div>
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
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid #dbe4ff;
  border-radius: 14px;
  background: #fff;
}

.print-choice-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: #eef2ff;
  font-size: 20px;
}

.print-choice-content {
  min-width: 0;
}

.print-choice-content strong,
.print-choice-content small {
  display: block;
}

.print-choice-content small {
  margin-top: 3px;
  color: #64748b;
}

.print-config {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin-top: 10px;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
}

.input-with-suffix {
  display: grid;
  grid-template-columns: 100px 26px;
  align-items: center;
  overflow: hidden;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #fff;
}

.input-with-suffix.money-input {
  grid-template-columns: minmax(140px, 190px) 28px;
}

.input-with-suffix .input {
  min-width: 0;
  border: 0;
  border-radius: 0;
}

.input-with-suffix b {
  text-align: center;
  color: #475569;
}

.print-button {
  white-space: nowrap;
}

@media (max-width: 700px) {
  .print-choice {
    grid-template-columns: 40px minmax(0, 1fr);
  }

  .print-button {
    grid-column: 1 / -1;
    width: 100%;
  }
}
</style>