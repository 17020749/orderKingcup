<script setup lang="ts">
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import type { OrderDoc, OrderItemDoc, ProductDoc, WarehouseDoc } from '~/types/models'
import { formatDateTime, isActive, normalizeText, safeJsonParse, todayKey, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { resolveOrderItemReference } from '~/utils/orderItemDependencies.mjs'
// @ts-ignore Shared lifecycle helper is also executed by Node client tests.
import { canCancelExportRequestRelease, canReleaseExportRequest } from '~/utils/exportLifecycle.mjs'
import {
  buildNotificationPayload,
  resolveSaleNotificationRecipients,
} from '~/composables/useNotifications'

const { db } = useFirebaseServices()
const { appUser, hasPermission, hasAnyPermission } = useAuth()
const {
  loadScopedOrders,
  loadScopedOrderItems,
  loadProducts,
  loadWarehouses,
  listenWarehouseExportRequests,
} = useScopedQueries()
const { buildFulfillmentRows, orderSummary, requestLineProgress } = useWarehouseLogic()
const { processExportRequestToExportOrder, cancelExportRequestRelease } = useWarehouseTransactions()
const { showToast } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()
const { invalidateScopedCache } = useRepo()

const supportingLoading = ref(false)
const realtimeLoading = ref(true)
const loading = computed(() => supportingLoading.value || realtimeLoading.value)
const saving = ref(false)
const search = ref('')
const statusFilter = ref('')
const rows = ref<any[]>([])
const orders = ref<OrderDoc[]>([])
const products = ref<ProductDoc[]>([])
const warehouses = ref<WarehouseDoc[]>([])
const itemsByOrder = ref<Record<string, OrderItemDoc[]>>({})
const selectedRequest = ref<any>(null)
const actionRequest = ref<any>(null)
const actionType = ref<'accept' | 'reject' | 'release' | 'cancel_release' | ''>('')
const showDetailModal = ref(false)
const showActionModal = ref(false)
const actionForm = reactive({ note: '', export_date: todayKey() })
const releaseLines = ref<any[]>([])
const releaseWarehouseIds = ref<Record<number, string>>({})
let stopRequestsListener: (() => void) | null = null
let lastRealtimeError = ''

const canOpenPage = computed(() => hasAnyPermission(['page.warehouse_export_requests', 'export_requests.process']))
const canAcceptAction = computed(() => hasAnyPermission(['export_requests.accept', 'export_requests.process']))
const canRejectAction = computed(() => hasAnyPermission(['export_requests.reject', 'export_requests.process']))
const canReleaseAction = computed(() => hasAnyPermission(['export_requests.release', 'export_requests.process']))
const warehouseOptions = computed(() => warehouses.value.map(warehouse => ({
  value: warehouse.id,
  label: warehouse.name || warehouse.warehouse_code || warehouse.id,
  subLabel: warehouse.address || '',
  search: `${warehouse.name || ''} ${warehouse.warehouse_code || ''} ${warehouse.address || ''}`
})))

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return rows.value.filter(row => {
    const statusOk = !statusFilter.value || row.status === statusFilter.value
    const textOk = !keyword || normalizeText([
      row.request_id,
      row.order_code,
      row.customer_name,
      row.status,
      row.requested_by,
      row.warehouse_export_code,
      row.warehouse_note
    ].join(' ')).includes(keyword)
    return statusOk && textOk
  })
})

const summary = computed(() => filtered.value.reduce((out, row) => {
  out.total++
  if (['cho_xu_ly', 'dang_xu_ly'].includes(String(row.status || ''))) out.waiting++
  if (['da_tiep_nhan', 'cho_xuat_kho'].includes(String(row.status || ''))) out.accepted++
  if (row.status === 'da_xuat') out.exported++
  if (row.status === 'tu_choi') out.rejected++
  return out
}, { total: 0, waiting: 0, accepted: 0, exported: 0, rejected: 0 }))

function statusLabel(status: any) {
  return ({
    cho_xu_ly: 'Chờ xử lý',
    dang_xu_ly: 'Đang xử lý',
    da_tiep_nhan: 'Đã tiếp nhận/chờ xuất kho',
    cho_xuat_kho: 'Chờ xuất kho',
    da_xuat: 'Đã xuất kho',
    tu_choi: 'Từ chối',
    loi: 'Lỗi xử lý'
  } as any)[status] || status || '-'
}

