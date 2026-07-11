<script setup lang="ts">
import type { CustomerDoc } from '~/types/models'
import { isActive, makeId, normalizeText } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

const { saveDoc, softDeleteDoc } = useRepo()
const { loadScopedCustomers } = useScopedQueries()
const { hasPermission } = useAuth()
const { showToast } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const rows = ref<CustomerDoc[]>([])
const showModal = ref(false)
const showDetailModal = ref(false)
const selectedDetail = ref<CustomerDoc | null>(null)
const editing = ref<CustomerDoc | null>(null)
const form = reactive<any>({})

const filtered = computed(() => rows.value.filter(r => normalizeText(`${r.customer_code} ${r.customer_name} ${r.company_name} ${r.phone} ${r.email}`).includes(normalizeText(search.value))))

async function loadRows(force = false) {
  loading.value = true
  try {
    rows.value = (await loadScopedCustomers(force)).filter(isActive)
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
  } catch (error) { showToast(reportFirebaseError(error, 'Không tải được khách hàng.'), 'error') }
  finally { loading.value = false }
}
function openDetail(row: CustomerDoc) {
  selectedDetail.value = row
  showDetailModal.value = true
}

function openModal(row?: CustomerDoc) {
  editing.value = row || null
  Object.assign(form, row ? { ...row } : { id: makeId('cus'), customer_code: '', customer_name: '', company_name: '', phone: '', email: '', tax_code: '', billing_address: '', shipping_address: '', source: '', note: '', status: 'active' })
  showModal.value = true
}
async function saveCustomer() {
  if (!form.customer_name) return alert('Thiếu tên khách hàng')
  saving.value = true
  try {
    const record = await saveDoc('customers', {
      ...form,
      customer_name_norm: normalizeText(form.customer_name),
      phone_norm: normalizeText(form.phone).replace(/\s/g, '')
    }, form.id)
    const index = rows.value.findIndex(r => r.id === record.id)
    if (index >= 0) rows.value[index] = { ...rows.value[index], ...record } as CustomerDoc
    else rows.value.unshift(record as CustomerDoc)
    showModal.value = false
  } catch (error) { showToast(reportFirebaseError(error, 'Không lưu được khách hàng.'), 'error') }
  finally { saving.value = false }
}
async function removeCustomer(row: CustomerDoc) {
  const confirmed = await askConfirm({
    title: 'Xóa khách hàng',
    message: `Bạn chắc chắn muốn xóa khách hàng ${row.customer_name}?`,
    confirmLabel: 'Xóa khách hàng'
  })
  if (!confirmed) return
  try {
    await softDeleteDoc('customers', row.id)
    rows.value = rows.value.filter(r => r.id !== row.id)
  } catch (error) { showToast(reportFirebaseError(error, 'Không xóa được khách hàng.'), 'error') }
}
onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Khách hàng" subtitle="Dữ liệu từ Firestore collection customers">
      <button v-if="hasPermission('customers.create')" class="btn primary" @click="openModal()">+ Thêm khách hàng</button>
    </PageHeader>
    <div class="card">
      <div class="toolbar">
        <input v-model="search" class="input" style="max-width:420px" placeholder="Tìm khách hàng, SĐT, email..." />
        <button class="btn" @click="loadRows(true)">Làm mới</button>
      </div>
      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Mã</th><th>Tên khách</th><th>Công ty</th><th>SĐT</th><th>Email</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td>{{ row.customer_code || row.id }}</td><td><b>{{ row.customer_name }}</b></td><td>{{ row.company_name }}</td><td>{{ row.phone }}</td><td>{{ row.email }}</td>
              <td><span class="badge green">{{ row.status || 'active' }}</span></td>
              <td class="row">
                <button class="btn" @click="openDetail(row)">Xem</button>
                <button v-if="hasPermission('customers.edit')" class="btn" @click="openModal(row)">Sửa</button>
                <button v-if="hasPermission('customers.delete')" class="btn danger" @click="removeCustomer(row)">Xóa</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <BaseModal v-if="showModal" :title="editing ? 'Sửa khách hàng' : 'Thêm khách hàng'" :loading="saving" @close="showModal=false" @save="saveCustomer">
      <div class="form-grid">
        <div class="form-group"><label>Mã khách</label><input v-model="form.customer_code" class="input" /></div>
        <div class="form-group"><label>Tên khách *</label><input v-model="form.customer_name" class="input" /></div>
        <div class="form-group"><label>Công ty</label><input v-model="form.company_name" class="input" /></div>
        <div class="form-group"><label>SĐT</label><input v-model="form.phone" class="input" /></div>
        <div class="form-group"><label>Email</label><input v-model="form.email" class="input" /></div>
        <div class="form-group"><label>Mã số thuế</label><input v-model="form.tax_code" class="input" /></div>
        <div class="form-group"><label>Địa chỉ hóa đơn</label><input v-model="form.billing_address" class="input" /></div>
        <div class="form-group"><label>Địa chỉ giao hàng</label><input v-model="form.shipping_address" class="input" /></div>
        <div class="form-group"><label>Nguồn</label><input v-model="form.source" class="input" /></div>
        <div class="form-group"><label>Trạng thái</label><select v-model="form.status" class="select"><option value="active">active</option><option value="inactive">inactive</option></select></div>
      </div>
      <div class="form-group" style="margin-top:12px"><label>Ghi chú</label><textarea v-model="form.note" class="textarea" rows="3" /></div>
    </BaseModal>

    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      title="Chi tiết khách hàng"
      :record="selectedDetail"
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
