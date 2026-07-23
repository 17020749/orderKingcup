<script setup lang="ts">
import type { CustomerDoc } from '~/types/models'
import { makeId, normalizeText } from '~/utils/format'
import { reportFirebaseError, reportPermissionError } from '~/utils/firebaseErrors'
import { matchesKeyword, uniqueOptions } from '~/utils/listFilters'
import { generateCustomerCode } from '~/utils/customerCode'

const { softDeleteDoc, listDocs, q } = useRepo()
const { saveCustomer: saveManagedCustomer } = useCustomerManagement()
const { appUser, hasPermission, isAdmin } = useAuth()
const { showToast } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const statusFilter = ref('')
const sourceFilter = ref('')
const rows = ref<CustomerDoc[]>([])
const showModal = ref(false)
const showDetailModal = ref(false)
const selectedDetail = ref<CustomerDoc | null>(null)
const editing = ref<CustomerDoc | null>(null)
const form = reactive<any>({})

const sourceOptions = computed(() => uniqueOptions(rows.value, 'source'))
const filterValues = computed(() => ({ status: statusFilter.value, source: sourceFilter.value }))
const toolbarFilters = computed(() => [
  { key: 'status', label: 'Trạng thái', allLabel: 'Tất cả trạng thái', width: '180px', options: [
    { label: 'Hoạt động', value: 'active' },
    { label: 'Không hoạt động', value: 'inactive' },
  ] },
  { key: 'source', label: 'Nguồn khách hàng', allLabel: 'Tất cả nguồn khách', width: '220px', options: sourceOptions.value.map(source => ({ label: source, value: normalizeText(source) })) },
])

function updateFilter(key: string, value: string) {
  if (key === 'status') statusFilter.value = value
  if (key === 'source') sourceFilter.value = value
}

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return rows.value.filter(row => {
    const matchedText = matchesKeyword([row.customer_code, row.customer_name, row.company_name, row.phone, row.email, customerStatusLabel(row.status), row.source], keyword)
    const matchedStatus = !statusFilter.value || String(row.status || 'active').trim().toLowerCase() === statusFilter.value
    const matchedSource = !sourceFilter.value || normalizeText(row.source) === sourceFilter.value
    return matchedText && matchedStatus && matchedSource
  })
})
const selectedDetailDisplay = computed(() => selectedDetail.value ? {
  ...selectedDetail.value,
  status: customerStatusLabel(selectedDetail.value.status)
} : null)

function resetFilters() {
  search.value = ''
  statusFilter.value = ''
  sourceFilter.value = ''
}

function customerStatusLabel(value: any) {
  const status = String(value || 'active').trim().toLowerCase()
  if (status === 'inactive') return 'Không hoạt động'
  if (status === 'active') return 'Hoạt động'
  return String(value || 'Hoạt động')
}

function customerStatusClass(value: any) {
  return String(value || 'active').trim().toLowerCase() === 'inactive' ? 'red' : 'green'
}

function isCustomerNotDeleted(row: any) {
  if (!row || row.deleted === true) return false
  const status = normalizeText(row.status)
  return !['deleted', 'da xoa'].includes(status)
}

function isOwnCustomer(row: CustomerDoc) {
  const actor = String(appUser.value?.email || '').trim().toLowerCase()
  return Boolean(actor && String(row?.created_by || '').trim().toLowerCase() === actor)
}

function canManageCustomer(row: CustomerDoc, actionPermission: string) {
  return hasPermission(actionPermission)
    && (isOwnCustomer(row) || hasPermission('customers.view_all'))
}

async function loadRows(force = false) {
  loading.value = true
  try {
    const currentEmail = String(appUser.value?.email || '').trim().toLowerCase()
    const constraints = isAdmin.value || hasPermission('customers.view_all')
      ? []
      : currentEmail
        ? [q.where('created_by', '==', currentEmail)]
        : []

    // Trang quản lý khách hàng phải hiển thị cả active và inactive. Chỉ loại
    // bản ghi đã xóa mềm; giá trị status trong Firestore vẫn giữ nguyên.
    rows.value = (await listDocs('customers', constraints) as CustomerDoc[])
      .filter(isCustomerNotDeleted)
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được khách hàng.', {
      module: 'customers',
      operation: 'list',
      actionPermission: 'customers.view',
      scopePermission: 'customers.view_all',
    }), 'error')
  }
  finally { loading.value = false }
}
function openDetail(row: CustomerDoc) {
  selectedDetail.value = row
  showDetailModal.value = true
}

