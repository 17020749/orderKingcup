<script setup lang="ts">
import { deleteField } from 'firebase/firestore'
import type { ProductDoc } from '~/types/models'
import { formatDateTime, makeId, normalizeText, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
import { matchesKeyword, uniqueOptions } from '~/utils/listFilters'

const { appUser, hasPermission } = useAuth()
const { loadProducts } = useScopedQueries()
const { saveDoc, softDeleteDoc } = useRepo()
const { showToast, withLoading } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()

const loading = ref(false)
const saving = ref(false)
const search = ref('')
const statusFilter = ref('')
const categoryFilter = ref('')
const unitFilter = ref('')
const rows = ref<ProductDoc[]>([])
const showModal = ref(false)
const showDetailModal = ref(false)
const editing = ref<ProductDoc | null>(null)
const selected = ref<ProductDoc | null>(null)
const form = reactive<any>({})

const canCreate = computed(() => hasPermission('*') || hasPermission('products.create'))
const canEdit = computed(() => hasPermission('*') || hasPermission('products.edit'))
const canDelete = computed(() => hasPermission('*') || hasPermission('products.delete'))

const productDetailLabels: Record<string, string> = {
  product_code: 'Mã sản phẩm', product_name: 'Tên sản phẩm', name: 'Tên cũ', unit: 'Đơn vị',
  category: 'Nhóm sản phẩm', product_group: 'Nhóm sản phẩm đồng bộ', packing_standard: 'Quy cách đóng gói',
  material: 'Chất liệu', color: 'Màu sắc', size: 'Kích thước', description: 'Mô tả',
  selling_price: 'Giá bán', warehouse_source: 'Nguồn đồng bộ',
  out_of_stock_max: 'Hết hàng khi tồn cuối ≤', out_of_stock_threshold: 'Ngưỡng hết hàng cũ',
  sold_out_max: 'Ngưỡng hết hàng đồng bộ', warning_stock_min: 'Cảnh báo từ',
  warning_stock_max: 'Cảnh báo đến', normal_stock_min: 'Bình thường khi tồn cuối ≥',
  normal_stock_threshold: 'Ngưỡng bình thường cũ', status: 'Trạng thái', note: 'Ghi chú'
}

function withoutLegacyCost<T extends Record<string, any>>(row: T): T {
  const cleaned = { ...row }
  delete cleaned.cost_price
  return cleaned
}

function productStatus(row: ProductDoc) {
  if (row.active === false) return 'inactive'
  const value = normalizeText(row.status || 'active')
  return ['inactive', 'ngung ban'].includes(value) ? 'inactive' : 'active'
}

function stockValue(row: ProductDoc, field: string, aliases: string[] = []) {
  const raw = (row as any)[field] ?? aliases.map(alias => (row as any)[alias]).find(value => value !== undefined && value !== null && value !== '')
  return toNumber(raw)
}

const categoryOptions = computed(() => uniqueOptions(rows.value, 'category'))
const unitOptions = computed(() => uniqueOptions(rows.value, 'unit'))
const filterValues = computed(() => ({ status: statusFilter.value, category: categoryFilter.value, unit: unitFilter.value }))
const toolbarFilters = computed(() => [
  { key: 'status', label: 'Trạng thái', allLabel: 'Tất cả trạng thái', width: '180px', options: [
    { label: 'Đang bán', value: 'active' },
    { label: 'Ngừng bán', value: 'inactive' },
  ] },
  { key: 'category', label: 'Nhóm sản phẩm', allLabel: 'Tất cả nhóm', width: '220px', options: categoryOptions.value.map(category => ({ label: category, value: normalizeText(category) })) },
  { key: 'unit', label: 'Đơn vị', allLabel: 'Tất cả đơn vị', width: '180px', options: unitOptions.value.map(unit => ({ label: unit, value: normalizeText(unit) })) },
])

function updateFilter(key: string, value: string) {
  if (key === 'status') statusFilter.value = value
  if (key === 'category') categoryFilter.value = value
  if (key === 'unit') unitFilter.value = value
}

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return rows.value.filter(row => {
    const matchedText = matchesKeyword([row.product_code, row.product_name, row.unit, row.category], keyword)
    const matchedStatus = !statusFilter.value || productStatus(row) === statusFilter.value
    const matchedCategory = !categoryFilter.value || normalizeText(row.category) === categoryFilter.value
    const matchedUnit = !unitFilter.value || normalizeText(row.unit) === unitFilter.value
    return matchedText && matchedStatus && matchedCategory && matchedUnit
  })
})

function resetFilters() {
  search.value = ''
  statusFilter.value = ''
  categoryFilter.value = ''
  unitFilter.value = ''
}

async function loadRows(force = false) {
  loading.value = true
  try {
    rows.value = (await loadProducts(force, true)).map(row => withoutLegacyCost(row as any))
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được sản phẩm.'), 'error')
  } finally {
    loading.value = false
  }
}

