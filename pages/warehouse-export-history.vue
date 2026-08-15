<script setup lang="ts">
import { formatDateTime, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import {
  buildWarehouseExportHistoryRows,
  matchesWarehouseExportHistoryFilters,
  uniqueHistoryOptions,
} from '~/utils/warehouseExportHistory.mjs'

const { hasPermission } = useAuth()
const {
  loadExportOrders,
  loadExportOrderItems,
  loadWarehouses,
  loadWarehouseExportRequests,
  loadScopedOrders,
} = useScopedQueries()
const { showToast } = useUi()

const loading = ref(false)
const search = ref('')
const warehouseFilter = ref('')
const saleFilter = ref('')
const logoFilter = ref('')
const dateTimeFrom = ref('')
const dateTimeTo = ref('')
const rows = ref<any[]>([])
const warehouses = ref<any[]>([])

const warehouseNameById = computed(() => new Map(
  warehouses.value.map(row => [
    String(row.id || '').trim(),
    String(row.name || row.warehouse_code || row.id || '').trim(),
  ]),
))

function warehouseDisplayName(id: any, savedName: any = '') {
  const warehouseId = String(id || '').trim()
  return warehouseNameById.value.get(warehouseId) || String(savedName || '').trim() || warehouseId || '-'
}

const canOpenPage = computed(() => hasPermission('*') || hasPermission('export.view'))

async function loadOptional(loader: (force?: boolean) => Promise<any[]>, force = false) {
  try {
    return await loader(force)
  } catch {
    return []
  }
}

async function loadRows(force = false) {
  if (!canOpenPage.value) {
    rows.value = []
    return
  }

  loading.value = true
  try {
    const [exportOrders, exportItems, requests, orders, warehouseRows] = await Promise.all([
      loadExportOrders(force),
      loadExportOrderItems(force),
      loadOptional(loadWarehouseExportRequests, force),
      loadOptional(loadScopedOrders, force),
      loadOptional(loadWarehouses, force),
    ])

    warehouses.value = warehouseRows
    rows.value = buildWarehouseExportHistoryRows({
      exportOrders,
      exportItems,
      requests,
      orders,
    }).map(row => ({
      ...row,
      warehouse_name: warehouseDisplayName(row.warehouse_id, row.warehouse_name),
    }))
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được lịch sử xuất kho.'), 'error')
  } finally {
    loading.value = false
  }
}

const warehouseOptions = computed(() => [
  { value: '', label: 'Tất cả kho', search: 'tất cả kho' },
  ...uniqueHistoryOptions(rows.value, 'warehouse_key', 'warehouse_name'),
])

const saleOptions = computed(() => [
  { value: '', label: 'Tất cả Sale', search: 'tất cả sale' },
  ...uniqueHistoryOptions(rows.value.filter(row => row.sale_key), 'sale_key', 'sale_label'),
])

const logoOptions = computed(() => [
  { value: '', label: 'Tất cả logo', search: 'tất cả logo' },
  { value: '__NO_LOGO__', label: 'Không logo', search: 'không logo' },
  ...uniqueHistoryOptions(rows.value.filter(row => row.logo), 'logo_key', 'logo'),
])

const filtered = computed(() => rows.value.filter(row => matchesWarehouseExportHistoryFilters(row, {
  keyword: search.value,
  warehouse: warehouseFilter.value,
  sale: saleFilter.value,
  logo: logoFilter.value,
  from: dateTimeFrom.value,
  to: dateTimeTo.value,
})))

const summary = computed(() => ({
  lines: filtered.value.length,
  quantity: filtered.value.reduce((sum, row) => sum + toNumber(row.quantity), 0),
  slips: new Set(filtered.value.map(row => row.export_order_id).filter(Boolean)).size,
  orders: new Set(filtered.value.map(row => row.order_id || row.order_code).filter(Boolean)).size,
  warehouses: new Set(filtered.value.map(row => row.warehouse_key).filter(Boolean)).size,
}))

function quantityText(value: any) {
  return toNumber(value).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
}

function resetFilters() {
  search.value = ''
  warehouseFilter.value = ''
  saleFilter.value = ''
  logoFilter.value = ''
  dateTimeFrom.value = ''
  dateTimeTo.value = ''
}

onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader
      title="Lịch sử xuất kho"
      subtitle="Theo dõi từng dòng hàng đã xuất theo kho, phiếu, đơn hàng, khách hàng và Sale"
    >
      <button class="btn" type="button" @click="loadRows(true)">Làm mới</button>
    </PageHeader>

    <div class="summary-grid warehouse-history-summary">
      <div class="summary-card"><label>Dòng xuất</label><strong>{{ summary.lines.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Tổng số lượng</label><strong>{{ quantityText(summary.quantity) }}</strong></div>
      <div class="summary-card"><label>Phiếu xuất</label><strong>{{ summary.slips.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Đơn hàng</label><strong>{{ summary.orders.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Kho xuất</label><strong>{{ summary.warehouses.toLocaleString('vi-VN') }}</strong></div>
    </div>

    <div class="card warehouse-history-card">
      <div class="warehouse-history-filters">
        <div class="filter-field warehouse-history-search">
          <label class="filter-label" for="warehouse-history-search">Tìm kiếm</label>
          <input
            id="warehouse-history-search"
            v-model="search"
            class="input"
            type="search"
            placeholder="Mã đơn, khách hàng, tên/mã sản phẩm, phiếu xuất..."
          />
        </div>

        <div class="filter-field">
          <label class="filter-label">Kho xuất</label>
          <SearchableSelect
            v-model="warehouseFilter"
            :options="warehouseOptions"
            placeholder="Tất cả kho"
          />
        </div>

        <div class="filter-field">
          <label class="filter-label">Sale phụ trách</label>
          <SearchableSelect
            v-model="saleFilter"
            :options="saleOptions"
            placeholder="Tất cả Sale"
          />
        </div>

        <div class="filter-field">
          <label class="filter-label">Logo</label>
          <SearchableSelect
            v-model="logoFilter"
            :options="logoOptions"
            placeholder="Tất cả logo"
          />
        </div>

        <div class="filter-field">
          <label class="filter-label" for="warehouse-history-from">Từ ngày giờ</label>
          <input id="warehouse-history-from" v-model="dateTimeFrom" class="input" type="datetime-local" />
        </div>

        <div class="filter-field">
          <label class="filter-label" for="warehouse-history-to">Đến ngày giờ</label>
          <input id="warehouse-history-to" v-model="dateTimeTo" class="input" type="datetime-local" />
        </div>

        <div class="warehouse-history-filter-actions">
          <button class="btn ghost" type="button" @click="resetFilters">Xóa lọc</button>
          <span class="small subtle">{{ filtered.length.toLocaleString('vi-VN') }} kết quả</span>
        </div>
      </div>

      <LoadingState v-if="loading" />
      <div v-else-if="!canOpenPage" class="empty">Bạn không có quyền xem lịch sử xuất kho.</div>
      <div v-else class="table-wrap">
        <table style="min-width: 1760px">
          <thead>
            <tr>
              <th>Ngày giờ xuất</th>
              <th>Kho xuất</th>
              <th>Sản phẩm</th>
              <th>Logo</th>
              <th>Số lượng</th>
              <th>Phiếu xuất</th>
              <th>Phiếu yêu cầu</th>
              <th>Đơn hàng</th>
              <th>Khách hàng</th>
              <th>Sale phụ trách</th>
              <th>Người tạo đơn</th>
              <th>Người xuất kho</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td>
                <b>{{ formatDateTime(row.exported_at) }}</b>
                <div v-if="row.export_date" class="small subtle">Ngày phiếu: {{ row.export_date }}</div>
              </td>
              <td><b>{{ warehouseDisplayName(row.warehouse_id, row.warehouse_name) }}</b></td>
              <td>
                <b>{{ row.product_code || '-' }}</b>
                <div class="small subtle">{{ row.product_name || '-' }}</div>
              </td>
              <td>{{ row.logo || 'Không logo' }}</td>
              <td><b>{{ quantityText(row.quantity) }}</b><div class="small subtle">{{ row.unit || '-' }}</div></td>
              <td>
                <b>{{ row.export_code || '-' }}</b>
                <div class="small subtle">{{ row.affects_inventory ? 'Có ghi nhận tồn' : 'Xuất ngoài HT - không trừ tồn' }}</div>
              </td>
              <td>{{ row.request_code || '-' }}</td>
              <td>{{ row.order_code || '-' }}</td>
              <td>{{ row.customer_name || '-' }}</td>
              <td>{{ row.sale_label || '-' }}</td>
              <td>{{ row.order_created_by || '-' }}</td>
              <td>{{ row.exported_by || '-' }}</td>
            </tr>
            <tr v-if="!filtered.length">
              <td colspan="12" class="empty">Không có lịch sử xuất kho phù hợp.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.warehouse-history-summary {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.warehouse-history-card {
  margin: 24px;
}

.warehouse-history-filters {
  display: grid;
  grid-template-columns: minmax(320px, 2fr) repeat(3, minmax(190px, 1fr));
  gap: 14px;
  align-items: end;
  padding: 16px;
  margin-bottom: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: #fff;
}

.warehouse-history-search {
  grid-column: span 2;
}

.warehouse-history-filter-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  min-height: 42px;
  grid-column: span 2;
}

@media (max-width: 1280px) {
  .warehouse-history-summary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .warehouse-history-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .warehouse-history-search,
  .warehouse-history-filter-actions {
    grid-column: span 2;
  }
}

@media (max-width: 720px) {
  .warehouse-history-summary,
  .warehouse-history-filters {
    grid-template-columns: 1fr;
  }

  .warehouse-history-search,
  .warehouse-history-filter-actions {
    grid-column: auto;
  }

  .warehouse-history-filter-actions {
    justify-content: space-between;
  }
}
</style>
