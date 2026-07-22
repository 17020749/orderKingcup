<script setup lang="ts">
import type {
  ImportOrderDoc,
  ImportOrderItemDoc,
  ProductDoc,
  SupplierDoc,
  WarehouseDoc,
} from '~/types/models'
import {
  formatDateTime,
  makeId,
  normalizeText,
  toNumber,
  todayKey,
} from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { appendUniqueRows } from '~/utils/cursorPagination.mjs'

const {
  loadImportOrdersPage,
  loadImportOrderItemsForOrders,
  loadProducts,
  loadWarehouses,
  loadSuppliers,
} = useScopedQueries()
const { createImportOrder, updateImportOrder, deleteImportOrder } = useWarehouseTransactions()
const { hasPermission } = useAuth()
const { showToast } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()

const loading = ref(false)
const saving = ref(false)
const search = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const supplierFilter = ref('')
const warehouseFilter = ref('')
const statusFilter = ref('')
const rows = ref<ImportOrderDoc[]>([])
const PAGE_SIZE = 50
const pageCursor = shallowRef<any>(null)
const hasMoreRows = ref(false)
const pageMode = ref<'cursor' | 'full'>('cursor')
const loadingMore = ref(false)
const items = ref<ImportOrderItemDoc[]>([])
const products = ref<ProductDoc[]>([])
const warehouses = ref<WarehouseDoc[]>([])
const suppliers = ref<SupplierDoc[]>([])
const selected = ref<ImportOrderDoc | null>(null)
const editing = ref<ImportOrderDoc | null>(null)
const showDetailModal = ref(false)
const showCreateModal = ref(false)

function newBlankLine() {
  return {
    product_id: '',
    warehouse_id: '',
    logo: '',
    quantity: 0,
    unit: '',
    unit_cost: 0,
    expiry_date: '',
    note: '',
  }
}

const form = reactive({
  import_date: todayKey(),
  supplier_id: '',
  note: '',
  operation_id: makeId('op_import_create'),
  lines: [newBlankLine()],
})

const canCreate = computed(() => hasPermission('*') || hasPermission('import.create'))
const canEdit = computed(() => hasPermission('*') || hasPermission('import.edit'))
const canDelete = computed(() => hasPermission('*') || hasPermission('import.delete'))

const supplierOptions = computed(() => suppliers.value.map(row => ({
  value: row.id,
  label: row.name || row.supplier_code || row.id,
  subLabel: [row.phone, row.email].filter(Boolean).join(' · '),
  search: `${row.name || ''} ${row.supplier_code || ''} ${row.phone || ''} ${row.email || ''}`,
})))

const productOptions = computed(() => products.value.map(row => ({
  value: row.id,
  label: `${row.product_code || ''} - ${row.product_name || ''}`,
  subLabel: row.unit || '',
  search: `${row.product_code || ''} ${row.product_name || ''} ${row.unit || ''}`,
})))

const warehouseOptions = computed(() => warehouses.value.map(row => ({
  value: row.id,
  label: row.name || row.warehouse_code || row.id,
  subLabel: row.address || '',
  search: `${row.name || ''} ${row.warehouse_code || ''} ${row.address || ''}`,
})))

const filterValues = computed(() => ({ supplier: supplierFilter.value, warehouse: warehouseFilter.value, status: statusFilter.value, from: dateFrom.value, to: dateTo.value }))
const toolbarFilters = computed(() => [
  { key: 'supplier', label: 'Nhà cung cấp', allLabel: 'Tất cả nhà cung cấp', options: supplierOptions.value.map(row => ({ label: row.label, value: row.value })) },
  { key: 'warehouse', label: 'Kho', allLabel: 'Tất cả kho', options: warehouseOptions.value.map(row => ({ label: row.label, value: row.value })) },
  { key: 'status', label: 'Trạng thái', allLabel: 'Tất cả trạng thái', options: [{ label: 'Đang hoạt động', value: 'active' }, { label: 'Đã khóa', value: 'inactive' }] },
  { key: 'from', label: 'Từ ngày', type: 'date' as const },
  { key: 'to', label: 'Đến ngày', type: 'date' as const },
])
function updateFilter(key: string, value: string) {
  if (key === 'supplier') supplierFilter.value = value
  if (key === 'warehouse') warehouseFilter.value = value
  if (key === 'status') statusFilter.value = value
  if (key === 'from') dateFrom.value = value
  if (key === 'to') dateTo.value = value
}

