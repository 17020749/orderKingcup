<script setup lang="ts">
import { PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_TYPES } from '~/constants/permissions'
import type { OrderDoc, PaymentDoc } from '~/types/models'
import { isActive, makeId, money, normalizeText, todayKey, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { recordBelongsToUser, scopedActionDecision } from '~/utils/permissionDiagnostics.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { appendUniqueRows } from '~/utils/cursorPagination.mjs'
import { toDateKey } from '~/utils/listFilters'

const { mutateOrderRelation } = useAtomicOrderRelations()
const { appUser, hasPermission, permissions } = useAuth()
const { loadScopedOrders, loadScopedPaymentsPage, loadScopedPaymentsForOrders } = useScopedQueries()
const { showToast, withLoading } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()

const loading = ref(false)
const saving = ref(false)
const search = ref('')
const paymentTypeFilter = ref('')
const methodFilter = ref('')
const paymentStatusFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const rows = ref<PaymentDoc[]>([])
const PAGE_SIZE = 50
const pageCursor = shallowRef<any>(null)
const hasMoreRows = ref(false)
const pageMode = ref<'cursor' | 'full'>('cursor')
const loadingMore = ref(false)
const orders = ref<OrderDoc[]>([])
const showModal = ref(false)
const showDetailModal = ref(false)
const selectedDetail = ref<PaymentDoc | null>(null)
const editing = ref<PaymentDoc | null>(null)
const form = reactive<any>({})

const filterValues = computed(() => ({ type: paymentTypeFilter.value, method: methodFilter.value, status: paymentStatusFilter.value, from: dateFrom.value, to: dateTo.value }))
const toolbarFilters = computed(() => [
  { key: 'type', label: 'Loại thanh toán', allLabel: 'Tất cả loại', options: PAYMENT_TYPES.map(value => ({ label: value, value })) },
  { key: 'method', label: 'Phương thức', allLabel: 'Tất cả phương thức', options: PAYMENT_METHODS.map(value => ({ label: value, value })) },
  { key: 'status', label: 'Trạng thái', allLabel: 'Tất cả trạng thái', options: PAYMENT_STATUSES.map(value => ({ label: value, value })) },
  { key: 'from', label: 'Từ ngày', type: 'date' as const },
  { key: 'to', label: 'Đến ngày', type: 'date' as const },
])
function updateFilter(key: string, value: string) {
  if (key === 'type') paymentTypeFilter.value = value
  if (key === 'method') methodFilter.value = value
  if (key === 'status') paymentStatusFilter.value = value
  if (key === 'from') dateFrom.value = value
  if (key === 'to') dateTo.value = value
}

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return rows.value.filter(row => {
    const matchedText = !keyword || normalizeText(`${row.order_code} ${row.payment_type} ${row.method} ${row.payment_status} ${row.created_by}`).includes(keyword)
    const rowDate = toDateKey(row.payment_date || row.created_at)
    return matchedText
      && (!paymentTypeFilter.value || row.payment_type === paymentTypeFilter.value)
      && (!methodFilter.value || row.method === methodFilter.value)
      && (!paymentStatusFilter.value || row.payment_status === paymentStatusFilter.value)
      && (!dateFrom.value || (!!rowDate && rowDate >= dateFrom.value))
      && (!dateTo.value || (!!rowDate && rowDate <= dateTo.value))
  })
})

function resetFilters() {
  search.value = ''
  paymentTypeFilter.value = ''
  methodFilter.value = ''
  paymentStatusFilter.value = ''
  dateFrom.value = ''
  dateTo.value = ''
}

const canEditPayments = computed(() => hasPermission('*') || hasPermission('payments.edit'))
const selectedOrder = computed(() => orders.value.find(order => order.id === form.order_id || order.order_code === form.order_code))