function statusClass(status: any) {
  if (status === 'da_xuat') return 'green'
  if (status === 'tu_choi' || status === 'loi') return 'red'
  if (status === 'da_tiep_nhan' || status === 'cho_xuat_kho') return 'blue'
  return 'yellow'
}

function timeline(row: any) {
  const value = safeJsonParse(row?.request_timeline_json, [])
  return Array.isArray(value) ? value : []
}

function timelineActorText(step: any, row?: any) {
  const payload = row ? safeJsonParse(row.payload_json, {}) : {}
  const actor = String(step?.actor || '').trim()
  const name = String(step?.actor_name || payload.requested_by_name || row?.requested_by_name || row?.sale_name || '').trim()
  if (name && actor && name.toLowerCase() !== actor.toLowerCase()) return `${name} · ${actor}`
  return name || actor || '-'
}

function timelineNoteText(step: any) {
  const note = String(step?.note || '').trim()
  return note ? `Ghi chú: ${note}` : ''
}

function timelineTitleText(step: any) {
  return String(step?.title || statusLabel(step?.status))
    .replace('Kingcup tạo yêu cầu xuất kho', 'Sale tạo yêu cầu xuất kho')
    .replace('Kingcup sửa yêu cầu xuất kho', 'Sale sửa yêu cầu xuất kho')
    .replace('Warehouse đã tiếp nhận', 'Kho đã tiếp nhận')
    .replace('Warehouse đã từ chối', 'Kho đã từ chối')
    .replace('Warehouse cho xuất kho', 'Kho cho xuất kho')
}

function appendTimeline(row: any, action: string, title: string, status: string, note = '') {
  return JSON.stringify([...timeline(row), {
    action,
    title,
    actor: appUser.value?.email || '',
    actor_name: appUser.value?.display_name || appUser.value?.email || '',
    time: new Date().toISOString(),
    status,
    note
  }])
}

function requestsForOrder(orderId: string) {
  return rows.value.filter(row => row.order_id === orderId && isActive(row))
}

function fallbackOrderPatch(nextStatus: string) {
  if (nextStatus === 'da_xuat') {
    return { warehouse_fulfillment_status: 'da_xuat_1_phan', warehouse_request_status: 'da_xuat' }
  }
  if (nextStatus === 'da_tiep_nhan' || nextStatus === 'cho_xuat_kho') {
    return { warehouse_request_status: 'da_tiep_nhan' }
  }
  if (nextStatus === 'tu_choi') {
    return { warehouse_request_status: 'co_tu_choi' }
  }
  return {}
}

function orderPatchAfter(row: any, nextStatus: string, extra: Record<string, any> = {}) {
  const order = orders.value.find(item => item.id === row.order_id)
  if (!order) return fallbackOrderPatch(nextStatus)
  const nextRows = rows.value.map(item => item.id === row.id ? { ...item, status: nextStatus, ...extra } : item)
    .filter(item => item.order_id === row.order_id && isActive(item))
  return orderSummary(buildFulfillmentRows(itemsByOrder.value[row.order_id] || [], nextRows), nextRows)
}

function requestHasExported(row: any) {
  const status = normalizeText(row?.status).replace(/\s+/g, '_')
  if (['da_xuat', 'da_xuat_kho', 'da_xuat_du', 'exported', 'completed', 'hoan_thanh'].includes(status)) return true
  return requestLineProgress(row).some((line: any) => toNumber(line.exported_qty) > 0)
}

function canAcceptRequest(row: any) {
  return canAcceptAction.value && ['cho_xu_ly', 'pending'].includes(String(row.status || ''))
}

function canRejectRequest(row: any) {
  return canRejectAction.value && !requestHasExported(row) && !['tu_choi', 'da_xuat'].includes(String(row.status || ''))
}

function canReleaseRequest(row: any) {
  return canReleaseAction.value && canReleaseExportRequest(row) && !requestHasExported(row)
}

function canCancelReleasedRequest(row: any) {
  return canReleaseAction.value && canCancelExportRequestRelease(row)
}

