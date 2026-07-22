<script setup lang="ts">
import type { InvoiceDoc, OrderDoc } from '~/types/models'
import { isActive, makeId, money, normalizeText, todayKey, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { recordBelongsToUser, scopedActionDecision } from '~/utils/permissionDiagnostics.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { appendUniqueRows } from '~/utils/cursorPagination.mjs'
import { toDateKey } from '~/utils/listFilters'

const { mutateOrderRelation } = useAtomicOrderRelations()
const { loadScopedOrders, loadScopedInvoicesPage } = useScopedQueries()
const { appUser, hasPermission, permissions } = useAuth()
const { showToast, withLoading } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()

const rows = ref<InvoiceDoc[]>([])
const PAGE_SIZE = 50
const pageCursor = shallowRef<any>(null)
const hasMoreRows = ref(false)
const pageMode = ref<'cursor' | 'full'>('cursor')
const loadingMore = ref(false)
const orders = ref<OrderDoc[]>([])
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const invoiceStatusFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const showModal = ref(false)
const showDetailModal = ref(false)
const selectedDetail = ref<InvoiceDoc | null>(null)
const editing = ref<InvoiceDoc | null>(null)
const form = reactive<any>({})

const filterValues = computed(() => ({ status: invoiceStatusFilter.value, from: dateFrom.value, to: dateTo.value }))
const toolbarFilters = [
  { key: 'status', label: 'Trạng thái hóa đơn', allLabel: 'Tất cả trạng thái', options: ['Yêu cầu xuất', 'HĐ nháp', 'Đã xuất'].map(value => ({ label: value, value })) },
  { key: 'from', label: 'Từ ngày', type: 'date' as const },
  { key: 'to', label: 'Đến ngày', type: 'date' as const },
]
function updateFilter(key: string, value: string) {
  if (key === 'status') invoiceStatusFilter.value = value
  if (key === 'from') dateFrom.value = value
  if (key === 'to') dateTo.value = value
}

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return rows.value.filter(row => {
    const matchedText = !keyword || normalizeText(`${row.order_code} ${row.invoice_number} ${row.company_name} ${row.invoice_status}`).includes(keyword)
    const rowDate = toDateKey(row.invoice_date || row.created_at)
    return matchedText
      && (!invoiceStatusFilter.value || row.invoice_status === invoiceStatusFilter.value)
      && (!dateFrom.value || (!!rowDate && rowDate >= dateFrom.value))
      && (!dateTo.value || (!!rowDate && rowDate <= dateTo.value))
  })
})

function resetFilters() {
  search.value = ''
  invoiceStatusFilter.value = ''
  dateFrom.value = ''
  dateTo.value = ''
}

const selectedOrder = computed(() => orders.value.find(order => order.id === form.order_id))


function invoiceActionDecision(row: InvoiceDoc | null | undefined, mode: 'create' | 'update' | 'delete') {
  const parentOrder = row ? orders.value.find(order => order.id === row.order_id) : selectedOrder.value
  const actionPermission = `invoices.${mode === 'create' ? 'create' : mode === 'update' ? 'edit' : 'delete'}`
  return scopedActionDecision({
    permissions: permissions.value,
    actionPermission,
    scopePermission: 'invoices.view_all',
    ownsRecord: !row || recordBelongsToUser(row, appUser.value?.email || '', parentOrder || {}),
    operation: `${mode === 'create' ? 'tạo' : mode === 'update' ? 'sửa' : 'xóa'} hóa đơn`,
    recordLabel: String(row?.order_code || row?.id || ''),
    diagnosticCode: `INVOICES_${mode.toUpperCase()}_RULES`,
    reason: 'Bản ghi phải thuộc phạm vi đơn hàng của người dùng nếu không có invoices.view_all; các trường order_id, created_by và created_at phải giữ nguyên khi sửa.',
  })
}

function canCreateInvoices() { return invoiceActionDecision(null, 'create').allowed }
function canEditInvoicesRow(row: InvoiceDoc) { return invoiceActionDecision(row, 'update').allowed }
function canDeleteInvoicesRow(row: InvoiceDoc) { return invoiceActionDecision(row, 'delete').allowed }

