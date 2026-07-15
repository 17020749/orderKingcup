<script setup lang="ts">
import type { ExportOrderDoc, ExportOrderItemDoc, ImportOrderDoc, ImportOrderItemDoc, InventoryBalanceDoc, StockMovementDoc, WarehouseDoc } from '~/types/models'
import { formatDateTime, normalizeText, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

type InventoryAuditRow = InventoryBalanceDoc & {
  movement_in: number
  movement_out: number
  movement_adjustment: number
  movement_quantity: number
  difference: number
  has_balance: boolean
}

const { loadInventoryBalances, loadStockMovements, loadWarehouses, loadImportOrders, loadImportOrderItems, loadExportOrders, loadExportOrderItems } = useScopedQueries()
const { showToast } = useUi()

const loading = ref(false)
const search = ref('')
const warehouseFilter = ref('')
const logoFilter = ref('')
const reconcileFilter = ref('')
const rows = ref<InventoryBalanceDoc[]>([])
const movements = ref<StockMovementDoc[]>([])
const warehouses = ref<WarehouseDoc[]>([])
const importOrders = ref<ImportOrderDoc[]>([])
const importItems = ref<ImportOrderItemDoc[]>([])
const exportOrders = ref<ExportOrderDoc[]>([])
const exportItems = ref<ExportOrderItemDoc[]>([])
const selected = ref<InventoryAuditRow | null>(null)
const showMovementModal = ref(false)

function inventoryKey(row: any) {
  return [
    String(row?.warehouse_id || '').trim(),
    String(row?.product_id || '').trim(),
    normalizeText(row?.logo || '')
  ].join('|')
}

const auditRows = computed<InventoryAuditRow[]>(() => {
  const audit = new Map<string, InventoryAuditRow>()

  rows.value.forEach(row => {
    audit.set(inventoryKey(row), {
      ...row,
      movement_in: 0,
      movement_out: 0,
      movement_adjustment: 0,
      movement_quantity: 0,
      difference: 0,
      has_balance: true
    })
  })

  movements.value
    .filter(row => row.deleted !== true && row.active !== false)
    .forEach(movement => {
      const key = inventoryKey(movement)
      if (!audit.has(key)) {
        audit.set(key, {
          id: `missing_balance__${key}`,
          warehouse_id: movement.warehouse_id,
          warehouse_name: movement.warehouse_name,
          product_id: movement.product_id,
          product_code: movement.product_code,
          product_name: movement.product_name,
          logo: movement.logo || '',
          quantity: 0,
          unit: (movement as any).unit || '',
          updated_at: movement.created_at,
          last_movement_at: movement.movement_date || movement.created_at,
          source: 'stock_movements_only',
          movement_in: 0,
          movement_out: 0,
          movement_adjustment: 0,
          movement_quantity: 0,
          difference: 0,
          has_balance: false
        })
      }

      const row = audit.get(key)!
      const quantity = toNumber(movement.quantity)
      const type = String(movement.movement_type || '').toLowerCase()
      const sourceCollection = String(movement.source_collection || '')
      const isAdjustment = movement.direction === 'adjust'
        || type.includes('adjust')
        || sourceCollection === 'inventory_adjustments'
      const isImportMovement = sourceCollection === 'import_orders'
        || type === 'import'
        || type.includes('transfer_in')
        || type.includes('reverse_destination')
      const isExportMovement = sourceCollection === 'export_orders' && !isImportMovement

      if (isAdjustment) {
        row.movement_adjustment += quantity
      } else if (isImportMovement) {
        // Số âm là movement đảo/xóa, nên tổng nhập hiển thị theo giá trị ròng.
        row.movement_in += quantity
      } else if (isExportMovement) {
        // Xuất gốc có quantity âm; movement hoàn kho nguồn có quantity dương.
        row.movement_out += -quantity
      } else if (quantity >= 0) {
        row.movement_in += quantity
      } else {
        row.movement_out += Math.abs(quantity)
      }
      row.movement_quantity += quantity
    })

  audit.forEach(row => {
    row.movement_in = Math.round(row.movement_in * 1000) / 1000
    row.movement_out = Math.round(row.movement_out * 1000) / 1000
    row.movement_adjustment = Math.round(row.movement_adjustment * 1000) / 1000
    row.movement_quantity = Math.round(row.movement_quantity * 1000) / 1000
    row.difference = Math.round((toNumber(row.quantity) - row.movement_quantity) * 1000) / 1000
  })

  return Array.from(audit.values()).sort((a, b) => {
    const left = `${a.warehouse_name || ''} ${a.product_code || ''} ${a.logo || ''}`
    const right = `${b.warehouse_name || ''} ${b.product_code || ''} ${b.logo || ''}`
    return left.localeCompare(right, 'vi')
  })
})

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return auditRows.value.filter(row => {
    const matchedWarehouse = !warehouseFilter.value || row.warehouse_id === warehouseFilter.value
    const hasLogo = String(row.logo || '').trim() !== ''
    const matchedLogo = !logoFilter.value || (logoFilter.value === 'logo' ? hasLogo : !hasLogo)
    const matchedReconcile = !reconcileFilter.value
      || (reconcileFilter.value === 'matched' ? Math.abs(row.difference) < 0.0001 : Math.abs(row.difference) >= 0.0001)
    const matchedText = !keyword || normalizeText([
      row.product_code,
      row.product_name,
      row.warehouse_name,
      row.logo,
      row.unit
    ].join(' ')).includes(keyword)
    return matchedWarehouse && matchedLogo && matchedReconcile && matchedText
  })
})