function emptyProduct() {
  return {
    id: makeId('prd'),
    product_code: '',
    product_name: '',
    unit: '',
    category: '',
    packing_standard: '',
    note: '',
    status: 'active',
    out_of_stock_max: 0,
    warning_stock_min: 1,
    warning_stock_max: 10,
    normal_stock_min: 11,
    created_by: appUser.value?.email || ''
  }
}

function openModal(row?: ProductDoc) {
  if (row && !canEdit.value) return showToast('Bạn không có quyền sửa sản phẩm.', 'error')
  if (!row && !canCreate.value) return showToast('Bạn không có quyền thêm sản phẩm.', 'error')

  editing.value = row || null
  const source = withoutLegacyCost((row || emptyProduct()) as any)
  Object.assign(form, {
    ...source,
    out_of_stock_max: stockValue(source, 'out_of_stock_max', ['out_of_stock_threshold', 'sold_out_max']),
    warning_stock_min: stockValue(source, 'warning_stock_min'),
    warning_stock_max: stockValue(source, 'warning_stock_max'),
    normal_stock_min: stockValue(source, 'normal_stock_min', ['normal_stock_threshold'])
  })
  delete form.cost_price
  showModal.value = true
}

function openDetail(row: ProductDoc) {
  selected.value = withoutLegacyCost(row as any)
  showDetailModal.value = true
}

function validateProduct() {
  const code = String(form.product_code || '').trim()
  const name = String(form.product_name || '').trim()
  const unit = String(form.unit || '').trim()
  if (!code) return 'Vui lòng nhập mã sản phẩm.'
  if (!name) return 'Vui lòng nhập tên sản phẩm.'
  if (!unit) return 'Vui lòng chọn hoặc nhập đơn vị.'

  const duplicate = rows.value.find(row => row.id !== form.id && normalizeText(row.product_code) === normalizeText(code))
  if (duplicate) return `Mã sản phẩm ${code} đã tồn tại.`

  const outMax = toNumber(form.out_of_stock_max)
  const warningMin = toNumber(form.warning_stock_min)
  const warningMax = toNumber(form.warning_stock_max)
  const normalMin = toNumber(form.normal_stock_min)
  if (warningMin <= outMax) return 'Mức cảnh báo từ phải lớn hơn mức hết hàng.'
  if (warningMax < warningMin) return 'Mức cảnh báo đến phải lớn hơn hoặc bằng mức cảnh báo từ.'
  if (normalMin <= warningMax) return 'Mức bình thường phải lớn hơn mức cảnh báo đến.'
  return ''
}

async function saveProduct() {
  const validation = validateProduct()
  if (validation) return showToast(validation, 'error')

  saving.value = true
  await withLoading(async () => {
    const payload = {
      ...withoutLegacyCost(form),
      cost_price: deleteField(),
      product_code: String(form.product_code || '').trim(),
      product_name: String(form.product_name || '').trim(),
      unit: String(form.unit || '').trim(),
      status: form.status || 'active',
      active: (form.status || 'active') !== 'inactive',
      deleted: false,
      out_of_stock_max: toNumber(form.out_of_stock_max),
      warning_stock_min: toNumber(form.warning_stock_min),
      warning_stock_max: toNumber(form.warning_stock_max),
      normal_stock_min: toNumber(form.normal_stock_min),
      created_by: editing.value?.created_by || appUser.value?.email || '',
      search_text: normalizeText(`${form.product_code} ${form.product_name} ${form.unit}`)
    }
    const saved = await saveDoc('products', payload, form.id, { isCreate: !editing.value }) as ProductDoc
    const record = withoutLegacyCost(saved as any) as ProductDoc

    const index = rows.value.findIndex(row => row.id === record.id)
    if (index >= 0) rows.value[index] = { ...rows.value[index], ...record }
    else rows.value.unshift(record)
    rows.value.sort((a, b) => String(a.product_name || '').localeCompare(String(b.product_name || ''), 'vi'))
    showModal.value = false
    showToast(editing.value ? 'Đã cập nhật sản phẩm.' : 'Đã thêm sản phẩm.', 'success')
  }).catch(error => {
    showToast(reportFirebaseError(error, editing.value ? 'Không sửa được sản phẩm.' : 'Không thêm được sản phẩm.'), 'error')
  }).finally(() => {
    saving.value = false
  })
}

async function removeProduct(row: ProductDoc) {
  if (!canDelete.value) return showToast('Bạn không có quyền xóa sản phẩm.', 'error')
  const confirmed = await askConfirm({
    title: 'Xóa sản phẩm',
    message: `Bạn chắc chắn muốn xóa sản phẩm ${row.product_code} - ${row.product_name}?\nSản phẩm sẽ được ẩn nhưng dữ liệu cũ trong đơn hàng vẫn được giữ.`,
    confirmLabel: 'Xóa sản phẩm'
  })
  if (!confirmed) return

  await withLoading(async () => {
    await softDeleteDoc('products', row.id, `${row.product_code} - ${row.product_name}`)
    rows.value = rows.value.filter(item => item.id !== row.id)
    showToast('Đã xóa sản phẩm.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không xóa được sản phẩm.'), 'error'))
}

onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Quản lý sản phẩm" subtitle="Danh mục sản phẩm dùng chung; giá nhập được quản lý theo từng lô nhập kho">
      <button class="btn" @click="loadRows(true)">Làm mới</button>
      <button v-if="canCreate" class="btn primary" @click="openModal()">+ Thêm sản phẩm</button>
    </PageHeader>

    <div class="card" style="margin: 24px;">
      <FilterToolbar
        v-model:search="search"
        search-width="680px"
        search-placeholder="Tìm mã hoặc tên sản phẩm..."
        :filters="toolbarFilters"
        :values="filterValues"
        :result-count="filtered.length"
        :loading="loading"
        @update:filter="updateFilter"
        @reset="resetFilters"
      />

      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table style="min-width: 1220px">
          <thead><tr><th>Mã SP</th><th>Tên sản phẩm</th><th>Đơn vị</th><th>Hết hàng ≤</th><th>Cảnh báo</th><th>Bình thường ≥</th><th>Ngày tạo</th><th>Cập nhật cuối</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td>{{ row.product_code }}</td>
              <td><b>{{ row.product_name }}</b></td>
              <td>{{ row.unit }}</td>
              <td>{{ stockValue(row, 'out_of_stock_max', ['out_of_stock_threshold', 'sold_out_max']) }}</td>
              <td>{{ stockValue(row, 'warning_stock_min') }} - {{ stockValue(row, 'warning_stock_max') }}</td>
              <td>{{ stockValue(row, 'normal_stock_min', ['normal_stock_threshold']) }}</td>
              <td>{{ formatDateTime(row.created_at) }}</td>
              <td>{{ formatDateTime(row.updated_at) }}</td>
              <td><span class="badge" :class="productStatus(row) === 'active' ? 'green' : 'red'">{{ productStatus(row) === 'active' ? 'Đang bán' : 'Ngừng bán' }}</span></td>
              <td><div class="action-buttons">
                <button class="btn-sm btn-view" @click="openDetail(row)">Xem</button>
                <button v-if="canEdit" class="btn-sm" @click="openModal(row)">Sửa</button>
                <button v-if="canDelete" class="btn-sm btn-delete" @click="removeProduct(row)">Xóa</button>
              </div></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="10" class="empty">Không có sản phẩm phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal v-if="showModal" :title="editing ? 'Sửa sản phẩm' : 'Thêm sản phẩm'" size="lg" :loading="saving" @close="showModal = false" @save="saveProduct">
      <div class="form-grid">
        <div class="form-group"><label>Mã sản phẩm *</label><input v-model="form.product_code" class="input" placeholder="VD: SP001" /></div>
        <div class="form-group"><label>Tên sản phẩm *</label><input v-model="form.product_name" class="input" /></div>
        <div class="form-group"><label>Đơn vị *</label><input v-model="form.unit" class="input" placeholder="VD: Chiếc, Cái, Tờ..." /></div>
        <div class="form-group"><label>Nhóm sản phẩm</label><input v-model="form.category" class="input" placeholder="Nhóm / loại sản phẩm" /></div>
        <div class="form-group"><label>Quy cách đóng gói</label><input v-model="form.packing_standard" class="input" placeholder="VD: 1 thùng / 1.000 chiếc" /></div>
        <div class="form-group"><label>Trạng thái</label><select v-model="form.status" class="select"><option value="active">Đang bán</option><option value="inactive">Ngừng bán</option></select></div>
        <div class="form-group"><label>Hết hàng khi tồn cuối ≤</label><input v-model.number="form.out_of_stock_max" class="input" type="number" /></div>
        <div></div>
        <div class="form-group"><label>Cảnh báo từ</label><input v-model.number="form.warning_stock_min" class="input" type="number" /></div>
        <div class="form-group"><label>Cảnh báo đến</label><input v-model.number="form.warning_stock_max" class="input" type="number" /></div>
        <div class="form-group"><label>Bình thường khi tồn cuối ≥</label><input v-model.number="form.normal_stock_min" class="input" type="number" /></div>
        <div class="product-threshold-note">Ví dụ: hết hàng ≤ 0, cảnh báo 1–10, bình thường ≥ 11.</div>
        <div class="form-group" style="grid-column:1/-1"><label>Ghi chú</label><textarea v-model="form.note" class="textarea" rows="3" /></div>
      </div>
    </BaseModal>

    <RecordDetailModal
      v-if="showDetailModal && selected"
      title="Chi tiết sản phẩm"
      :record="selected"
      :labels="productDetailLabels"
      :field-order="[
        'id','firestore_id','product_code','product_name','name','unit','category','product_group','packing_standard',
        'material','color','size','description','selling_price',
        'out_of_stock_max','out_of_stock_threshold','sold_out_max','warning_stock_min','warning_stock_max','normal_stock_min','normal_stock_threshold',
        'created_by','owner_email','created_at','updated_at','status','active','deleted','deleted_at','warehouse_source','note'
      ]"
      @close="showDetailModal = false"
    />

    <ConfirmModal v-bind="confirmState" @cancel="resolveConfirm(false)" @confirm="resolveConfirm(true)" />
  </AppShell>
</template>