function actionStillValid(row: any) {
  if (actionType.value === 'accept') return canAcceptRequest(row)
  if (actionType.value === 'reject') return canRejectRequest(row)
  if (actionType.value === 'release') return canReleaseRequest(row)
  if (actionType.value === 'cancel_release') return canCancelReleasedRequest(row)
  return false
}

function normalizeCode(value: any) {
  return String(value || '').trim().toUpperCase()
}

function findProductByCode(code: any) {
  const wanted = normalizeCode(code)
  return products.value.find(product => normalizeCode(product.product_code) === wanted || normalizeCode((product as any).code) === wanted)
}

function findWarehouse(id: string) {
  return warehouses.value.find(warehouse => warehouse.id === id)
}

function openDetail(row: any) {
  selectedRequest.value = row
  showDetailModal.value = true
}

function openAction(row: any, type: 'accept' | 'reject' | 'release' | 'cancel_release') {
  if (type === 'accept' && !canAcceptRequest(row)) return showToast('Yêu cầu này không còn ở trạng thái có thể tiếp nhận.', 'error')
  if (type === 'reject' && !canRejectRequest(row)) return showToast('Yêu cầu này không thể từ chối.', 'error')
  if (type === 'release' && !canReleaseRequest(row)) return showToast('Yêu cầu phải được tiếp nhận trước khi cho xuất kho.', 'error')
  if (type === 'cancel_release' && !canCancelReleasedRequest(row)) return showToast('Yêu cầu không có phiếu xuất đang hoạt động để hủy.', 'error')
  actionRequest.value = row
  actionType.value = type
  Object.assign(actionForm, {
    note: '',
    export_date: row.export_date || todayKey()
  })
  releaseLines.value = type === 'release'
    ? requestLineProgress(row).map((line: any) => ({
        ...line,
        from_warehouse_id: '',
      }))
    : []
  releaseWarehouseIds.value = {}
  showActionModal.value = true
}

const actionTitle = computed(() => {
  if (actionType.value === 'accept') return 'Tiếp nhận yêu cầu xuất kho'
  if (actionType.value === 'reject') return 'Từ chối yêu cầu xuất kho'
  if (actionType.value === 'release') return 'Cho xuất kho'
  if (actionType.value === 'cancel_release') return 'Hủy xuất và hoàn tồn'
  return 'Xử lý yêu cầu xuất kho'
})

const actionSaveLabel = computed(() => {
  if (actionType.value === 'accept') return 'Xác nhận tiếp nhận'
  if (actionType.value === 'reject') return 'Xác nhận từ chối'
  if (actionType.value === 'release') return 'Cho xuất kho'
  if (actionType.value === 'cancel_release') return 'Hủy xuất và hoàn tồn'
  return 'Xác nhận'
})

const actionLines = computed(() => {
  if (actionType.value === 'release') return releaseLines.value
  return actionRequest.value ? requestLineProgress(actionRequest.value) : []
})

function releaseWarehouseId(line: any, index: number) {
  return String(releaseWarehouseIds.value[index] || line?.from_warehouse_id || '').trim()
}

function onReleaseWarehouseChanged(index: number, value: string) {
  releaseWarehouseIds.value[index] = value
  if (releaseLines.value[index]) releaseLines.value[index].from_warehouse_id = value
}

function saleNotificationRecipients(row: any) {
  const order = orders.value.find(item => item.id === row?.order_id)
  return resolveSaleNotificationRecipients({
    request: row,
    order,
    actorEmail: appUser.value?.email || '',
  })
}

function addSaleNotifications(batch: any, row: any, input: { type: string; title: string; message: string }) {
  const recipients = saleNotificationRecipients(row)
  recipients.forEach(toEmail => {
    batch.set(
      doc(collection(db, 'notifications')),
      buildNotificationPayload({
        type: input.type,
        title: input.title,
        message: input.message,
        route: '/export-requests',
        entity_collection: 'order_export_requests',
        entity_id: row.id,
        entity_code: row.request_id || row.id,
        created_by: appUser.value?.email || '',
        to_email: toEmail,
        metadata: {
          order_id: row.order_id || '',
          order_code: row.order_code || '',
          customer_name: row.customer_name || '',
        },
      }),
    )
  })
  return recipients.length
}