const summary = computed(() => ({
  lines: filtered.value.length,
  quantity: filtered.value.reduce((sum, row) => sum + toNumber(row.quantity), 0),
  movementQuantity: filtered.value.reduce((sum, row) => sum + toNumber(row.movement_quantity), 0),
  mismatches: filtered.value.filter(row => Math.abs(row.difference) >= 0.0001).length
}))

const selectedMovements = computed(() => {
  if (!selected.value) return []
  const row = selected.value
  const rowLogo = normalizeText(row.logo || '')
  return movements.value.filter(movement =>
    movement.deleted !== true
    && movement.active !== false
    && movement.warehouse_id === row.warehouse_id
    && movement.product_id === row.product_id
    && normalizeText(movement.logo || '') === rowLogo
  )
})

function quantityText(value: any) {
  return toNumber(value).toLocaleString('vi-VN', { maximumFractionDigits: 3 })
}

function movementClass(row: StockMovementDoc) {
  if (toNumber(row.quantity) < 0 || row.direction === 'out') return 'red'
  if (row.direction === 'adjust') return 'yellow'
  return 'green'
}

function differenceClass(row: InventoryAuditRow) {
  return Math.abs(row.difference) < 0.0001 ? 'green' : 'red'
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
    if (type.includes('reverse') || type.includes('cancel')) return movement.reason || 'Biến động đảo/hoàn tồn của phiếu xuất.'
    if (type === 'transfer_in' || type === 'export_transfer_in' || movement.direction === 'in') {
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

function openMovements(row: InventoryAuditRow) {
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
    <PageHeader title="Tồn kho" subtitle="Đối soát inventory_balances với tổng stock_movements theo kho, sản phẩm và logo">
      <button class="btn" @click="loadRows(true)">Làm mới</button>
    </PageHeader>

    <div class="summary-grid">
      <div class="summary-card"><label>Số dòng đối soát</label><strong>{{ summary.lines.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Tồn từ balances</label><strong>{{ quantityText(summary.quantity) }}</strong></div>
      <div class="summary-card"><label>Tồn từ movements</label><strong>{{ quantityText(summary.movementQuantity) }}</strong></div>
      <div class="summary-card"><label>Dòng bị lệch</label><strong>{{ summary.mismatches.toLocaleString('vi-VN') }}</strong></div>
    </div>

    <div class="card" style="margin: 24px;">
      <div class="toolbar">
        <input v-model="search" class="input" style="max-width: 420px" placeholder="Tìm mã/tên sản phẩm, kho, logo..." />
        <select v-model="warehouseFilter" class="select" style="max-width: 220px">
          <option value="">Tất cả kho</option>
          <option v-for="warehouse in warehouses" :key="warehouse.id" :value="warehouse.id">{{ warehouse.name || warehouse.warehouse_code || warehouse.id }}</option>
        </select>
        <select v-model="logoFilter" class="select" style="max-width: 170px">
          <option value="">Tất cả logo</option>
          <option value="no-logo">Không logo</option>
          <option value="logo">Có logo</option>
        </select>
        <select v-model="reconcileFilter" class="select" style="max-width: 190px">
          <option value="">Tất cả đối soát</option>
          <option value="matched">Đã khớp</option>
          <option value="mismatch">Đang lệch</option>
        </select>
      </div>

      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table style="min-width: 1540px">
          <thead>
            <tr>
              <th>Kho</th>
              <th>Sản phẩm</th>
              <th>Logo</th>
              <th>Đơn vị</th>
              <th>Tổng nhập</th>
              <th>Tổng xuất</th>
              <th>Điều chỉnh</th>
              <th>Tồn theo lịch sử</th>
              <th>Tồn hiện tại</th>
              <th>Chênh lệch</th>
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
              <td>{{ quantityText(row.movement_in) }}</td>
              <td>{{ quantityText(row.movement_out) }}</td>
              <td>{{ quantityText(row.movement_adjustment) }}</td>
              <td><b>{{ quantityText(row.movement_quantity) }}</b></td>
              <td><b>{{ quantityText(row.quantity) }}</b><div v-if="!row.has_balance" class="small" style="color:#dc2626">Thiếu balance</div></td>
              <td><span class="badge" :class="differenceClass(row)">{{ quantityText(row.difference) }}</span></td>
              <td>{{ formatDateTime(row.last_movement_at || row.updated_at) }}</td>
              <td><button class="btn-sm btn-view" @click="openMovements(row)">Lịch sử</button></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="12" class="empty">Không có dữ liệu tồn kho.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal v-if="showMovementModal && selected" :title="`Lịch sử tồn: ${selected.product_code || selected.product_name}`" size="xl" :show-footer="false" @close="showMovementModal = false">
      <div class="detail-grid">
        <div class="detail-item"><label>Kho</label><strong>{{ selected.warehouse_name || selected.warehouse_id }}</strong></div>
        <div class="detail-item"><label>Sản phẩm</label><strong>{{ selected.product_code }} - {{ selected.product_name }}</strong></div>
        <div class="detail-item"><label>Logo</label><strong>{{ selected.logo || 'Không logo' }}</strong></div>
        <div class="detail-item"><label>Tổng nhập</label><strong>{{ quantityText(selected.movement_in) }}</strong></div>
        <div class="detail-item"><label>Tổng xuất</label><strong>{{ quantityText(selected.movement_out) }}</strong></div>
        <div class="detail-item"><label>Tổng điều chỉnh</label><strong>{{ quantityText(selected.movement_adjustment) }}</strong></div>
        <div class="detail-item"><label>Tồn theo lịch sử</label><strong>{{ quantityText(selected.movement_quantity) }}</strong></div>
        <div class="detail-item"><label>Tồn hiện tại</label><strong>{{ quantityText(selected.quantity) }}</strong></div>
        <div class="detail-item"><label>Chênh lệch</label><strong>{{ quantityText(selected.difference) }}</strong></div>
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
