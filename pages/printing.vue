<script setup lang="ts">
import type {
  PrintOrderDoc,
  PrintOrderItemDoc,
  OrderDoc,
  OrderItemDoc,
  ProductDoc,
  SupplierDoc,
} from '~/types/models'
import type { PrintItemInput } from '~/composables/usePrintingProgress'
import {
  dateTimeLocal,
  formatDateTime,
  makeId,
  normalizeText,
  safeJsonParse,
  toNumber,
} from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

type PrintStatus = 'Đang in' | 'Cảnh báo' | 'Quá hạn' | 'Hoàn thành'

type PrintLineForm = {
  id?: string
  logo: string
  logo_color: string
  print_quantity: number
  actual_print_quantity: number
  print_started_at: string
  expected_done_at: string
  is_completed: boolean
  completed_at?: any
  note: string
}

type PrintProductForm = PrintLineForm & {
  key: string
  product_id: string
  use_logo: boolean
  logo_lines: PrintLineForm[]
}

const {
  loadPrintOrders,
  loadPrintOrderItems,
  loadPrintingSourceOrders,
  loadPrintingSourceOrderItems,
  loadProducts,
  loadSuppliers,
} = useScopedQueries()
const { savePrintOrder, deletePrintOrder } = usePrintingProgress()
const { appUser, authReady, isAdmin, permissions, hasPermission } = useAuth()
const { showToast } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()

const rows = ref<PrintOrderDoc[]>([])
const items = ref<PrintOrderItemDoc[]>([])
const products = ref<ProductDoc[]>([])
const suppliers = ref<SupplierDoc[]>([])
const sourceOrders = ref<OrderDoc[]>([])
const sourceOrderItems = ref<OrderItemDoc[]>([])
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const statusFilter = ref('')
const showFormModal = ref(false)
const showDetailModal = ref(false)
const editing = ref<PrintOrderDoc | null>(null)
const selected = ref<PrintOrderDoc | null>(null)
const statusTick = ref(Date.now())
let statusTimer: ReturnType<typeof setInterval> | null = null

const form = reactive<{
  order_id: string
  order_code: string
  am_code: string
  supplier_id: string
  note: string
  products: PrintProductForm[]
}>({
  order_id: '',
  order_code: '',
  am_code: '',
  supplier_id: '',
  note: '',
  products: [],
})

const canViewAll = computed(() => hasPermission('printing.view_all') || hasPermission('*'))
const canCreate = computed(() => hasPermission('printing.create') || hasPermission('*'))
const canEdit = computed(() => hasPermission('printing.edit') || hasPermission('*'))
const canDelete = computed(() => hasPermission('printing.delete') || hasPermission('*'))
const currentEmail = computed(() => String(appUser.value?.email || '').trim().toLowerCase())

function ownsPrintOrder(order: PrintOrderDoc | null | undefined) {
  return Boolean(order && String(order.created_by || '').trim().toLowerCase() === currentEmail.value)
}

function canEditOrder(order: PrintOrderDoc | null | undefined) {
  return isAdmin.value || (canEdit.value && ownsPrintOrder(order))
}

function canDeleteOrder(order: PrintOrderDoc | null | undefined) {
  return isAdmin.value || (canDelete.value && ownsPrintOrder(order))
}

function sourceLogoLines(item: OrderItemDoc) {
  const logos = safeJsonParse(item.logo_json, [])
  return Array.isArray(logos)
    ? logos.filter((line: any) => String(line?.logo || '').trim())
    : []
}

const printableOrderIds = computed(() => new Set(
  sourceOrderItems.value
    .filter(item => item.deleted !== true && sourceLogoLines(item).length > 0)
    .map(item => item.order_id),
))

const orderOptions = computed(() => sourceOrders.value
  .filter(order => printableOrderIds.value.has(order.id))
  .map(order => ({
    value: order.id,
    label: order.order_code,
    subLabel: [order.customer_name, order.customer_code, order.order_status].filter(Boolean).join(' · '),
    search: `${order.order_code} ${order.customer_name || ''} ${order.customer_code || ''} ${order.phone || ''}`,
  })))

const supplierOptions = computed(() => suppliers.value.map(supplier => ({
  value: supplier.id,
  label: supplier.name,
  subLabel: supplier.supplier_code || supplier.email || '',
  search: `${supplier.supplier_code || ''} ${supplier.name || ''} ${supplier.email || ''}`,
})))