async function openCustomerOrders(row: CustomerDoc) {
  if (!hasPermission('customers.orders_view')) {
    showToast(reportPermissionError({
      module: 'customers',
      operation: 'view_customer_orders',
      record: row.id,
      missingPermissions: ['customers.orders_view'],
    }), 'error')
    return
  }
  await navigateTo(`/customers/${encodeURIComponent(row.id)}`)
}

function openModal(row?: CustomerDoc) {
  if (row && !canManageCustomer(row, 'customers.edit')) {
    showToast(reportPermissionError({
      module: 'customers',
      operation: 'edit',
      record: row.id,
      actionPermission: 'customers.edit',
      scopePermission: 'customers.view_all',
      missingPermissions: hasPermission('customers.edit') ? ['customers.view_all'] : ['customers.edit'],
    }), 'error')
    return
  }
  if (!row && !hasPermission('customers.create')) {
    showToast(reportPermissionError({
      module: 'customers',
      operation: 'create',
      missingPermissions: ['customers.create'],
    }), 'error')
    return
  }
  editing.value = row || null
  Object.keys(form).forEach(key => delete form[key])
  Object.assign(form, row
    ? { ...row, customer_code: row.customer_code || generateCustomerCode() }
    : { id: makeId('cus'), customer_code: generateCustomerCode(), customer_name: '', company_name: '', phone: '', email: '', tax_code: '', billing_address: '', shipping_address: '', source: '', note: '', status: 'active' })
  showModal.value = true
}
async function saveCustomer() {
  const requiredPermission = editing.value ? 'customers.edit' : 'customers.create'
  if (
    (editing.value && !canManageCustomer(editing.value, requiredPermission))
    || (!editing.value && !hasPermission(requiredPermission))
  ) {
    showToast(reportPermissionError({
      module: 'customers',
      operation: editing.value ? 'edit' : 'create',
      record: editing.value?.id || form.id,
      actionPermission: requiredPermission,
      scopePermission: editing.value ? 'customers.view_all' : undefined,
      missingPermissions: editing.value && hasPermission(requiredPermission)
        ? ['customers.view_all']
        : [requiredPermission],
    }), 'error')
    return
  }
  if (!form.customer_name) return showToast('Thiếu tên khách hàng', 'error')
  saving.value = true
  try {
    const record = await saveManagedCustomer({
      ...form,
      customer_name_norm: normalizeText(form.customer_name),
      phone_norm: normalizeText(form.phone).replace(/\s/g, '')
    }, editing.value)
    const index = rows.value.findIndex(r => r.id === record.id)
    if (index >= 0) rows.value[index] = { ...rows.value[index], ...record } as CustomerDoc
    else rows.value.unshift(record as CustomerDoc)
    showModal.value = false
    showToast(editing.value ? 'Đã cập nhật khách hàng' : 'Đã thêm khách hàng', 'success')
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không lưu được khách hàng.', {
      module: 'customers',
      operation: editing.value ? 'edit' : 'create',
      record: editing.value?.id || form.id,
      actionPermission: editing.value ? 'customers.edit' : 'customers.create',
      scopePermission: editing.value ? 'customers.view_all' : undefined,
    }), 'error')
  }
  finally { saving.value = false }
}
async function removeCustomer(row: CustomerDoc) {
  if (!canManageCustomer(row, 'customers.delete')) {
    showToast(reportPermissionError({
      module: 'customers',
      operation: 'delete',
      record: row.id,
      actionPermission: 'customers.delete',
      scopePermission: 'customers.view_all',
      missingPermissions: hasPermission('customers.delete') ? ['customers.view_all'] : ['customers.delete'],
    }), 'error')
    return
  }
  const confirmed = await askConfirm({
    title: 'Xóa khách hàng',
    message: `Bạn chắc chắn muốn xóa khách hàng ${row.customer_name}?`,
    confirmLabel: 'Xóa khách hàng'
  })
  if (!confirmed) return
  try {
    await softDeleteDoc('customers', row.id)
    rows.value = rows.value.filter(r => r.id !== row.id)
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không xóa được khách hàng.', {
      module: 'customers',
      operation: 'delete',
      record: row.id,
      actionPermission: 'customers.delete',
      scopePermission: 'customers.view_all',
    }), 'error')
  }
}
onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Khách hàng" subtitle="Quản lý thông tin khách hàng">
      <button v-if="hasPermission('customers.create')" class="btn primary" @click="openModal()">+ Thêm khách hàng</button>
    </PageHeader>
    <div class="card" style="margin: 24px;">
      <FilterToolbar
        v-model:search="search"
        search-placeholder="Tìm khách hàng, SĐT, email, trạng thái, nguồn..."
        :filters="toolbarFilters"
        :values="filterValues"
        :result-count="filtered.length"
        :loading="loading"
        show-refresh
        @update:filter="updateFilter"
        @reset="resetFilters"
        @refresh="loadRows(true)"
      />
      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Mã</th><th>Tên khách</th><th>Công ty</th><th>SĐT</th><th>Email</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr
              v-for="row in filtered"
              :key="row.id"
              :class="{ 'clickable-row': hasPermission('customers.orders_view') }"
              @click="openCustomerOrders(row)"
            >
              <td>{{ row.customer_code || row.id }}</td><td><b>{{ row.customer_name }}</b></td><td>{{ row.company_name }}</td><td>{{ row.phone }}</td><td>{{ row.email }}</td>
              <td><span class="badge" :class="customerStatusClass(row.status)">{{ customerStatusLabel(row.status) }}</span></td>
              <td class="row" @click.stop>
                <button class="btn" @click="openDetail(row)">Chi tiết</button>
                <button v-if="hasPermission('customers.orders_view')" class="btn" @click="openCustomerOrders(row)">Đơn hàng</button>
                <button v-if="canManageCustomer(row, 'customers.edit')" class="btn" @click="openModal(row)">Sửa</button>
                <button v-if="canManageCustomer(row, 'customers.delete')" class="btn danger" @click="removeCustomer(row)">Xóa</button>
              </td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="7" class="empty">Không có khách hàng phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <BaseModal v-if="showModal" :title="editing ? 'Sửa khách hàng' : 'Thêm khách hàng'" :loading="saving" @close="showModal=false" @save="saveCustomer">
      <div class="form-grid">
        <div class="form-group">
          <label>Mã khách (tự động)</label>
          <input v-model="form.customer_code" class="input readonly-field" readonly />
          <div class="small subtle">Gồm 3 chữ cái in hoa và 3 chữ số; không thể nhập hoặc đổi thủ công.</div>
        </div>
        <div class="form-group"><label>Tên khách *</label><input v-model="form.customer_name" class="input" /></div>
        <div class="form-group"><label>Công ty</label><input v-model="form.company_name" class="input" /></div>
        <div class="form-group"><label>SĐT</label><input v-model="form.phone" class="input" /></div>
        <div class="form-group"><label>Email</label><input v-model="form.email" class="input" /></div>
        <div class="form-group"><label>Mã số thuế</label><input v-model="form.tax_code" class="input" /></div>
        <div class="form-group"><label>Địa chỉ hóa đơn</label><input v-model="form.billing_address" class="input" /></div>
        <div class="form-group"><label>Địa chỉ giao hàng</label><input v-model="form.shipping_address" class="input" /></div>
        <div class="form-group"><label>Nguồn</label><input v-model="form.source" class="input" /></div>
        <div class="form-group"><label>Trạng thái</label><select v-model="form.status" class="select"><option value="active">Hoạt động</option><option value="inactive">Không hoạt động</option></select></div>
      </div>
      <div class="form-group" style="margin-top:12px"><label>Ghi chú</label><textarea v-model="form.note" class="textarea" rows="3" /></div>
    </BaseModal>

    <RecordDetailModal
      v-if="showDetailModal && selectedDetailDisplay"
      title="Chi tiết khách hàng"
      :record="selectedDetailDisplay"
      :field-order="['id','customer_code','customer_name','company_name','phone','email','tax_code','billing_address','shipping_address','source','note','created_by','created_at','updated_at','status','active','deleted']"
      @close="showDetailModal = false"
    />

    <ConfirmModal
      v-bind="confirmState"
      @cancel="resolveConfirm(false)"
      @confirm="resolveConfirm(true)"
    />
  </AppShell>
</template>