async function updateRequestStatus(row: any, nextStatus: string, action: string, title: string, note = '', extra: Record<string, any> = {}, notification?: { type: string; title: string; message: string }) {
  const orderPatch = orderPatchAfter(row, nextStatus, extra)
  const batch = writeBatch(db)
  const patch = {
    status: nextStatus,
    warehouse_handled_by: appUser.value?.email || '',
    warehouse_handled_at: serverTimestamp(),
    warehouse_note: note || '',
    request_timeline_json: appendTimeline(row, action, title, nextStatus, note),
    updated_at: serverTimestamp(),
    ...extra
  }
  batch.update(doc(db, 'order_export_requests', row.id), patch)
  if (row.order_id && Object.keys(orderPatch).length) {
    batch.update(doc(db, 'orders', row.order_id), {
      ...orderPatch,
      updated_at: serverTimestamp()
    })
  }
  batch.set(doc(collection(db, 'activity_logs')), {
    module: 'order_export_requests',
    action,
    item_code: row.request_id || row.id,
    item_name: `${row.order_code || ''} - ${row.customer_name || ''}`,
    changed_by: appUser.value?.email || '',
    after_json: JSON.stringify({ id: row.id, request_id: row.request_id, status: nextStatus, note, ...extra }),
    created_at: serverTimestamp(),
    active: true,
    deleted: false
  })
  const notificationCount = notification ? addSaleNotifications(batch, row, notification) : 0
  await batch.commit()
  invalidateScopedCache('order_export_requests')
  invalidateScopedCache('orders')
  invalidateScopedCache('activity_logs')
  return { notificationCount }
}

async function submitAccept(row: any) {
  const result = await updateRequestStatus(
    row,
    'da_tiep_nhan',
    'accept',
    'Kho đã tiếp nhận',
    actionForm.note,
    {},
    {
      type: 'warehouse_export_request_accepted',
      title: 'Kho đã tiếp nhận yêu cầu xuất',
      message: `${row.request_id || row.id} · Đơn ${row.order_code || '-'} đã được Kho tiếp nhận.`,
    },
  )
  showToast(
    result.notificationCount
      ? 'Đã tiếp nhận yêu cầu xuất kho.'
      : 'Đã tiếp nhận yêu cầu nhưng không xác định được Sale để gửi thông báo.',
    result.notificationCount ? 'success' : 'info',
  )
}

async function submitReject(row: any) {
  if (!String(actionForm.note || '').trim()) return showToast('Vui lòng nhập lý do từ chối.', 'error')
  const confirmed = await askConfirm({
    title: 'Từ chối yêu cầu xuất kho',
    message: `Bạn chắc chắn muốn từ chối yêu cầu ${row.request_id}?`,
    confirmLabel: 'Từ chối'
  })
  if (!confirmed) return
  const result = await updateRequestStatus(
    row,
    'tu_choi',
    'reject',
    'Kho đã từ chối',
    actionForm.note,
    {},
    {
      type: 'warehouse_export_request_rejected',
      title: 'Kho đã từ chối yêu cầu xuất',
      message: `${row.request_id || row.id} · Lý do: ${String(actionForm.note || '').trim()}`,
    },
  )
  showToast(
    result.notificationCount
      ? 'Đã từ chối yêu cầu xuất kho.'
      : 'Đã từ chối yêu cầu nhưng không xác định được Sale để gửi thông báo.',
    result.notificationCount ? 'success' : 'info',
  )
}