function paymentActionDecision(row: PaymentDoc | null | undefined, mode: 'create' | 'update' | 'delete') {
  const parentOrder = row ? orders.value.find(order => order.id === row.order_id) : selectedOrder.value
  const actionPermission = `payments.${mode === 'create' ? 'create' : mode === 'update' ? 'edit' : 'delete'}`
  return scopedActionDecision({
    permissions: permissions.value,
    actionPermission,
    scopePermission: 'payments.view_all',
    ownsRecord: !row || recordBelongsToUser(row, appUser.value?.email || '', parentOrder || {}),
    operation: `${mode === 'create' ? 'tạo' : mode === 'update' ? 'sửa' : 'xóa'} thanh toán`,
    recordLabel: String(row?.order_code || row?.id || ''),
    diagnosticCode: `PAYMENTS_${mode.toUpperCase()}_RULES`,
    reason: 'Bản ghi phải thuộc phạm vi đơn hàng của người dùng nếu không có payments.view_all; các trường order_id, created_by và created_at phải giữ nguyên khi sửa.',
  })
}

function canCreatePayments() { return paymentActionDecision(null, 'create').allowed }
function canEditPaymentsRow(row: PaymentDoc) { return paymentActionDecision(row, 'update').allowed }
function canDeletePaymentsRow(row: PaymentDoc) { return paymentActionDecision(row, 'delete').allowed }

