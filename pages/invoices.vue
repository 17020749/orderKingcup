<script setup lang="ts">
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import type { InvoiceDoc, OrderDoc } from '~/types/models'
import { isActive, makeId, money, normalizeText, todayKey, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

const { db } = useFirebaseServices()
const { saveDoc, softDeleteDoc } = useRepo()
const { loadScopedOrders, loadScopedInvoices } = useScopedQueries()
const { appUser, hasPermission } = useAuth()
const { showToast, withLoading } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()

const rows = ref<InvoiceDoc[]>([])
const orders = ref<OrderDoc[]>([])
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const showModal = ref(false)
const showDetailModal = ref(false)
const selectedDetail = ref<InvoiceDoc | null>(null)
const editing = ref<InvoiceDoc | null>(null)
const form = reactive<any>({})

const filtered = computed(() => rows.value.filter(row =>
  normalizeText(`${row.order_code} ${row.invoice_number} ${row.company_name} ${row.invoice_status}`)
    .includes(normalizeText(search.value))
))

async function loadRows(force = false) {
  loading.value = true
  try {
    const [loadedOrders, loadedRows] = await Promise.all([
      loadScopedOrders(force),
      loadScopedInvoices(force)
    ])
    orders.value = loadedOrders
    rows.value = loadedRows.filter(isActive)
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được hóa đơn.'), 'error')
  } finally {
    loading.value = false
  }
}

function chooseOrder() {
  const order = orders.value.find(row => row.id === form.order_id)
  if (!order) return
  form.order_code = order.order_code
  form.invoice_amount ||= toNumber(order.actual_revenue || order.total_vat)
}

function openDetail(row: InvoiceDoc) {
  selectedDetail.value = row
  showDetailModal.value = true
}

function openModal(row?: InvoiceDoc) {
  editing.value = row || null
  Object.assign(form, row ? { ...row } : {
    id: makeId('inv'),
    order_id: '',
    order_code: '',
    invoice_number: '',
    invoice_date: todayKey(),
    invoice_amount: 0,
    invoice_status: 'HĐ nháp',
    tax_code: '',
    company_name: '',
    billing_address: '',
    note: '',
    status: 'active'
  })
  showModal.value = true
}

async function save() {
  if (!form.order_id) return showToast('Vui lòng chọn đơn hàng.', 'error')
  saving.value = true
  await withLoading(async () => {
    chooseOrder()
    const order = orders.value.find(row => row.id === form.order_id)
    if (!order) throw new Error('Không tìm thấy đơn hàng')

    const record = await saveDoc('invoices', {
      ...form,
      invoice_amount: toNumber(form.invoice_amount),
      created_by: editing.value?.created_by || appUser.value?.email || '',
      order_owner_email: order.owner_email || '',
      order_created_by: order.created_by || '',
      order_sale_email: order.sale_email || ''
    }, form.id, { isCreate: !editing.value }) as InvoiceDoc

    try {
      await updateDoc(doc(db, 'orders', form.order_id), {
        invoice_status: form.invoice_status,
        updated_at: serverTimestamp()
      })
    } catch {
      // Invoice itself is the source of truth in this UI. The orders page can
      // still show the latest invoice after the next data refresh.
    }

    const index = rows.value.findIndex(row => row.id === record.id)
    if (index >= 0) rows.value[index] = { ...rows.value[index], ...record }
    else rows.value.unshift(record)
    Object.assign(order, { invoice_status: form.invoice_status })
    showModal.value = false
    showToast('Đã lưu hóa đơn.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không lưu được hóa đơn.'), 'error'))
    .finally(() => { saving.value = false })
}

async function remove(row: InvoiceDoc) {
  const confirmed = await askConfirm({
    title: 'Xóa hóa đơn',
    message: `Bạn chắc chắn muốn xóa hóa đơn ${row.invoice_number || row.order_code}?`,
    confirmLabel: 'Xóa hóa đơn'
  })
  if (!confirmed) return
  await withLoading(async () => {
    await softDeleteDoc('invoices', row.id, row.invoice_number || row.order_code || row.id)
    rows.value = rows.value.filter(item => item.id !== row.id)
    const order = orders.value.find(item => item.id === row.order_id)
    if (order) order.invoice_status = 'Không xuất'
    try {
      await updateDoc(doc(db, 'orders', row.order_id), {
        invoice_status: 'Không xuất',
        updated_at: serverTimestamp()
      })
    } catch {
      // Main delete succeeded; do not show a false failure for summary sync.
    }
    showToast('Đã xóa hóa đơn.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không xóa được hóa đơn.'), 'error'))
}

onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Hóa đơn" subtitle="Theo dõi yêu cầu và trạng thái xuất hóa đơn">
      <button v-if="hasPermission('invoices.create') || hasPermission('*')" class="btn primary" @click="openModal()">+ Thêm hóa đơn</button>
    </PageHeader>
    <div class="card">
      <div class="toolbar"><input v-model="search" class="input" placeholder="Tìm đơn, số hóa đơn, công ty..."/><button class="btn" @click="loadRows(true)">Làm mới</button></div>
      <LoadingState v-if="loading"/>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Đơn hàng</th><th>Số hóa đơn</th><th>Ngày</th><th>Công ty</th><th>Giá trị</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id"><td>{{row.order_code}}</td><td>{{row.invoice_number||'-'}}</td><td>{{row.invoice_date}}</td><td>{{row.company_name}}</td><td>{{money(row.invoice_amount)}}</td><td><span class="badge">{{row.invoice_status}}</span></td><td><div class="action-buttons"><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button><button v-if="hasPermission('invoices.edit') || hasPermission('*')" class="btn-sm" @click="openModal(row)">Sửa</button><button v-if="hasPermission('invoices.delete') || hasPermission('*')" class="btn-sm btn-delete" @click="remove(row)">Xóa</button></div></td></tr>
            <tr v-if="!filtered.length"><td colspan="7" class="empty">Không có hóa đơn phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal v-if="showModal" :title="editing?'Sửa hóa đơn':'Thêm hóa đơn'" size="lg" :loading="saving" @close="showModal=false" @save="save">
      <div class="form-grid">
        <div class="form-group"><label>Đơn hàng</label><select v-model="form.order_id" class="select" @change="chooseOrder"><option value="">Chọn đơn</option><option v-for="order in orders" :key="order.id" :value="order.id">{{order.order_code}} - {{order.customer_name}}</option></select></div>
        <div class="form-group"><label>Số hóa đơn</label><input v-model="form.invoice_number" class="input"/></div>
        <div class="form-group"><label>Ngày hóa đơn</label><input v-model="form.invoice_date" class="input" type="date"/></div>
        <div class="form-group"><label>Giá trị</label><input v-model.number="form.invoice_amount" class="input" type="number" min="0"/></div>
        <div class="form-group"><label>Trạng thái</label><select v-model="form.invoice_status" class="select"><option>Yêu cầu xuất</option><option>HĐ nháp</option><option>Đã xuất</option></select></div>
        <div class="form-group"><label>Mã số thuế</label><input v-model="form.tax_code" class="input"/></div>
        <div class="form-group"><label>Tên công ty</label><input v-model="form.company_name" class="input"/></div>
      </div>
      <div class="form-group"><label>Địa chỉ hóa đơn</label><textarea v-model="form.billing_address" class="textarea" rows="2"/></div>
      <div class="form-group"><label>Ghi chú</label><textarea v-model="form.note" class="textarea" rows="2"/></div>
    </BaseModal>

    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      title="Chi tiết hóa đơn"
      :record="selectedDetail"
      :field-order="['id','order_id','order_code','invoice_number','invoice_date','invoice_amount','invoice_status','tax_code','company_name','billing_address','note','created_by','created_at','updated_at','order_owner_email','order_created_by','order_sale_email','status','active','deleted']"
      :money-fields="['invoice_amount']"
      @close="showDetailModal = false"
    />

    <ConfirmModal
      v-bind="confirmState"
      @cancel="resolveConfirm(false)"
      @confirm="resolveConfirm(true)"
    />
  </AppShell>
</template>
