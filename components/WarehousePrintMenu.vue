<script setup lang="ts">
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import type { BusTransportDoc, ExportOrderDoc, ExportOrderItemDoc, OrderDoc } from '~/types/models'
// @ts-ignore Shared lifecycle helper is executed directly by Node tests.
import { activeExportOrderId } from '~/utils/exportLifecycle.mjs'

const props = defineProps<{
  request: Record<string, any>
  order?: OrderDoc | null
}>()

const { db } = useFirebaseServices()
const { hasPermission } = useAuth()
const { showToast } = useUi()

const menuOpen = ref(false)
const loadingType = ref<'export' | 'post_office' | 'bus_carrier' | ''>('')
const selectedExportOrder = ref<ExportOrderDoc | null>(null)
const selectedItems = ref<ExportOrderItemDoc[]>([])
const selectedBusTransport = ref<BusTransportDoc | null>(null)
const selectedLabelType = ref<'post_office' | 'bus_carrier' | null>(null)

const exportOrderId = computed(() => String(activeExportOrderId(props.request) || '').trim())
const canPrintExport = computed(() => hasPermission('*') || (
  hasPermission('export.view') && hasPermission('export.print')
))
const canReadBusTransport = computed(() => hasPermission('*') || hasPermission('bus_transport.view'))
const canOpenMenu = computed(() => (
  canPrintExport.value
  && String(props.request?.status || '') === 'da_xuat'
  && Boolean(exportOrderId.value)
))

function exportOrderFromSnapshot(snapshot: any) {
  return { id: snapshot.id, ...(snapshot.data() || {}) } as ExportOrderDoc
}

function exportItemFromSnapshot(snapshot: any) {
  return { id: snapshot.id, ...(snapshot.data() || {}) } as ExportOrderItemDoc
}

async function loadExportBundle() {
  const id = exportOrderId.value
  if (!id) throw new Error('Yêu cầu chưa liên kết với phiếu xuất kho đang hoạt động.')

  const [orderSnapshot, itemSnapshots] = await Promise.all([
    getDoc(doc(db, 'export_orders', id)),
    getDocs(query(collection(db, 'export_order_items'), where('export_order_id', '==', id))),
  ])
  if (!orderSnapshot.exists()) throw new Error('Không tìm thấy phiếu xuất kho liên kết.')

  const exportOrder = exportOrderFromSnapshot(orderSnapshot)
  if (exportOrder.deleted === true || exportOrder.active === false || exportOrder.lifecycle_status === 'cancelled') {
    throw new Error('Phiếu xuất kho liên kết đã bị hủy hoặc không còn hoạt động.')
  }

  const items = itemSnapshots.docs
    .map(exportItemFromSnapshot)
    .filter(item => item.deleted !== true && item.active !== false)
  if (!items.length) throw new Error('Phiếu xuất kho chưa có sản phẩm để in.')

  selectedExportOrder.value = exportOrder
  selectedItems.value = items
}

async function loadBusTransport() {
  if (!canReadBusTransport.value) throw new Error('Bạn chưa có quyền xem vận chuyển nhà xe.')
  const id = exportOrderId.value
  const snapshot = await getDocs(query(
    collection(db, 'bus_transport_orders'),
    where('export_order_id', '==', id),
  ))
  const row = snapshot.docs
    .map(item => ({ id: item.id, ...(item.data() || {}) } as BusTransportDoc))
    .find(item => item.deleted !== true && item.active !== false)
  if (!row) throw new Error('Phiếu xuất kho này chưa có đơn vận chuyển nhà xe.')
  selectedBusTransport.value = row
}

async function openPrint(type: 'export' | 'post_office' | 'bus_carrier') {
  if (!canOpenMenu.value || loadingType.value) return
  menuOpen.value = false
  loadingType.value = type
  selectedBusTransport.value = null
  selectedLabelType.value = null
  try {
    await loadExportBundle()
    if (type === 'bus_carrier') await loadBusTransport()
    if (type === 'post_office' || type === 'bus_carrier') selectedLabelType.value = type
  } catch (error: any) {
    selectedExportOrder.value = null
    selectedItems.value = []
    selectedBusTransport.value = null
    showToast(String(error?.message || error || 'Không tải được dữ liệu để in.'), 'error')
  } finally {
    loadingType.value = ''
  }
}

function closeExportPrint() {
  selectedExportOrder.value = null
  selectedItems.value = []
}

function closeLabelPrint() {
  selectedLabelType.value = null
  selectedExportOrder.value = null
  selectedItems.value = []
  selectedBusTransport.value = null
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
      <button type="button" @click="openPrint('export')">Phiếu xuất kho</button>
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

  <ExportOrderPrintModal
    v-if="selectedExportOrder && !selectedLabelType"
    :export-order="selectedExportOrder"
    :items="selectedItems"
    @close="closeExportPrint"
  />

  <ParcelLabelPrintModal
    v-if="selectedExportOrder && selectedLabelType"
    :type="selectedLabelType"
    :export-order="selectedExportOrder"
    :items="selectedItems"
    :bus-transport="selectedBusTransport"
    :request="request"
    :order="order || null"
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