async function loadRows(force = false, append = false) {
  if (append && (!hasMoreRows.value || loadingMore.value)) return
  if (append) loadingMore.value = true
  else loading.value = true
  try {
    if (!append) orders.value = await loadScopedOrders(force)
    const page = await loadScopedInvoicesPage(append ? pageCursor.value : null, PAGE_SIZE, force)
    const loadedRows = page.rows.filter(isActive)
    rows.value = append ? appendUniqueRows(rows.value, loadedRows) : loadedRows
    pageCursor.value = page.cursor
    hasMoreRows.value = page.hasMore
    pageMode.value = page.mode
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được hóa đơn.'), 'error')
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadMoreRows() { await loadRows(false, true) }

function chooseOrder() {
  const order = selectedOrder.value
  if (!order) return
  form.order_code = order.order_code
  form.invoice_amount ||= toNumber(order.actual_revenue || order.total_vat)
}

function openDetail(row: InvoiceDoc) {
  selectedDetail.value = row
  showDetailModal.value = true
}

function openModal(row?: InvoiceDoc) {
  if (row) { const decision = invoiceActionDecision(row, 'update'); if (!decision.allowed) return showToast(decision.message, 'error') }
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
  if (editing.value) { const decision = invoiceActionDecision(editing.value, 'update'); if (!decision.allowed) return showToast(decision.message, 'error') }
  if (!editing.value) { const decision = invoiceActionDecision(null, 'create'); if (!decision.allowed) return showToast(decision.message, 'error') }
  if (!form.order_id) return showToast('Vui lòng chọn đơn hàng.', 'error')
  const order = selectedOrder.value
  if (!order) return showToast('Không tìm thấy đơn hàng.', 'error')

  saving.value = true
  await withLoading(async () => {
    chooseOrder()
    const result = await mutateOrderRelation({
      module: 'invoices',
      mode: editing.value ? 'update' : 'create',
      order,
      record: {
        ...form,
        invoice_amount: toNumber(form.invoice_amount),
        created_by: editing.value?.created_by || appUser.value?.email || '',
      },
      existingRecords: rows.value.filter(row => row.order_id === order.id),
      actor: appUser.value?.email || '',
    })

    const record = result.record as InvoiceDoc
    const index = rows.value.findIndex(row => row.id === record.id)
    if (index >= 0) rows.value[index] = { ...rows.value[index], ...record }
    else rows.value.unshift(record)
    Object.assign(order, result.orderPatch)
    showModal.value = false
    showToast('Đã lưu hóa đơn và cập nhật trạng thái đơn hàng.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không lưu được hóa đơn. Toàn bộ thay đổi đã hoàn tác.'), 'error'))
    .finally(() => { saving.value = false })
}

async function remove(row: InvoiceDoc) {
  { const decision = invoiceActionDecision(row, 'delete'); if (!decision.allowed) return showToast(decision.message, 'error') }
  const order = orders.value.find(item => item.id === row.order_id)
  if (!order) return showToast('Không tìm thấy đơn hàng cha của hóa đơn.', 'error')
  const confirmed = await askConfirm({
    title: 'Xóa hóa đơn',
    message: `Bạn chắc chắn muốn xóa hóa đơn ${row.invoice_number || row.order_code}?`,
    confirmLabel: 'Xóa hóa đơn'
  })
  if (!confirmed) return
  await withLoading(async () => {
    const result = await mutateOrderRelation({
      module: 'invoices',
      mode: 'delete',
      order,
      record: row,
      existingRecords: rows.value.filter(item => item.order_id === order.id),
      actor: appUser.value?.email || '',
    })
    rows.value = rows.value.filter(item => item.id !== row.id)
    Object.assign(order, result.orderPatch)
    showToast('Đã xóa hóa đơn và cập nhật trạng thái đơn hàng.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không xóa được hóa đơn. Toàn bộ thay đổi đã hoàn tác.'), 'error'))
}

onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Hóa đơn" subtitle="Theo dõi yêu cầu và trạng thái xuất hóa đơn">
      <button v-if="canCreateInvoices()" class="btn primary" @click="openModal()">+ Thêm hóa đơn</button>
    </PageHeader>
    <div class="card" style="padding: 24px;">
      <div class="toolbar"><input v-model="search" class="input" placeholder="Tìm đơn, số hóa đơn, công ty..."/><select v-model="invoiceStatusFilter" class="select"><option value="">Tất cả trạng thái</option><option>Yêu cầu xuất</option><option>HĐ nháp</option><option>Đã xuất</option></select><input v-model="dateFrom" class="input" type="date" aria-label="Từ ngày"/><input v-model="dateTo" class="input" type="date" aria-label="Đến ngày"/><button class="btn" @click="resetFilters">Xóa lọc</button><button class="btn" @click="loadRows(true)">Làm mới</button></div>
      <FilterToolbar v-model:search="search" search-placeholder="Tìm đơn, số hóa đơn, công ty..." :filters="toolbarFilters" :values="filterValues" :result-count="filtered.length" :loading="loading" show-refresh @update:filter="updateFilter" @reset="resetFilters" @refresh="loadRows(true)" />
      <LoadingState v-if="loading"/>
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Đơn hàng</th><th>Số hóa đơn</th><th>Ngày</th><th>Công ty</th><th>Giá trị</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id"><td>{{row.order_code}}</td><td>{{row.invoice_number||'-'}}</td><td>{{row.invoice_date}}</td><td>{{row.company_name}}</td><td>{{money(row.invoice_amount)}}</td><td><span class="badge">{{row.invoice_status}}</span></td><td><div class="action-buttons"><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button><button v-if="canEditInvoicesRow(row)" class="btn-sm" @click="openModal(row)">Sửa</button><button v-if="canDeleteInvoicesRow(row)" class="btn-sm btn-delete" @click="remove(row)">Xóa</button></div></td></tr>
            <tr v-if="!filtered.length"><td colspan="7" class="empty">Không có hóa đơn phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
      <CursorLoadMore :loaded-count="rows.length" :has-more="hasMoreRows" :loading="loadingMore" :mode="pageMode" @load-more="loadMoreRows" />
    </div>

    <BaseModal v-if="showModal" :title="editing?'Sửa hóa đơn':'Thêm hóa đơn'" size="lg" :loading="saving" @close="showModal=false" @save="save">
      <div class="form-grid">
        <div class="form-group"><label>Đơn hàng</label><select v-model="form.order_id" class="select" :disabled="!!editing" @change="chooseOrder"><option value="">Chọn đơn</option><option v-for="order in orders" :key="order.id" :value="order.id">{{order.order_code}} - {{order.customer_name}}</option></select></div>
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
      :field-order="['id','order_id','order_code','invoice_number','invoice_date','invoice_amount','invoice_status','tax_code','company_name','billing_address','note','created_by','created_at','updated_at','order_owner_email','order_created_by','order_sale_email','relation_revision','last_operation_id','status','active','deleted']"
      :money-fields="['invoice_amount']"
      @close="showDetailModal = false"
    />

    <ConfirmModal v-bind="confirmState" @cancel="resolveConfirm(false)" @confirm="resolveConfirm(true)" />
  </AppShell>
</template>

<style scoped>
.toolbar { display: none; }
</style>
