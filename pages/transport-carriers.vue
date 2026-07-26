<script setup lang="ts">
import { collection, doc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import type { TransportCarrierDoc } from '~/types/models'
import { formatDateTime, isActive, makeCode, makeId, normalizeText } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

const { db } = useFirebaseServices()
const { appUser, hasPermission } = useAuth()
const { showToast, withLoading } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()
const { invalidateScopedCache } = useRepo()
const { options: provinceOptions, loadProvinces, provinceNames } = useVietnamProvinces()

const rows = ref<TransportCarrierDoc[]>([])
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const showModal = ref(false)
const showDetailModal = ref(false)
const editing = ref<TransportCarrierDoc | null>(null)
const selectedDetail = ref<TransportCarrierDoc | null>(null)
const form = reactive<any>({})

const canView = computed(() => hasPermission('*') || hasPermission('transport_carriers.view'))
const canCreate = computed(() => hasPermission('*') || hasPermission('transport_carriers.create'))
const canEdit = computed(() => hasPermission('*') || hasPermission('transport_carriers.edit'))
const canDelete = computed(() => hasPermission('*') || hasPermission('transport_carriers.delete'))

function normalizeProvinceCodes(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map(code => Number(code))
    .filter(code => Number.isInteger(code) && code > 0)))
    .sort((left, right) => left - right)
}

function carrierProvinceNames(row: Partial<TransportCarrierDoc> | null | undefined) {
  const namesByCode = provinceNames(normalizeProvinceCodes(row?.service_province_codes))
  if (namesByCode.length) return namesByCode
  return Array.isArray(row?.service_province_names)
    ? Array.from(new Set(row.service_province_names.map(name => String(name || '').trim()).filter(Boolean)))
    : []
}

function normalizedCarrier(id: string, data: Record<string, any>) {
  return {
    id,
    ...data,
    carrier_address: String(data.carrier_address || ''),
    service_province_codes: normalizeProvinceCodes(data.service_province_codes),
    service_province_names: Array.isArray(data.service_province_names)
      ? data.service_province_names.map((name: any) => String(name || '').trim()).filter(Boolean)
      : [],
  } as TransportCarrierDoc
}

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  if (!keyword) return rows.value
  return rows.value.filter(row => normalizeText([
    row.carrier_code,
    row.carrier_name,
    row.carrier_phone,
    row.carrier_address,
    row.driver_name,
    carrierProvinceNames(row).join(' '),
    row.note,
  ].join(' ')).includes(keyword))
})

function resetForm(row?: TransportCarrierDoc) {
  Object.keys(form).forEach(key => delete form[key])
  Object.assign(form, {
    carrier_name: row?.carrier_name || '',
    carrier_phone: row?.carrier_phone || '',
    carrier_address: row?.carrier_address || '',
    service_province_codes: normalizeProvinceCodes(row?.service_province_codes),
    driver_name: row?.driver_name || '',
    note: row?.note || '',
  })
}

function openModal(row?: TransportCarrierDoc) {
  if (row && !canEdit.value) return showToast('Bạn không có quyền sửa nhà xe.', 'error')
  if (!row && !canCreate.value) return showToast('Bạn không có quyền thêm nhà xe.', 'error')
  editing.value = row || null
  resetForm(row)
  showModal.value = true
}

function openDetail(row: TransportCarrierDoc) {
  selectedDetail.value = row
  showDetailModal.value = true
}

async function save() {
  const name = String(form.carrier_name || '').trim()
  const phone = String(form.carrier_phone || '').trim()
  const address = String(form.carrier_address || '').trim()
  const driver = String(form.driver_name || '').trim()
  const serviceProvinceCodes = normalizeProvinceCodes(form.service_province_codes)
  const serviceProvinceNames = provinceNames(serviceProvinceCodes)

  if (!name) return showToast('Vui lòng nhập tên nhà xe.', 'error')
  if (!address) return showToast('Vui lòng nhập địa chỉ nhà xe.', 'error')
  if (!serviceProvinceCodes.length) return showToast('Vui lòng chọn ít nhất một tỉnh thành nhà xe phục vụ.', 'error')
  if (serviceProvinceNames.length !== serviceProvinceCodes.length) {
    return showToast('Danh sách tỉnh thành chưa sẵn sàng. Vui lòng tải lại trang.', 'error')
  }

  saving.value = true
  await withLoading(async () => {
    const actor = appUser.value?.email || ''
    const payload = {
      carrier_name: name,
      carrier_phone: phone,
      carrier_address: address,
      service_province_codes: serviceProvinceCodes,
      service_province_names: serviceProvinceNames,
      driver_name: driver,
      note: String(form.note || '').trim(),
      updated_by: actor,
      updated_at: serverTimestamp(),
    }

    if (editing.value) {
      await updateDoc(doc(db, 'transport_carriers', editing.value.id), payload)
      showToast('Đã cập nhật nhà xe.', 'success')
    } else {
      const id = makeId('carrier')
      await setDoc(doc(db, 'transport_carriers', id), {
        id,
        carrier_code: makeCode('NX'),
        ...payload,
        status: 'active',
        active: true,
        deleted: false,
        created_by: actor,
        created_at: serverTimestamp(),
        source: 'nuxt',
      })
      showToast('Đã thêm nhà xe.', 'success')
    }
    invalidateScopedCache('transport_carriers')
    showModal.value = false
    await loadRows()
  }).catch(error => showToast(reportFirebaseError(error, 'Không lưu được nhà xe.'), 'error'))
    .finally(() => { saving.value = false })
}

