<script setup lang="ts">
import { collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import type { BusTransportDoc, ExportOrderDoc, ExportOrderItemDoc } from '~/types/models'
import { formatDateTime, isActive, makeCode, makeId, normalizeText, safeJsonParse } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

const { db } = useFirebaseServices()
const { appUser, hasPermission } = useAuth()
const { showToast, withLoading } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()
const { invalidateScopedCache } = useRepo()

const rows = ref<BusTransportDoc[]>([])
const exportOrders = ref<ExportOrderDoc[]>([])
const exportItems = ref<ExportOrderItemDoc[]>([])
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const statusFilter = ref('')
const showModal = ref(false)
const showDetailModal = ref(false)
const editing = ref<BusTransportDoc | null>(null)
const selectedDetail = ref<BusTransportDoc | null>(null)
const selectedPrint = ref<BusTransportDoc | null>(null)
const selectedPrintOrder = ref<ExportOrderDoc | null>(null)
const selectedPrintItems = ref<ExportOrderItemDoc[]>([])
const form = reactive<any>({})

const canView = computed(() => hasPermission('*') || hasPermission('bus_transport.view'))
const canCreate = computed(() => hasPermission('*') || hasPermission('bus_transport.create'))
const canEdit = computed(() => hasPermission('*') || hasPermission('bus_transport.edit'))
const canDelete = computed(() => hasPermission('*') || hasPermission('bus_transport.delete'))

function codeOf(row: ExportOrderDoc | null | undefined) {
  return String(row?.code || row?.export_code || row?.id || '').trim()
}

function timestampValue(value: any) {
  if (value?.toMillis) return value.toMillis()
  const date = new Date(value || 0)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

const activeExportOrders = computed(() => exportOrders.value.filter(row => (
  isActive(row)
  && String(row.lifecycle_status || '') !== 'cancelled'
  && String(row.status || '') !== 'cancelled'
)))

const itemsByExportOrder = computed<Record<string, ExportOrderItemDoc[]>>(() => {
  return exportItems.value.reduce((map, item) => {
    if (!isActive(item) || !item.export_order_id) return map
    if (!map[item.export_order_id]) map[item.export_order_id] = []
    map[item.export_order_id].push(item)
    return map
  }, {} as Record<string, ExportOrderItemDoc[]>)
})

const usedExportOrderIds = computed(() => new Set(
  rows.value.filter(isActive).map(row => String(row.export_order_id || '')).filter(Boolean),
))

const exportOrderOptions = computed(() => activeExportOrders.value
  .filter(row => !usedExportOrderIds.value.has(row.id) || editing.value?.export_order_id === row.id)
  .map(row => ({
    value: row.id,
    label: `${codeOf(row)} - ${row.customer_name || row.destination_name || 'Chưa có khách hàng'}`,
    subLabel: `${row.source_order_code || 'Không có mã đơn'} · ${row.export_date || ''}`,
    search: `${codeOf(row)} ${row.source_order_code || ''} ${row.customer_name || ''} ${row.destination_name || ''}`,
  })))

const selectedExportOrder = computed(() => exportOrders.value.find(row => row.id === form.export_order_id) || null)
const selectedExportItems = computed(() => selectedExportOrder.value ? (itemsByExportOrder.value[selectedExportOrder.value.id] || []) : [])

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return rows.value.filter(row => {
    const text = normalizeText([
      row.transport_code,
      row.export_order_code,
      row.order_code,
      row.customer_name,
      row.receiver_name,
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

function chooseExportOrder() {
  const row = selectedExportOrder.value as any
  if (!row) return
  Object.assign(form, {
    export_order_code: codeOf(row),
    source_request_id: row.source_request_id || '',
    order_id: row.order_id || row.source_order_id || '',
    order_code: row.source_order_code || row.order_code || '',
    customer_name: row.customer_name || row.destination_name || '',
    receiver_name: form.receiver_name || row.receiver_name || row.customer_name || row.destination_name || '',
    receiver_phone: form.receiver_phone || row.receiver_phone || row.customer_phone || row.phone || '',
    receiver_address: form.receiver_address || row.receiver_address || row.destination_address || row.shipping_address || row.billing_address || '',
  })
}

function openModal(row?: BusTransportDoc) {
  if (row && !canEdit.value) return showToast('Bạn không có quyền sửa đơn vận chuyển nhà xe.', 'error')
  if (!row && !canCreate.value) return showToast('Bạn không có quyền tạo đơn vận chuyển nhà xe.', 'error')
  editing.value = row || null
  resetForm()
  if (row) {
    Object.assign(form, {
      ...row,
      carrier_name: row.carrier_name || '',
      carrier_phone: row.carrier_phone || '',
      vehicle_plate: row.vehicle_plate || '',
      driver_name: row.driver_name || '',
      departure_at: row.departure_at || '',
      receiver_name: row.receiver_name || '',
      receiver_phone: row.receiver_phone || '',
      receiver_address: row.receiver_address || '',
      transport_status: row.transport_status || 'Chờ xuất phát',
      note: row.note || '',
    })
  } else {
    Object.assign(form, {
      export_order_id: '',
      export_order_code: '',
      source_request_id: '',
      order_id: '',
      order_code: '',
      customer_name: '',
      receiver_name: '',
      receiver_phone: '',
      receiver_address: '',
      carrier_name: '',
      carrier_phone: '',
      vehicle_plate: '',
      driver_name: '',
      departure_at: '',
      transport_status: 'Chờ xuất phát',
      note: '',
    })
  }
  showModal.value = true
}

function activityPayload(action: string, code: string, before: any, after: any) {
  return {
    module: 'bus_transport_orders',
    action,
    item_code: code,
    item_name: `${after?.export_order_code || before?.export_order_code || ''} - ${after?.carrier_name || before?.carrier_name || ''}`,
    changed_by: appUser.value?.email || '',
    before_json: JSON.stringify(before || {}),
    after_json: JSON.stringify(after || {}),
    created_at: serverTimestamp(),
    active: true,
    deleted: false,
  }
}

async function save() {
  if (!form.export_order_id) return showToast('Vui lòng chọn phiếu xuất kho.', 'error')
  if (editing.value && !canEdit.value) return showToast('Bạn không có quyền sửa đơn vận chuyển.', 'error')
  if (!editing.value && !canCreate.value) return showToast('Bạn không có quyền tạo đơn vận chuyển.', 'error')

  const source = selectedExportOrder.value
  if (!source) return showToast('Không tìm thấy phiếu xuất kho đã chọn.', 'error')
  if (!editing.value && usedExportOrderIds.value.has(source.id)) {
    return showToast('Phiếu xuất kho này đã có đơn vận chuyển nhà xe đang hoạt động.', 'error')
  }

  saving.value = true
  await withLoading(async () => {
    chooseExportOrder()
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
        export_order_id: source.id,
        export_order_code: codeOf(source),
        source_request_id: (source as any).source_request_id || '',
        order_id: (source as any).order_id || (source as any).source_order_id || '',
        order_code: (source as any).source_order_code || (source as any).order_code || '',
        customer_name: (source as any).customer_name || (source as any).destination_name || '',
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
        items_json: JSON.stringify(selectedExportItems.value.map(item => ({
          id: item.id,
          export_order_id: item.export_order_id,
          product_id: item.product_id || '',
          product_code: item.product_code || '',
          product_name: item.product_name || '',
          logo: item.logo || item.target_logo || item.source_logo || '',
          quantity: item.quantity || 0,
          unit: item.unit || '',
          active: true,
          deleted: false,
        }))),
        status: 'active',
        active: true,
        deleted: false,
        created_by: nowEmail,
        created_at: serverTimestamp(),
        updated_by: nowEmail,
        updated_at: serverTimestamp(),
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
  const confirmed = await askConfirm({
    title: 'Xóa đơn vận chuyển nhà xe',
    message: `Bạn chắc chắn muốn xóa ${row.transport_code || row.id}?`,
    confirmLabel: 'Xóa đơn vận chuyển',
  })
  if (!confirmed) return

  await withLoading(async () => {
    const batch = writeBatch(db)
    const patch = {
      deleted: true,
      active: false,
      status: 'deleted',
      deleted_by: appUser.value?.email || '',
      deleted_at: serverTimestamp(),
      updated_by: appUser.value?.email || '',
      updated_at: serverTimestamp(),
    }
    batch.update(doc(db, 'bus_transport_orders', row.id), patch)
    batch.set(doc(collection(db, 'activity_logs')), activityPayload('delete', row.transport_code || row.id, row, patch))
    await batch.commit()
    invalidateScopedCache('bus_transport_orders')
    invalidateScopedCache('activity_logs')
    rows.value = rows.value.filter(item => item.id !== row.id)
    showToast('Đã xóa đơn vận chuyển nhà xe.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không xóa được đơn vận chuyển nhà xe.'), 'error'))
}

function openDetail(row: BusTransportDoc) {
  selectedDetail.value = row
  showDetailModal.value = true
}

function itemSnapshot(row: BusTransportDoc) {
  const value = safeJsonParse(row.items_json, [])
  return Array.isArray(value) ? value as ExportOrderItemDoc[] : []
}

function openPrint(row: BusTransportDoc) {
  const source = exportOrders.value.find(item => item.id === row.export_order_id)
  const items = itemsByExportOrder.value[row.export_order_id] || itemSnapshot(row)
  selectedPrint.value = row
  selectedPrintOrder.value = source || {
    id: row.export_order_id,
    code: row.export_order_code,
    export_code: row.export_order_code,
    source_request_id: row.source_request_id,
    source_order_code: row.order_code,
    customer_name: row.customer_name,
    destination_name: row.receiver_name,
    active: true,
    deleted: false,
    status: 'completed',
  }
  selectedPrintItems.value = items
}

async function loadRows(force = false) {
  if (!canView.value) return
  loading.value = true
  try {
    const [transportSnapshot, exportSnapshot, itemSnapshotRows] = await Promise.all([
      getDocs(collection(db, 'bus_transport_orders')),
      getDocs(collection(db, 'export_orders')),
      getDocs(collection(db, 'export_order_items')),
    ])
    rows.value = transportSnapshot.docs
      .map(item => ({ id: item.id, ...(item.data() || {}) } as BusTransportDoc))
      .filter(isActive)
      .sort((left, right) => timestampValue(right.updated_at || right.created_at) - timestampValue(left.updated_at || left.created_at))
    exportOrders.value = exportSnapshot.docs.map(item => ({ id: item.id, ...(item.data() || {}) } as ExportOrderDoc))
    exportItems.value = itemSnapshotRows.docs.map(item => ({ id: item.id, ...(item.data() || {}) } as ExportOrderItemDoc))
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
    <PageHeader title="Vận chuyển nhà xe" subtitle="Tạo và quản lý đơn vận chuyển từ các phiếu xuất kho đã phát hành">
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
        <input v-model="search" class="input" placeholder="Tìm mã vận chuyển, phiếu xuất, nhà xe, biển số..." />
        <select v-model="statusFilter" class="select">
          <option value="">Tất cả trạng thái</option>
          <option>Chờ xuất phát</option>
          <option>Đã xuất phát</option>
          <option>Đã hoàn thành</option>
        </select>
      </div>

      <LoadingState v-if="loading" />
      <div v-else-if="!canView" class="empty">Bạn không có quyền xem vận chuyển nhà xe.</div>
      <div v-else class="table-wrap">
        <table style="min-width:1180px">
          <thead><tr><th>Mã vận chuyển</th><th>Phiếu xuất</th><th>Đơn hàng</th><th>Khách hàng</th><th>Nhà xe</th><th>Biển số</th><th>Giờ xuất phát</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ row.transport_code || row.id }}</b></td>
              <td>{{ row.export_order_code || '-' }}</td>
              <td>{{ row.order_code || '-' }}</td>
              <td>{{ row.customer_name || row.receiver_name || '-' }}</td>
              <td><b>{{ row.carrier_name || '-' }}</b><div class="small subtle">{{ row.carrier_phone || '' }}</div></td>
              <td>{{ row.vehicle_plate || '-' }}</td>
              <td>{{ row.departure_at ? formatDateTime(row.departure_at) : '-' }}</td>
              <td><span class="badge">{{ row.transport_status || 'Chờ xuất phát' }}</span></td>
              <td>
                <div class="action-buttons">
                  <button class="btn-sm btn-view" @click="openDetail(row)">Xem</button>
                  <button class="btn-sm btn-view" @click="openPrint(row)">In tem</button>
                  <button v-if="canEdit" class="btn-sm" @click="openModal(row)">Sửa</button>
                  <button v-if="canDelete" class="btn-sm btn-delete" @click="remove(row)">Xóa</button>
                </div>
              </td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="9" class="empty">Không có đơn vận chuyển nhà xe phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal v-if="showModal" :title="editing ? 'Sửa đơn vận chuyển nhà xe' : 'Tạo đơn vận chuyển nhà xe'" size="xl" :loading="saving" :save-label="editing ? 'Lưu thay đổi' : 'Tạo đơn vận chuyển'" @close="showModal=false" @save="save">
      <div class="form-grid">
        <div class="form-group full">
          <label>Phiếu xuất kho <span class="required">*</span></label>
          <SearchableSelect v-model="form.export_order_id" :options="exportOrderOptions" :disabled="Boolean(editing)" placeholder="Tìm mã phiếu xuất, mã đơn hoặc khách hàng..." @change="chooseExportOrder" />
        </div>
        <div class="form-group"><label>Mã phiếu xuất</label><input v-model="form.export_order_code" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Mã đơn hàng</label><input v-model="form.order_code" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Người nhận</label><input v-model="form.receiver_name" class="input" /></div>
        <div class="form-group"><label>Số điện thoại người nhận</label><input v-model="form.receiver_phone" class="input" /></div>
        <div class="form-group full"><label>Địa chỉ nhận</label><input v-model="form.receiver_address" class="input" /></div>
        <div class="form-group"><label>Tên nhà xe</label><input v-model="form.carrier_name" class="input" /></div>
        <div class="form-group"><label>Số điện thoại nhà xe</label><input v-model="form.carrier_phone" class="input" /></div>
        <div class="form-group"><label>Biển số xe</label><input v-model="form.vehicle_plate" class="input" /></div>
        <div class="form-group"><label>Tên chủ xe/Tài xế</label><input v-model="form.driver_name" class="input" /></div>
        <div class="form-group"><label>Giờ bắt đầu xuất phát</label><input v-model="form.departure_at" class="input" type="datetime-local" /></div>
        <div class="form-group"><label>Trạng thái</label><select v-model="form.transport_status" class="select"><option>Chờ xuất phát</option><option>Đã xuất phát</option><option>Đã hoàn thành</option></select></div>
        <div class="form-group full"><label>Ghi chú</label><textarea v-model="form.note" class="textarea" rows="3" /></div>
      </div>

      <template v-if="selectedExportOrder">
        <h3 style="margin-top:18px">Sản phẩm trong phiếu xuất kho</h3>
        <div class="table-wrap">
          <table style="min-width:760px">
            <thead><tr><th>Sản phẩm</th><th>Mã SP</th><th>Logo</th><th>Đơn vị</th><th>Số lượng xuất</th></tr></thead>
            <tbody>
              <tr v-for="item in selectedExportItems" :key="item.id">
                <td><b>{{ item.product_name || '-' }}</b></td>
                <td>{{ item.product_code || '-' }}</td>
                <td>{{ item.logo || item.target_logo || item.source_logo || '-' }}</td>
                <td>{{ item.unit || '-' }}</td>
                <td>{{ item.quantity }}</td>
              </tr>
              <tr v-if="!selectedExportItems.length"><td colspan="5" class="empty">Phiếu xuất chưa có sản phẩm.</td></tr>
            </tbody>
          </table>
        </div>
      </template>

      <p class="small subtle" style="margin-top:12px">Các thông tin nhà xe đều không bắt buộc. Tên hàng hóa và logo được lấy nguyên từ phiếu xuất kho; cột số kiện trên tem in luôn để trống.</p>
    </BaseModal>

    <BaseModal v-if="showDetailModal && selectedDetail" title="Chi tiết vận chuyển nhà xe" size="lg" :show-footer="false" @close="showDetailModal=false">
      <div class="detail-grid">
        <div class="detail-item"><label>Mã vận chuyển</label><strong>{{ selectedDetail.transport_code || selectedDetail.id }}</strong></div>
        <div class="detail-item"><label>Phiếu xuất kho</label><strong>{{ selectedDetail.export_order_code || '-' }}</strong></div>
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
        <div class="detail-item"><label>Ghi chú</label><strong>{{ selectedDetail.note || '-' }}</strong></div>
      </div>
    </BaseModal>

    <ParcelLabelPrintModal
      v-if="selectedPrint && selectedPrintOrder"
      type="bus_carrier"
      :export-order="selectedPrintOrder"
      :items="selectedPrintItems"
      :bus-transport="selectedPrint"
      @close="selectedPrint=null; selectedPrintOrder=null; selectedPrintItems=[]"
    />

    <ConfirmModal v-bind="confirmState" @cancel="resolveConfirm(false)" @confirm="resolveConfirm(true)" />
  </AppShell>
</template>

<style scoped>
.filter-bar { display: grid; grid-template-columns: minmax(0, 1fr) 220px; gap: 12px; margin-bottom: 16px; }
.form-group.full { grid-column: 1 / -1; }
.required { color: #dc2626; }
@media (max-width: 700px) {
  .filter-bar { grid-template-columns: 1fr; }
}
</style>
