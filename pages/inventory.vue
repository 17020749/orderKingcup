<script setup lang="ts">
import type { ExportOrderDoc, ExportOrderItemDoc, ImportOrderDoc, ImportOrderItemDoc, InventoryBalanceDoc, StockMovementDoc, WarehouseDoc } from '~/types/models'
import { formatDateTime, normalizeText, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

const { loadInventoryBalances, loadStockMovements, loadWarehouses, loadImportOrders, loadImportOrderItems, loadExportOrders, loadExportOrderItems } = useScopedQueries()
const { showToast } = useUi()

const loading = ref(false)
const search = ref('')
const warehouseFilter = ref('')
const logoFilter = ref('')
const rows = ref<InventoryBalanceDoc[]>([])
const movements = ref<StockMovementDoc[]>([])
const warehouses = ref<WarehouseDoc[]>([])
const importOrders = ref<ImportOrderDoc[]>([])
const importItems = ref<ImportOrderItemDoc[]>([])
const exportOrders = ref<ExportOrderDoc[]>([])
const exportItems = ref<ExportOrderItemDoc[]>([])
const selected = ref<InventoryBalanceDoc | null>(null)
const showMovementModal = ref(false)

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return rows.value.filter(row => {
    const matchedWarehouse = !warehouseFilter.value || row.warehouse_id === warehouseFilter.value
    const hasLogo = String(row.logo || '').trim() !== ''
    const matchedLogo = !logoFilter.value || (logoFilter.value === 'logo' ? hasLogo : !hasLogo)
    const matchedText = !keyword || normalizeText([
      row.product_code,
      row.product_name,
      row.warehouse_name,
      row.logo,
      row.unit
    ].join(' ')).includes(keyword)
    return matchedWarehouse && matchedLogo && matchedText
  })
})

const summary = computed(() => ({
  lines: filtered.value.length,
  quantity: filtered.value.reduce((sum, row) => sum + toNumber(row.quantity), 0),
  products: new Set(filtered.value.map(row => row.product_id || row.product_code).filter(Boolean)).size,
  warehouses: new Set(filtered.value.map(row => row.warehouse_id).filter(Boolean)).size
}))

const selectedMovements = computed(() => {
  if (!selected.value) return []
  const row = selected.value
  const rowLogo = normalizeText(row.logo || '')
  return movements.value.filter(movement =>
    movement.warehouse_id === row.warehouse_id
    && movement.product_id === row.product_id
    && normalizeText(movement.logo || '') === rowLogo
  )
})

function quantityText(value: any) {
  return toNumber(value).toLocaleString('vi-VN')
}

function movementClass(row: StockMovementDoc) {
  if (toNumber(row.quantity) < 0 || row.direction === 'out') return 'red'
  if (row.direction === 'adjust') return 'yellow'
  return 'green'
}

function findImportOrder(id: any) {
  return importOrders.value.find(row => row.id === id)
}

function findExportOrder(id: any) {
  return exportOrders.value.find(row => row.id === id)
}

function findImportItem(id: any) {
  return importItems.value.find(row => row.id === id)
}

function findExportItem(id: any) {
  return exportItems.value.find(row => row.id === id)
}

function movementDetail(movement: StockMovementDoc) {
  const sourceCollection = String(movement.source_collection || '')
  const type = String(movement.movement_type || '')
  if (sourceCollection === 'import_orders') {
    const order = findImportOrder(movement.source_doc_id)
    const item = findImportItem(movement.source_item_id)
    const supplier = order?.supplier_name ? ` từ NCC: ${order.supplier_name}` : ''
    const warehouse = item?.warehouse_name || movement.warehouse_name || ''
    return `Nhập vào kho ${warehouse || '-'}${supplier}.`
  }
  if (sourceCollection === 'export_orders') {
    const order = findExportOrder(movement.source_doc_id)
    const item = findExportItem(movement.source_item_id)
    if (type === 'transfer_in' || movement.direction === 'in') {
      return `Nhập chuyển kho từ ${item?.from_warehouse_name || 'kho nguồn'} theo phiếu ${order?.code || order?.export_code || movement.source_code || ''}.`
    }
    if (item?.to_warehouse_name || order?.destination_type === 'warehouse') {
      return `Xuất tới kho ${item?.to_warehouse_name || order?.destination_name || '-'}.`
    }
    return `Xuất tới khách ${item?.destination_name || order?.customer_name || order?.destination_name || '-'}.`
  }
  if (sourceCollection === 'inventory_adjustments') return movement.reason || 'Điều chỉnh tồn kho.'
  return movement.reason || '-'
}

function openMovements(row: InventoryBalanceDoc) {
  selected.value = row
  showMovementModal.value = true
}

