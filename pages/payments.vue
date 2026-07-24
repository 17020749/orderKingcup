<script setup lang="ts">
import { PAYMENT_METHODS, PAYMENT_STATUSES, PAYMENT_TYPES } from '~/constants/permissions'
import type { OrderDoc, PaymentDoc } from '~/types/models'
import { isActive, makeId, money, normalizeText, todayKey, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { moduleActionDecision, permissionDecisionMessage } from '~/utils/permissionDecisions.mjs'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { appendUniqueRows } from '~/utils/cursorPagination.mjs'
import { toDateKey } from '~/utils/listFilters'

type PaymentRow = PaymentDoc & {
  recipient_account_id?: string
  recipient_name?: string
  recipient_account_number?: string
  recipient_bank_name?: string
  sender_image_url?: string
}

type PaymentBankAccount = {
  id: string
  recipient_name: string
  account_number: string
  bank_name: string
  status?: string
  active?: boolean
  deleted?: boolean
  created_by?: string
  created_at?: any
  updated_at?: any
}

const { mutateOrderRelation } = useAtomicOrderRelations()
const { appUser, permissions, isAdmin, hasPermission } = useAuth()
const { loadScopedOrders, loadScopedPaymentsPage, loadScopedPaymentsForOrders } = useScopedQueries()
const { listDocs, saveDoc, softDeleteDoc, q } = useRepo()
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
const rows = ref<PaymentRow[]>([])
const PAGE_SIZE = 50
const pageCursor = shallowRef<any>(null)
const hasMoreRows = ref(false)
const pageMode = ref<'cursor' | 'full'>('cursor')
const loadingMore = ref(false)
const orders = ref<OrderDoc[]>([])
const showModal = ref(false)
const showDetailModal = ref(false)
const selectedDetail = ref<PaymentRow | null>(null)
const editing = ref<PaymentRow | null>(null)
const form = reactive<any>({})
const bankAccounts = ref<PaymentBankAccount[]>([])
const bankAccountsLoading = ref(false)
const showBankSetupModal = ref(false)
const bankAccountSaving = ref(false)
const bankAccountEditing = ref<PaymentBankAccount | null>(null)
const bankAccountForm = reactive({ id: '', recipient_name: '', account_number: '', bank_name: '' })

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
    const matchedText = !keyword || normalizeText(`${row.order_code} ${row.payment_type} ${row.method} ${row.payment_status} ${row.created_by} ${row.recipient_name || ''} ${row.recipient_account_number || ''} ${row.recipient_bank_name || ''}`).includes(keyword)
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

const selectedOrder = computed(() => orders.value.find(order => order.id === form.order_id || order.order_code === form.order_code))
const selectedRecipientAccount = computed(() => bankAccounts.value.find(account => account.id === form.recipient_account_id) || null)
const isBankTransfer = computed(() => isBankTransferMethod(form.method))

function isBankTransferMethod(value: any) {
  return normalizeText(value) === normalizeText('Chuyển khoản')
}

function normalizeHttpUrl(value: any) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : ''
  } catch {
    return ''
  }
}

function shortUrl(value: any) {
  const url = normalizeHttpUrl(value)
  return url.length > 42 ? `${url.slice(0, 39)}...` : url
}

function clearTransferSnapshot() {
  form.recipient_account_id = ''
  form.recipient_name = ''
  form.recipient_account_number = ''
  form.recipient_bank_name = ''
  form.sender_image_url = ''
}

function syncRecipientSnapshot() {
  const account = selectedRecipientAccount.value
  if (!account) {
    form.recipient_name = ''
    form.recipient_account_number = ''
    form.recipient_bank_name = ''
    return
  }
  form.recipient_name = account.recipient_name
  form.recipient_account_number = account.account_number
  form.recipient_bank_name = account.bank_name
}

function recipientSummary(row: PaymentRow) {
  if (!isBankTransferMethod(row.method)) return '-'
  return [row.recipient_bank_name, row.recipient_account_number, row.recipient_name].filter(Boolean).join(' · ') || '-'
}

watch(() => form.method, method => {
  if (!isBankTransferMethod(method)) clearTransferSnapshot()
})