function isCompleted(value: any) {
  return value === true || String(value || '').toUpperCase() === 'TRUE'
}

function toEpoch(value: any) {
  if (!value) return Number.NaN
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const epoch = new Date(value).getTime()
  return Number.isFinite(epoch) ? epoch : Number.NaN
}

function itemStatus(item: PrintOrderItemDoc): PrintStatus {
  statusTick.value
  if (isCompleted(item.is_completed)) return 'Hoàn thành'
  const due = toEpoch(item.expected_done_at)
  if (Number.isNaN(due)) return 'Đang in'
  const remaining = due - Date.now()
  if (remaining < 0) return 'Quá hạn'
  if (remaining <= 24 * 60 * 60 * 1000) return 'Cảnh báo'
  return 'Đang in'
}

function orderStatus(orderItems: PrintOrderItemDoc[]): PrintStatus {
  const statuses = orderItems.map(itemStatus)
  if (statuses.includes('Quá hạn')) return 'Quá hạn'
  if (statuses.includes('Cảnh báo')) return 'Cảnh báo'
  if (statuses.length && statuses.every(status => status === 'Hoàn thành')) return 'Hoàn thành'
  return 'Đang in'
}

function statusClass(status: PrintStatus) {
  if (status === 'Hoàn thành') return 'green'
  if (status === 'Quá hạn') return 'red'
  if (status === 'Cảnh báo') return 'yellow'
  return 'blue'
}

function itemsForOrder(order: PrintOrderDoc) {
  return items.value.filter(item => item.print_order_id === order.id)
}

function quantityText(value: any) {
  return toNumber(value).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
}

const visibleRows = computed(() => canViewAll.value
  ? rows.value
  : rows.value.filter(order => ownsPrintOrder(order)))

const enrichedRows = computed(() => visibleRows.value.map(order => {
  const detailItems = itemsForOrder(order)
  const unfinishedDueDates = detailItems
    .filter(item => !isCompleted(item.is_completed))
    .map(item => toEpoch(item.expected_done_at))
    .filter(epoch => !Number.isNaN(epoch))
  return {
    ...order,
    detailItems,
    print_status: orderStatus(detailItems),
    total_print_quantity: detailItems.reduce((sum, item) => sum + toNumber(item.print_quantity), 0),
    total_actual_quantity: detailItems.reduce((sum, item) => sum + toNumber(item.actual_print_quantity), 0),
    completed_count: detailItems.filter(item => isCompleted(item.is_completed)).length,
    next_due_at: unfinishedDueDates.length ? Math.min(...unfinishedDueDates) : null,
  }
}))

const filtered = computed(() => {
  const query = normalizeText(search.value)
  return enrichedRows.value.filter(row => {
    if (statusFilter.value && row.print_status !== statusFilter.value) return false
    if (!query) return true
    const itemText = row.detailItems.map(item =>
      `${item.product_code || ''} ${item.product_name || ''} ${item.logo || ''} ${item.logo_color || ''}`,
    ).join(' ')
    return normalizeText(
      `${row.order_code} ${row.am_code || ''} ${row.supplier_name || ''} ${row.note || ''} ${row.created_by || ''} ${itemText}`,
    ).includes(query)
  })
})

const summary = computed(() => {
  const statuses = enrichedRows.value.map(row => row.print_status)
  return {
    total: statuses.length,
    active: statuses.filter(status => status === 'Đang in').length,
    warning: statuses.filter(status => status === 'Cảnh báo').length,
    overdue: statuses.filter(status => status === 'Quá hạn').length,
    completed: statuses.filter(status => status === 'Hoàn thành').length,
  }
})

const selectedItems = computed(() => selected.value ? itemsForOrder(selected.value) : [])

function blankLine(item?: Partial<PrintOrderItemDoc>): PrintLineForm {
  return {
    id: item?.id,
    logo: String(item?.logo || ''),
    logo_color: String(item?.logo_color || ''),
    print_quantity: toNumber(item?.print_quantity),
    actual_print_quantity: toNumber(item?.actual_print_quantity),
    print_started_at: dateTimeLocal(item?.print_started_at),
    expected_done_at: dateTimeLocal(item?.expected_done_at),
    is_completed: isCompleted(item?.is_completed),
    completed_at: item?.completed_at,
    note: String(item?.note || ''),
  }
}

