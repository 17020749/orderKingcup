<script setup lang="ts">
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import type { BusTransportDoc, CustomerDoc, OrderDoc, OrderItemDoc } from '~/types/models'
import { normalizeText, toNumber } from '~/utils/format'
// @ts-ignore Shared lifecycle helper is executed directly by Node tests.
import { activeExportOrderId } from '~/utils/exportLifecycle.mjs'

const props = defineProps<{
  request: Record<string, any>
  order?: OrderDoc | null
  orderItems?: OrderItemDoc[]
}>()

const { db } = useFirebaseServices()
const { hasPermission } = useAuth()
const { showToast } = useUi()
const { requestLineProgress } = useWarehouseLogic()

const menuOpen = ref(false)
const loadingType = ref<'request' | 'post_office' | 'bus_carrier' | ''>('')
const showRequestPrint = ref(false)
const selectedBusTransport = ref<BusTransportDoc | null>(null)
const selectedCustomer = ref<CustomerDoc | null>(null)
const selectedLabelType = ref<'post_office' | 'bus_carrier' | null>(null)

const statusKey = computed(() => normalizeText(props.request?.status).replace(/\s+/g, '_'))
const isRejected = computed(() => ['tu_choi', 'rejected'].includes(statusKey.value))
const canPrintExport = computed(() => hasPermission('*') || (
  hasPermission('export.view') && hasPermission('export.print')
))
const canReadBusTransport = computed(() => hasPermission('*') || hasPermission('bus_transport.view'))
const canOpenMenu = computed(() => (
  canPrintExport.value
  && props.request?.deleted !== true
  && props.request?.active !== false
  && !isRejected.value
))

const labelItems = computed(() => requestLineProgress(props.request)
  .map((line: any) => ({
    id: line.order_item_id || `${line.product_code || ''}|${line.logo || ''}`,
    product_id: line.product_id || '',
    product_code: line.product_code || '',
    product_name: line.product_name || '',
    logo: line.logo || '',
    unit: line.unit || '',
    quantity: toNumber(line.exported_qty) > 0 ? toNumber(line.exported_qty) : toNumber(line.requested_qty),
    active: true,
    deleted: false,
  }))
  .filter(item => item.quantity > 0))

async function loadCustomer() {
  selectedCustomer.value = null
  const customerId = String(props.order?.customer_id || '').trim()
  if (!customerId) throw new Error('Đơn hàng chưa liên kết với hồ sơ khách hàng.')
  const snapshot = await getDoc(doc(db, 'customers', customerId))
  if (!snapshot.exists()) throw new Error('Không tìm thấy hồ sơ khách hàng liên kết với đơn hàng.')
  selectedCustomer.value = { id: snapshot.id, ...(snapshot.data() || {}) } as CustomerDoc
}

async function findTransportByRequest() {
  if (!canReadBusTransport.value) throw new Error('Bạn chưa có quyền xem vận chuyển nhà xe.')
  const requestIds = Array.from(new Set([
    String(props.request?.id || '').trim(),
    String(props.request?.request_id || '').trim(),
  ].filter(Boolean)))
  let snapshots
  if (requestIds.length > 1) {
    snapshots = await getDocs(query(collection(db, 'bus_transport_orders'), where('source_request_id', 'in', requestIds)))
  } else if (requestIds.length === 1) {
    snapshots = await getDocs(query(collection(db, 'bus_transport_orders'), where('source_request_id', '==', requestIds[0])))
  }

  let row = snapshots?.docs
    .map(item => ({ id: item.id, ...(item.data() || {}) } as BusTransportDoc))
    .find(item => item.deleted !== true && item.active !== false)

  if (!row) {
    const legacyExportOrderId = String(activeExportOrderId(props.request) || '').trim()
    if (legacyExportOrderId) {
      const legacy = await getDocs(query(
        collection(db, 'bus_transport_orders'),
        where('export_order_id', '==', legacyExportOrderId),
      ))
      row = legacy.docs
        .map(item => ({ id: item.id, ...(item.data() || {}) } as BusTransportDoc))
        .find(item => item.deleted !== true && item.active !== false)
    }
  }

  if (!row) throw new Error('Yêu cầu này chưa có đơn vận chuyển nhà xe.')
  selectedBusTransport.value = row
}

async function openPrint(type: 'request' | 'post_office' | 'bus_carrier') {
  if (!canOpenMenu.value || loadingType.value) return
  menuOpen.value = false
  selectedBusTransport.value = null
  selectedCustomer.value = null
  selectedLabelType.value = null

  if (!props.order) {
    showToast('Không tìm thấy đơn hàng liên kết với yêu cầu xuất kho.', 'error')
    return
  }

  if (type === 'request') {
    showRequestPrint.value = true
    return
  }

  loadingType.value = type
  try {
    if (!labelItems.value.length) throw new Error('Yêu cầu chưa có sản phẩm để in.')
    await loadCustomer()
    if (type === 'bus_carrier') await findTransportByRequest()
    selectedLabelType.value = type
  } catch (error: any) {
    selectedBusTransport.value = null
    selectedCustomer.value = null
    showToast(String(error?.message || error || 'Không tải được dữ liệu để in.'), 'error')
  } finally {
    loadingType.value = ''
  }
}

function closeLabelPrint() {
  selectedLabelType.value = null
  selectedBusTransport.value = null
  selectedCustomer.value = null
}
</script>

<template>
  <div v-if="canOpenMenu" class="warehouse-print-menu">
    <button
      type="button"
      class="btn-sm btn-view print-trigger"
      :disabled="Boolean(loadingType)"
      @click="menuOpen = !menuOpen"
    >
      {{ loadingType ? 'Đang tải...' : 'In ▾' }}
    </button>
    <div v-if="menuOpen" class="print-options">
      <button type="button" @click="openPrint('request')">Phiếu xuất kho</button>
      <button type="button" @click="openPrint('post_office')">Tem gửi bưu điện</button>
      <button
        type="button"
        :disabled="!canReadBusTransport"
        :title="canReadBusTransport ? 'In tem từ đơn vận chuyển nhà xe' : 'Thiếu quyền bus_transport.view'"
        @click="openPrint('bus_carrier')"
      >
        Tem gửi nhà xe
      </button>
    </div>
  </div>

  <ExportRequestPrintModal
    v-if="showRequestPrint && order"
    :request="request"
    :order="order"
    :items="orderItems || []"
    @close="showRequestPrint = false"
  />

  <ParcelLabelPrintModal
    v-if="selectedLabelType && order"
    :type="selectedLabelType"
    :source-code="request.request_id || request.id"
    :items="labelItems"
    :bus-transport="selectedBusTransport"
    :request="request"
    :order="order"
    :customer="selectedCustomer"
    @close="closeLabelPrint"
  />
</template>

<style scoped>
.warehouse-print-menu { position: relative; display: inline-flex; }
.print-trigger { white-space: nowrap; }
.print-options {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  right: 0;
  min-width: 190px;
  padding: 6px;
  border: 1px solid #dbe4ff;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16);
}
.print-options button {
  display: block;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.print-options button:hover:not(:disabled) { background: #eef2ff; }
.print-options button:disabled { color: #94a3b8; cursor: not-allowed; }
</style>