async function submitRelease(row: any) {
  const lines = releaseLines.value
    .map((line: any, index: number) => ({ ...line, __release_index: index }))
    .filter((line: any) => toNumber(line.requested_qty) > 0)
  if (!lines.length) return showToast('Yêu cầu xuất kho chưa có dòng hàng hợp lệ.', 'error')

  const sourceItems = itemsByOrder.value[row.order_id] || []
  const resolvedLines = lines.map((line: any) => ({
    releaseLine: line,
    source: resolveOrderItemReference(sourceItems, line),
  }))
  const invalidSource = resolvedLines.find(entry => !entry.source.line)
  if (invalidSource) return showToast(invalidSource.source.error, 'error')

  const missing = lines.filter((line: any) => !findProductByCode(line.product_code))
  if (missing.length) {
    return showToast(`Chưa tìm thấy sản phẩm cho mã: ${missing.map((line: any) => line.product_code).join(', ')}. Kiểm tra quyền truy cập và mã sản phẩm.`, 'error')
  }
  const missingWarehouse = lines.filter((line: any) => !releaseWarehouseId(line, line.__release_index))
  if (missingWarehouse.length) {
    return showToast(
      `Vui lòng chọn kho xuất cho dòng ${missingWarehouse.map((line: any) => line.__release_index + 1).join(', ')}.`,
      'error',
    )
  }
  const missingWarehouseDocs = lines.filter((line: any) => !findWarehouse(releaseWarehouseId(line, line.__release_index)))
  if (missingWarehouseDocs.length) {
    return showToast(
      `Kho xuất dòng ${missingWarehouseDocs.map((line: any) => line.__release_index + 1).join(', ')} không còn trong danh mục kho. Vui lòng tải lại trang và chọn lại.`,
      'error',
    )
  }

  const result = await processExportRequestToExportOrder({
    request: row,
    notification_recipients: saleNotificationRecipients(row),
    customer_name: row.customer_name,
    export_date: actionForm.export_date,
    note: actionForm.note,
    timeline: timeline(row),
    orderSummaryPatch: orderPatchAfter(row, 'da_xuat', { warehouse_export_code: 'pending_firestore' }),
    expected_revision: toNumber(row.revision),
    lines: resolvedLines.map(({ releaseLine: line, source }: any) => {
      const warehouseId = releaseWarehouseId(line, line.__release_index)
      const fromWarehouse = findWarehouse(warehouseId)
      return {
        source_order_id: row.order_id,
        source_order_item_id: source.line.order_item_id,
        product: findProductByCode(line.product_code),
        fromWarehouse,
        warehouse: fromWarehouse,
        from_warehouse_id: warehouseId,
        warehouse_id: warehouseId,
        logo: line.logo,
        quantity: toNumber(line.requested_qty),
        unit: line.unit,
        note: line.note || ''
      }
    })
  })
  if (result.alreadyProcessed) {
    showToast('Yêu cầu đã được xử lý trước đó.', 'info')
  } else if (!result.notificationCount) {
    showToast(`Đã cho xuất kho và tạo phiếu ${result.code}, nhưng không xác định được Sale để gửi thông báo.`, 'info')
  } else {
    showToast(`Đã cho xuất kho và tạo phiếu ${result.code}.`, 'success')
  }
}

async function submitCancelRelease(row: any) {
  const reason = String(actionForm.note || '').trim()
  if (!reason) return showToast('Vui lòng nhập lý do hủy xuất kho.', 'error')
  const confirmed = await askConfirm({
    title: 'Hủy xuất và hoàn tồn',
    message: `Hủy phiếu ${row.warehouse_export_code || row.export_order_id || '-'} sẽ hoàn tồn và mở lại yêu cầu ${row.request_id || row.id}. Bạn chắc chắn?`,
    confirmLabel: 'Hủy xuất và hoàn tồn'
  })
  if (!confirmed) return
  const result = await cancelExportRequestRelease({
    request: row,
    reason,
    timeline: timeline(row),
    notification_recipients: saleNotificationRecipients(row),
    orderSummaryPatch: orderPatchAfter(row, 'da_tiep_nhan', {
      active_export_order_id: '',
      export_order_id: '',
      warehouse_export_order_id: '',
    }),
    operation_id: `export_request_cancel:${row.id}:${toNumber(row.revision)}`,
    expected_request_revision: toNumber(row.revision),
  })
  showToast(
    result.notificationCount
      ? `Đã hủy phiếu ${result.code}, hoàn tồn và mở lại yêu cầu.`
      : `Đã hủy phiếu ${result.code} và hoàn tồn, nhưng không xác định được Sale để gửi thông báo.`,
    result.notificationCount ? 'success' : 'info',
  )
}