function paymentActionDecision(action: 'create' | 'edit' | 'delete', row?: PaymentDoc | null, order?: OrderDoc | null) {
  return moduleActionDecision({
    actionPermission: `payments.${action}`,
    viewAllPermission: 'payments.view_all',
    permissions: permissions.value,
    record: row || null,
    parent: order || (row ? orders.value.find(item => item.id === row.order_id) : selectedOrder.value) || null,
    currentUserEmail: appUser.value?.email || '',
  })
}

function paymentActionError(action: 'create' | 'edit' | 'delete', row?: PaymentDoc | null) {
  const order = row ? orders.value.find(item => item.id === row.order_id) : selectedOrder.value
  return permissionDecisionMessage(paymentActionDecision(action, row, order), {
    operation: `${action === 'create' ? 'tạo' : action === 'edit' ? 'sửa' : 'xóa'} thanh toán`,
    record: row?.id || form.id || '(mới)',
    status: row?.status || form.status || '',
  })
}

function canEditPayment(row: PaymentDoc) {
  return paymentActionDecision('edit', row).allowed
}

function canDeletePayment(row: PaymentDoc) {
  return paymentActionDecision('delete', row).allowed
}

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

async function loadBankAccounts() {
  bankAccountsLoading.value = true
  try {
    const values = await listDocs('payment_bank_accounts', [
      q.where('active', '==', true),
      q.where('deleted', '==', false),
    ])
    bankAccounts.value = values
      .filter(isActive)
      .map(value => ({
        id: String(value.id || value.firestore_id || ''),
        recipient_name: String(value.recipient_name || ''),
        account_number: String(value.account_number || ''),
        bank_name: String(value.bank_name || ''),
        status: value.status,
        active: value.active,
        deleted: value.deleted,
        created_by: value.created_by,
        created_at: value.created_at,
        updated_at: value.updated_at,
      }))
      .sort((a, b) => `${a.bank_name} ${a.account_number}`.localeCompare(`${b.bank_name} ${b.account_number}`, 'vi'))
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được danh sách tài khoản nhận tiền.'), 'error')
  } finally {
    bankAccountsLoading.value = false
  }
}

function resetBankAccountForm() {
  bankAccountEditing.value = null
  Object.assign(bankAccountForm, { id: '', recipient_name: '', account_number: '', bank_name: '' })
}

async function openBankAccountSetup() {
  if (!isAdmin.value) return showToast('Chỉ admin được thiết lập tài khoản nhận tiền.', 'error')
  resetBankAccountForm()
  showBankSetupModal.value = true
  await loadBankAccounts()
}

function editBankAccount(account: PaymentBankAccount) {
  if (!isAdmin.value) return
  bankAccountEditing.value = account
  Object.assign(bankAccountForm, {
    id: account.id,
    recipient_name: account.recipient_name,
    account_number: account.account_number,
    bank_name: account.bank_name,
  })
}

async function saveBankAccount() {
  if (!isAdmin.value) return showToast('Chỉ admin được thiết lập tài khoản nhận tiền.', 'error')
  const recipientName = String(bankAccountForm.recipient_name || '').trim()
  const accountNumber = String(bankAccountForm.account_number || '').trim()
  const bankName = String(bankAccountForm.bank_name || '').trim()
  if (!recipientName || !accountNumber || !bankName) return showToast('Vui lòng nhập đủ tên người nhận, số tài khoản và ngân hàng.', 'error')
  const duplicate = bankAccounts.value.find(account =>
    account.id !== bankAccountEditing.value?.id
    && normalizeText(account.account_number) === normalizeText(accountNumber)
    && normalizeText(account.bank_name) === normalizeText(bankName),
  )
  if (duplicate) return showToast('Số tài khoản này đã tồn tại trong cùng ngân hàng.', 'error')

  bankAccountSaving.value = true
  try {
    const id = bankAccountEditing.value?.id || makeId('bank')
    const saved = await saveDoc('payment_bank_accounts', {
      id,
      recipient_name: recipientName,
      account_number: accountNumber,
      bank_name: bankName,
      status: 'active',
      active: true,
      deleted: false,
      created_by: bankAccountEditing.value?.created_by || appUser.value?.email || '',
    }, id, { isCreate: !bankAccountEditing.value })
    const normalized = saved as PaymentBankAccount
    const index = bankAccounts.value.findIndex(account => account.id === id)
    if (index >= 0) bankAccounts.value[index] = normalized
    else bankAccounts.value.push(normalized)
    bankAccounts.value.sort((a, b) => `${a.bank_name} ${a.account_number}`.localeCompare(`${b.bank_name} ${b.account_number}`, 'vi'))
    if (form.recipient_account_id === id) syncRecipientSnapshot()
    showToast(bankAccountEditing.value ? 'Đã cập nhật tài khoản nhận tiền.' : 'Đã thêm tài khoản nhận tiền.', 'success')
    resetBankAccountForm()
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không lưu được tài khoản nhận tiền.'), 'error')
  } finally {
    bankAccountSaving.value = false
  }
}