async function loadRows(force = false) {
  loading.value = true
  try {
    const [balanceRows, movementRows, warehouseRows, importOrderRows, importItemRows, exportOrderRows, exportItemRows] = await Promise.all([
      loadInventoryBalances(force),
      loadStockMovements(force),
      loadWarehouses(force),
      loadImportOrders(force),
      loadImportOrderItems(force),
      loadExportOrders(force),
      loadExportOrderItems(force)
    ])
    rows.value = balanceRows
    movements.value = movementRows
    warehouses.value = warehouseRows
    importOrders.value = importOrderRows
    importItems.value = importItemRows
    exportOrders.value = exportOrderRows
    exportItems.value = exportItemRows
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được tồn kho.'), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Tồn kho" subtitle="Đọc nhanh từ inventory_balances, truy vết bằng stock_movements">
      <button class="btn" @click="loadRows(true)">Làm mới</button>
    </PageHeader>

    <div class="summary-grid">
      <div class="summary-card"><label>Số dòng tồn</label><strong>{{ summary.lines.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Tổng SL tồn</label><strong>{{ quantityText(summary.quantity) }}</strong></div>
      <div class="summary-card"><label>Số sản phẩm</label><strong>{{ summary.products.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Số kho</label><strong>{{ summary.warehouses.toLocaleString('vi-VN') }}</strong></div>
    </div>

    <div class="card">
      <div class="toolbar">
        <input v-model="search" class="input" style="max-width: 520px" placeholder="Tìm mã/tên sản phẩm, kho, logo..." />
        <select v-model="warehouseFilter" class="select" style="max-width: 240px">
          <option value="">Tất cả kho</option>
          <option v-for="warehouse in warehouses" :key="warehouse.id" :value="warehouse.id">{{ warehouse.name || warehouse.warehouse_code || warehouse.id }}</option>
        </select>
        <select v-model="logoFilter" class="select" style="max-width: 180px">
          <option value="">Tất cả logo</option>
          <option value="no-logo">Không logo</option>
          <option value="logo">Có logo</option>
        </select>
      </div>

      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table style="min-width: 1120px">
          <thead>
            <tr>
              <th>Kho</th>
              <th>Sản phẩm</th>
              <th>Logo</th>
              <th>Đơn vị</th>
              <th>Tồn hiện tại</th>
              <th>Cập nhật cuối</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ row.warehouse_name || row.warehouse_id }}</b></td>
              <td><b>{{ row.product_code }}</b><div class="small subtle">{{ row.product_name }}</div></td>
              <td>{{ row.logo || 'Không logo' }}</td>
              <td>{{ row.unit || '-' }}</td>
              <td><span class="badge" :class="toNumber(row.quantity) > 0 ? 'green' : 'yellow'">{{ quantityText(row.quantity) }}</span></td>
              <td>{{ formatDateTime(row.last_movement_at || row.updated_at) }}</td>
              <td><button class="btn-sm btn-view" @click="openMovements(row)">Lịch sử</button></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="7" class="empty">Không có dữ liệu tồn kho.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal v-if="showMovementModal && selected" :title="`Lịch sử tồn: ${selected.product_code || selected.product_name}`" size="xl" :show-footer="false" @close="showMovementModal = false">
      <div class="detail-grid">
        <div class="detail-item"><label>Kho</label><strong>{{ selected.warehouse_name || selected.warehouse_id }}</strong></div>
        <div class="detail-item"><label>Sản phẩm</label><strong>{{ selected.product_code }} - {{ selected.product_name }}</strong></div>
        <div class="detail-item"><label>Logo</label><strong>{{ selected.logo || 'Không logo' }}</strong></div>
        <div class="detail-item"><label>Tồn hiện tại</label><strong>{{ quantityText(selected.quantity) }}</strong></div>
        <div class="detail-item"><label>Đơn vị</label><strong>{{ selected.unit || '-' }}</strong></div>
        <div class="detail-item"><label>Cập nhật cuối</label><strong>{{ formatDateTime(selected.last_movement_at || selected.updated_at) }}</strong></div>
      </div>

      <div class="table-wrap">
        <table style="min-width: 1040px">
          <thead><tr><th>Thời gian</th><th>Loại</th><th>Mã nguồn</th><th>Số lượng</th><th>Chi tiết biến động</th><th>Lý do gốc</th><th>Người tạo</th></tr></thead>
          <tbody>
            <tr v-for="movement in selectedMovements" :key="movement.id">
              <td>{{ formatDateTime(movement.movement_date || movement.created_at) }}</td>
              <td><span class="badge" :class="movementClass(movement)">{{ movement.movement_type || movement.direction }}</span></td>
              <td><b>{{ movement.source_code || movement.source_doc_id }}</b><div class="small subtle">{{ movement.source_collection }}</div></td>
              <td><b>{{ quantityText(movement.quantity) }}</b></td>
              <td>{{ movementDetail(movement) }}</td>
              <td>{{ movement.reason || '-' }}</td>
              <td>{{ movement.created_by || '-' }}</td>
            </tr>
            <tr v-if="!selectedMovements.length"><td colspan="7" class="empty">Chưa có lịch sử biến động cho dòng tồn này.</td></tr>
          </tbody>
        </table>
      </div>
    </BaseModal>
  </AppShell>
</template>