async function remove(row: TransportCarrierDoc) {
  if (!canDelete.value) return showToast('Bạn không có quyền xóa nhà xe.', 'error')
  const confirmed = await askConfirm({
    title: 'Xóa nhà xe',
    message: `Bạn chắc chắn muốn xóa ${row.carrier_name || row.id}? Dữ liệu vận chuyển cũ vẫn giữ snapshot nhà xe.`,
    confirmLabel: 'Xóa nhà xe',
  })
  if (!confirmed) return
  const actor = appUser.value?.email || ''
  await withLoading(async () => {
    await updateDoc(doc(db, 'transport_carriers', row.id), {
      deleted: true,
      active: false,
      status: 'deleted',
      deleted_by: actor,
      deleted_at: serverTimestamp(),
      updated_by: actor,
      updated_at: serverTimestamp(),
    })
    rows.value = rows.value.filter(item => item.id !== row.id)
    invalidateScopedCache('transport_carriers')
    showToast('Đã xóa nhà xe.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không xóa được nhà xe.'), 'error'))
}

async function loadRows(force = false) {
  if (!canView.value) return
  loading.value = true
  try {
    const snapshot = await getDocs(collection(db, 'transport_carriers'))
    rows.value = snapshot.docs
      .map(item => normalizedCarrier(item.id, item.data() || {}))
      .filter(isActive)
      .sort((left, right) => String(left.carrier_name || '').localeCompare(String(right.carrier_name || ''), 'vi'))
    if (force) showToast('Đã làm mới danh sách nhà xe.', 'success')
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được danh sách nhà xe.'), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void loadProvinces()
  void loadRows()
})
</script>

