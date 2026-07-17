<script setup lang="ts">
import type { OrderDoc, OrderItemDoc } from '~/types/models'

const route = useRoute()
const { hasPermission } = useAuth()
const { showToast } = useUi()
const {
  loadScopedOrders,
  loadScopedOrderItems,
  loadScopedExportRequests,
} = useScopedQueries()

const selectedRequest = ref<any>(null)
const selectedOrder = ref<OrderDoc | null>(null)
const selectedItems = ref<OrderItemDoc[]>([])
let observer: MutationObserver | null = null
let installTimer: ReturnType<typeof setTimeout> | null = null

const canPrint = computed(() => hasPermission('*') || hasPermission('orders.print'))

function requestCodeFromRow(row: HTMLTableRowElement | null) {
  return String(row?.querySelector('td:first-child b')?.textContent || '').trim()
}

async function openPrint(code: string, button: HTMLButtonElement) {
  if (!canPrint.value) {
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
    const request = requests.find((row: any) => String(row.request_id || row.id).trim() === code)
    if (!request) {
      showToast(`Không tìm thấy yêu cầu xuất kho ${code} hoặc bạn không có quyền xem phiếu này.`, 'error')
      return
    }
    const order = orders.find(row => row.id === request.order_id)
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

function installPrintButtons() {
  if (route.path !== '/export-requests' || !canPrint.value) return

  document.querySelectorAll<HTMLElement>('.main .card .action-buttons').forEach(container => {
    if (container.querySelector('.export-request-print-trigger')) return

    const row = container.closest('tr') as HTMLTableRowElement | null
    const requestCode = requestCodeFromRow(row)
    if (!requestCode) return

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn-sm export-request-print-trigger'
    button.textContent = 'In'
    button.title = `In phiếu xuất hàng ${requestCode}`
    button.addEventListener('click', () => openPrint(requestCode, button))
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
}

function startObserver() {
  stopObserver()
  if (route.path !== '/export-requests' || !canPrint.value) return
  observer = new MutationObserver(scheduleInstall)
  observer.observe(document.body, { childList: true, subtree: true })
  scheduleInstall()
}

function closePrint() {
  selectedRequest.value = null
  selectedOrder.value = null
  selectedItems.value = []
}

watch(() => [route.path, canPrint.value], async () => {
  await nextTick()
  startObserver()
}, { immediate: true })

onMounted(startObserver)
onBeforeUnmount(stopObserver)
</script>

<template>
  <ExportRequestPrintModal
    v-if="selectedRequest && selectedOrder"
    :request="selectedRequest"
    :order="selectedOrder"
    :items="selectedItems"
    @close="closePrint"
  />
</template>