async function removeBankAccount(account: PaymentBankAccount) {
  if (!isAdmin.value) return showToast('Chỉ admin được xóa tài khoản nhận tiền.', 'error')
  const confirmed = await askConfirm({
    title: 'Xóa tài khoản nhận tiền',
    message: `Bạn chắc chắn muốn xóa ${account.bank_name} - ${account.account_number}? Các phiếu thanh toán cũ vẫn giữ nguyên snapshot.`,
    confirmLabel: 'Xóa tài khoản',
  })
  if (!confirmed) return
  try {
    await softDeleteDoc('payment_bank_accounts', account.id, `${account.bank_name} - ${account.account_number}`)
    bankAccounts.value = bankAccounts.value.filter(item => item.id !== account.id)
    if (form.recipient_account_id === account.id) clearTransferSnapshot()
    if (bankAccountEditing.value?.id === account.id) resetBankAccountForm()
    showToast('Đã xóa tài khoản nhận tiền.', 'success')
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không xóa được tài khoản nhận tiền.'), 'error')
  }
}

function chooseOrder() {
  const order = selectedOrder.value
  if (!order) return
  form.order_id = order.id
  form.order_code = order.order_code
}

function openDetail(row: PaymentRow) {
  selectedDetail.value = row
  showDetailModal.value = true
}

function openModal(row?: PaymentRow) {
  if (row && !canEditPayment(row)) return showToast(paymentActionError('edit', row), 'error')
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
    recipient_account_id: '',
    recipient_name: '',
    recipient_account_number: '',
    recipient_bank_name: '',
    sender_image_url: '',
    note: '',
    status: 'active'
  })
  showModal.value = true
}

async function savePayment() {
  chooseOrder()
  if (!form.order_id) return showToast('Thiếu đơn hàng.', 'error')
  const order = selectedOrder.value
  if (!order) return showToast(`Không tìm thấy đơn hàng với mã: ${form.order_code || form.order_id}`, 'error')
  const action = editing.value ? 'edit' : 'create'
  if (!paymentActionDecision(action, editing.value, order).allowed) return showToast(paymentActionError(action, editing.value), 'error')
  if (!String(order.customer_name || '').trim()) return showToast('Đơn hàng chưa có thông tin khách hàng, không thể tạo thanh toán.', 'error')

  if (isBankTransfer.value) {
    if (!form.recipient_account_id || !selectedRecipientAccount.value) return showToast('Vui lòng chọn tài khoản người nhận.', 'error')
    syncRecipientSnapshot()
    const rawImageUrl = String(form.sender_image_url || '').trim()
    const imageUrl = normalizeHttpUrl(rawImageUrl)
    if (rawImageUrl && !imageUrl) return showToast('Link ảnh người gửi phải là địa chỉ web http hoặc https hợp lệ.', 'error')
    form.sender_image_url = imageUrl
  } else {
    clearTransferSnapshot()
  }

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

    const record = result.record as PaymentRow
    const index = rows.value.findIndex(row => row.id === record.id)
    if (index >= 0) rows.value[index] = { ...rows.value[index], ...record }
    else rows.value.unshift(record)
    Object.assign(order, result.orderPatch)
    showModal.value = false
    showToast(editing.value ? 'Đã cập nhật thanh toán và tổng hợp đơn hàng.' : 'Đã thêm thanh toán và cập nhật đơn hàng.', 'success')
  }).catch(error => {
    showToast(reportFirebaseError(
      error,
      editing.value ? 'Không cập nhật được thanh toán. Toàn bộ thay đổi đã hoàn tác.' : 'Không tạo được thanh toán. Toàn bộ thay đổi đã hoàn tác.',
      {
        operation: `payments.${action}`,
        record: form.id || form.order_id,
        status: editing.value?.status || form.status,
        actionPermission: `payments.${action}`,
        scopePermission: 'payments.view_all',
      },
    ), 'error')
  }).finally(() => {
    saving.value = false
  })
}