function blankProductGroup(item?: Partial<PrintOrderItemDoc>): PrintProductForm {
  return {
    key: makeId('print_group'),
    product_id: String(item?.product_id || ''),
    use_logo: false,
    logo_lines: [],
    ...blankLine(item),
  }
}

function groupsFromItems(orderItems: PrintOrderItemDoc[]) {
  const result: PrintProductForm[] = []
  const logoGroups = new Map<string, PrintProductForm>()

  orderItems.forEach(item => {
    if (!item.logo) {
      result.push(blankProductGroup(item))
      return
    }
    const productKey = item.product_id || item.product_code || item.id
    let group = logoGroups.get(productKey)
    if (!group) {
      group = blankProductGroup(item)
      group.id = undefined
      group.logo = ''
      group.print_quantity = 0
      group.actual_print_quantity = 0
      group.print_started_at = ''
      group.expected_done_at = ''
      group.is_completed = false
      group.completed_at = undefined
      group.note = ''
      group.use_logo = true
      logoGroups.set(productKey, group)
      result.push(group)
    }
    group.logo_lines.push(blankLine(item))
  })
  return result.length ? result : [blankProductGroup()]
}

function groupsFromSourceOrder(orderId: string) {
  const orderItems = sourceOrderItems.value.filter(item => item.order_id === orderId && item.deleted !== true)
  return orderItems.map(item => {
    const logos = sourceLogoLines(item)
    if (logos.length) {
      const group = blankProductGroup({
        product_id: item.product_id,
        product_code: item.product_code,
        product_name: item.product_name,
      })
      group.use_logo = true
      group.print_quantity = 0
      group.logo_lines = logos.map((line: any) => blankLine({
        logo: String(line.logo || ''),
        logo_color: String(line.logo_color || line.color || ''),
        print_quantity: toNumber(line.quantity ?? line.qty),
        actual_print_quantity: 0,
      }))
      return group
    }
    return blankProductGroup({
      product_id: item.product_id,
      product_code: item.product_code,
      product_name: item.product_name,
      print_quantity: toNumber(item.quantity),
      actual_print_quantity: 0,
    })
  }).filter(group => group.product_id && (
    group.use_logo
      ? group.logo_lines.some(line => toNumber(line.print_quantity) > 0)
      : toNumber(group.print_quantity) > 0
  ))
}

function chooseSourceOrder() {
  const order = sourceOrders.value.find(item => item.id === form.order_id)
  form.order_code = order?.order_code || ''
  form.products = order ? groupsFromSourceOrder(order.id) : []
  if (order && !form.products.length) {
    showToast('Đơn hàng đã chọn chưa có sản phẩm hợp lệ.', 'error')
  }
}

function resetForm(order?: PrintOrderDoc) {
  editing.value = order || null
  form.order_id = order?.order_id
    || sourceOrders.value.find(item => item.order_code === order?.order_code)?.id
    || ''
  form.order_code = order?.order_code || ''
  form.am_code = order?.am_code || String(appUser.value?.user_code || '').trim().toUpperCase()
  form.supplier_id = order?.supplier_id || ''
  form.note = order?.note || ''
  form.products = order ? groupsFromItems(itemsForOrder(order)) : []
}

function openCreateModal() {
  if (!canCreate.value) return showToast('Bạn không có quyền thêm tiến độ in ấn.', 'error')
  resetForm()
  showFormModal.value = true
}

function openEditModal(order: PrintOrderDoc) {
  if (!canEditOrder(order)) return showToast('Bạn chỉ được sửa tiến độ in ấn do mình tạo.', 'error')
  resetForm(order)
  showFormModal.value = true
}

function openDetail(order: PrintOrderDoc) {
  selected.value = order
  showDetailModal.value = true
}

function closeFormModal() {
  showFormModal.value = false
  editing.value = null
}

function selectedProduct(productId: string) {
  return products.value.find(product => product.id === productId)
}

