<script setup lang="ts">
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore'
import type { OrderDoc, OrderItemDoc, ProductDoc, WarehouseDoc } from '~/types/models'
import { formatDateTime, isActive, normalizeEmail, normalizeText, safeJsonParse, todayKey, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
import { buildNotificationPayload } from '~/composables/useNotifications'

const { db } = useFirebaseServices()
const { appUser, hasPermission, hasAnyPermission } = useAuth()
const { loadScopedOrders, loadScopedOrderItems, loadWarehouseExportRequests, loadProducts, loadWarehouses } = useScopedQueries()
const { buildFulfillmentRows, orderSummary, requestLineProgress } = useWarehouseLogic()
const { processExportRequestToExportOrder } = useWarehouseTransactions()
const { showToast } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()
const { invalidateScopedCache } = useRepo()

const loading = ref(false)
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
const actionType = ref<'accept' | 'reject' | 'release' | ''>('')
const showDetailModal = ref(false)
const showActionModal = ref(false)
const actionForm = reactive({ warehouse_id: '', note: '', export_date: todayKey() })

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
  return canReleaseAction.value && !requestHasExported(row)
    && ['da_tiep_nhan', 'cho_xuat_kho', 'loi'].includes(String(row.status || ''))
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

function openAction(row: any, type: 'accept' | 'reject' | 'release') {
  if (type === 'accept' && !canAcceptRequest(row)) return showToast('Yêu cầu này không còn ở trạng thái có thể tiếp nhận.', 'error')
  if (type === 'reject' && !canRejectRequest(row)) return showToast('Yêu cầu này không thể từ chối.', 'error')
  if (type === 'release' && !canReleaseRequest(row)) return showToast('Yêu cầu phải được tiếp nhận trước khi cho xuất kho.', 'error')
  actionRequest.value = row
  actionType.value = type
  Object.assign(actionForm, {
    warehouse_id: warehouses.value[0]?.id || '',
    note: '',
    export_date: row.export_date || todayKey()
  })
  showActionModal.value = true
}

const actionTitle = computed(() => {
  if (actionType.value === 'accept') return 'Tiếp nhận yêu cầu xuất kho'
  if (actionType.value === 'reject') return 'Từ chối yêu cầu xuất kho'
  if (actionType.value === 'release') return 'Cho xuất kho'
  return 'Xử lý yêu cầu xuất kho'
})

const actionSaveLabel = computed(() => {
  if (actionType.value === 'accept') return 'Xác nhận tiếp nhận'
  if (actionType.value === 'reject') return 'Xác nhận từ chối'
  if (actionType.value === 'release') return 'Cho xuất kho'
  return 'Xác nhận'
})

function saleNotificationRecipients(row: any) {
  const actor = normalizeEmail(appUser.value?.email || '')
  return Array.from(new Set([
    normalizeEmail(row?.requested_by || ''),
    normalizeEmail(row?.order_sale_email || ''),
  ].filter(Boolean))).filter(email => email !== actor)
}

function addSaleNotifications(batch: any, row: any, input: { type: string; title: string; message: string }) {
  saleNotificationRecipients(row).forEach(toEmail => {
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
  if (notification) addSaleNotifications(batch, row, notification)
  await batch.commit()
  invalidateScopedCache('order_export_requests')
  invalidateScopedCache('orders')
  invalidateScopedCache('activity_logs')
}

async function submitAccept(row: any) {
  await updateRequestStatus(
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
  showToast('Đã tiếp nhận yêu cầu xuất kho.', 'success')
}

async function submitReject(row: any) {
  if (!String(actionForm.note || '').trim()) return showToast('Vui lòng nhập lý do từ chối.', 'error')
  const confirmed = await askConfirm({
    title: 'Từ chối yêu cầu xuất kho',
    message: `Bạn chắc chắn muốn từ chối yêu cầu ${row.request_id}?`,
    confirmLabel: 'Từ chối'
  })
  if (!confirmed) return
  await updateRequestStatus(
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
  showToast('Đã từ chối yêu cầu xuất kho.', 'success')
}

async function submitRelease(row: any) {
  const warehouse = findWarehouse(actionForm.warehouse_id)
  if (!warehouse) return showToast('Vui lòng chọn kho xuất.', 'error')

  const lines = requestLineProgress(row).filter((line: any) => toNumber(line.requested_qty) > 0)
  if (!lines.length) return showToast('Yêu cầu xuất kho chưa có dòng hàng hợp lệ.', 'error')

  const missing = lines.filter((line: any) => !findProductByCode(line.product_code))
  if (missing.length) {
    return showToast(`Chưa map được sản phẩm Firestore cho mã: ${missing.map((line: any) => line.product_code).join(', ')}. Kiểm tra quyền products.view và mã sản phẩm.`, 'error')
  }

  const result = await processExportRequestToExportOrder({
    request: row,
    warehouse,
    customer_name: row.customer_name,
    export_date: actionForm.export_date,
    note: actionForm.note,
    timeline: timeline(row),
    orderSummaryPatch: orderPatchAfter(row, 'da_xuat', { warehouse_export_code: 'pending_firestore' }),
    lines: lines.map((line: any) => ({
      product: findProductByCode(line.product_code),
      logo: line.logo,
      quantity: toNumber(line.requested_qty),
      unit: line.unit,
      note: line.note || ''
    }))
  })
  showToast(result.alreadyProcessed ? 'Yêu cầu đã được xử lý trước đó.' : `Đã cho xuất kho và tạo phiếu ${result.code}.`, 'success')
}

async function submitAction() {
  const row = actionRequest.value
  if (!row || !actionType.value) return
  saving.value = true
  try {
    if (actionType.value === 'accept') await submitAccept(row)
    if (actionType.value === 'reject') await submitReject(row)
    if (actionType.value === 'release') await submitRelease(row)
    showActionModal.value = false
    await loadRows(true)
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không xử lý được yêu cầu xuất kho.'), 'error')
  } finally {
    saving.value = false
  }
}

function detailRequestLines(row: any) {
  return requestLineProgress(row)
}

async function loadRows(force = false) {
  loading.value = true
  try {
    const [loadedOrders, productRows, warehouseRows] = await Promise.all([
      loadScopedOrders(force),
      loadProducts(force),
      loadWarehouses(force)
    ])
    orders.value = loadedOrders.filter(isActive)
    products.value = productRows
    warehouses.value = warehouseRows
    const [requests, items] = await Promise.all([
      loadWarehouseExportRequests(force),
      loadScopedOrderItems(orders.value, force)
    ])
    rows.value = requests.filter(isActive)
    itemsByOrder.value = items.reduce((map, item) => {
      if (!map[item.order_id]) map[item.order_id] = []
      map[item.order_id].push(item)
      return map
    }, {} as Record<string, OrderItemDoc[]>)
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được danh sách yêu cầu xuất kho cần xử lý.'), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => loadRows())
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

    <div class="card">
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
      <div v-else-if="!canOpenPage" class="empty">Bạn chưa có quyền mở trang Kho xử lý yêu cầu xuất.</div>
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
                  <button v-if="canRejectRequest(row)" class="btn-sm btn-delete" @click="openAction(row, 'reject')">Từ chối</button>
                  <button v-if="!canAcceptRequest(row) && !canReleaseRequest(row) && !canRejectRequest(row)" class="btn-sm" disabled>Khóa</button>
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
        <div class="form-group">
          <label>Kho xuất</label>
          <SearchableSelect v-model="actionForm.warehouse_id" :options="warehouseOptions" placeholder="Chọn kho xuất" />
        </div>
      </div>

      <div class="table-wrap" style="margin-top: 14px">
        <table style="min-width: 720px">
          <thead><tr><th>Sản phẩm</th><th>Logo</th><th>Đơn vị</th><th>Số lượng</th></tr></thead>
          <tbody>
            <tr v-for="(line,index) in requestLineProgress(actionRequest)" :key="index">
              <td><b>{{ line.product_code }}</b><div class="small subtle">{{ line.product_name }}</div></td>
              <td>{{ line.logo || '-' }}</td>
              <td>{{ line.unit || '-' }}</td>
              <td><b>{{ line.requested_qty }}</b></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="form-group" style="margin-top:12px">
        <label>{{ actionType === 'reject' ? 'Lý do từ chối' : 'Ghi chú kho' }}</label>
        <textarea v-model="actionForm.note" class="textarea" rows="3" />
      </div>
      <p v-if="actionType === 'release'" class="small subtle">Khi cho xuất kho, hệ thống sẽ check tồn, tạo export_orders/export_order_items, ghi stock_movements và trừ inventory_balances bằng transaction.</p>
    </BaseModal>

    <ConfirmModal
      v-bind="confirmState"
      @cancel="resolveConfirm(false)"
      @confirm="resolveConfirm(true)"
    />
  </AppShell>
</template>