<template>
  <AppShell>
    <PageHeader title="Danh sách nhà xe" subtitle="Quản lý địa chỉ và các tỉnh thành nhà xe phục vụ">
      <button class="btn" @click="loadRows(true)">Làm mới</button>
      <button v-if="canCreate" class="btn primary" @click="openModal()">+ Thêm nhà xe</button>
    </PageHeader>

    <div class="card" style="margin:24px">
      <div class="filter-bar">
        <input v-model="search" class="input" placeholder="Tìm tên, số điện thoại, địa chỉ, tỉnh thành, tài xế..." />
        <span class="small subtle">{{ filtered.length.toLocaleString('vi-VN') }} nhà xe</span>
      </div>

      <LoadingState v-if="loading" />
      <div v-else-if="!canView" class="empty">Bạn không có quyền xem danh sách nhà xe.</div>
      <div v-else class="table-wrap">
        <table style="min-width:1320px">
          <thead><tr><th>Mã</th><th>Tên nhà xe</th><th>Số điện thoại</th><th>Địa chỉ nhà xe</th><th>Tỉnh thành phục vụ</th><th>Chủ xe/Tài xế</th><th>Cập nhật</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ row.carrier_code || '-' }}</b></td>
              <td>{{ row.carrier_name || '-' }}</td>
              <td>{{ row.carrier_phone || '-' }}</td>
              <td class="address-cell">{{ row.carrier_address || 'Chưa thiết lập' }}</td>
              <td>
                <div v-if="carrierProvinceNames(row).length" class="province-chips table-provinces">
                  <span v-for="name in carrierProvinceNames(row).slice(0, 3)" :key="name" class="province-chip">{{ name }}</span>
                  <span v-if="carrierProvinceNames(row).length > 3" class="province-chip more">+{{ carrierProvinceNames(row).length - 3 }}</span>
                </div>
                <span v-else class="small subtle">Chưa thiết lập</span>
              </td>
              <td>{{ row.driver_name || '-' }}</td>
              <td>{{ row.updated_at ? formatDateTime(row.updated_at) : '-' }}</td>
              <td><div class="action-buttons"><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button><button v-if="canEdit" class="btn-sm" @click="openModal(row)">Sửa</button><button v-if="canDelete" class="btn-sm btn-delete" @click="remove(row)">Xóa</button></div></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="8" class="empty">Chưa có nhà xe phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal v-if="showModal" :title="editing ? 'Sửa nhà xe' : 'Thêm nhà xe'" size="lg" :loading="saving" :save-label="editing ? 'Lưu thay đổi' : 'Thêm nhà xe'" @close="showModal=false" @save="save">
      <div class="form-grid">
        <div class="form-group full"><label>Tên nhà xe <span class="required">*</span></label><input v-model="form.carrier_name" class="input" /></div>
        <div class="form-group"><label>Số điện thoại nhà xe</label><input v-model="form.carrier_phone" class="input" /></div>
        <div class="form-group"><label>Tên chủ xe/Tài xế</label><input v-model="form.driver_name" class="input" /></div>
        <div class="form-group full"><label>Địa chỉ nhà xe <span class="required">*</span></label><input v-model="form.carrier_address" class="input" placeholder="Nhập địa chỉ văn phòng, bến hoặc điểm nhận hàng" /></div>
        <div class="form-group full"><label>Tỉnh thành phục vụ <span class="required">*</span></label><SearchableMultiSelect v-model="form.service_province_codes" :options="provinceOptions" placeholder="Tìm và chọn nhiều tỉnh thành..." search-placeholder="Tìm tỉnh thành không dấu..." /></div>
        <div class="form-group full"><label>Ghi chú</label><textarea v-model="form.note" class="textarea" rows="3" /></div>
      </div>
    </BaseModal>

    <BaseModal v-if="showDetailModal && selectedDetail" title="Chi tiết nhà xe" size="lg" :show-footer="false" @close="showDetailModal=false">
      <div class="detail-grid">
        <div class="detail-item"><label>Mã nhà xe</label><strong>{{ selectedDetail.carrier_code || '-' }}</strong></div>
        <div class="detail-item"><label>Tên nhà xe</label><strong>{{ selectedDetail.carrier_name || '-' }}</strong></div>
        <div class="detail-item"><label>Số điện thoại</label><strong>{{ selectedDetail.carrier_phone || '-' }}</strong></div>
        <div class="detail-item"><label>Chủ xe/Tài xế</label><strong>{{ selectedDetail.driver_name || '-' }}</strong></div>
        <div class="detail-item full-detail"><label>Địa chỉ nhà xe</label><strong>{{ selectedDetail.carrier_address || '-' }}</strong></div>
        <div class="detail-item full-detail"><label>Tỉnh thành phục vụ</label><div v-if="carrierProvinceNames(selectedDetail).length" class="province-chips"><span v-for="name in carrierProvinceNames(selectedDetail)" :key="name" class="province-chip">{{ name }}</span></div><strong v-else>-</strong></div>
        <div class="detail-item full-detail"><label>Ghi chú</label><strong>{{ selectedDetail.note || '-' }}</strong></div>
      </div>
    </BaseModal>

    <ConfirmModal v-bind="confirmState" @cancel="resolveConfirm(false)" @confirm="resolveConfirm(true)" />
  </AppShell>
</template>

<style scoped>
.filter-bar { display:flex; align-items:center; gap:12px; justify-content:space-between; margin-bottom:16px; }
.filter-bar .input { max-width:720px; }
.form-group.full { grid-column:1 / -1; }
.required { color:#dc2626; }
.address-cell { min-width:240px; max-width:340px; white-space:normal; }
.province-chips { display:flex; flex-wrap:wrap; gap:6px; }
.province-chip { display:inline-flex; align-items:center; padding:4px 8px; border:1px solid #bfdbfe; border-radius:999px; background:#eff6ff; color:#1d4ed8; font-size:12px; line-height:1.25; }
.province-chip.more { border-color:#cbd5e1; background:#f8fafc; color:#475569; }
.table-provinces { min-width:260px; max-width:380px; }
.full-detail { grid-column:1 / -1; }
@media (max-width:700px) { .filter-bar { align-items:stretch; flex-direction:column; } .filter-bar .input { max-width:none; } }
</style>