const itemsByOrder = computed(() => {
  const map = new Map<string, ImportOrderItemDoc[]>()
  items.value.forEach(item => {
    const key = String(item.import_order_id || '')
    if (!key) return
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  })
  return map
})

function lineCost(item: any) {
  return Math.round((toNumber(item.line_cost) || toNumber(item.quantity) * toNumber(item.unit_cost)) * 100) / 100
}

const enrichedRows = computed(() => rows.value.map(row => {
  const orderItems = itemsByOrder.value.get(row.id) || []
  return {
    ...row,
    item_count: orderItems.length,
    total_quantity: orderItems.reduce((sum, item) => sum + toNumber(item.quantity), 0),
    total_cost: toNumber((row as any).total_cost) || orderItems.reduce((sum, item) => sum + lineCost(item), 0),
    warehouse_ids: orderItems.map(item => String(item.warehouse_id || '')).filter(Boolean),
    product_search_text: orderItems
      .map(item => `${item.product_code || ''} ${item.product_name || ''} ${item.logo || ''} ${item.unit || ''}`)
      .join(' '),
  }
}))

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return enrichedRows.value.filter(row => {
    const rowDate = String(row.import_date || row.created_at || '').slice(0, 10)
    const matchedDateFrom = !dateFrom.value || rowDate >= dateFrom.value
    const matchedDateTo = !dateTo.value || rowDate <= dateTo.value
    const matchedSupplier = !supplierFilter.value || row.supplier_id === supplierFilter.value
    const matchedWarehouse = !warehouseFilter.value || row.warehouse_ids.includes(warehouseFilter.value)
    const matchedStatus = !statusFilter.value || String(row.status || 'active') === statusFilter.value
    const matchedText = !keyword || normalizeText([
      row.code,
      row.import_code,
      row.supplier_name,
      row.created_by,
      row.status,
      row.note,
      row.product_search_text,
    ].join(' ')).includes(keyword)
    return matchedDateFrom && matchedDateTo && matchedSupplier && matchedWarehouse && matchedStatus && matchedText
  })
})

function resetFilters() {
  search.value = ''
  dateFrom.value = ''
  dateTo.value = ''
  supplierFilter.value = ''
  warehouseFilter.value = ''
  statusFilter.value = ''
}

const summary = computed(() => ({
  orders: filtered.value.length,
  lines: filtered.value.reduce((sum, row) => sum + toNumber(row.item_count), 0),
  quantity: filtered.value.reduce((sum, row) => sum + toNumber(row.total_quantity), 0),
  cost: filtered.value.reduce((sum, row) => sum + toNumber(row.total_cost), 0),
}))

const selectedItems = computed(() => selected.value ? itemsByOrder.value.get(selected.value.id) || [] : [])
const formTotalQuantity = computed(() => form.lines.reduce((sum, line) => sum + toNumber(line.quantity), 0))
const formTotalCost = computed(() => form.lines.reduce((sum, line) => sum + toNumber(line.quantity) * toNumber(line.unit_cost), 0))

function itemsForOrder(row: ImportOrderDoc | null) {
  return row ? itemsByOrder.value.get(row.id) || [] : []
}

function findProduct(id: string) {
  return products.value.find(row => row.id === id)
}

function findWarehouse(id: string) {
  return warehouses.value.find(row => row.id === id)
}

function findSupplier(id: string) {
  return suppliers.value.find(row => row.id === id)
}

function codeOf(row: ImportOrderDoc) {
  return row.code || row.import_code || row.id
}