async function removePayment(row: PaymentRow) {
  const order = orders.value.find(item => item.id === row.order_id)
  if (!order) return showToast('Không tìm thấy đơn hàng cha của thanh toán.', 'error')
  if (!paymentActionDecision('delete', row, order).allowed) return showToast(paymentActionError('delete', row), 'error')
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
  }).catch(error => showToast(reportFirebaseError(error, 'Không xóa được thanh toán. Toàn bộ thay đổi đã hoàn tác.', {
    operation: 'payments.delete', record: row.id, status: row.status,
    actionPermission: 'payments.delete', scopePermission: 'payments.view_all',
  }), 'error'))
}

onMounted(() => {
  void Promise.all([loadRows(), loadBankAccounts()])
})
</script>

<template>
  <AppShell>
    <PageHeader title="Thanh toán" subtitle="Trạng thái thanh toán của đơn tự tính từ phiếu đã nhận">
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        <button v-if="isAdmin" class="btn" @click="openBankAccountSetup">Thiết lập tài khoản nhận</button>
        <button v-if="hasPermission('payments.create') || hasPermission('*')" class="btn primary" @click="openModal()">+ Thêm thanh toán</button>
      </div>
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
          <thead><tr><th>Mã đơn</th><th>Ngày</th><th>Loại</th><th>Số tiền</th><th>Phương thức</th><th>Tài khoản nhận</th><th>Ảnh người gửi</th><th>Trạng thái</th><th>Người tạo</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ row.order_code }}</b></td>
              <td>{{ row.payment_date }}</td>
              <td>{{ row.payment_type }}</td>
              <td>{{ money(row.amount) }}</td>
              <td>{{ row.method }}</td>
              <td style="min-width:220px">{{ recipientSummary(row) }}</td>
              <td style="max-width:260px">
                <a v-if="normalizeHttpUrl(row.sender_image_url)" :href="normalizeHttpUrl(row.sender_image_url)" target="_blank" rel="noopener noreferrer" style="word-break:break-all">{{ shortUrl(row.sender_image_url) }}</a>
                <span v-else>-</span>
              </td>
              <td><span class="badge green">{{ row.payment_status }}</span></td>
              <td>{{ row.created_by }}</td>
              <td><div class="action-buttons"><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button><button v-if="canEditPayment(row)" class="btn-sm" @click="openModal(row)">Sửa</button><button v-if="canDeletePayment(row)" class="btn-sm btn-delete" @click="removePayment(row)">Xóa</button></div></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="10" class="empty">Không có thanh toán phù hợp.</td></tr>
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

      <div v-if="isBankTransfer" class="card" style="margin-top:16px;padding:16px;background:#f8fafc">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px">
          <div>
            <strong>Thông tin chuyển khoản</strong>
            <div style="font-size:12px;color:#64748b;margin-top:4px">Phiếu lưu snapshot tài khoản nhận và không thay đổi khi Setup được chỉnh sửa sau này.</div>
          </div>
          <button v-if="isAdmin" type="button" class="btn-sm" @click="openBankAccountSetup">Thiết lập</button>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label>Tài khoản người nhận</label>
            <select v-model="form.recipient_account_id" class="select" :disabled="bankAccountsLoading" @change="syncRecipientSnapshot">
              <option value="">{{ bankAccountsLoading ? 'Đang tải...' : 'Chọn tài khoản nhận' }}</option>
              <option v-for="account in bankAccounts" :key="account.id" :value="account.id">{{ account.bank_name }} - {{ account.account_number }} - {{ account.recipient_name }}</option>
            </select>
            <small v-if="!bankAccountsLoading && !bankAccounts.length" style="color:#b45309">Chưa có tài khoản nhận tiền. Vui lòng liên hệ admin thiết lập.</small>
          </div>
          <div class="form-group">
            <label>Link ảnh người gửi / ảnh chuyển khoản</label>
            <input v-model.trim="form.sender_image_url" class="input" type="url" placeholder="https://..." />
          </div>
        </div>
        <div v-if="selectedRecipientAccount" class="detail-grid" style="margin-top:12px">
          <div class="detail-item"><label>Người nhận</label><strong>{{ form.recipient_name }}</strong></div>
          <div class="detail-item"><label>Số tài khoản</label><strong>{{ form.recipient_account_number }}</strong></div>
          <div class="detail-item"><label>Ngân hàng</label><strong>{{ form.recipient_bank_name }}</strong></div>
        </div>
      </div>

      <div class="form-group" style="margin-top:12px"><label>Ghi chú</label><textarea v-model="form.note" class="textarea" rows="3" /></div>
    </BaseModal>

    <BaseModal
      v-if="showBankSetupModal"
      title="Thiết lập tài khoản nhận tiền"
      size="xl"
      :show-footer="false"
      @close="showBankSetupModal=false"
    >
      <div class="card" style="padding:16px;margin-bottom:16px;background:#f8fafc">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px">
          <strong>{{ bankAccountEditing ? 'Sửa tài khoản nhận' : 'Thêm tài khoản nhận' }}</strong>
          <button v-if="bankAccountEditing" type="button" class="btn-sm" @click="resetBankAccountForm">Hủy sửa</button>
        </div>
        <div class="form-grid">
          <div class="form-group"><label>Tên người nhận</label><input v-model.trim="bankAccountForm.recipient_name" class="input" placeholder="NGUYEN VAN A" /></div>
          <div class="form-group"><label>Số tài khoản</label><input v-model.trim="bankAccountForm.account_number" class="input" inputmode="numeric" placeholder="0123456789" /></div>
          <div class="form-group"><label>Ngân hàng</label><input v-model.trim="bankAccountForm.bank_name" class="input" placeholder="Vietcombank" /></div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px">
          <button type="button" class="btn primary" :disabled="bankAccountSaving" @click="saveBankAccount">{{ bankAccountSaving ? 'Đang lưu...' : bankAccountEditing ? 'Cập nhật' : 'Thêm tài khoản' }}</button>
        </div>
      </div>

      <LoadingState v-if="bankAccountsLoading" />
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Ngân hàng</th><th>Số tài khoản</th><th>Tên người nhận</th><th>Người tạo</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="account in bankAccounts" :key="account.id">
              <td><b>{{ account.bank_name }}</b></td>
              <td>{{ account.account_number }}</td>
              <td>{{ account.recipient_name }}</td>
              <td>{{ account.created_by || '-' }}</td>
              <td><div class="action-buttons"><button class="btn-sm" @click="editBankAccount(account)">Sửa</button><button class="btn-sm btn-delete" @click="removeBankAccount(account)">Xóa</button></div></td>
            </tr>
            <tr v-if="!bankAccounts.length"><td colspan="5" class="empty">Chưa có tài khoản nhận tiền.</td></tr>
          </tbody>
        </table>
      </div>
    </BaseModal>

    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      title="Chi tiết thanh toán"
      :record="selectedDetail"
      :field-order="['id','order_id','order_code','payment_date','payment_type','amount','method','recipient_account_id','recipient_name','recipient_account_number','recipient_bank_name','sender_image_url','payment_status','cod_status','note','created_by','created_at','updated_at','order_owner_email','order_created_by','order_sale_email','relation_revision','last_operation_id','status','active','deleted']"
      :money-fields="['amount']"
      @close="showDetailModal = false"
    />

    <ConfirmModal v-bind="confirmState" @cancel="resolveConfirm(false)" @confirm="resolveConfirm(true)" />
  </AppShell>
</template>