function collectItems(): PrintItemInput[] {
  const result: PrintItemInput[] = []
  form.products.forEach((group, productIndex) => {
    const product = selectedProduct(group.product_id)
    if (!product) throw new Error(`Sản phẩm ${productIndex + 1}: vui lòng chọn sản phẩm.`)

    const appendLine = (line: PrintLineForm, lineLabel: string, logo = '') => {
      if (toNumber(line.print_quantity) <= 0) {
        throw new Error(`${lineLabel}: số lượng in phải lớn hơn 0.`)
      }
      if (toNumber(line.actual_print_quantity) < 0) {
        throw new Error(`${lineLabel}: số lượng in thực tế không được âm.`)
      }
      result.push({
        id: line.id,
        product,
        logo,
        logo_color: line.logo_color,
        print_quantity: toNumber(line.print_quantity),
        actual_print_quantity: toNumber(line.actual_print_quantity),
        print_started_at: line.print_started_at,
        expected_done_at: line.expected_done_at,
        is_completed: line.is_completed,
        completed_at: line.completed_at,
        note: line.note,
      })
    }

    if (group.use_logo) {
      if (!group.logo_lines.length) {
        throw new Error(`Sản phẩm ${productIndex + 1}: vui lòng thêm ít nhất một logo.`)
      }
      group.logo_lines.forEach((line, logoIndex) => {
        const logo = String(line.logo || '').trim()
        if (!logo) throw new Error(`Sản phẩm ${productIndex + 1}, logo ${logoIndex + 1}: vui lòng nhập tên logo.`)
        appendLine(line, `Sản phẩm ${productIndex + 1}, logo ${logoIndex + 1}`, logo)
      })
      return
    }
    appendLine(group, `Sản phẩm ${productIndex + 1}`)
  })
  return result
}

async function submitForm() {
  if (editing.value ? !canEditOrder(editing.value) : !canCreate.value) {
    return showToast(editing.value
      ? 'Bạn chỉ được sửa tiến độ in ấn do mình tạo.'
      : 'Bạn không có quyền tạo tiến độ in ấn.', 'error')
  }
  if (!form.order_id || !form.order_code) {
    return showToast('Vui lòng chọn mã đơn hàng.', 'error')
  }

  let printItems: PrintItemInput[]
  try {
    printItems = collectItems()
  } catch (error: any) {
    return showToast(error?.message || 'Dữ liệu sản phẩm in chưa hợp lệ.', 'error')
  }

  saving.value = true
  try {
    const isEditing = !!editing.value
    const supplier = suppliers.value.find(row => row.id === form.supplier_id)
      || (editing.value && form.supplier_id === editing.value.supplier_id
        ? ({ id: editing.value.supplier_id, name: editing.value.supplier_name || '' } as SupplierDoc)
        : null)
    const result = await savePrintOrder({
      order: editing.value,
      order_id: form.order_id,
      order_code: form.order_code,
      am_code: form.am_code,
      supplier,
      note: form.note,
      items: printItems,
      existingItems: editing.value ? itemsForOrder(editing.value) : [],
    })
    closeFormModal()
    showToast(isEditing ? `Đã cập nhật đơn in ${result.order_code}.` : `Đã thêm đơn in ${result.order_code}.`, 'success')
    await loadRows(true)
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không lưu được tiến độ in ấn.'), 'error')
  } finally {
    saving.value = false
  }
}

async function removeOrder(order: PrintOrderDoc) {
  if (!canDeleteOrder(order)) return showToast('Bạn chỉ được xóa tiến độ in ấn do mình tạo.', 'error')
  const confirmed = await askConfirm({
    title: 'Xóa tiến độ in ấn',
    message: `Bạn chắc chắn muốn xóa đơn in ${order.order_code}? Đơn và toàn bộ dòng tiến độ sẽ được xóa mềm.`,
    confirmLabel: 'Xóa đơn in',
  })
  if (!confirmed) return

  saving.value = true
  try {
    await deletePrintOrder(order, itemsForOrder(order))
    rows.value = rows.value.filter(row => row.id !== order.id)
    items.value = items.value.filter(item => item.print_order_id !== order.id)
    showToast(`Đã xóa đơn in ${order.order_code}.`, 'success')
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không xóa được tiến độ in ấn.'), 'error')
  } finally {
    saving.value = false
  }
}

