<script setup lang="ts">
import type { SupplierDoc, UnitDoc, WarehouseDoc } from '~/types/models'
import { formatDateTime, normalizeText } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

type TabKey = 'warehouses' | 'suppliers' | 'units'

const { loadWarehouses, loadSuppliers, loadUnits } = useScopedQueries()
const { showToast } = useUi()

const loading = ref(false)
const activeTab = ref<TabKey>('warehouses')
const search = ref('')
const warehouses = ref<WarehouseDoc[]>([])
const suppliers = ref<SupplierDoc[]>([])
const units = ref<UnitDoc[]>([])
const selected = ref<Record<string, any> | null>(null)
const showDetailModal = ref(false)

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

function openDetail(row: Record<string, any>) {
  selected.value = row
  showDetailModal.value = true
}

function statusLabel(row: Record<string, any>) {
  if (row.active === false) return 'inactive'
  return row.status || 'active'
}

async function loadRows(force = false) {
  loading.value = true
  try {
    const [warehouseRows, supplierRows, unitRows] = await Promise.all([
      loadWarehouses(force),
      loadSuppliers(force),
      loadUnits(force)
    ])
    warehouses.value = warehouseRows
    suppliers.value = supplierRows
    units.value = unitRows
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được danh mục kho.'), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Danh mục kho" subtitle="Kho, nhà cung cấp, đơn vị đã migrate từ Warehouse Sheet sang Firestore">
      <button class="btn" @click="loadRows(true)">Làm mới</button>
    </PageHeader>

    <div class="card">
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

      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table v-if="activeTab === 'warehouses'" style="min-width: 980px">
          <thead><tr><th>Mã kho</th><th>Tên kho</th><th>Địa chỉ</th><th>Quản lý/SĐT</th><th>Nguồn</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ row.warehouse_code || row.legacy_id || row.id }}</b></td>
              <td>{{ row.name }}</td>
              <td>{{ row.address || '-' }}</td>
              <td>{{ row.manager || row.phone || '-' }}</td>
              <td>{{ row.source || '-' }}</td>
              <td><span class="badge blue">{{ statusLabel(row) }}</span></td>
              <td><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="7" class="empty">Không có danh mục kho.</td></tr>
          </tbody>
        </table>

        <table v-else-if="activeTab === 'suppliers'" style="min-width: 980px">
          <thead><tr><th>Mã NCC</th><th>Tên nhà cung cấp</th><th>SĐT</th><th>Email</th><th>Địa chỉ</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ row.supplier_code || row.legacy_id || row.id }}</b></td>
              <td>{{ row.name }}</td>
              <td>{{ row.phone || '-' }}</td>
              <td>{{ row.email || '-' }}</td>
              <td>{{ row.address || '-' }}</td>
              <td><span class="badge blue">{{ statusLabel(row) }}</span></td>
              <td><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="7" class="empty">Không có nhà cung cấp.</td></tr>
          </tbody>
        </table>

        <table v-else style="min-width: 760px">
          <thead><tr><th>Mã đơn vị</th><th>Tên đơn vị</th><th>Nguồn</th><th>Cập nhật</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ row.unit_code || row.legacy_id || row.id }}</b></td>
              <td>{{ row.name }}</td>
              <td>{{ row.source || '-' }}</td>
              <td>{{ formatDateTime(row.updated_at || row.created_at) }}</td>
              <td><span class="badge blue">{{ statusLabel(row) }}</span></td>
              <td><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="6" class="empty">Không có đơn vị.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <RecordDetailModal
      v-if="showDetailModal && selected"
      title="Chi tiết danh mục kho"
      :record="selected"
      :field-order="['id','legacy_id','warehouse_code','supplier_code','unit_code','name','phone','email','address','manager','note','created_by','created_at','updated_at','source','status','active','deleted']"
      @close="showDetailModal = false"
    />
  </AppShell>
</template>
