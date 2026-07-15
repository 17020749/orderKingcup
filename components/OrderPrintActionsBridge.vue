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
let originalWindowOpen: typeof window.open | null = null

function orderCodeFromRow(row: HTMLTableRowElement | null) {
  return String(row?.querySelector('td:first-child b')?.textContent || '').trim()
}

function removeEmptyPrintRows(popup: Window) {
  try {
    popup.document.querySelectorAll<HTMLTableRowElement>('table.items tbody tr').forEach(row => {
      const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('td'))
      if (cells.length < 6) return

      // Các dòng sản phẩm rỗng của mẫu cũ chỉ có số STT tại ô đầu tiên.
      // Dòng tổng tiền/cộng vẫn có nội dung từ ô thứ hai trở đi nên được giữ lại.
      const hasBusinessData = cells.slice(1).some(cell => String(cell.textContent || '').trim())
      if (!hasBusinessData) row.remove()
    })
  } catch {
    // Popup có thể đã đóng; không ảnh hưởng tới trang đơn hàng.
  }
}

function installPrintPopupCleanup() {
  if (originalWindowOpen || import.meta.server) return
  originalWindowOpen = window.open.bind(window)

  window.open = ((...args: Parameters<typeof window.open>) => {
    const popup = originalWindowOpen?.(...args) || null
    if (!popup) return popup

    const nativePrint = popup.print.bind(popup)
    popup.print = () => {
      removeEmptyPrintRows(popup)
      nativePrint()
    }

    // OrderPrintModal ghi HTML ngay sau window.open(). Chạy vài nhịp để loại
    // dòng trắng cả ở màn hình xem trước lẫn ngay trước hộp thoại in.
    window.setTimeout(() => removeEmptyPrintRows(popup), 30)
    window.setTimeout(() => removeEmptyPrintRows(popup), 180)
    window.setTimeout(() => removeEmptyPrintRows(popup), 420)
    return popup
  }) as typeof window.open
}

function restoreWindowOpen() {
  if (!originalWindowOpen || import.meta.server) return
  window.open = originalWindowOpen
  originalWindowOpen = null
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

  installPrintPopupCleanup()
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

watch(() => route.path, async path => {
  await nextTick()
  if (path !== '/orders') restoreWindowOpen()
  startObserver()
}, { immediate: true })

onMounted(startObserver)
onBeforeUnmount(() => {
  stopObserver()
  restoreWindowOpen()
})
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
