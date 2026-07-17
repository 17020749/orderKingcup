<script setup lang="ts">
import type {
  ExportOrderDoc,
  ExportOrderItemDoc,
  OrderDoc,
  OrderItemDoc,
} from '~/types/models'

const route = useRoute()
const { hasPermission } = useAuth()
const { showToast } = useUi()
const {
  loadScopedOrders,
  loadScopedOrderItems,
  loadScopedExportRequests,
  loadExportOrders,
  loadExportOrderItems,
} = useScopedQueries()

const selectedRequest = ref<any>(null)
const selectedOrder = ref<OrderDoc | null>(null)
const selectedItems = ref<OrderItemDoc[]>([])
const selectedExportOrder = ref<ExportOrderDoc | null>(null)
const selectedExportItems = ref<ExportOrderItemDoc[]>([])

let observer: MutationObserver | null = null
let installTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setInterval> | null = null

const isRequestPage = computed(() => route.path === '/export-requests')
const isExportPage = computed(() => route.path === '/exports')
const canPrintRequest = computed(() => hasPermission('*') || hasPermission('orders.print'))
const canPrintExport = computed(() => hasPermission('*') || hasPermission('export.print'))

function rowCode(row: HTMLTableRowElement | null) {
  return String(row?.querySelector('td:first-child b')?.textContent || '').trim()
}

function exportOrderCode(row: ExportOrderDoc) {
  return String(row.code || row.export_code || row.id || '').trim()
}

async function openRequestPrint(code: string, button: HTMLButtonElement) {
  if (!canPrintRequest.value) {
    showToast('Bạn không có quyền in chứng từ đơn hàng.', 'error')
    return
  }

  const oldText = button.textContent
  button.disabled = true
  button.textContent = 'Đang tải...'

  try {
    const orders = await loadScopedOrders(true)
    const [requests, items] = await Promise.all([
      loadScopedExportRequests(orders, true),
      loadScopedOrderItems(orders, true),
    ])
    const request = requests.find((item: any) => String(item.request_id || item.id).trim() === code)
    if (!request) {
      showToast(`Không tìm thấy yêu cầu xuất kho ${code} hoặc bạn không có quyền xem phiếu này.`, 'error')
      return
    }
    const order = orders.find(item => item.id === request.order_id)
    if (!order) {
      showToast(`Không tìm thấy đơn hàng của yêu cầu ${code}.`, 'error')
      return
    }

    selectedRequest.value = request
    selectedOrder.value = order
    selectedItems.value = items.filter(item => item.order_id === order.id)
  } catch (error: any) {
    showToast(error?.message || 'Không tải được dữ liệu để in phiếu xuất hàng.', 'error')
  } finally {
    button.disabled = false
    button.textContent = oldText || 'In'
  }
}

async function openExportPrint(code: string, button: HTMLButtonElement) {
  if (!canPrintExport.value) {
    showToast('Bạn không có quyền in phiếu xuất kho thật.', 'error')
    return
  }

  const oldText = button.textContent
  button.disabled = true
  button.textContent = 'Đang tải...'

  try {
    const [orders, items] = await Promise.all([
      loadExportOrders(true),
      loadExportOrderItems(true),
    ])
    const exportOrder = orders.find(item => exportOrderCode(item) === code)
    if (!exportOrder) {
      showToast(`Không tìm thấy phiếu xuất kho ${code} hoặc bạn không có quyền xem phiếu này.`, 'error')
      return
    }

    selectedExportOrder.value = exportOrder
    selectedExportItems.value = items.filter(item => item.export_order_id === exportOrder.id)
  } catch (error: any) {
    showToast(error?.message || 'Không tải được dữ liệu để in phiếu xuất kho.', 'error')
  } finally {
    button.disabled = false
    button.textContent = oldText || 'In'
  }
}

function currentTriggerClass() {
  return isRequestPage.value
    ? 'export-request-print-trigger'
    : 'warehouse-export-print-trigger'
}

function currentCanPrint() {
  return isRequestPage.value ? canPrintRequest.value : canPrintExport.value
}

function installPrintButtons() {
  if (!isRequestPage.value && !isExportPage.value) return

  const triggerClass = currentTriggerClass()
  if (!currentCanPrint()) {
    document.querySelectorAll(`.${triggerClass}`).forEach(button => button.remove())
    return
  }

  document.querySelectorAll<HTMLElement>('.main .card .action-buttons').forEach(container => {
    if (container.querySelector(`.${triggerClass}`)) return

    const row = container.closest('tr') as HTMLTableRowElement | null
    const code = rowCode(row)
    if (!code) return

    const button = document.createElement('button')
    button.type = 'button'
    button.className = `btn-sm ${triggerClass}`
    button.textContent = 'In'
    button.title = isRequestPage.value
      ? `In phiếu xuất hàng ${code}`
      : `In phiếu xuất kho ${code}`
    button.addEventListener('click', () => {
      if (isRequestPage.value) void openRequestPrint(code, button)
      else void openExportPrint(code, button)
    })
    container.insertBefore(button, container.children[1] || null)
  })
}

function scheduleInstall() {
  if (installTimer) clearTimeout(installTimer)
  installTimer = setTimeout(() => {
    installTimer = null
    installPrintButtons()
  }, 30)
}

function stopObserver() {
  observer?.disconnect()
  observer = null
  if (installTimer) clearTimeout(installTimer)
  installTimer = null
  if (retryTimer) clearInterval(retryTimer)
  retryTimer = null
}

function startObserver() {
  stopObserver()
  if (import.meta.server || (!isRequestPage.value && !isExportPage.value)) return

  observer = new MutationObserver(scheduleInstall)
  observer.observe(document.body, { childList: true, subtree: true })
  scheduleInstall()

  // Khi tải thẳng trang, bảng và quyền có thể sẵn sàng sau mutation đầu tiên.
  // Kiểm tra lại trong lúc đang ở trang để không cần chuyển route mới thấy nút.
  retryTimer = setInterval(installPrintButtons, 500)
}

function closeRequestPrint() {
  selectedRequest.value = null
  selectedOrder.value = null
  selectedItems.value = []
}

function closeExportPrint() {
  selectedExportOrder.value = null
  selectedExportItems.value = []
}

watch(
  () => [route.path, canPrintRequest.value, canPrintExport.value],
  async () => {
    await nextTick()
    startObserver()
  },
  { immediate: true },
)

onMounted(startObserver)
onBeforeUnmount(stopObserver)
</script>

<template>
  <ExportRequestPrintModal
    v-if="selectedRequest && selectedOrder"
    :request="selectedRequest"
    :order="selectedOrder"
    :items="selectedItems"
    @close="closeRequestPrint"
  />
  <ExportOrderPrintModal
    v-if="selectedExportOrder"
    :export-order="selectedExportOrder"
    :items="selectedExportItems"
    @close="closeExportPrint"
  />
</template>