async function loadRows(force = false, append = false) {
  if (append && (!hasMoreRows.value || loadingMore.value)) return
  if (append) loadingMore.value = true
  else loading.value = true
  try {
    if (!append) orders.value = await loadScopedOrders(force)
    const page = await loadScopedPaymentsPage(orders.value, append ? pageCursor.value : null, PAGE_SIZE, force)
    rows.value = append ? appendUniqueRows(rows.value, page.rows) : page.rows
    pageCursor.value = page.cursor
    hasMoreRows.value = page.hasMore
    pageMode.value = page.mode
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được thanh toán.'), 'error')
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadMoreRows() {
  await loadRows(false, true)
}

function chooseOrder() {
  const order = selectedOrder.value
  if (!order) return
  form.order_id = order.id
  form.order_code = order.order_code
}

function openDetail(row: PaymentDoc) {
  selectedDetail.value = row
  showDetailModal.value = true
}

function openModal(row?: PaymentDoc) {
  if (row) { const decision = paymentActionDecision(row, 'update'); if (!decision.allowed) return showToast(decision.message, 'error') }
  editing.value = row || null
  Object.assign(form, row ? { ...row } : {
    id: makeId('pay'),
    order_id: '',
    order_code: '',
    payment_date: todayKey(),
    payment_type: 'Cọc',
    amount: 0,
    method: 'Chuyển khoản',
    payment_status: 'Chưa nhận',
    cod_status: '',
    note: '',
    status: 'active'
  })
  showModal.value = true
}

async function savePayment() {
  if (editing.value) { const decision = paymentActionDecision(editing.value, 'update'); if (!decision.allowed) return showToast(decision.message, 'error') }
  if (!editing.value) { const decision = paymentActionDecision(null, 'create'); if (!decision.allowed) return showToast(decision.message, 'error') }
  chooseOrder()
  if (!form.order_id) return showToast('Thiếu đơn hàng.', 'error')
  const order = selectedOrder.value
  if (!order) return showToast(`Không tìm thấy đơn hàng với mã: ${form.order_code || form.order_id}`, 'error')
  if (!String(order.customer_name || '').trim()) return showToast('Đơn hàng chưa có thông tin khách hàng, không thể tạo thanh toán.', 'error')

  saving.value = true
  await withLoading(async () => {
    const result = await mutateOrderRelation({
      module: 'payments',
      mode: editing.value ? 'update' : 'create',
      order,
      record: {
        ...form,
        amount: toNumber(form.amount),
        cod_status: '',
        created_by: editing.value?.created_by || appUser.value?.email || '',
      },
      existingRecords: await loadScopedPaymentsForOrders([order], true),
      actor: appUser.value?.email || '',
    })

    const record = result.record as PaymentDoc
    const index = rows.value.findIndex(row => row.id === record.id)
    if (index >= 0) rows.value[index] = { ...rows.value[index], ...record }
    else rows.value.unshift(record)
    Object.assign(order, result.orderPatch)
    showModal.value = false
    showToast(editing.value ? 'Đã cập nhật thanh toán và tổng hợp đơn hàng.' : 'Đã thêm thanh toán và cập nhật đơn hàng.', 'success')
  }).catch(error => {
    showToast(reportFirebaseError(error, editing.value ? 'Không cập nhật được thanh toán. Toàn bộ thay đổi đã hoàn tác.' : 'Không tạo được thanh toán. Toàn bộ thay đổi đã hoàn tác.'), 'error')
  }).finally(() => {
    saving.value = false
  })
}

async function removePayment(row: PaymentDoc) {
  { const decision = paymentActionDecision(row, 'delete'); if (!decision.allowed) return showToast(decision.message, 'error') }
  const order = orders.value.find(item => item.id === row.order_id)
  if (!order) return showToast('Không tìm thấy đơn hàng cha của thanh toán.', 'error')
  const confirmed = await askConfirm({
    title: 'Xóa thanh toán',
    message: `Bạn chắc chắn muốn xóa phiếu thanh toán của đơn ${row.order_code}?`,
    confirmLabel: 'Xóa thanh toán'
  })
  if (!confirmed) return

  await withLoading(async () => {
    const result = await mutateOrderRelation({
      module: 'payments',
      mode: 'delete',
      order,
      record: row,
      existingRecords: await loadScopedPaymentsForOrders([order], true),
      actor: appUser.value?.email || '',
    })
    rows.value = rows.value.filter(item => item.id !== row.id)
    Object.assign(order, result.orderPatch)
    showToast('Đã xóa thanh toán và cập nhật lại công nợ đơn hàng.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không xóa được thanh toán. Toàn bộ thay đổi đã hoàn tác.'), 'error'))
}

onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Thanh toán" subtitle="Trạng thái thanh toán của đơn tự tính từ phiếu đã nhận">
      <button v-if="canCreatePayments()" class="btn primary" @click="openModal()">+ Thêm thanh toán</button>
    </PageHeader>

    <div class="card" style="margin: 24px;">
      <FilterToolbar v-model:search="search" search-placeholder="Tìm mã đơn, loại thanh toán..." :filters="toolbarFilters" :values="filterValues" :result-count="filtered.length" :loading="loading" show-refresh @update:filter="updateFilter" @reset="resetFilters" @refresh="loadRows(true)" />
      <div v-if="false" class="toolbar">
        <input v-model="search" class="input" style="max-width:480px" placeholder="Tìm mã đơn, loại thanh toán..." />
        <select v-model="paymentTypeFilter" class="select"><option value="">Tất cả loại</option><option v-for="value in PAYMENT_TYPES" :key="value" :value="value">{{ value }}</option></select>
        <select v-model="methodFilter" class="select"><option value="">Tất cả phương thức</option><option v-for="value in PAYMENT_METHODS" :key="value" :value="value">{{ value }}</option></select>
        <select v-model="paymentStatusFilter" class="select"><option value="">Tất cả trạng thái</option><option v-for="value in PAYMENT_STATUSES" :key="value" :value="value">{{ value }}</option></select>
        <input v-model="dateFrom" class="input" type="date" aria-label="Từ ngày" />
        <input v-model="dateTo" class="input" type="date" aria-label="Đến ngày" />
        <button class="btn" @click="resetFilters">Xóa lọc</button>
        <button class="btn" @click="loadRows(true)">Làm mới</button>
      </div>
      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Mã đơn</th><th>Ngày</th><th>Loại</th><th>Số tiền</th><th>Phương thức</th><th>Trạng thái</th><th>Người tạo</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ row.order_code }}</b></td>
              <td>{{ row.payment_date }}</td>
              <td>{{ row.payment_type }}</td>
              <td>{{ money(row.amount) }}</td>
              <td>{{ row.method }}</td>
              <td><span class="badge green">{{ row.payment_status }}</span></td>
              <td>{{ row.created_by }}</td>
              <td><div class="action-buttons"><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button><button v-if="canEditPaymentsRow(row)" class="btn-sm" @click="openModal(row)">Sửa</button><button v-if="canDeletePaymentsRow(row)" class="btn-sm btn-delete" @click="removePayment(row)">Xóa</button></div></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="8" class="empty">Không có thanh toán phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
      <CursorLoadMore :loaded-count="rows.length" :has-more="hasMoreRows" :loading="loadingMore" :mode="pageMode" @load-more="loadMoreRows" />
    </div>

    <BaseModal
      v-if="showModal"
      :title="editing ? 'Sửa thanh toán' : 'Thêm thanh toán'"
      size="lg"
      save-label="Lưu"
      :loading="saving"
      @close="showModal=false"
      @save="savePayment"
    >
      <div class="form-grid">
        <div class="form-group">
          <label>Mã đơn hàng</label>
          <select v-model="form.order_id" class="select" :disabled="!!editing" @change="chooseOrder">
            <option value="">Chọn đơn</option>
            <option v-for="order in orders" :key="order.id" :value="order.id">{{ order.order_code }} - {{ order.customer_name }}</option>
          </select>
        </div>
        <div class="form-group">
          <label>Nhập mã đơn</label>
          <input v-model="form.order_code" class="input" :readonly="!!editing" placeholder="VD: DH-..." @input="form.order_id = ''; chooseOrder()" />
        </div>
      </div>

      <div class="detail-grid" style="margin-top:12px">
        <div class="detail-item"><label>Khách hàng</label><strong>{{ selectedOrder?.customer_name || '-' }}</strong></div>
        <div class="detail-item"><label>Tổng tiền</label><strong>{{ money(selectedOrder?.actual_revenue || selectedOrder?.total_vat) }}</strong></div>
        <div class="detail-item"><label>Công nợ hiện tại</label><strong>{{ money(selectedOrder?.debt_amount) }}</strong></div>
      </div>

      <div class="form-grid">
        <div class="form-group"><label>Ngày thanh toán</label><input v-model="form.payment_date" class="input" type="date" /></div>
        <div class="form-group"><label>Loại thanh toán</label><select v-model="form.payment_type" class="select"><option v-for="value in PAYMENT_TYPES" :key="value" :value="value">{{ value }}</option></select></div>
        <div class="form-group"><label>Số tiền</label><input v-model.number="form.amount" class="input" type="number" min="0" /></div>
        <div class="form-group"><label>Phương thức</label><select v-model="form.method" class="select"><option v-for="value in PAYMENT_METHODS" :key="value" :value="value">{{ value }}</option></select></div>
        <div class="form-group"><label>Trạng thái</label><select v-model="form.payment_status" class="select"><option v-for="value in PAYMENT_STATUSES" :key="value" :value="value">{{ value }}</option></select></div>
      </div>
      <div class="form-group" style="margin-top:12px"><label>Ghi chú</label><textarea v-model="form.note" class="textarea" rows="3" /></div>
    </BaseModal>

    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      title="Chi tiết thanh toán"
      :record="selectedDetail"
      :field-order="['id','order_id','order_code','payment_date','payment_type','amount','method','payment_status','cod_status','note','created_by','created_at','updated_at','order_owner_email','order_created_by','order_sale_email','relation_revision','last_operation_id','status','active','deleted']"
      :money-fields="['amount']"
      @close="showDetailModal = false"
    />

    <ConfirmModal v-bind="confirmState" @cancel="resolveConfirm(false)" @confirm="resolveConfirm(true)" />
  </AppShell>
</template>
