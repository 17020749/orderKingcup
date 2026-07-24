<script setup lang="ts">
import { collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import type { BusTransportDoc, ExportRequestDoc } from '~/types/models'
import { formatDateTime, isActive, makeCode, makeId, normalizeText, safeJsonParse, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared lifecycle helper is executed directly by Node tests.
import { activeExportOrderId } from '~/utils/exportLifecycle.mjs'

const { db } = useFirebaseServices()
const { appUser, hasPermission } = useAuth()
const { showToast, withLoading } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()
const { invalidateScopedCache } = useRepo()
const { requestLineProgress } = useWarehouseLogic()

const rows = ref<BusTransportDoc[]>([])
const requests = ref<ExportRequestDoc[]>([])
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const statusFilter = ref('')
const showModal = ref(false)
const showDetailModal = ref(false)
const editing = ref<BusTransportDoc | null>(null)
const selectedDetail = ref<BusTransportDoc | null>(null)
const selectedPrint = ref<BusTransportDoc | null>(null)
const selectedPrintRequest = ref<ExportRequestDoc | null>(null)
const selectedPrintItems = ref<Array<Record<string, any>>>([])
const form = reactive<any>({})

const canView = computed(() => hasPermission('*') || hasPermission('bus_transport.view'))
const canCreate = computed(() => hasPermission('*') || hasPermission('bus_transport.create'))
const canEdit = computed(() => hasPermission('*') || hasPermission('bus_transport.edit'))
const canDelete = computed(() => hasPermission('*') || hasPermission('bus_transport.delete'))

function timestampValue(value: any) {
  if (value?.toMillis) return value.toMillis()
  const date = new Date(value || 0)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function requestCode(row: ExportRequestDoc | null | undefined) {
  return String(row?.request_id || row?.id || '').trim()
}

function statusKey(value: any) {
  return normalizeText(value).replace(/\s+/g, '_')
}

function isRejectedRequest(row: ExportRequestDoc | null | undefined) {
  return ['tu_choi', 'rejected'].includes(statusKey(row?.status))
}

function requestStatusLabel(value: any) {
  const key = statusKey(value)
  return ({
    cho_xu_ly: 'Chờ xử lý',
    dang_xu_ly: 'Đang xử lý',
    da_tiep_nhan: 'Đã tiếp nhận/chờ xuất kho',
    cho_xuat_kho: 'Đã tiếp nhận/chờ xuất kho',
    da_xuat: 'Đã xuất kho',
    loi: 'Lỗi xử lý',
  } as Record<string, string>)[key] || String(value || '-')
}

const activeRequests = computed(() => requests.value.filter(row => isActive(row) && !isRejectedRequest(row)))
const usedRequestIds = computed(() => new Set(
  rows.value.filter(isActive).map(row => String(row.source_request_id || '')).filter(Boolean),
))

const requestOptions = computed(() => activeRequests.value
  .filter(row => !usedRequestIds.value.has(row.id) || editing.value?.source_request_id === row.id)
  .map(row => ({
    value: row.id,
    label: `${requestCode(row)} - ${row.customer_name || 'Chưa có khách hàng'}`,
    subLabel: `${row.order_code || 'Không có mã đơn'} · ${requestStatusLabel(row.status)}`,
    search: `${requestCode(row)} ${row.order_code || ''} ${row.customer_name || ''} ${requestStatusLabel(row.status)}`,
  })))

const selectedRequest = computed(() => requests.value.find(row => row.id === form.source_request_id) || null)
const selectedRequestItems = computed(() => selectedRequest.value
  ? requestLineProgress(selectedRequest.value).map((line: any) => ({
      id: line.order_item_id || `${line.product_code || ''}|${line.logo || ''}`,
      source_request_id: selectedRequest.value?.id || '',
      product_id: line.product_id || '',
      product_code: line.product_code || '',
      product_name: line.product_name || '',
      logo: line.logo || '',
      unit: line.unit || '',
      quantity: toNumber(line.exported_qty) > 0 ? toNumber(line.exported_qty) : toNumber(line.requested_qty),
      active: true,
      deleted: false,
    })).filter((item: any) => item.quantity > 0)
  : [])

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return rows.value.filter(row => {
    const text = normalizeText([
      row.transport_code,
      row.request_code,
      row.export_order_code,
      row.order_code,
      row.customer_name,
      row.receiver_name,
      row.receiver_phone,
      row.receiver_address,
      row.carrier_name,
      row.carrier_phone,
      row.vehicle_plate,
      row.driver_name,
      row.transport_status,
    ].join(' '))
    return (!keyword || text.includes(keyword))
      && (!statusFilter.value || row.transport_status === statusFilter.value)
  })
})

const summary = computed(() => rows.value.reduce((out, row) => {
  out.total++
  if (row.transport_status === 'Chờ xuất phát') out.pending++
  if (row.transport_status === 'Đã xuất phát') out.departed++
  if (row.transport_status === 'Đã hoàn thành') out.completed++
  return out
}, { total: 0, pending: 0, departed: 0, completed: 0 }))

function resetForm() {
  Object.keys(form).forEach(key => delete form[key])
}

function requestRecipient(row: any) {
  const payload = safeJsonParse(row?.payload_json, {})
  return {
    customer_id: row?.customer_id || payload?.customer_id || '',
    receiver_name: row?.receiver_name || payload?.receiver_name || row?.customer_name || payload?.customer_name || '',
    receiver_phone: row?.receiver_phone || payload?.receiver_phone || '',
    receiver_address: row?.receiver_address || payload?.receiver_address || '',
  }
}

async function chooseRequest() {
  const request = selectedRequest.value
  if (!request) return
  const receiver = requestRecipient(request)
  Object.assign(form, {
    source_request_id: request.id,
    request_code: requestCode(request),
    request_status: request.status || '',
    export_order_id: String(activeExportOrderId(request) || ''),
    export_order_code: request.warehouse_export_code || '',
    order_id: request.order_id || '',
    order_code: request.order_code || '',
    customer_id: receiver.customer_id,
    customer_name: receiver.receiver_name,
    receiver_name: receiver.receiver_name,
    receiver_phone: receiver.receiver_phone,
    receiver_address: receiver.receiver_address,
  })
}

async function openModal(row?: BusTransportDoc) {
  if (row && !canEdit.value) return showToast('Bạn không có quyền sửa đơn vận chuyển nhà xe.', 'error')
  if (!row && !canCreate.value) return showToast('Bạn không có quyền tạo đơn vận chuyển nhà xe.', 'error')
  editing.value = row || null
  resetForm()
  if (row) {
    Object.assign(form, {
      ...row,
      source_request_id: row.source_request_id || '',
      request_code: row.request_code || row.export_order_code || '',
      request_status: row.request_status || '',
      carrier_name: row.carrier_name || '',
      carrier_phone: row.carrier_phone || '',
      vehicle_plate: row.vehicle_plate || '',
      driver_name: row.driver_name || '',
      departure_at: row.departure_at || '',
      transport_status: row.transport_status || 'Chờ xuất phát',
      note: row.note || '',
    })
    if (row.source_request_id) await chooseRequest()
  } else {
    Object.assign(form, {
      source_request_id: '', request_code: '', request_status: '',
      export_order_id: '', export_order_code: '', order_id: '', order_code: '',
      customer_id: '', customer_name: '', receiver_name: '', receiver_phone: '', receiver_address: '',
      carrier_name: '', carrier_phone: '', vehicle_plate: '', driver_name: '', departure_at: '',
      transport_status: 'Chờ xuất phát', note: '',
    })
  }
  showModal.value = true
}

function activityPayload(action: string, code: string, before: any, after: any) {
  return {
    module: 'bus_transport_orders',
    action,
    item_code: code,
    item_name: `${after?.request_code || before?.request_code || ''} - ${after?.carrier_name || before?.carrier_name || ''}`,
    changed_by: appUser.value?.email || '',
    before_json: JSON.stringify(before || {}),
    after_json: JSON.stringify(after || {}),
    created_at: serverTimestamp(),
    active: true,
    deleted: false,
  }
}

async function save() {
  if (!form.source_request_id) return showToast('Vui lòng chọn yêu cầu xuất kho.', 'error')
  if (editing.value && !canEdit.value) return showToast('Bạn không có quyền sửa đơn vận chuyển.', 'error')
  if (!editing.value && !canCreate.value) return showToast('Bạn không có quyền tạo đơn vận chuyển.', 'error')
  const source = selectedRequest.value
  if (!source || isRejectedRequest(source)) return showToast('Yêu cầu xuất kho không còn hợp lệ để tạo vận chuyển.', 'error')
  if (!editing.value && usedRequestIds.value.has(source.id)) {
    return showToast('Yêu cầu xuất kho này đã có đơn vận chuyển nhà xe đang hoạt động.', 'error')
  }

  saving.value = true
  await withLoading(async () => {
    await chooseRequest()
    const nowEmail = appUser.value?.email || ''
    const batch = writeBatch(db)
    if (editing.value) {
      const patch = {
        receiver_name: String(form.receiver_name || '').trim(),
        receiver_phone: String(form.receiver_phone || '').trim(),
        receiver_address: String(form.receiver_address || '').trim(),
        carrier_name: String(form.carrier_name || '').trim(),
        carrier_phone: String(form.carrier_phone || '').trim(),
        vehicle_plate: String(form.vehicle_plate || '').trim(),
        driver_name: String(form.driver_name || '').trim(),
        departure_at: String(form.departure_at || '').trim(),
        transport_status: form.transport_status || 'Chờ xuất phát',
        note: String(form.note || '').trim(),
        updated_by: nowEmail,
        updated_at: serverTimestamp(),
      }
      batch.update(doc(db, 'bus_transport_orders', editing.value.id), patch)
      batch.set(doc(collection(db, 'activity_logs')), activityPayload('update', editing.value.transport_code || editing.value.id, editing.value, patch))
    } else {
      const id = makeId('bus_transport')
      const transportCode = makeCode('VCNX')
      const payload = {
        id,
        transport_code: transportCode,
        source_request_id: source.id,
        request_code: requestCode(source),
        request_status: source.status || '',
        export_order_id: String(activeExportOrderId(source) || ''),
        export_order_code: source.warehouse_export_code || '',
        order_id: form.order_id || '',
        order_code: form.order_code || '',
        customer_id: form.customer_id || '',
        customer_name: form.customer_name || '',
        receiver_name: form.receiver_name || '',
        receiver_phone: form.receiver_phone || '',
        receiver_address: form.receiver_address || '',
        carrier_name: String(form.carrier_name || '').trim(),
        carrier_phone: String(form.carrier_phone || '').trim(),
        vehicle_plate: String(form.vehicle_plate || '').trim(),
        driver_name: String(form.driver_name || '').trim(),
        departure_at: String(form.departure_at || '').trim(),
        transport_status: form.transport_status || 'Chờ xuất phát',
        note: String(form.note || '').trim(),
        items_json: JSON.stringify(selectedRequestItems.value),
        status: 'active', active: true, deleted: false,
        created_by: nowEmail, created_at: serverTimestamp(), updated_by: nowEmail, updated_at: serverTimestamp(),
        source: 'bus_transport',
      }
      batch.set(doc(db, 'bus_transport_orders', id), payload)
      batch.set(doc(collection(db, 'activity_logs')), activityPayload('create', transportCode, null, payload))
    }
    await batch.commit()
    invalidateScopedCache('bus_transport_orders')
    invalidateScopedCache('activity_logs')
    showModal.value = false
    await loadRows(true)
    showToast(editing.value ? 'Đã cập nhật đơn vận chuyển nhà xe.' : 'Đã tạo đơn vận chuyển nhà xe.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không lưu được đơn vận chuyển nhà xe.'), 'error'))
    .finally(() => { saving.value = false })
}

async function remove(row: BusTransportDoc) {
  if (!canDelete.value) return showToast('Bạn không có quyền xóa đơn vận chuyển nhà xe.', 'error')
  const confirmed = await askConfirm({ title: 'Xóa đơn vận chuyển nhà xe', message: `Bạn chắc chắn muốn xóa ${row.transport_code || row.id}?`, confirmLabel: 'Xóa đơn vận chuyển' })
  if (!confirmed) return
  await withLoading(async () => {
    const batch = writeBatch(db)
    const patch = {
      deleted: true, active: false, status: 'deleted',
      deleted_by: appUser.value?.email || '', deleted_at: serverTimestamp(),
      updated_by: appUser.value?.email || '', updated_at: serverTimestamp(),
    }
    batch.update(doc(db, 'bus_transport_orders', row.id), patch)
    batch.set(doc(collection(db, 'activity_logs')), activityPayload('delete', row.transport_code || row.id, row, patch))
    await batch.commit()
    rows.value = rows.value.filter(item => item.id !== row.id)
    invalidateScopedCache('bus_transport_orders')
    invalidateScopedCache('activity_logs')
    showToast('Đã xóa đơn vận chuyển nhà xe.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không xóa được đơn vận chuyển nhà xe.'), 'error'))
}

function openDetail(row: BusTransportDoc) {
  selectedDetail.value = row
  showDetailModal.value = true
}

function itemSnapshot(row: BusTransportDoc) {
  const value = safeJsonParse(row.items_json, [])
  return Array.isArray(value) ? value as Array<Record<string, any>> : []
}

async function openPrint(row: BusTransportDoc) {
  const request = requests.value.find(item => item.id === row.source_request_id) || null
  selectedPrint.value = row
  selectedPrintRequest.value = request
  selectedPrintItems.value = request
    ? requestLineProgress(request).map((line: any) => ({
        product_code: line.product_code || '', product_name: line.product_name || '', logo: line.logo || '',
        quantity: toNumber(line.exported_qty) > 0 ? toNumber(line.exported_qty) : toNumber(line.requested_qty),
        active: true, deleted: false,
      })).filter((item: any) => item.quantity > 0)
    : itemSnapshot(row)
}

async function loadRows(force = false) {
  if (!canView.value) return
  loading.value = true
  try {
    const [transportSnapshot, requestSnapshot] = await Promise.all([
      getDocs(collection(db, 'bus_transport_orders')),
      getDocs(collection(db, 'order_export_requests')),
    ])
    rows.value = transportSnapshot.docs
      .map(item => ({ id: item.id, ...(item.data() || {}) } as BusTransportDoc))
      .filter(isActive)
      .sort((left, right) => timestampValue(right.updated_at || right.created_at) - timestampValue(left.updated_at || left.created_at))
    requests.value = requestSnapshot.docs.map(item => ({ id: item.id, ...(item.data() || {}) } as ExportRequestDoc)).filter(isActive)
    if (force) showToast('Đã làm mới dữ liệu vận chuyển nhà xe.', 'success')
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được dữ liệu vận chuyển nhà xe.'), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Vận chuyển nhà xe" subtitle="Tạo đơn vận chuyển từ yêu cầu xuất kho ở mọi trạng thái, trừ yêu cầu đã từ chối">
      <button class="btn" @click="loadRows(true)">Làm mới</button>
      <button v-if="canCreate" class="btn primary" @click="openModal()">+ Tạo đơn vận chuyển</button>
    </PageHeader>

    <div class="summary-grid">
      <div class="summary-card"><label>Tổng đơn</label><strong>{{ summary.total.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Chờ xuất phát</label><strong>{{ summary.pending.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Đã xuất phát</label><strong>{{ summary.departed.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Hoàn thành</label><strong>{{ summary.completed.toLocaleString('vi-VN') }}</strong></div>
    </div>

    <div class="card" style="margin:24px">
      <div class="filter-bar">
        <input v-model="search" class="input" placeholder="Tìm mã vận chuyển, yêu cầu xuất, khách hàng, nhà xe..." />
        <select v-model="statusFilter" class="select"><option value="">Tất cả trạng thái</option><option>Chờ xuất phát</option><option>Đã xuất phát</option><option>Đã hoàn thành</option></select>
      </div>

      <LoadingState v-if="loading" />
      <div v-else-if="!canView" class="empty">Bạn không có quyền xem vận chuyển nhà xe.</div>
      <div v-else class="table-wrap">
        <table style="min-width:1220px">
          <thead><tr><th>Mã vận chuyển</th><th>Yêu cầu xuất</th><th>Trạng thái YC</th><th>Đơn hàng</th><th>Khách hàng</th><th>Nhà xe</th><th>Biển số</th><th>Giờ xuất phát</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ row.transport_code || row.id }}</b></td>
              <td>{{ row.request_code || row.export_order_code || '-' }}</td>
              <td>{{ requestStatusLabel(row.request_status) }}</td>
              <td>{{ row.order_code || '-' }}</td>
              <td>{{ row.customer_name || row.receiver_name || '-' }}<div class="small subtle">{{ row.receiver_phone || '' }}</div></td>
              <td><b>{{ row.carrier_name || '-' }}</b><div class="small subtle">{{ row.carrier_phone || '' }}</div></td>
              <td>{{ row.vehicle_plate || '-' }}</td>
              <td>{{ row.departure_at ? formatDateTime(row.departure_at) : '-' }}</td>
              <td><span class="badge">{{ row.transport_status || 'Chờ xuất phát' }}</span></td>
              <td><div class="action-buttons"><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button><button class="btn-sm btn-view" @click="openPrint(row)">In tem</button><button v-if="canEdit" class="btn-sm" @click="openModal(row)">Sửa</button><button v-if="canDelete" class="btn-sm btn-delete" @click="remove(row)">Xóa</button></div></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="10" class="empty">Không có đơn vận chuyển nhà xe phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal v-if="showModal" :title="editing ? 'Sửa đơn vận chuyển nhà xe' : 'Tạo đơn vận chuyển nhà xe'" size="xl" :loading="saving" :save-label="editing ? 'Lưu thay đổi' : 'Tạo đơn vận chuyển'" @close="showModal=false" @save="save">
      <div class="form-grid">
        <div class="form-group full"><label>Yêu cầu xuất kho <span class="required">*</span></label><SearchableSelect v-model="form.source_request_id" :options="requestOptions" :disabled="Boolean(editing)" placeholder="Tìm mã yêu cầu, mã đơn hoặc khách hàng..." @change="chooseRequest" /></div>
        <div class="form-group"><label>Mã yêu cầu</label><input v-model="form.request_code" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Trạng thái yêu cầu</label><input :value="requestStatusLabel(form.request_status)" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Mã đơn hàng</label><input v-model="form.order_code" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Họ tên người nhận</label><input v-model="form.receiver_name" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Số điện thoại người nhận</label><input v-model="form.receiver_phone" class="input readonly-field" readonly /></div>
        <div class="form-group full"><label>Địa chỉ nhận</label><input v-model="form.receiver_address" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Tên nhà xe</label><input v-model="form.carrier_name" class="input" /></div>
        <div class="form-group"><label>Số điện thoại nhà xe</label><input v-model="form.carrier_phone" class="input" /></div>
        <div class="form-group"><label>Biển số xe</label><input v-model="form.vehicle_plate" class="input" /></div>
        <div class="form-group"><label>Tên chủ xe/Tài xế</label><input v-model="form.driver_name" class="input" /></div>
        <div class="form-group"><label>Giờ bắt đầu xuất phát</label><input v-model="form.departure_at" class="input" type="datetime-local" /></div>
        <div class="form-group"><label>Trạng thái vận chuyển</label><select v-model="form.transport_status" class="select"><option>Chờ xuất phát</option><option>Đã xuất phát</option><option>Đã hoàn thành</option></select></div>
        <div class="form-group full"><label>Ghi chú</label><textarea v-model="form.note" class="textarea" rows="3" /></div>
      </div>

      <template v-if="selectedRequest">
        <h3 style="margin-top:18px">Sản phẩm trong yêu cầu xuất kho</h3>
        <div class="table-wrap"><table style="min-width:760px"><thead><tr><th>Sản phẩm</th><th>Mã SP</th><th>Logo</th><th>Đơn vị</th><th>Số lượng</th></tr></thead><tbody><tr v-for="item in selectedRequestItems" :key="item.id"><td><b>{{ item.product_name || '-' }}</b></td><td>{{ item.product_code || '-' }}</td><td>{{ item.logo || '-' }}</td><td>{{ item.unit || '-' }}</td><td>{{ item.quantity }}</td></tr><tr v-if="!selectedRequestItems.length"><td colspan="5" class="empty">Yêu cầu chưa có sản phẩm.</td></tr></tbody></table></div>
      </template>
      <p class="small subtle" style="margin-top:12px">Họ tên, số điện thoại và địa chỉ lấy từ snapshot của yêu cầu xuất kho. Module nhà xe không đọc bảng khách hàng hoặc đơn hàng; cột số kiện trên tem luôn để trống.</p>
    </BaseModal>

    <BaseModal v-if="showDetailModal && selectedDetail" title="Chi tiết vận chuyển nhà xe" size="lg" :show-footer="false" @close="showDetailModal=false">
      <div class="detail-grid">
        <div class="detail-item"><label>Mã vận chuyển</label><strong>{{ selectedDetail.transport_code || selectedDetail.id }}</strong></div>
        <div class="detail-item"><label>Yêu cầu xuất</label><strong>{{ selectedDetail.request_code || selectedDetail.export_order_code || '-' }}</strong></div>
        <div class="detail-item"><label>Đơn hàng</label><strong>{{ selectedDetail.order_code || '-' }}</strong></div>
        <div class="detail-item"><label>Người nhận</label><strong>{{ selectedDetail.receiver_name || '-' }}</strong></div>
        <div class="detail-item"><label>SĐT người nhận</label><strong>{{ selectedDetail.receiver_phone || '-' }}</strong></div>
        <div class="detail-item"><label>Địa chỉ</label><strong>{{ selectedDetail.receiver_address || '-' }}</strong></div>
        <div class="detail-item"><label>Nhà xe</label><strong>{{ selectedDetail.carrier_name || '-' }}</strong></div>
        <div class="detail-item"><label>SĐT nhà xe</label><strong>{{ selectedDetail.carrier_phone || '-' }}</strong></div>
        <div class="detail-item"><label>Biển số</label><strong>{{ selectedDetail.vehicle_plate || '-' }}</strong></div>
        <div class="detail-item"><label>Chủ xe/Tài xế</label><strong>{{ selectedDetail.driver_name || '-' }}</strong></div>
        <div class="detail-item"><label>Giờ xuất phát</label><strong>{{ selectedDetail.departure_at ? formatDateTime(selectedDetail.departure_at) : '-' }}</strong></div>
        <div class="detail-item"><label>Trạng thái</label><strong>{{ selectedDetail.transport_status || '-' }}</strong></div>
      </div>
    </BaseModal>

    <ParcelLabelPrintModal v-if="selectedPrint" type="bus_carrier" :source-code="selectedPrint.request_code || selectedPrint.export_order_code || selectedPrint.id" :items="selectedPrintItems" :bus-transport="selectedPrint" :request="selectedPrintRequest" @close="selectedPrint=null; selectedPrintRequest=null; selectedPrintItems=[]" />
    <ConfirmModal v-bind="confirmState" @cancel="resolveConfirm(false)" @confirm="resolveConfirm(true)" />
  </AppShell>
</template>

<style scoped>
.filter-bar { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 12px; margin-bottom: 16px; }
.form-group.full { grid-column: 1 / -1; }
.required { color: #dc2626; }
@media (max-width: 700px) { .filter-bar { grid-template-columns: 1fr; } }
</style>