async function loadRows(force = false) {
  loading.value = true
  try {
    const [orderRows, itemRows, sourceOrderRows, sourceItemRows, productRows, supplierRows] = await Promise.all([
      loadPrintOrders(force),
      loadPrintOrderItems(force),
      loadPrintingSourceOrders(force),
      loadPrintingSourceOrderItems(force),
      loadProducts(force, true),
      loadSuppliers(force),
    ])
    rows.value = orderRows
    items.value = itemRows
    sourceOrders.value = sourceOrderRows
    sourceOrderItems.value = sourceItemRows
    products.value = productRows
    suppliers.value = supplierRows
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được tiến độ in ấn.'), 'error')
  } finally {
    loading.value = false
  }
}

watch(
  () => `${authReady.value}|${appUser.value?.email || ''}|${permissions.value.slice().sort().join('|')}`,
  () => {
    if (!authReady.value || !appUser.value?.email) return
    void loadRows(true)
  },
  { immediate: true },
)

onMounted(() => {
  statusTimer = setInterval(() => { statusTick.value = Date.now() }, 60_000)
})

onBeforeUnmount(() => {
  if (statusTimer) clearInterval(statusTimer)
})
</script>

<template>
  <AppShell>
    <PageHeader title="Tiến độ in ấn" :subtitle="canViewAll ? 'Theo dõi tất cả tiến độ in theo sản phẩm hoặc logo' : 'Chỉ hiển thị tiến độ in do bạn tạo'">
      <button v-if="canCreate" class="btn primary" @click="openCreateModal">+ Thêm đơn in</button>
      <button class="btn" @click="loadRows(true)">Làm mới</button>
    </PageHeader>

    <div class="summary-grid printing-summary">
      <div class="summary-card"><label>Tổng đơn in</label><strong>{{ summary.total }}</strong></div>
      <div class="summary-card"><label>Đang in</label><strong>{{ summary.active }}</strong></div>
      <div class="summary-card warning-card"><label>Cảnh báo trong 24h</label><strong>{{ summary.warning }}</strong></div>
      <div class="summary-card overdue-card"><label>Quá hạn</label><strong>{{ summary.overdue }}</strong></div>
      <div class="summary-card complete-card"><label>Hoàn thành</label><strong>{{ summary.completed }}</strong></div>
    </div>

    <div class="card printing-card">
      <div class="toolbar printing-toolbar">
        <input
          v-model="search"
          class="input"
          placeholder="Tìm mã đơn, mã AM, nhà cung cấp, sản phẩm, logo, người tạo..."
        />
        <select v-model="statusFilter" class="select">
          <option value="">Tất cả trạng thái</option>
          <option>Đang in</option>
          <option>Cảnh báo</option>
          <option>Quá hạn</option>
          <option>Hoàn thành</option>
        </select>
      </div>

      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table class="printing-table">
          <thead>
            <tr>
              <th>Mã đơn hàng</th>
              <th>Mã AM</th>
              <th>Nhà cung cấp</th>
              <th>Tiến độ dòng</th>
              <th>SL dự kiến</th>
              <th>SL thực tế</th>
              <th>Hạn gần nhất</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ row.order_code }}</b><div class="small subtle">{{ row.created_by || '-' }}</div></td>
              <td>{{ row.am_code || '-' }}</td>
              <td>{{ row.supplier_name || '-' }}</td>
              <td><b>{{ row.completed_count }}/{{ row.detailItems.length }}</b> dòng</td>
              <td>{{ quantityText(row.total_print_quantity) }}</td>
              <td>{{ quantityText(row.total_actual_quantity) }}</td>
              <td>{{ row.next_due_at ? formatDateTime(row.next_due_at) : '-' }}</td>
              <td><span class="badge" :class="statusClass(row.print_status)">{{ row.print_status }}</span></td>
              <td>
                <div class="action-buttons">
                  <button class="btn-sm btn-view" @click="openDetail(row)">Chi tiết</button>
                  <button v-if="canEditOrder(row)" class="btn-sm" @click="openEditModal(row)">Sửa</button>
                  <button v-if="canDeleteOrder(row)" class="btn-sm btn-delete" @click="removeOrder(row)">Xóa</button>
                </div>
              </td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="9" class="empty">Chưa có tiến độ in ấn phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal
      v-if="showFormModal"
      :title="editing ? `Sửa tiến độ in ${editing.order_code}` : 'Thêm tiến độ in ấn'"
      size="full"
      :loading="saving"
      :save-label="editing ? 'Lưu tiến độ' : 'Tạo đơn in'"
      @close="closeFormModal"
      @save="submitForm"
    >
      <div class="form-grid printing-header-form">
        <div class="form-group">
          <label>Mã đơn hàng *</label>
          <SearchableSelect
            v-model="form.order_id"
            :options="orderOptions"
            placeholder="Tìm đơn có sản phẩm logo theo mã, khách hàng hoặc SĐT..."
            @change="chooseSourceOrder"
          />
          <div class="small subtle">Chỉ hiển thị đơn có ít nhất một sản phẩm logo.</div>
        </div>
        <div class="form-group">
          <label>Mã AM</label>
          <input v-model="form.am_code" class="input" placeholder="Nhập mã AM" />
        </div>
        <div class="form-group">
          <label>Nhà cung cấp</label>
          <SearchableSelect v-model="form.supplier_id" :options="supplierOptions" placeholder="Tìm và chọn nhà cung cấp" />
        </div>
      </div>

      <div class="form-group" style="margin-top: 12px">
        <label>Ghi chú đơn in</label>
        <textarea v-model="form.note" class="textarea" rows="2" placeholder="Ghi chú chung cho đơn in" />
      </div>

      <div class="form-section-label">
        <span>Sản phẩm in</span>
        <span class="product-row-count">{{ form.products.length }} nhóm sản phẩm</span>
      </div>

      <div v-for="(group, productIndex) in form.products" :key="group.key" class="product-row-card print-product-card">
        <div class="product-row-header">
          <span class="product-row-title">
            {{ productIndex + 1 }}. {{ selectedProduct(group.product_id)?.product_code || group.product_id }}
            - {{ selectedProduct(group.product_id)?.product_name || 'Sản phẩm trong đơn' }}
          </span>
        </div>

        <div v-if="!group.use_logo" class="print-fields-grid">
          <div class="form-group"><label>SL cần in</label><input :value="group.print_quantity" class="input readonly-field" readonly /></div>
          <div class="form-group"><label>SL in thực tế</label><input v-model.number="group.actual_print_quantity" class="input" type="number" min="0" step="1" /></div>
          <div class="form-group"><label>Bắt đầu in</label><input v-model="group.print_started_at" class="input" type="datetime-local" /></div>
          <div class="form-group"><label>Dự kiến xong</label><input v-model="group.expected_done_at" class="input" type="datetime-local" /></div>
          <div class="form-group"><label>Ghi chú dòng</label><input v-model="group.note" class="input" placeholder="Ghi chú" /></div>
          <label class="complete-checkbox"><input v-model="group.is_completed" type="checkbox" /> Hoàn thành</label>
        </div>

        <div v-else class="logo-items-box print-logo-box">
          <div class="logo-mode-note">Sản phẩm và số lượng theo logo được lấy tự động từ đơn hàng.</div>
          <div class="table-wrap">
            <table class="print-logo-table">
              <thead><tr><th>Logo</th><th>Màu logo</th><th>SL cần in</th><th>SL in thực tế</th><th>Bắt đầu in</th><th>Dự kiến xong</th><th>Ghi chú dòng</th><th>Hoàn thành</th></tr></thead>
              <tbody>
                <tr v-for="(line, logoIndex) in group.logo_lines" :key="line.id || logoIndex">
                  <td><input :value="line.logo" class="input readonly-field" readonly /></td>
                  <td><input v-model="line.logo_color" class="input" placeholder="VD: Đỏ, xanh navy..." /></td>
                  <td><input :value="line.print_quantity" class="input readonly-field" readonly /></td>
                  <td><input v-model.number="line.actual_print_quantity" class="input" type="number" min="0" step="1" /></td>
                  <td><input v-model="line.print_started_at" class="input" type="datetime-local" /></td>
                  <td><input v-model="line.expected_done_at" class="input" type="datetime-local" /></td>
                  <td><input v-model="line.note" class="input" placeholder="Ghi chú" /></td>
                  <td class="check-cell"><input v-model="line.is_completed" type="checkbox" /></td>
                </tr>
                <tr v-if="!group.logo_lines.length"><td colspan="8" class="empty">Đơn hàng chưa có dòng logo hợp lệ.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div v-if="!form.products.length" class="empty print-source-empty">Hãy chọn mã đơn hàng để tự động hiển thị sản phẩm.</div>
    </BaseModal>

    <BaseModal
      v-if="showDetailModal && selected"
      :title="`Chi tiết tiến độ in ${selected.order_code}`"
      size="full"
      :show-footer="false"
      @close="showDetailModal = false"
    >
      <div class="detail-grid">
        <div class="detail-item"><label>Mã đơn hàng</label><strong>{{ selected.order_code }}</strong></div>
        <div class="detail-item"><label>Mã AM</label><strong>{{ selected.am_code || '-' }}</strong></div>
        <div class="detail-item"><label>Nhà cung cấp</label><strong>{{ selected.supplier_name || '-' }}</strong></div>
        <div class="detail-item"><label>Người tạo</label><strong>{{ selected.created_by || '-' }}</strong></div>
        <div class="detail-item"><label>Ngày tạo</label><strong>{{ formatDateTime(selected.created_at) || '-' }}</strong></div>
        <div class="detail-item"><label>Ghi chú</label><strong>{{ selected.note || '-' }}</strong></div>
      </div>

      <div class="table-wrap">
        <table class="printing-detail-table">
          <thead><tr><th>Sản phẩm</th><th>Mã SP</th><th>Logo</th><th>Màu logo</th><th>SL in</th><th>SL thực tế</th><th>Bắt đầu in</th><th>Dự kiến xong</th><th>Hoàn thành lúc</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead>
          <tbody>
            <tr v-for="item in selectedItems" :key="item.id">
              <td>{{ item.product_name || '-' }}</td>
              <td><b>{{ item.product_code || '-' }}</b></td>
              <td><span v-if="item.logo" class="badge blue">{{ item.logo }}</span><span v-else>-</span></td>
              <td>{{ item.logo_color || '-' }}</td>
              <td>{{ quantityText(item.print_quantity) }}</td>
              <td>{{ quantityText(item.actual_print_quantity) }}</td>
              <td>{{ formatDateTime(item.print_started_at) || '-' }}</td>
              <td>{{ formatDateTime(item.expected_done_at) || '-' }}</td>
              <td>{{ isCompleted(item.is_completed) ? (formatDateTime(item.completed_at) || '-') : '-' }}</td>
              <td><span class="badge" :class="statusClass(itemStatus(item))">{{ itemStatus(item) }}</span></td>
              <td>{{ item.note || '-' }}</td>
            </tr>
            <tr v-if="!selectedItems.length"><td colspan="11" class="empty">Đơn in này chưa có sản phẩm.</td></tr>
          </tbody>
        </table>
      </div>
    </BaseModal>

    <ConfirmModal
      v-bind="confirmState"
      @cancel="resolveConfirm(false)"
      @confirm="resolveConfirm(true)"
    />
  </AppShell>