function quantityText(value: any) {
  return toNumber(value).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
}

function currencyText(value: any) {
  return toNumber(value).toLocaleString('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  })
}

function openDetail(row: ImportOrderDoc) {
  selected.value = row
  showDetailModal.value = true
}

function openCreateModal() {
  editing.value = null
  Object.assign(form, {
    import_date: todayKey(),
    supplier_id: '',
    note: '',
    operation_id: makeId('op_import_create'),
    lines: [newBlankLine()],
  })
  showCreateModal.value = true
}

function openEditModal(row: ImportOrderDoc) {
  if (!canEdit.value) return showToast('Không thể sửa phiếu nhập kho. Thiếu quyền: [import.edit].', 'error')
  editing.value = row
  const orderItems = itemsForOrder(row)
  Object.assign(form, {
    import_date: String(row.import_date || todayKey()).slice(0, 10),
    supplier_id: row.supplier_id || '',
    note: row.note || '',
    operation_id: makeId('op_import_update'),
    lines: orderItems.length
      ? orderItems.map(item => ({
          product_id: item.product_id || '',
          warehouse_id: item.warehouse_id || '',
          logo: item.logo || '',
          quantity: toNumber(item.quantity),
          unit: item.unit || '',
          unit_cost: toNumber((item as any).unit_cost),
          expiry_date: String((item as any).expiry_date || '').slice(0, 10),
          note: item.note || '',
        }))
      : [newBlankLine()],
  })
  showCreateModal.value = true
}

async function confirmDeleteImport(row: ImportOrderDoc) {
  if (!canDelete.value) return showToast('Không thể xóa phiếu nhập kho. Thiếu quyền: [import.delete].', 'error')
  const ok = await askConfirm({
    title: 'Xóa phiếu nhập kho',
    message: `Bạn chắc chắn muốn xóa mềm phiếu ${codeOf(row)}? Chỉ được xóa khi các lô của phiếu chưa được xuất.`,
    confirmLabel: 'Xóa phiếu',
  })
  if (!ok) return
  saving.value = true
  try {
    const result = await deleteImportOrder({
      order: row,
      existingItems: itemsForOrder(row),
      reason: 'Xóa phiếu nhập kho',
      operation_id: `import_delete:${row.id}:${toNumber((row as any).revision)}`,
      expected_revision: toNumber((row as any).revision),
    })
    showToast(`Đã xóa phiếu nhập ${result.code}.`, 'success')
    await loadRows(true)
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không xóa được phiếu nhập kho.'), 'error')
  } finally {
    saving.value = false
  }
}

function addLine() {
  form.lines.push(newBlankLine())
}

function removeLine(index: number) {
  if (form.lines.length <= 1) {
    form.lines[0] = newBlankLine()
    return
  }
  form.lines.splice(index, 1)
}

function onProductChanged(line: any) {
  const product = findProduct(line.product_id)
  if (!product) return
  if (!line.unit) line.unit = product.unit || ''
  if (!toNumber(line.unit_cost) && toNumber(product.cost_price) > 0) line.unit_cost = toNumber(product.cost_price)
}

async function saveImportOrder() {
  const validLines = form.lines.filter(line => line.product_id && line.warehouse_id && toNumber(line.quantity) > 0)
  if (!validLines.length) return showToast('Vui lòng nhập ít nhất một dòng sản phẩm, kho và số lượng hợp lệ.', 'error')

  const invalidPriceIndex = validLines.findIndex(line => toNumber(line.unit_cost) <= 0)
  if (invalidPriceIndex >= 0) return showToast(`Dòng ${invalidPriceIndex + 1}: giá nhập phải lớn hơn 0.`, 'error')

  saving.value = true
  try {
    const payload = {
      import_date: form.import_date,
      supplier: findSupplier(form.supplier_id) || null,
      note: form.note,
      operation_id: form.operation_id,
      lines: validLines.map(line => ({
        product: findProduct(line.product_id),
        warehouse: findWarehouse(line.warehouse_id),
        logo: line.logo,
        quantity: toNumber(line.quantity),
        unit: line.unit || findProduct(line.product_id)?.unit || '',
        unit_cost: toNumber(line.unit_cost),
        expiry_date: line.expiry_date || '',
        note: line.note,
      })),
    }
    const result = editing.value
      ? await updateImportOrder({
          order: editing.value,
          existingItems: itemsForOrder(editing.value),
          expected_revision: toNumber((editing.value as any).revision),
          ...payload,
        })
      : await createImportOrder(payload)
    showCreateModal.value = false
    showToast(`${editing.value ? 'Đã sửa' : 'Đã tạo'} phiếu nhập ${result.code}.`, 'success')
    editing.value = null
    await loadRows(true)
  } catch (error) {
    showToast(reportFirebaseError(error, editing.value ? 'Không sửa được phiếu nhập kho.' : 'Không tạo được phiếu nhập kho.'), 'error')
  } finally {
    saving.value = false
  }
}

async function loadRows(force = false, append = false) {
  if (append && (!hasMoreRows.value || loadingMore.value)) return
  if (append) loadingMore.value = true
  else loading.value = true
  try {
    const pagePromise = loadImportOrdersPage(append ? pageCursor.value : null, PAGE_SIZE)
    const referencesPromise = append
      ? Promise.resolve([products.value, warehouses.value, suppliers.value] as const)
      : Promise.all([loadProducts(force), loadWarehouses(force), loadSuppliers(force)])
    const [page, [productRows, warehouseRows, supplierRows]] = await Promise.all([pagePromise, referencesPromise])
    const itemRows = await loadImportOrderItemsForOrders(page.rows)
    rows.value = append ? appendUniqueRows(rows.value, page.rows) : page.rows
    items.value = append ? appendUniqueRows(items.value, itemRows) : itemRows
    if (!append) {
      products.value = productRows
      warehouses.value = warehouseRows
      suppliers.value = supplierRows
    }
    pageCursor.value = page.cursor
    hasMoreRows.value = page.hasMore
    pageMode.value = page.mode
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được phiếu nhập kho.'), 'error')
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadMoreRows() { await loadRows(false, true) }

onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Nhập kho" subtitle="Mỗi dòng nhập tạo một lô tồn riêng với giá nhập riêng">
      <button v-if="canCreate" class="btn primary" @click="openCreateModal">+ Tạo phiếu nhập</button>
      <button class="btn" @click="loadRows(true)">Làm mới</button>
    </PageHeader>

    <div class="summary-grid">
      <div class="summary-card"><label>Số phiếu</label><strong>{{ summary.orders.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Số dòng hàng</label><strong>{{ summary.lines.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Tổng SL nhập</label><strong>{{ quantityText(summary.quantity) }}</strong></div>
      <div class="summary-card"><label>Tổng giá trị nhập</label><strong>{{ currencyText(summary.cost) }}</strong></div>
    </div>

    <div class="card" style="margin: 24px;">
      <FilterToolbar v-model:search="search" search-placeholder="Tìm mã phiếu, nhà cung cấp, sản phẩm..." :filters="toolbarFilters" :values="filterValues" :result-count="filtered.length" :loading="loading" show-refresh @update:filter="updateFilter" @reset="resetFilters" @refresh="loadRows(true)" />
      <div v-if="false" class="toolbar">
        <input v-model="search" class="input" style="max-width: 360px" placeholder="Tìm mã phiếu, nhà cung cấp, tên/mã sản phẩm, người tạo, ghi chú..." />
        <input v-model="dateFrom" class="input" type="date" style="max-width: 160px" title="Từ ngày" />
        <input v-model="dateTo" class="input" type="date" style="max-width: 160px" title="Đến ngày" />
        <select v-model="supplierFilter" class="select" style="max-width: 220px">
          <option value="">Tất cả nhà cung cấp</option>
          <option v-for="supplier in suppliers" :key="supplier.id" :value="supplier.id">{{ supplier.name || supplier.supplier_code || supplier.id }}</option>
        </select>
        <select v-model="warehouseFilter" class="select" style="max-width: 220px">
          <option value="">Tất cả kho nhập</option>
          <option v-for="warehouse in warehouses" :key="warehouse.id" :value="warehouse.id">{{ warehouse.name || warehouse.warehouse_code || warehouse.id }}</option>
        </select>
        <select v-model="statusFilter" class="select" style="max-width: 180px">
          <option value="">Tất cả trạng thái</option>
<option value="active">Đang hoạt động</option>
<option value="cancelled">Đã hủy</option>
<option value="deleted">Đã xóa</option>
        </select>
        <button class="btn" type="button" @click="resetFilters">Xóa lọc</button>
      </div>

      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table style="min-width: 1220px">
          <thead><tr><th>Mã phiếu</th><th>Ngày nhập</th><th>Nhà cung cấp</th><th>Số dòng</th><th>Tổng SL</th><th>Tổng giá trị</th><th>Người tạo</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ codeOf(row) }}</b><div class="small subtle">{{ row.id }}</div></td>
              <td>{{ formatDateTime(row.import_date || row.created_at) }}</td>
              <td>{{ row.supplier_name || '-' }}</td>
              <td>{{ row.item_count }}</td>
              <td><b>{{ quantityText(row.total_quantity) }}</b></td>
              <td><b>{{ currencyText(row.total_cost) }}</b></td>
              <td>{{ row.created_by || '-' }}</td>
              <td><span class="badge blue">{{ row.status || 'active' }}</span></td>
              <td><div class="action-buttons">
                <button class="btn-sm btn-view" @click="openDetail(row)">Xem chi tiết</button>
                <button v-if="canEdit" class="btn-sm" @click="openEditModal(row)">Sửa</button>
                <button v-if="canDelete" class="btn-sm btn-delete" @click="confirmDeleteImport(row)">Xóa</button>
              </div></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="9" class="empty">Không có phiếu nhập kho.</td></tr>
          </tbody>
        </table>
      </div>
      <CursorLoadMore :loaded-count="rows.length" :has-more="hasMoreRows" :loading="loadingMore" :mode="pageMode" @load-more="loadMoreRows" />
    </div>

    <BaseModal
      v-if="showCreateModal"
      :title="editing ? `Sửa phiếu nhập ${codeOf(editing)}` : 'Tạo phiếu nhập kho'"
      size="xl"
      :loading="saving"
      :save-label="editing ? 'Lưu sửa phiếu nhập' : 'Tạo phiếu nhập'"
      @close="showCreateModal = false; editing = null"
      @save="saveImportOrder"
    >
      <div class="form-grid">
        <div class="form-group"><label>Ngày nhập</label><input v-model="form.import_date" class="input" type="date" /></div>
        <div class="form-group"><label>Nhà cung cấp</label><SearchableSelect v-model="form.supplier_id" :options="supplierOptions" placeholder="Chọn nhà cung cấp" /></div>
      </div>

      <div class="table-wrap" style="margin-top: 14px">
        <table style="min-width: 1420px">
          <thead><tr><th>Sản phẩm</th><th>Kho nhập</th><th>Logo</th><th>Đơn vị</th><th>Số lượng</th><th>Giá nhập</th><th>Thành tiền</th><th>Hạn dùng</th><th>Ghi chú</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(line, index) in form.lines" :key="index">
              <td><SearchableSelect v-model="line.product_id" :options="productOptions" placeholder="Tìm theo mã hoặc tên sản phẩm" @change="onProductChanged(line)" /></td>
              <td><SearchableSelect v-model="line.warehouse_id" :options="warehouseOptions" placeholder="Chọn kho" /></td>
              <td><input v-model="line.logo" class="input" placeholder="Để trống nếu không logo" /></td>
              <td><input v-model="line.unit" class="input" placeholder="Đơn vị" /></td>
              <td><input v-model.number="line.quantity" class="input" type="number" min="0" step="1" /></td>
              <td><input v-model.number="line.unit_cost" class="input" type="number" min="0" step="100" placeholder="Giá của lần nhập này" /></td>
              <td><b>{{ currencyText(toNumber(line.quantity) * toNumber(line.unit_cost)) }}</b></td>
              <td><input v-model="line.expiry_date" class="input" type="date" /></td>
              <td><input v-model="line.note" class="input" placeholder="Ghi chú dòng" /></td>
              <td><button class="btn-sm btn-delete" type="button" @click="removeLine(index)">Xóa</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <button class="btn" type="button" style="margin-top: 10px" @click="addLine">+ Thêm dòng</button>
      <div class="detail-grid" style="margin-top: 12px">
        <div class="detail-item"><label>Tổng số lượng</label><strong>{{ quantityText(formTotalQuantity) }}</strong></div>
        <div class="detail-item"><label>Tổng giá trị nhập</label><strong>{{ currencyText(formTotalCost) }}</strong></div>
      </div>
      <div class="form-group" style="margin-top: 12px"><label>Ghi chú phiếu</label><textarea v-model="form.note" class="textarea" rows="3" /></div>
      <p class="small subtle">Giá nhập chỉ được lưu ở dữ liệu phiếu nhập. Phiếu xuất và màn hình xử lý yêu cầu kho không nhận trường giá này.</p>
    </BaseModal>

    <BaseModal v-if="showDetailModal && selected" :title="`Chi tiết nhập kho ${codeOf(selected)}`" size="xl" :show-footer="false" @close="showDetailModal = false">
      <div class="detail-grid">
        <div class="detail-item"><label>Mã phiếu</label><strong>{{ codeOf(selected) }}</strong></div>
        <div class="detail-item"><label>Ngày nhập</label><strong>{{ formatDateTime(selected.import_date || selected.created_at) }}</strong></div>
        <div class="detail-item"><label>Nhà cung cấp</label><strong>{{ selected.supplier_name || '-' }}</strong></div>
        <div class="detail-item"><label>Tổng giá trị</label><strong>{{ currencyText((selected as any).total_cost || selectedItems.reduce((sum, item) => sum + lineCost(item), 0)) }}</strong></div>
        <div class="detail-item"><label>Người tạo</label><strong>{{ selected.created_by || '-' }}</strong></div>
        <div class="detail-item"><label>Ghi chú</label><strong>{{ selected.note || '-' }}</strong></div>
      </div>

      <div class="table-wrap">
        <table style="min-width: 1220px">
          <thead><tr><th>Sản phẩm</th><th>Kho</th><th>Logo</th><th>Đơn vị</th><th>Số lượng</th><th>Giá nhập</th><th>Thành tiền</th><th>Mã lô</th><th>Hạn dùng</th><th>Ghi chú</th></tr></thead>
          <tbody>
            <tr v-for="item in selectedItems" :key="item.id">
              <td><b>{{ item.product_code }}</b><div class="small subtle">{{ item.product_name }}</div></td>
              <td>{{ item.warehouse_name || item.warehouse_id || '-' }}</td>
              <td>{{ item.logo || 'Không logo' }}</td>
              <td>{{ item.unit || '-' }}</td>
              <td><b>{{ quantityText(item.quantity) }}</b></td>
              <td>{{ currencyText((item as any).unit_cost) }}</td>
              <td><b>{{ currencyText(lineCost(item)) }}</b></td>
              <td><span class="small">{{ (item as any).lot_id || '-' }}</span></td>
              <td>{{ (item as any).expiry_date || '-' }}</td>
              <td>{{ item.note || '-' }}</td>
            </tr>
            <tr v-if="!selectedItems.length"><td colspan="10" class="empty">Phiếu này chưa có dòng chi tiết.</td></tr>
          </tbody>
        </table>
      </div>
    </BaseModal>

    <ConfirmModal v-bind="confirmState" @cancel="resolveConfirm(false)" @confirm="resolveConfirm(true)" />
  </AppShell>
</template>
