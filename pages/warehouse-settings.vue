<script setup lang="ts">
import { collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import type { SupplierDoc, UnitDoc, WarehouseDoc } from '~/types/models'
import { formatDateTime, makeCode, makeId, normalizeText } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

type TabKey = 'warehouses' | 'suppliers' | 'units'

const { db } = useFirebaseServices()
const { appUser, hasPermission } = useAuth()
const {
  loadWarehouses,
  loadSuppliers,
  loadUnits,
  loadImportOrders,
  loadImportOrderItems,
  loadExportOrders,
  loadExportOrderItems,
  loadInventoryBalances,
  loadInventoryAdjustments,
  loadProducts,
  invalidateScopedCache
} = useScopedQueries()
const { showToast } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()

const loading = ref(false)
const saving = ref(false)
const activeTab = ref<TabKey>('warehouses')
const search = ref('')
const warehouses = ref<WarehouseDoc[]>([])
const suppliers = ref<SupplierDoc[]>([])
const units = ref<UnitDoc[]>([])
const selected = ref<Record<string, any> | null>(null)
const editing = ref<Record<string, any> | null>(null)
const showDetailModal = ref(false)
const showFormModal = ref(false)
const usageCheckLoaded = ref(false)
const importOrders = ref<any[]>([])
const importItems = ref<any[]>([])
const exportOrders = ref<any[]>([])
const exportItems = ref<any[]>([])
const inventoryBalances = ref<any[]>([])
const inventoryAdjustments = ref<any[]>([])
const products = ref<any[]>([])
const form = reactive<Record<string, any>>({})

const tabItems: Array<{ key: TabKey; label: string }> = [
  { key: 'warehouses', label: 'Kho' },
  { key: 'suppliers', label: 'Nhà cung cấp' },
  { key: 'units', label: 'Đơn vị' }
]

const currentRows = computed<any[]>(() => {
  if (activeTab.value === 'suppliers') return suppliers.value
  if (activeTab.value === 'units') return units.value
  return warehouses.value
})

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  if (!keyword) return currentRows.value
  return currentRows.value.filter(row => normalizeText([
    row.id,
    row.legacy_id,
    row.warehouse_code,
    row.supplier_code,
    row.unit_code,
    row.name,
    row.phone,
    row.email,
    row.address,
    row.note,
    row.status
  ].join(' ')).includes(keyword))
})

const canManageCurrentTab = computed(() => {
  if (hasPermission('*')) return true
  if (activeTab.value === 'warehouses') return hasPermission('warehouses.manage')
  if (activeTab.value === 'suppliers') return hasPermission('suppliers.manage')
  return hasPermission('units.manage')
})

const currentCollection = computed(() => activeTab.value)
const currentLabel = computed(() => tabItems.find(tab => tab.key === activeTab.value)?.label || 'Danh mục')
const formTitle = computed(() => `${editing.value ? 'Sửa' : 'Thêm'} ${currentLabel.value.toLowerCase()}`)
const formSaveLabel = computed(() => editing.value ? 'Lưu' : 'Thêm')
const canCheckReferences = computed(() => {
  if (hasPermission('*')) return true
  return hasPermission('import.view')
    && hasPermission('export.view')
    && hasPermission('inventory.view')
    && hasPermission('products.view')
})

function activeDoc(row: any) {
  return row && row.deleted !== true && row.active !== false
}

function codeFieldForTab(tab: TabKey = activeTab.value) {
  if (tab === 'warehouses') return 'warehouse_code'
  if (tab === 'suppliers') return 'supplier_code'
  return 'unit_code'
}

function codePrefixForTab(tab: TabKey = activeTab.value) {
  if (tab === 'warehouses') return 'KHO'
  if (tab === 'suppliers') return 'NCC'
  return 'DV'
}

function nextCatalogCode(tab: TabKey = activeTab.value) {
  const field = codeFieldForTab(tab)
  const usedCodes = new Set(currentRows.value
    .filter(row => row.id !== editing.value?.id && activeDoc(row))
    .map(row => normalizeText(row[field] || ''))
    .filter(Boolean))

  let code = ''
  let attempts = 0
  do {
    code = makeCode(codePrefixForTab(tab))
    attempts += 1
  } while (usedCodes.has(normalizeText(code)) && attempts < 10)
  return code
}

function catalogReferenceKeys(row: Record<string, any>) {
  const values = [row.id, row.legacy_id]
  if (activeTab.value === 'warehouses') values.push(row.warehouse_code)
  if (activeTab.value === 'suppliers') values.push(row.supplier_code)
  if (activeTab.value === 'units') values.push(row.unit_code, row.name)
  return new Set(values.map(value => normalizeText(value || '')).filter(Boolean))
}

