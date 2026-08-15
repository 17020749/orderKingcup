<script setup lang="ts">
import { INVOICE_STATUS_OPTIONS } from '~/constants/permissions'
import type { InvoiceDoc, OrderDoc } from '~/types/models'
import { isActive, money, normalizeText, toNumber } from '~/utils/format'
import { normalizeInvoiceStatus, validateAccountingInvoice } from '~/utils/orderInvoiceFlow.mjs'
import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { moduleActionDecision, permissionDecisionMessage } from '~/utils/permissionDecisions.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { appendUniqueRows } from '~/utils/cursorPagination.mjs'
import { toDateKey } from '~/utils/listFilters'

const { mutateOrderRelation } = useAtomicOrderRelations()
const { loadScopedOrdersForInvoices, loadScopedInvoicesPage, loadScopedInvoicesForOrders } = useScopedQueries()
const { appUser, permissions, hasPermission } = useAuth()
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
  { key: 'status', label: 'Trạng thái hóa đơn', allLabel: 'Tất cả trạng thái', options: INVOICE_STATUS_OPTIONS.map(value => ({ label: value, value })) },
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
      && (!invoiceStatusFilter.value || normalizeInvoiceStatus(row.invoice_status) === invoiceStatusFilter.value)
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

function parentOrderForInvoice(row: InvoiceDoc) {
  return orders.value.find(order => order.id === row.order_id) || null
}

const selectedOrder = computed(() => orders.value.find(order => order.id === form.order_id))

function invoiceActionDecision(action: 'edit' | 'delete', _row: InvoiceDoc, _order?: OrderDoc | null) {
  return moduleActionDecision({
    actionPermission: `invoices.${action}`,
    viewAllPermission: 'invoices.view_all',
    permissions: permissions.value,
    record: null,
    parent: null,
    currentUserEmail: appUser.value?.email || '',
  })
}

function invoiceActionError(action: 'edit' | 'delete', row: InvoiceDoc) {
  const order = parentOrderForInvoice(row)
  if (!order) {
    return 'Không tải được đơn hàng cha của hóa đơn. Hãy làm mới trang.'
  }
  return permissionDecisionMessage(invoiceActionDecision(action, row, order), {
    operation: `${action === 'edit' ? 'sửa' : 'xóa'} hóa đơn`,
    record: row.invoice_number || row.id,
    status: row.status || '',
  })
}

function canEditInvoice(row: InvoiceDoc) {
  const order = parentOrderForInvoice(row)
  if (!order) return false
  return invoiceActionDecision('edit', row, order).allowed
}
function canDeleteInvoice(row: InvoiceDoc) {
  const order = parentOrderForInvoice(row)
  if (!order) return false
  return invoiceActionDecision('delete', row, order).allowed
}

async function loadRows(force = false, append = false) {
  if (append && (!hasMoreRows.value || loadingMore.value)) return
  if (append) loadingMore.value = true
  else loading.value = true
  try {
    const page = await loadScopedInvoicesPage(append ? pageCursor.value : null, PAGE_SIZE, force)
    const loadedRows = page.rows.filter(isActive)
    const loadedOrders = await loadScopedOrdersForInvoices(loadedRows, force)
    rows.value = append ? appendUniqueRows(rows.value, loadedRows) : loadedRows
    orders.value = append ? appendUniqueRows(orders.value, loadedOrders) : loadedOrders
    if (!append && loadedRows.some(row => !parentOrderForInvoice(row))
      && (hasPermission('invoices.edit') || hasPermission('invoices.delete'))) {
      showToast('Một số hóa đơn không thể sửa vì chưa tải được đơn hàng cha. Hãy làm mới trang.', 'warning')
    }
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

const invoiceDetailLabels: Record<string, string> = {
  order_code: 'Mã đơn hàng',
  invoice_number: 'Số hóa đơn',
  invoice_date: 'Ngày hóa đơn',
  invoice_amount: 'Giá trị hóa đơn',
  invoice_status: 'Trạng thái hóa đơn',
  tax_code: 'Mã số thuế',
  company_name: 'Tên công ty',
  billing_address: 'Địa chỉ hóa đơn',
  note: 'Ghi chú',
  created_by: 'Người tạo',
  created_at: 'Ngày giờ tạo',
  updated_at: 'Ngày giờ cập nhật',
}

function openDetail(row: InvoiceDoc) {
  selectedDetail.value = row
  showDetailModal.value = true
}

function openModal(row: InvoiceDoc) {
  if (!canEditInvoice(row)) return showToast(invoiceActionError('edit', row), 'error')
  editing.value = row
  Object.keys(form).forEach(key => delete form[key])
  Object.assign(form, {
    ...row,
    invoice_status: normalizeInvoiceStatus(row.invoice_status),
    invoice_amount: toNumber(row.invoice_amount),
  })
  showModal.value = true
}

async function save() {
  if (!editing.value) return showToast('Không tìm thấy hóa đơn cần sửa.', 'error')
  const order = selectedOrder.value
  if (!order) return showToast('Không tìm thấy đơn hàng cha của hóa đơn.', 'error')
  if (!invoiceActionDecision('edit', editing.value, order).allowed) {
    return showToast(invoiceActionError('edit', editing.value), 'error')
  }

  const normalizedRecord = {
    ...form,
    invoice_status: normalizeInvoiceStatus(form.invoice_status),
    invoice_amount: Math.max(0, toNumber(order.payable_amount)),
    created_by: editing.value.created_by || appUser.value?.email || '',
  }
  const validationError = validateAccountingInvoice(normalizedRecord)
  if (validationError) return showToast(validationError, 'error')

  saving.value = true
  await withLoading(async () => {
    const result = await mutateOrderRelation({
      module: 'invoices',
      mode: 'update',
      order,
      record: normalizedRecord,
      existingRecords: await loadScopedInvoicesForOrders([order], true),
      actor: appUser.value?.email || '',
    })

    const record = result.record as InvoiceDoc
    const index = rows.value.findIndex(row => row.id === record.id)
    if (index >= 0) rows.value[index] = { ...rows.value[index], ...record }
    Object.assign(order, result.orderPatch)
    showModal.value = false
    showToast('Đã cập nhật hóa đơn và trạng thái đơn hàng.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không lưu được hóa đơn. Toàn bộ thay đổi đã hoàn tác.', {
    operation: 'invoices.edit', record: form.id || form.order_id,
    status: editing.value?.status || form.status, actionPermission: 'invoices.edit',
    scopePermission: 'invoices.view_all',
  }), 'error'))
    .finally(() => { saving.value = false })
}

async function remove(row: InvoiceDoc) {
  const order = orders.value.find(item => item.id === row.order_id)
  if (!order) return showToast('Không tìm thấy đơn hàng cha của hóa đơn.', 'error')
  if (!invoiceActionDecision('delete', row, order).allowed) return showToast(invoiceActionError('delete', row), 'error')
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
      existingRecords: await loadScopedInvoicesForOrders([order], true),
      actor: appUser.value?.email || '',
    })
    rows.value = rows.value.filter(item => item.id !== row.id)
    Object.assign(order, result.orderPatch)
    showToast('Đã xóa hóa đơn và cập nhật trạng thái đơn hàng.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không xóa được hóa đơn. Toàn bộ thay đổi đã hoàn tác.', {
    operation: 'invoices.delete', record: row.id, status: row.status,
    actionPermission: 'invoices.delete', scopePermission: 'invoices.view_all',
  }), 'error'))
}

onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Hóa đơn" subtitle="Kế toán cập nhật yêu cầu và trạng thái xuất hóa đơn" />
    <div class="card" style="padding: 24px;">
      <FilterToolbar v-model:search="search" search-placeholder="Tìm đơn, số hóa đơn, công ty..." :filters="toolbarFilters" :values="filterValues" :result-count="filtered.length" :loading="loading" show-refresh @update:filter="updateFilter" @reset="resetFilters" @refresh="loadRows(true)" />
      <LoadingState v-if="loading"/>
      <div v-else class="table-wrap table-wrap--sticky-head">
        <table>
          <thead><tr><th>Đơn hàng</th><th>Số hóa đơn</th><th>Ngày</th><th>Công ty</th><th>Giá trị</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id"><td>{{row.order_code}}</td><td>{{row.invoice_number||'-'}}</td><td>{{row.invoice_date||'-'}}</td><td>{{row.company_name||'-'}}</td><td>{{money(row.invoice_amount)}}</td><td><span class="badge">{{normalizeInvoiceStatus(row.invoice_status)}}</span></td><td><div class="action-buttons"><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button><button v-if="canEditInvoice(row)" class="btn-sm" @click="openModal(row)">Sửa</button><button v-if="canDeleteInvoice(row)" class="btn-sm btn-delete" @click="remove(row)">Xóa</button></div></td></tr>
            <tr v-if="!filtered.length"><td colspan="7" class="empty">Không có hóa đơn phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
      <CursorLoadMore :loaded-count="rows.length" :has-more="hasMoreRows" :loading="loadingMore" :mode="pageMode" @load-more="loadMoreRows" />
    </div>

    <BaseModal v-if="showModal && editing" title="Sửa hóa đơn" size="lg" :loading="saving" @close="showModal=false" @save="save">
      <div class="form-grid">
        <div class="form-group"><label>Đơn hàng</label><input :value="form.order_code" class="input readonly-field" readonly/></div>
        <div class="form-group"><label>Số hóa đơn</label><input v-model="form.invoice_number" class="input"/></div>
        <div class="form-group"><label>Ngày hóa đơn</label><input v-model="form.invoice_date" class="input" type="date"/></div>
        <div class="form-group"><label>Giá trị</label><input :value="money(selectedOrder?.payable_amount)" class="input readonly-field" readonly/></div>
        <div class="form-group"><label>Trạng thái</label><select v-model="form.invoice_status" class="select"><option v-for="status in INVOICE_STATUS_OPTIONS" :key="status" :value="status">{{status}}</option></select></div>
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
      :labels="invoiceDetailLabels"
      :field-order="[
        'order_code','invoice_number','invoice_date','invoice_amount','invoice_status',
        'tax_code','company_name','billing_address','note','created_by','created_at','updated_at'
      ]"
      :money-fields="['invoice_amount']"
      :include-unlisted-fields="false"
      :columns="3"
      @close="showDetailModal = false"
    />

    <ConfirmModal v-bind="confirmState" @cancel="resolveConfirm(false)" @confirm="resolveConfirm(true)" />
  </AppShell>
</template>