async function submitAction() {
  const row = actionRequest.value
  if (!row || !actionType.value) return
  saving.value = true
  try {
    if (actionType.value === 'accept') await submitAccept(row)
    if (actionType.value === 'reject') await submitReject(row)
    if (actionType.value === 'release') await submitRelease(row)
    if (actionType.value === 'cancel_release') await submitCancelRelease(row)
    showActionModal.value = false
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không xử lý được yêu cầu xuất kho.'), 'error')
  } finally {
    saving.value = false
  }
}

function detailRequestLines(row: any) {
  return requestLineProgress(row)
}

function syncOpenRequestState(nextRows: any[]) {
  if (selectedRequest.value) {
    const fresh = nextRows.find(row => row.id === selectedRequest.value.id)
    if (fresh) selectedRequest.value = fresh
    else {
      selectedRequest.value = null
      showDetailModal.value = false
    }
  }

  if (!actionRequest.value) return
  const fresh = nextRows.find(row => row.id === actionRequest.value.id)
  if (!fresh) {
    actionRequest.value = null
    if (showActionModal.value && !saving.value) {
      showActionModal.value = false
      showToast('Yêu cầu đang xử lý không còn khả dụng.', 'info')
    }
    return
  }

  actionRequest.value = fresh
  if (showActionModal.value && !saving.value && !actionStillValid(fresh)) {
    showActionModal.value = false
    showToast('Yêu cầu vừa được tài khoản khác cập nhật nên thao tác này không còn hợp lệ.', 'info')
  }
}

function startRequestsListener() {
  stopRequestsListener?.()
  stopRequestsListener = null
  realtimeLoading.value = true
  stopRequestsListener = listenWarehouseExportRequests(
    nextRows => {
      syncOpenRequestState(nextRows)
      rows.value = nextRows
      realtimeLoading.value = false
      lastRealtimeError = ''
    },
    error => {
      realtimeLoading.value = false
      const message = reportFirebaseError(
        error,
        'Mất kết nối realtime với yêu cầu xuất kho.',
      )
      if (message !== lastRealtimeError) showToast(message, 'error')
      lastRealtimeError = message
    },
  )
}

async function loadRows(force = false) {
  supportingLoading.value = true
  try {
    const [loadedOrders, productRows, warehouseRows] = await Promise.all([
      loadScopedOrders(force),
      loadProducts(force),
      loadWarehouses(force)
    ])
    orders.value = loadedOrders.filter(isActive)
    products.value = productRows
    warehouses.value = warehouseRows
    const items = await loadScopedOrderItems(orders.value, force)
    itemsByOrder.value = items.reduce((map, item) => {
      if (!map[item.order_id]) map[item.order_id] = []
      map[item.order_id].push(item)
      return map
    }, {} as Record<string, OrderItemDoc[]>)
    startRequestsListener()
  } catch (error) {
    realtimeLoading.value = false
    showToast(reportFirebaseError(error, 'Không tải được danh sách yêu cầu xuất kho cần xử lý.'), 'error')
  } finally {
    supportingLoading.value = false
  }
}

onMounted(() => loadRows())
onBeforeUnmount(() => {
  stopRequestsListener?.()
  stopRequestsListener = null
})
</script>

