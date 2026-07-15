<script setup lang="ts">
import type { OrderDoc, OrderItemDoc } from '~/types/models'

const route = useRoute()
const { showToast } = useUi()
const {
  loadScopedOrders,
  loadScopedOrderItems,
  loadScopedExportRequests,
} = useScopedQueries()

const selectedOrder = ref<OrderDoc | null>(null)
const selectedItems = ref<OrderItemDoc[]>([])
const selectedRequests = ref<any[]>([])
let observer: MutationObserver | null = null
let installTimer: ReturnType<typeof setTimeout> | null = null

function orderCodeFromRow(row: HTMLTableRowElement | null) {
  return String(row?.querySelector('td:first-child b')?.textContent || '').trim()
}

async function openPrint(code: string, button: HTMLButtonElement) {
  const oldText = button.textContent
  button.disabled = true
  button.textContent = 'Đang tải...'

  try {
    const orders = await loadScopedOrders(true)
    const order = orders.find(row => String(row.order_code || '').trim() === code)
    if (!order) {
      showToast(`Không tìm thấy đơn hàng ${code} hoặc bạn không có quyền xem đơn này.`, 'error')
      return
    }

    const [items, requests] = await Promise.all([
      loadScopedOrderItems(orders, true),
      loadScopedExportRequests(orders, true),
    ])

    selectedOrder.value = order
    selectedItems.value = items.filter(item => item.order_id === order.id)
    selectedRequests.value = requests.filter(request => request.order_id === order.id)
  } catch (error: any) {
    showToast(error?.message || 'Không tải được dữ liệu để in đơn hàng.', 'error')
  } finally {
    button.disabled = false
    button.textContent = oldText || 'In'
  }
}

function installPrintButtons() {
  if (route.path !== '/orders') return

  document.querySelectorAll<HTMLElement>('.main .card .action-buttons').forEach(container => {
    if (container.querySelector('.order-print-trigger')) return

    const row = container.closest('tr') as HTMLTableRowElement | null
    const orderCode = orderCodeFromRow(row)
    if (!orderCode) return

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn-sm order-print-trigger'
    button.textContent = 'In'
    button.title = `In chứng từ cho đơn ${orderCode}`
    button.addEventListener('click', () => openPrint(orderCode, button))
    container.appendChild(button)
  })
}

function scheduleInstall() {
  if (installTimer) clearTimeout(installTimer)
  installTimer = setTimeout(() => {
    installTimer = null
    installPrintButtons()
  }, 30)
}

function startObserver() {
  stopObserver()
  if (route.path !== '/orders') return

  observer = new MutationObserver(scheduleInstall)
  observer.observe(document.body, { childList: true, subtree: true })
  scheduleInstall()
}

function stopObserver() {
  observer?.disconnect()
  observer = null
  if (installTimer) clearTimeout(installTimer)
  installTimer = null
}

function closePrint() {
  selectedOrder.value = null
  selectedItems.value = []
  selectedRequests.value = []
}

watch(() => route.path, async () => {
  await nextTick()
  startObserver()
}, { immediate: true })

onMounted(startObserver)
onBeforeUnmount(stopObserver)
</script>

<template>
  <OrderPrintModal
    v-if="selectedOrder"
    :order="selectedOrder"
    :items="selectedItems"
    :requests="selectedRequests"
    @close="closePrint"
  />
</template>