function matchesCatalogReference(row: Record<string, any>, values: any[]) {
  const keys = catalogReferenceKeys(row)
  return values.some(value => {
    const normalized = normalizeText(value || '')
    return normalized && keys.has(normalized)
  })
}

function catalogUsage(row: Record<string, any>) {
  const names = new Set([
    normalizeText(row.name || ''),
    normalizeText(row.unit_code || ''),
  ].filter(Boolean))

  if (activeTab.value === 'warehouses') {
    const importCount = importItems.value.filter(item => activeDoc(item) && matchesCatalogReference(row, [
      item.warehouse_id,
      item.warehouse_legacy_id,
      item.warehouse_code,
    ])).length
    const exportCount = exportItems.value.filter(item => activeDoc(item) && (
      matchesCatalogReference(row, [
        item.from_warehouse_id,
        item.from_warehouse_legacy_id,
        item.from_warehouse_code,
      ])
      || matchesCatalogReference(row, [
        item.to_warehouse_id,
        item.to_warehouse_legacy_id,
        item.to_warehouse_code,
      ])
    )).length
    const balanceCount = inventoryBalances.value.filter(item => matchesCatalogReference(row, [
      item.warehouse_id,
      item.warehouse_legacy_id,
      item.warehouse_code,
    ])).length
    const adjustmentCount = inventoryAdjustments.value.filter(item => activeDoc(item) && matchesCatalogReference(row, [
      item.warehouse_id,
      item.warehouse_legacy_id,
      item.warehouse_code,
    ])).length
    return { total: importCount + exportCount + balanceCount + adjustmentCount, detail: `nhập ${importCount}, xuất ${exportCount}, tồn ${balanceCount}, điều chỉnh ${adjustmentCount}` }
  }

  if (activeTab.value === 'suppliers') {
    const count = importOrders.value.filter(order => activeDoc(order) && matchesCatalogReference(row, [
      order.supplier_id,
      order.supplier_legacy_id,
      order.supplier_code,
    ])).length
    return { total: count, detail: `${count} phiếu nhập` }
  }

  const hasUnit = (value: any) => names.has(normalizeText(value || ''))
  const productCount = products.value.filter(product => activeDoc(product) && hasUnit(product.unit)).length
  const importCount = importItems.value.filter(item => activeDoc(item) && hasUnit(item.unit)).length
  const exportCount = exportItems.value.filter(item => activeDoc(item) && hasUnit(item.unit)).length
  return { total: productCount + importCount + exportCount, detail: `sản phẩm ${productCount}, dòng nhập ${importCount}, dòng xuất ${exportCount}` }
}

function openDetail(row: Record<string, any>) {
  selected.value = row
  showDetailModal.value = true
}

function statusLabel(row: Record<string, any>) {
  if (row.deleted === true) return 'deleted'
  if (row.active === false) return 'inactive'
  return row.status || 'active'
}

function resetForm(row: Record<string, any> = {}) {
  Object.keys(form).forEach(key => delete form[key])
  Object.assign(form, {
    name: row.name || '',
    phone: row.phone || '',
    email: row.email || '',
    address: row.address || '',
    manager: row.manager || '',
    note: row.note || '',
    status: row.status || 'active',
    active: row.active !== false
  })
}

function openCreateModal() {
  editing.value = null
  resetForm()
  showFormModal.value = true
}

function openEditModal(row: Record<string, any>) {
  editing.value = row
  resetForm(row)
  showFormModal.value = true
}

function basePayload() {
  if (!String(form.name || '').trim()) throw new Error('Vui lòng nhập tên danh mục.')
  const payload: Record<string, any> = {
    name: String(form.name || '').trim(),
    note: form.note || '',
    status: form.status || 'active',
    active: form.active !== false,
    deleted: false,
    updated_at: serverTimestamp()
  }
  const codeField = codeFieldForTab()
  const existingCode = String(editing.value?.[codeField] || '').trim()
  payload[codeField] = existingCode || nextCatalogCode()
  if (activeTab.value === 'warehouses') {
    payload.address = form.address || ''
    payload.phone = form.phone || ''
    payload.manager = form.manager || ''
  }
  if (activeTab.value === 'suppliers') {
    payload.phone = form.phone || ''
    payload.email = form.email || ''
    payload.address = form.address || ''
  }
  return payload
}