</template>

<style scoped>
.printing-card { margin: 24px; }
.printing-summary { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.warning-card strong { color: #b45309; }
.overdue-card strong { color: #b91c1c; }
.complete-card strong { color: #15803d; }
.printing-toolbar .input { max-width: 720px; }
.printing-toolbar .select { width: 220px; }
.printing-table { min-width: 1320px; }
.printing-header-form { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.print-fields-grid { display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr)) auto; gap: 10px; align-items: end; margin-top: 14px; }
.complete-checkbox { min-height: 44px; display: flex; align-items: center; gap: 8px; padding: 0 10px; font-weight: 800; white-space: nowrap; }
.print-logo-table { min-width: 1400px; }
.print-source-empty { margin-top: 12px; border: 1px dashed var(--line); border-radius: 12px; }
.printing-detail-table { min-width: 1650px; }
.check-cell { text-align: center; vertical-align: middle; }
.check-cell input, .complete-checkbox input { width: 18px; height: 18px; }
@media (max-width: 1180px) {
  .printing-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .printing-header-form, .print-fields-grid { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 700px) {
  .printing-card { margin: 12px 0; }
  .printing-summary, .printing-header-form, .print-fields-grid { grid-template-columns: 1fr; }
  .printing-toolbar .input, .printing-toolbar .select { max-width: none; width: 100%; }
}
</style>