<template>
  <AppShell>
    <PageHeader title="Xử lý yêu cầu xuất kho" subtitle="Kho tiếp nhận, từ chối hoặc cho xuất các yêu cầu từ Sale/OrderKingcup">
      <button class="btn" @click="loadRows(true)">Làm mới</button>
    </PageHeader>

    <div class="summary-grid">
      <div class="summary-card"><label>Tổng yêu cầu</label><strong>{{ summary.total.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Chờ tiếp nhận</label><strong>{{ summary.waiting.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Đã tiếp nhận</label><strong>{{ summary.accepted.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Đã xuất kho</label><strong>{{ summary.exported.toLocaleString('vi-VN') }}</strong></div>
    </div>

    <div class="card" style="margin: 24px;">
      <div class="toolbar">
        <input v-model="search" class="input" style="max-width:420px" placeholder="Tìm mã yêu cầu, đơn hàng, khách hàng..." />
        <select v-model="statusFilter" class="input" style="max-width:220px">
          <option value="">Tất cả trạng thái</option>
          <option value="cho_xu_ly">Chờ xử lý</option>
          <option value="da_tiep_nhan">Đã tiếp nhận</option>
          <option value="da_xuat">Đã xuất kho</option>
          <option value="tu_choi">Từ chối</option>
          <option value="loi">Lỗi xử lý</option>
        </select>
      </div>

      <LoadingState v-if="loading" />
      <div v-else-if="!canOpenPage" class="empty">Bạn không có quyền thực hiện thao tác này.</div>
      <div v-else class="table-wrap">
        <table style="min-width: 980px">
          <thead>
            <tr>
              <th>Mã YC</th><th>Đơn hàng</th><th>Khách hàng</th><th>Ngày yêu cầu</th><th>Người yêu cầu</th><th>Trạng thái</th><th>Phiếu kho</th><th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ row.request_id || row.id }}</b></td>
              <td>{{ row.order_code || '-' }}</td>
              <td>{{ row.customer_name || '-' }}</td>
              <td>{{ formatDateTime(row.requested_at || row.created_at) }}</td>
              <td>{{ row.requested_by || '-' }}</td>
              <td><span class="badge" :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span></td>
              <td>{{ row.warehouse_export_code || '-' }}</td>
              <td>
                <div class="action-buttons">
                  <button class="btn-sm" @click="openDetail(row)">Xem</button>
                  <button v-if="canAcceptRequest(row)" class="btn-sm btn-view" @click="openAction(row, 'accept')">Tiếp nhận</button>
                  <button v-if="canReleaseRequest(row)" class="btn-sm btn-view" @click="openAction(row, 'release')">Cho xuất kho</button>
                  <button v-if="canCancelReleasedRequest(row)" class="btn-sm btn-delete" @click="openAction(row, 'cancel_release')">Hủy xuất/Hoàn tồn</button>
                  <button v-if="canRejectRequest(row)" class="btn-sm btn-delete" @click="openAction(row, 'reject')">Từ chối</button>
                  <button v-if="!canAcceptRequest(row) && !canReleaseRequest(row) && !canCancelReleasedRequest(row) && !canRejectRequest(row)" class="btn-sm" disabled>Khóa</button>
                </div>
              </td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="8" class="empty">Không có yêu cầu xuất kho phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal v-if="showDetailModal && selectedRequest" title="Chi tiết yêu cầu xuất kho" size="xl" :show-footer="false" @close="showDetailModal=false">
      <div class="detail-grid">
        <div class="detail-item"><label>Mã yêu cầu</label><strong>{{ selectedRequest.request_id || selectedRequest.id }}</strong></div>
        <div class="detail-item"><label>Đơn hàng</label><strong>{{ selectedRequest.order_code || '-' }}</strong></div>
        <div class="detail-item"><label>Khách hàng</label><strong>{{ selectedRequest.customer_name || '-' }}</strong></div>
        <div class="detail-item"><label>Trạng thái</label><strong>{{ statusLabel(selectedRequest.status) }}</strong></div>
        <div class="detail-item"><label>Sale tạo yêu cầu</label><strong>{{ timelineActorText({ actor: selectedRequest.requested_by, actor_name: safeJsonParse(selectedRequest.payload_json, {}).requested_by_name || selectedRequest.sale_name }, selectedRequest) }}</strong></div>
        <div class="detail-item"><label>Ngày yêu cầu</label><strong>{{ formatDateTime(selectedRequest.requested_at || selectedRequest.created_at) }}</strong></div>
        <div class="detail-item"><label>Phiếu kho</label><strong>{{ selectedRequest.warehouse_export_code || '-' }}</strong></div>
        <div class="detail-item"><label>Ghi chú kho</label><strong>{{ selectedRequest.warehouse_note || '-' }}</strong></div>
        <div class="detail-item"><label>Lần xuất</label><strong>{{ selectedRequest.release_sequence || (selectedRequest.export_order_id ? 1 : 0) }}</strong></div>
        <div class="detail-item"><label>Phiếu đã hủy gần nhất</label><strong>{{ selectedRequest.last_cancelled_export_code || '-' }}</strong></div>
      </div>

      <h3>Sản phẩm yêu cầu</h3>
      <div class="table-wrap">
        <table style="min-width: 780px">
          <thead><tr><th>Sản phẩm</th><th>Logo</th><th>Đơn vị</th><th>SL yêu cầu</th><th>Đã xử lý</th><th>Đã xuất</th></tr></thead>
          <tbody>
            <tr v-for="(line,index) in detailRequestLines(selectedRequest)" :key="index">
              <td><b>{{ line.product_code }}</b><div class="small subtle">{{ line.product_name }}</div></td>
              <td>{{ line.logo || '-' }}</td>
              <td>{{ line.unit || '-' }}</td>
              <td>{{ line.requested_qty }}</td>
              <td>{{ line.processed_qty }}</td>
              <td>{{ line.exported_qty }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h3 v-if="timeline(selectedRequest).length">Timeline xử lý</h3>
      <div v-for="(step,index) in timeline(selectedRequest)" :key="index" class="detail-item" style="margin-bottom:8px">
        <strong>{{ timelineTitleText(step) }}</strong>
        <div class="small subtle">{{ formatDateTime(step.time) }} · {{ timelineActorText(step, selectedRequest) }}</div>
        <div v-if="timelineNoteText(step)">{{ timelineNoteText(step) }}</div>
      </div>
    </BaseModal>

    <BaseModal v-if="showActionModal && actionRequest" :title="actionTitle" size="lg" :loading="saving" :save-label="actionSaveLabel" @close="showActionModal=false" @save="submitAction">
      <div class="detail-grid">
        <div class="detail-item"><label>Mã yêu cầu</label><strong>{{ actionRequest.request_id }}</strong></div>
        <div class="detail-item"><label>Đơn hàng</label><strong>{{ actionRequest.order_code }}</strong></div>
        <div class="detail-item"><label>Khách hàng</label><strong>{{ actionRequest.customer_name || '-' }}</strong></div>
        <div class="detail-item"><label>Trạng thái</label><strong>{{ statusLabel(actionRequest.status) }}</strong></div>
      </div>

      <div v-if="actionType === 'release'" class="form-grid">
        <div class="form-group"><label>Ngày xuất thực tế</label><input v-model="actionForm.export_date" class="input" type="date" /></div>
      </div>

      <div class="table-wrap" style="margin-top: 14px">
        <table :style="{ minWidth: actionType === 'release' ? '980px' : '720px' }">
          <thead><tr><th v-if="actionType === 'release'">Kho xuất</th><th>Sản phẩm</th><th>Logo</th><th>Đơn vị</th><th>Số lượng</th></tr></thead>
          <tbody>
            <tr v-for="(line,index) in actionLines" :key="index">
              <td v-if="actionType === 'release'">
                <SearchableSelect
                  :model-value="releaseWarehouseId(line, index)"
                  :options="warehouseOptions"
                  placeholder="Chọn kho xuất"
                  @update:model-value="onReleaseWarehouseChanged(index, $event)"
                  @change="onReleaseWarehouseChanged(index, $event)"
                />
                <div class="small subtle">ID kho: {{ releaseWarehouseId(line, index) || 'chưa chọn' }}</div>
              </td>
              <td><b>{{ line.product_code }}</b><div class="small subtle">{{ line.product_name }}</div></td>
              <td>{{ line.logo || '-' }}</td>
              <td>{{ line.unit || '-' }}</td>
              <td><b>{{ line.requested_qty }}</b></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="form-group" style="margin-top:12px">
        <label>{{ actionType === 'reject' ? 'Lý do từ chối' : actionType === 'cancel_release' ? 'Lý do hủy xuất' : 'Ghi chú kho' }}</label>
        <textarea v-model="actionForm.note" class="textarea" rows="3" />
      </div>
      <p v-if="actionType === 'release'" class="small subtle">Khi cho xuất kho, hệ thống sẽ check tồn, tạo export_orders/export_order_items, ghi stock_movements và trừ inventory_balances bằng transaction.</p>
      <p v-if="actionType === 'cancel_release'" class="small subtle">Hệ thống sẽ hủy mềm phiếu xuất liên kết, hoàn inventory_balances, ghi stock_movements đảo và mở lại yêu cầu trong cùng transaction.</p>
    </BaseModal>

    <ConfirmModal
      v-bind="confirmState"
      @cancel="resolveConfirm(false)"
      @confirm="resolveConfirm(true)"
    />
  </AppShell>
</template>