async function saveCatalog() {
  saving.value = true
  try {
    const payload = basePayload()
    const codeField = codeFieldForTab()
    const normalizedCode = normalizeText(payload[codeField] || '')
    if (normalizedCode) {
      const duplicated = currentRows.value.some(row =>
        row.id !== editing.value?.id
        && activeDoc(row)
        && normalizeText(row[codeField] || '') === normalizedCode
      )
      if (duplicated) throw new Error(`Mã ${payload[codeField]} đã tồn tại.`)
    }
    if (editing.value?.id) {
      await updateDoc(doc(db, currentCollection.value, editing.value.id), payload)
      showToast(`Đã sửa ${currentLabel.value.toLowerCase()}.`, 'success')
    } else {
      const idPrefix = activeTab.value === 'warehouses' ? 'wh' : activeTab.value === 'suppliers' ? 'sup' : 'unit'
      const id = makeId(idPrefix)
      await setDoc(doc(collection(db, currentCollection.value), id), {
        ...payload,
        id,
        legacy_id: '',
        created_by: appUser.value?.email || '',
        created_at: serverTimestamp(),
        source: 'nuxt'
      })
      showToast(`Đã thêm ${currentLabel.value.toLowerCase()}.`, 'success')
    }
    invalidateScopedCache(currentCollection.value)
    showFormModal.value = false
    editing.value = null
    await loadRows(true)
  } catch (error) {
    showToast(reportFirebaseError(error, `Không lưu được ${currentLabel.value.toLowerCase()}.`), 'error')
  } finally {
    saving.value = false
  }
}

async function removeCatalog(row: Record<string, any>) {
  if (!usageCheckLoaded.value) {
    return showToast(
      canCheckReferences.value
        ? 'Chưa tải xong dữ liệu tham chiếu. Hãy bấm Làm mới rồi thử lại.'
        : 'Không thể xóa an toàn vì tài khoản chưa đủ quyền kiểm tra phiếu nhập, phiếu xuất, tồn kho và sản phẩm đang tham chiếu danh mục này.',
      'error'
    )
  }

  const usage = catalogUsage(row)
  if (usage.total > 0) {
    return showToast(`Không thể xóa ${row.name || row.id} vì đang được sử dụng: ${usage.detail}.`, 'error')
  }

  const confirmed = await askConfirm({
    title: `Xóa ${currentLabel.value.toLowerCase()}`,
    message: `Bạn chắc chắn muốn xóa mềm ${row.name || row.id}?`,
    confirmLabel: 'Xóa'
  })
  if (!confirmed) return
  saving.value = true
  try {
    await updateDoc(doc(db, currentCollection.value, row.id), {
      deleted: true,
      active: false,
      status: 'deleted',
      deleted_at: serverTimestamp(),
      updated_at: serverTimestamp()
    })
    invalidateScopedCache(currentCollection.value)
    showToast(`Đã xóa ${currentLabel.value.toLowerCase()}.`, 'success')
    await loadRows(true)
  } catch (error) {
    showToast(reportFirebaseError(error, `Không xóa được ${currentLabel.value.toLowerCase()}.`), 'error')
  } finally {
    saving.value = false
  }
}

async function loadRows(force = false) {
  loading.value = true
  usageCheckLoaded.value = false
  try {
    const [warehouseRows, supplierRows, unitRows] = await Promise.all([
      loadWarehouses(force),
      loadSuppliers(force),
      loadUnits(force)
    ])
    warehouses.value = warehouseRows
    suppliers.value = supplierRows
    units.value = unitRows

    if (canCheckReferences.value) {
      const [importOrderRows, importItemRows, exportOrderRows, exportItemRows, balanceRows, adjustmentRows, productRows] = await Promise.all([
        loadImportOrders(force),
        loadImportOrderItems(force),
        loadExportOrders(force),
        loadExportOrderItems(force),
        loadInventoryBalances(force),
        loadInventoryAdjustments(force),
        loadProducts(force)
      ])
      importOrders.value = importOrderRows
      importItems.value = importItemRows
      exportOrders.value = exportOrderRows
      exportItems.value = exportItemRows
      inventoryBalances.value = balanceRows
      inventoryAdjustments.value = adjustmentRows
      products.value = productRows
      usageCheckLoaded.value = true
    }
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được danh mục kho hoặc dữ liệu tham chiếu.'), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Danh mục kho" subtitle="Kho, nhà cung cấp và đơn vị">
      <button v-if="canManageCurrentTab" class="btn primary" @click="openCreateModal">+ Thêm {{ currentLabel.toLowerCase() }}</button>
      <button class="btn" @click="loadRows(true)">Làm mới</button>
    </PageHeader>

    <div class="card" style="margin: 24px;">
      <div class="toolbar">
        <div class="row">
          <button
            v-for="tab in tabItems"
            :key="tab.key"
            class="btn"
            :class="activeTab === tab.key ? 'primary' : ''"
            @click="activeTab = tab.key"
          >{{ tab.label }}</button>
        </div>
        <input v-model="search" class="input" style="max-width: 420px" placeholder="Tìm theo mã, tên, SĐT, email, địa chỉ..." />
      </div>

      <div v-if="canManageCurrentTab && !usageCheckLoaded" class="small subtle" style="margin: 8px 0 12px">
        Nút xóa chỉ hoạt động sau khi tài khoản tải được đầy đủ dữ liệu tham chiếu để tránh xóa kho/NCC/đơn vị đang được sử dụng.
      </div>

      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table v-if="activeTab === 'warehouses'" style="min-width: 1080px">
          <thead><tr><th>STT</th><th>Tên kho</th><th>Địa chỉ</th><th>Quản lý/SĐT</th><th>Nguồn</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="(row, index) in filtered" :key="row.id">
              <td>{{ index + 1 }}</td>
              <td>{{ row.name }}</td>
              <td>{{ row.address || '-' }}</td>
              <td>{{ row.manager || row.phone || '-' }}</td>
              <td>{{ row.source || '-' }}</td>
              <td><span class="badge blue">{{ statusLabel(row) }}</span></td>
              <td><div class="action-buttons"><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button><button v-if="canManageCurrentTab" class="btn-sm" @click="openEditModal(row)">Sửa</button><button v-if="canManageCurrentTab" class="btn-sm btn-delete" @click="removeCatalog(row)">Xóa</button></div></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="7" class="empty">Không có danh mục kho.</td></tr>
          </tbody>
        </table>

        <table v-else-if="activeTab === 'suppliers'" style="min-width: 1080px">
          <thead><tr><th>STT</th><th>Tên nhà cung cấp</th><th>SĐT</th><th>Email</th><th>Địa chỉ</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="(row, index) in filtered" :key="row.id">
              <td>{{ index + 1 }}</td>
              <td>{{ row.name }}</td>
              <td>{{ row.phone || '-' }}</td>
              <td>{{ row.email || '-' }}</td>
              <td>{{ row.address || '-' }}</td>
              <td><span class="badge blue">{{ statusLabel(row) }}</span></td>
              <td><div class="action-buttons"><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button><button v-if="canManageCurrentTab" class="btn-sm" @click="openEditModal(row)">Sửa</button><button v-if="canManageCurrentTab" class="btn-sm btn-delete" @click="removeCatalog(row)">Xóa</button></div></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="7" class="empty">Không có nhà cung cấp.</td></tr>
          </tbody>
        </table>

        <table v-else style="min-width: 860px">
          <thead><tr><th>STT</th><th>Tên đơn vị</th><th>Nguồn</th><th>Cập nhật</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="(row, index) in filtered" :key="row.id">
              <td>{{ index + 1 }}</td>
              <td>{{ row.name }}</td>
              <td>{{ row.source || '-' }}</td>
              <td>{{ formatDateTime(row.updated_at || row.created_at) }}</td>
              <td><span class="badge blue">{{ statusLabel(row) }}</span></td>
              <td><div class="action-buttons"><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button><button v-if="canManageCurrentTab" class="btn-sm" @click="openEditModal(row)">Sửa</button><button v-if="canManageCurrentTab" class="btn-sm btn-delete" @click="removeCatalog(row)">Xóa</button></div></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="6" class="empty">Không có đơn vị.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal v-if="showFormModal" :title="formTitle" size="lg" :loading="saving" :save-label="formSaveLabel" @close="showFormModal = false" @save="saveCatalog">
      <div class="form-grid">
        <div class="form-group"><label>Tên</label><input v-model="form.name" class="input" /></div>
        <div v-if="activeTab !== 'units'" class="form-group"><label>SĐT</label><input v-model="form.phone" class="input" /></div>
        <div v-if="activeTab === 'suppliers'" class="form-group"><label>Email</label><input v-model="form.email" class="input" /></div>
        <div v-if="activeTab === 'warehouses'" class="form-group"><label>Quản lý</label><input v-model="form.manager" class="input" /></div>
        <div v-if="activeTab !== 'units'" class="form-group"><label>Địa chỉ</label><input v-model="form.address" class="input" /></div>
<div class="form-group"><label>Trạng thái</label><select v-model="form.status" class="select"><option value="active">Đang hoạt động</option><option value="inactive">Ngừng hoạt động</option></select></div>
      </div>
      <div class="form-group" style="margin-top:12px"><label>Ghi chú</label><textarea v-model="form.note" class="textarea" rows="3" /></div>
    </BaseModal>

    <RecordDetailModal
      v-if="showDetailModal && selected"
      title="Chi tiết danh mục kho"
      :record="selected"
      :field-order="['id','legacy_id','warehouse_code','supplier_code','unit_code','name','phone','email','address','manager','note','created_by','created_at','updated_at','source','status','active','deleted']"
      @close="showDetailModal = false"
    />

    <ConfirmModal
      v-bind="confirmState"
      @cancel="resolveConfirm(false)"
      @confirm="resolveConfirm(true)"
    />
  </AppShell>
</template>
