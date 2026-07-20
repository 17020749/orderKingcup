<script setup lang="ts">
import type {
  ExportOrderDoc,
  ExportOrderItemDoc,
  ImportOrderDoc,
  ImportOrderItemDoc,
  InventoryBalanceDoc,
  ProductDoc,
  StockMovementDoc,
  WarehouseDoc,
} from '~/types/models'
import { formatDateTime, normalizeText, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

type InventoryAuditRow = InventoryBalanceDoc & {
  movement_in: number
  movement_out: number
  movement_adjustment: number
  movement_quantity: number
  difference: number
  has_balance: boolean
  has_inbound_history: boolean
}

type InventoryLotDetailRow = {
  id: string
  import_code: string
  import_date: string
  expiry_date: string
  supplier_name: string
  received_quantity: number
  available_quantity: number
  unit_cost: number | null
  remaining_value: number | null
  source: string
  source_label: string
  source_lot_id: string
  cost_item_id: string
}

const {
  loadInventoryBalances,
  loadStockMovements,
  loadWarehouses,
  loadProducts,
  loadImportOrders,
  loadImportOrderItems,
  loadExportOrders,
  loadExportOrderItems,
} = useScopedQueries()
const { hasPermission } = useAuth()
const { showToast } = useUi()

const loading = ref(false)
const search = ref('')
const warehouseFilter = ref('')
const logoFilter = ref('')
const reconcileFilter = ref('')
const stockStatusFilter = ref('')
const sortMode = ref('warehouse_product')
const rows = ref<InventoryBalanceDoc[]>([])
const movements = ref<StockMovementDoc[]>([])
const warehouses = ref<WarehouseDoc[]>([])
const products = ref<ProductDoc[]>([])
const importOrders = ref<ImportOrderDoc[]>([])
const importItems = ref<ImportOrderItemDoc[]>([])
const exportOrders = ref<ExportOrderDoc[]>([])
const exportItems = ref<ExportOrderItemDoc[]>([])
const selected = ref<InventoryAuditRow | null>(null)
const showDetailModal = ref(false)
const detailTab = ref<'lots' | 'movements'>('movements')

const canViewCost = computed(() => hasPermission('*') || hasPermission('import.view'))

const activeProductIds = computed(() => new Set(
  products.value.map(row => String(row.id || '').trim()).filter(Boolean),
))

const importItemById = computed(() => new Map(
  importItems.value.map(item => [String(item.id || ''), item]),
))

const importOrderById = computed(() => new Map(
  importOrders.value.map(order => [String(order.id || ''), order]),
))

const activeImportOrderIds = computed(() => new Set(
  importOrders.value
    .filter(isActiveRecord)
    .map(order => String(order.id || '').trim())
    .filter(Boolean),
))

const activeImportItemIds = computed(() => new Set(
  importItems.value
    .filter(isActiveRecord)
    .filter(item => activeImportOrderIds.value.has(String(item.import_order_id || '').trim()))
    .map(item => String(item.id || '').trim())
    .filter(Boolean),
))

function inventoryKey(row: any) {
  return [
    String(row?.warehouse_id || '').trim(),
    String(row?.product_id || '').trim(),
    normalizeText(row?.logo || ''),
  ].join('|')
}

function productIsVisible(row: any) {
  return activeProductIds.value.has(String(row?.product_id || '').trim())
}

function roundQuantity(value: any) {
  return Math.round(toNumber(value) * 1000) / 1000
}

function isActiveRecord(row: any) {
  return row?.deleted !== true
    && row?.active !== false
    && !['deleted', 'cancelled', 'canceled'].includes(String(row?.status || '').trim().toLowerCase())
}

function lotHasValidInboundOrigin(lot: any) {
  const source = String(lot?.source || '')
  if (source === 'import_order') {
    if (!importOrders.value.length && !importItems.value.length) return true

    const orderId = String(lot?.import_order_id || '').trim()
    const itemId = String(lot?.cost_item_id || lot?.import_order_item_id || '').trim()
    return Boolean(
      (orderId && activeImportOrderIds.value.has(orderId))
      || (itemId && activeImportItemIds.value.has(itemId)),
    )
  }
  return ['warehouse_transfer', 'legacy_opening'].includes(source)
}

function balanceHasInboundOrigin(row: any) {
  if (Array.isArray(row?.lots)) {
    return row.lots.some(lotHasValidInboundOrigin)
  }

  // Dữ liệu tồn cũ chưa có cấu trúc lots nhưng đang có số lượng được coi là
  // tồn mở đầu. Balance mới luôn có mảng lots nên điều kiện này không làm cho
  // một điều chỉnh tăng mới trở thành lịch sử nhập kho.
  return Math.abs(toNumber(row?.quantity)) >= 0.0001
}

function rawLotsForRow(row: any) {
  const lots = Array.isArray(row?.lots)
    ? row.lots
        .filter((lot: any) => lot && String(lot.id || '').trim())
        .map((lot: any) => ({
          ...lot,
          id: String(lot.id || '').trim(),
          received_quantity: roundQuantity(lot.received_quantity),
          available_quantity: roundQuantity(lot.available_quantity),
        }))
        .filter((lot: any) => lot.available_quantity > 0)
    : []

  const tracked = roundQuantity(lots.reduce(
    (sum: number, lot: any) => sum + roundQuantity(lot.available_quantity),
    0,
  ))
  const missing = roundQuantity(toNumber(row?.quantity) - tracked)

  if (missing > 0.0001) {
    lots.push({
      id: `opening__${row.id}`,
      import_code: 'OPENING',
      import_date: '',
      expiry_date: '',
      received_quantity: missing,
      available_quantity: missing,
      cost_item_id: '',
      source_lot_id: '',
      source: 'legacy_opening',
      status: 'available',
    })
  }

  return lots
}

function sourceLabel(source: any) {
  switch (String(source || '')) {
    case 'import_order': return 'Nhập trực tiếp'
    case 'warehouse_transfer': return 'Chuyển kho'
    case 'inventory_adjustment': return 'Điều chỉnh tăng'
    case 'legacy_opening': return 'Tồn mở đầu'
    default: return String(source || 'Không xác định')
  }
}

function lotDetailsForRow(row: any): InventoryLotDetailRow[] {
  return rawLotsForRow(row)
    .map((lot: any) => {
      const costItemId = String(lot.cost_item_id || lot.import_order_item_id || '')
      const costItem = costItemId ? importItemById.value.get(costItemId) : undefined
      const importOrderId = String(lot.import_order_id || costItem?.import_order_id || '')
      const importOrder = importOrderId ? importOrderById.value.get(importOrderId) : undefined
      const hasCost = canViewCost.value
        && Boolean(costItem)
        && Object.prototype.hasOwnProperty.call(costItem || {}, 'unit_cost')
      const unitCost = hasCost ? toNumber((costItem as any).unit_cost) : null
      const availableQuantity = roundQuantity(lot.available_quantity)

      return {
        id: String(lot.id || ''),
        import_code: String(lot.import_code || importOrder?.code || importOrder?.import_code || 'OPENING'),
        import_date: String(lot.import_date || importOrder?.import_date || ''),
        expiry_date: String(lot.expiry_date || (costItem as any)?.expiry_date || ''),
        supplier_name: String(lot.supplier_name || importOrder?.supplier_name || ''),
        received_quantity: roundQuantity(lot.received_quantity),
        available_quantity: availableQuantity,
        unit_cost: unitCost,
        remaining_value: unitCost === null
          ? null
          : Math.round(availableQuantity * unitCost * 100) / 100,
        source: String(lot.source || ''),
        source_label: sourceLabel(lot.source),
        source_lot_id: String(lot.source_lot_id || ''),
        cost_item_id: costItemId,
      }
    })
    .sort((left, right) => {
      const leftDate = left.import_date || '0000-00-00'
      const rightDate = right.import_date || '0000-00-00'
      return leftDate.localeCompare(rightDate) || left.id.localeCompare(right.id)
    })
}

function lotCount(row: any) {
  return rawLotsForRow(row).length
}

function lotValueForRow(row: any) {
  return lotDetailsForRow(row).reduce(
    (sum, lot) => sum + (lot.remaining_value === null ? 0 : lot.remaining_value),
    0,
  )
}

const auditRows = computed<InventoryAuditRow[]>(() => {
  const audit = new Map<string, InventoryAuditRow>()

  rows.value
    .filter(productIsVisible)
    .forEach(row => {
      audit.set(inventoryKey(row), {
        ...row,
        movement_in: 0,
        movement_out: 0,
        movement_adjustment: 0,
        movement_quantity: 0,
        difference: 0,
        has_balance: true,
        has_inbound_history: balanceHasInboundOrigin(row),
      })
    })

  movements.value
    .filter(row => row.deleted !== true && row.active !== false && productIsVisible(row))
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
          has_balance: false,
          has_inbound_history: false,
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
      const importOrderId = String(movement.source_doc_id || '').trim()
      const importItemId = String(movement.source_item_id || '').trim()
      const canValidateImportSource = importOrders.value.length > 0 || importItems.value.length > 0
      const hasActiveImportSource = (sourceCollection === 'import_orders' || type === 'import')
        && (
          !canValidateImportSource
          || (importOrderId && activeImportOrderIds.value.has(importOrderId))
          || (importItemId && activeImportItemIds.value.has(importItemId))
        )
      const qualifiesAsInboundHistory = quantity > 0 && (
        hasActiveImportSource
        || type.includes('transfer_in')
      )

      if (qualifiesAsInboundHistory) row.has_inbound_history = true

      if (isAdjustment) row.movement_adjustment += quantity
      else if (isImportMovement) row.movement_in += quantity
      else if (isExportMovement) row.movement_out += -quantity
      else if (quantity >= 0) row.movement_in += quantity
      else row.movement_out += Math.abs(quantity)

      row.movement_quantity += quantity
    })

  audit.forEach(row => {
    row.movement_in = roundQuantity(row.movement_in)
    row.movement_out = roundQuantity(row.movement_out)
    row.movement_adjustment = roundQuantity(row.movement_adjustment)
    row.movement_quantity = roundQuantity(row.movement_quantity)
    row.difference = roundQuantity(toNumber(row.quantity) - row.movement_quantity)
  })

  return Array.from(audit.values())
    .filter(row => row.has_inbound_history)
    .sort((a, b) => {
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
      || (reconcileFilter.value === 'matched'
        ? Math.abs(row.difference) < 0.0001
        : Math.abs(row.difference) >= 0.0001)
    const matchedStockStatus = !stockStatusFilter.value
      || (stockStatusFilter.value === 'in_stock' && toNumber(row.quantity) > 0)
      || (stockStatusFilter.value === 'out_of_stock' && Math.abs(toNumber(row.quantity)) < 0.0001)
      || (stockStatusFilter.value === 'negative' && toNumber(row.quantity) < 0)
    const matchedText = !keyword || normalizeText([
      row.product_code,
      row.product_name,
      row.warehouse_name,
      row.logo,
      row.unit,
    ].join(' ')).includes(keyword)
    return matchedWarehouse && matchedLogo && matchedReconcile && matchedStockStatus && matchedText
  }).sort((a, b) => {
    switch (sortMode.value) {
      case 'quantity_desc':
        return toNumber(b.quantity) - toNumber(a.quantity)
      case 'quantity_asc':
        return toNumber(a.quantity) - toNumber(b.quantity)
      case 'updated_desc':
        return String(b.last_movement_at || b.updated_at || '').localeCompare(String(a.last_movement_at || a.updated_at || ''))
      case 'value_desc':
        return lotValueForRow(b) - lotValueForRow(a)
      default: {
        const left = `${a.warehouse_name || ''} ${a.product_code || ''} ${a.logo || ''}`
        const right = `${b.warehouse_name || ''} ${b.product_code || ''} ${b.logo || ''}`
        return left.localeCompare(right, 'vi')
      }
    }
  })
})

function resetFilters() {
  search.value = ''
  warehouseFilter.value = ''
  logoFilter.value = ''
  reconcileFilter.value = ''
  stockStatusFilter.value = ''
  sortMode.value = 'warehouse_product'
}

const filterValues = computed(() => ({ warehouse: warehouseFilter.value, logo: logoFilter.value, reconcile: reconcileFilter.value, stock: stockStatusFilter.value, sort: sortMode.value }))
const toolbarFilters = computed(() => [
  { key: 'warehouse', label: 'Kho', allLabel: 'Tất cả kho', options: warehouses.value.map(row => ({ label: row.name || row.warehouse_code || row.id, value: row.id })) },
  { key: 'logo', label: 'Logo', allLabel: 'Tất cả logo', options: [{ label: 'Không logo', value: 'no-logo' }, { label: 'Có logo', value: 'logo' }] },
  { key: 'reconcile', label: 'Đối soát', allLabel: 'Tất cả đối soát', options: [{ label: 'Đã khớp', value: 'matched' }, { label: 'Đang lệch', value: 'mismatch' }] },
  { key: 'stock', label: 'Tình trạng tồn', allLabel: 'Tất cả tình trạng', options: [{ label: 'Còn hàng', value: 'in_stock' }, { label: 'Hết hàng', value: 'out_of_stock' }, { label: 'Tồn âm', value: 'negative' }] },
  { key: 'sort', label: 'Sắp xếp', options: [{ label: 'Kho / sản phẩm', value: 'warehouse_product' }, { label: 'Tồn nhiều nhất', value: 'quantity_desc' }, { label: 'Tồn ít nhất', value: 'quantity_asc' }, { label: 'Cập nhật mới nhất', value: 'updated_desc' }, ...(canViewCost.value ? [{ label: 'Giá trị tồn cao nhất', value: 'value_desc' }] : [])] },
])
function updateFilter(key: string, value: string) {
  if (key === 'warehouse') warehouseFilter.value = value
  if (key === 'logo') logoFilter.value = value
  if (key === 'reconcile') reconcileFilter.value = value
  if (key === 'stock') stockStatusFilter.value = value
  if (key === 'sort') sortMode.value = value
}

const summary = computed(() => ({
  lines: filtered.value.length,
  quantity: filtered.value.reduce((sum, row) => sum + toNumber(row.quantity), 0),
  movementQuantity: filtered.value.reduce((sum, row) => sum + toNumber(row.movement_quantity), 0),
  mismatches: filtered.value.filter(row => Math.abs(row.difference) >= 0.0001).length,
  lots: canViewCost.value ? filtered.value.reduce((sum, row) => sum + lotCount(row), 0) : 0,
  inventoryValue: canViewCost.value
    ? filtered.value.reduce((sum, row) => sum + lotValueForRow(row), 0)
    : 0,
}))

const selectedMovements = computed(() => {
  if (!selected.value) return []
  const row = selected.value
  const rowLogo = normalizeText(row.logo || '')
  return movements.value
    .filter(movement =>
      movement.deleted !== true
      && movement.active !== false
      && movement.warehouse_id === row.warehouse_id
      && movement.product_id === row.product_id
      && normalizeText(movement.logo || '') === rowLogo,
    )
    .sort((a, b) => String(b.movement_date || b.created_at || '').localeCompare(String(a.movement_date || a.created_at || '')))
})

const selectedLots = computed(() => selected.value && canViewCost.value
  ? lotDetailsForRow(selected.value)
  : [])

const selectedLotSummary = computed(() => {
  const lots = selectedLots.value
  const knownLots = lots.filter(lot => lot.unit_cost !== null)
  const knownQuantity = knownLots.reduce((sum, lot) => sum + lot.available_quantity, 0)
  const knownValue = knownLots.reduce((sum, lot) => sum + toNumber(lot.remaining_value), 0)
  return {
    lots: lots.length,
    quantity: lots.reduce((sum, lot) => sum + lot.available_quantity, 0),
    knownValue,
    averageCost: knownQuantity > 0 ? knownValue / knownQuantity : 0,
    unknownLots: lots.filter(lot => lot.unit_cost === null).length,
  }
})

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

function movementClass(row: StockMovementDoc) {
  if (toNumber(row.quantity) < 0 || row.direction === 'out') return 'red'
  if (row.direction === 'adjust') return 'yellow'
  return 'green'
}

function differenceClass(row: InventoryAuditRow) {
  return Math.abs(row.difference) < 0.0001 ? 'green' : 'red'
}

function findImportOrder(id: any) {
  return importOrderById.value.get(String(id || ''))
}

function findExportOrder(id: any) {
  return exportOrders.value.find(row => row.id === id)
}

function findImportItem(id: any) {
  return importItemById.value.get(String(id || ''))
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
    if (type.includes('reverse') || type.includes('cancel')) {
      return movement.reason || 'Biến động đảo/hoàn tồn của phiếu xuất.'
    }
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

function openDetail(row: InventoryAuditRow, tab?: 'lots' | 'movements') {
  selected.value = row
  detailTab.value = tab || (canViewCost.value ? 'lots' : 'movements')
  showDetailModal.value = true
}

async function loadOptional<T>(loader: (force?: boolean) => Promise<T[]>, force: boolean) {
  try {
    return await loader(force)
  } catch {
    return [] as T[]
  }
}

async function loadRows(force = false) {
  loading.value = true
  try {
    const [balanceRows, movementRows, warehouseRows, productRows] = await Promise.all([
      loadInventoryBalances(force),
      loadStockMovements(force),
      loadWarehouses(force),
      loadProducts(force),
    ])

    const [exportOrderRows, exportItemRows] = await Promise.all([
      loadOptional<ExportOrderDoc>(loadExportOrders, force),
      loadOptional<ExportOrderItemDoc>(loadExportOrderItems, force),
    ])

    let importOrderRows: ImportOrderDoc[] = []
    let importItemRows: ImportOrderItemDoc[] = []
    if (canViewCost.value) {
      ;[importOrderRows, importItemRows] = await Promise.all([
        loadImportOrders(force),
        loadImportOrderItems(force),
      ])
    }

    rows.value = balanceRows
    movements.value = movementRows
    warehouses.value = warehouseRows
    products.value = productRows.filter(isActiveRecord)
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
    <PageHeader title="Tồn kho" subtitle="Xem tồn tổng hợp, chi tiết lô giá và lịch sử theo kho, sản phẩm, logo">
      <button class="btn" @click="loadRows(true)">Làm mới</button>
    </PageHeader>

    <div class="summary-grid">
      <div class="summary-card"><label>Số dòng đối soát</label><strong>{{ summary.lines.toLocaleString('vi-VN') }}</strong></div>
      <div class="summary-card"><label>Tồn từ balances</label><strong>{{ quantityText(summary.quantity) }}</strong></div>
      <div class="summary-card"><label>Tồn từ movements</label><strong>{{ quantityText(summary.movementQuantity) }}</strong></div>
      <div class="summary-card"><label>Dòng bị lệch</label><strong>{{ summary.mismatches.toLocaleString('vi-VN') }}</strong></div>
      <div v-if="canViewCost" class="summary-card"><label>Số lô còn hàng</label><strong>{{ summary.lots.toLocaleString('vi-VN') }}</strong></div>
      <div v-if="canViewCost" class="summary-card"><label>Giá trị tồn đã xác định</label><strong>{{ currencyText(summary.inventoryValue) }}</strong></div>
    </div>

    <div class="card" style="margin: 24px;">
      <FilterToolbar v-model:search="search" search-placeholder="Tìm mã/tên sản phẩm, kho, logo..." :filters="toolbarFilters" :values="filterValues" :result-count="filtered.length" :loading="loading" @update:filter="updateFilter" @reset="resetFilters" />
      <div v-if="false" class="toolbar">
        <input v-model="search" class="input" style="max-width: 420px" placeholder="Tìm mã/tên sản phẩm, kho, logo..." />
        <select v-model="warehouseFilter" class="select" style="max-width: 220px">
          <option value="">Tất cả kho</option>
          <option v-for="warehouse in warehouses" :key="warehouse.id" :value="warehouse.id">
            {{ warehouse.name || warehouse.warehouse_code || warehouse.id }}
          </option>
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
        <select v-model="stockStatusFilter" class="select" style="max-width: 190px">
          <option value="">Tất cả tình trạng tồn</option>
          <option value="in_stock">Còn hàng</option>
          <option value="out_of_stock">Hết hàng</option>
          <option value="negative">Tồn âm</option>
        </select>
        <select v-model="sortMode" class="select" style="max-width: 220px">
          <option value="warehouse_product">Sắp xếp kho / sản phẩm</option>
          <option value="quantity_desc">Tồn nhiều nhất</option>
          <option value="quantity_asc">Tồn ít nhất</option>
          <option value="updated_desc">Cập nhật mới nhất</option>
          <option v-if="canViewCost" value="value_desc">Giá trị tồn cao nhất</option>
        </select>
        <button class="btn" type="button" @click="resetFilters">Xóa lọc</button>
      </div>

      <div v-if="!canViewCost" class="small subtle" style="margin: 0 0 12px;">
        Giá nhập và chi tiết lô giá chỉ hiển thị cho người có quyền Xem phiếu nhập kho (`import.view`).
      </div>

      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table :style="{ minWidth: canViewCost ? '1640px' : '1540px' }">
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
              <th v-if="canViewCost">Số lô</th>
              <th v-if="canViewCost">Giá trị tồn</th>
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
              <td>
                <b>{{ quantityText(row.quantity) }}</b>
                <span v-if="Math.abs(toNumber(row.quantity)) < 0.0001" class="badge red" style="margin-left: 6px;">Hết hàng</span>
                <div v-if="!row.has_balance" class="small" style="color:#dc2626">Thiếu balance</div>
              </td>
              <td v-if="canViewCost"><b>{{ lotCount(row) }}</b></td>
              <td v-if="canViewCost"><b>{{ currencyText(lotValueForRow(row)) }}</b></td>
              <td><span class="badge" :class="differenceClass(row)">{{ quantityText(row.difference) }}</span></td>
              <td>{{ formatDateTime(row.last_movement_at || row.updated_at) }}</td>
              <td>
                <button class="btn-sm btn-view" @click="openDetail(row)">
                  {{ canViewCost ? 'Chi tiết' : 'Lịch sử' }}
                </button>
              </td>
            </tr>
            <tr v-if="!filtered.length">
              <td :colspan="canViewCost ? 14 : 12" class="empty">Không có dữ liệu tồn kho.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal
      v-if="showDetailModal && selected"
      :title="`Chi tiết tồn: ${selected.product_code || selected.product_name}`"
      size="xl"
      :show-footer="false"
      @close="showDetailModal = false"
    >
      <div class="detail-grid">
        <div class="detail-item"><label>Kho hiện tại</label><strong>{{ selected.warehouse_name || selected.warehouse_id }}</strong></div>
        <div class="detail-item"><label>Sản phẩm</label><strong>{{ selected.product_code }} - {{ selected.product_name }}</strong></div>
        <div class="detail-item"><label>Logo</label><strong>{{ selected.logo || 'Không logo' }}</strong></div>
        <div class="detail-item"><label>Tồn hiện tại</label><strong>{{ quantityText(selected.quantity) }} {{ selected.unit || '' }}</strong></div>
        <div class="detail-item"><label>Tồn theo lịch sử</label><strong>{{ quantityText(selected.movement_quantity) }}</strong></div>
        <div class="detail-item"><label>Chênh lệch</label><strong>{{ quantityText(selected.difference) }}</strong></div>
      </div>

      <div class="toolbar" style="margin: 16px 0;">
        <button
          v-if="canViewCost"
          class="btn"
          :class="{ primary: detailTab === 'lots' }"
          @click="detailTab = 'lots'"
        >
          Các lô giá
        </button>
        <button
          class="btn"
          :class="{ primary: detailTab === 'movements' }"
          @click="detailTab = 'movements'"
        >
          Lịch sử biến động
        </button>
      </div>

      <template v-if="detailTab === 'lots' && canViewCost">
        <div class="summary-grid" style="margin: 0 0 16px;">
          <div class="summary-card"><label>Số lô còn hàng</label><strong>{{ selectedLotSummary.lots }}</strong></div>
          <div class="summary-card"><label>Tổng số lượng theo lô</label><strong>{{ quantityText(selectedLotSummary.quantity) }}</strong></div>
          <div class="summary-card"><label>Giá trị đã xác định</label><strong>{{ currencyText(selectedLotSummary.knownValue) }}</strong></div>
          <div class="summary-card"><label>Giá nhập bình quân</label><strong>{{ currencyText(selectedLotSummary.averageCost) }}</strong></div>
        </div>

        <div v-if="selectedLotSummary.unknownLots" class="small" style="margin-bottom: 10px; color:#b45309;">
          Có {{ selectedLotSummary.unknownLots }} lô chưa xác định giá, thường là tồn mở đầu hoặc điều chỉnh tăng không có phiếu nhập gốc.
        </div>

        <div class="table-wrap">
          <table style="min-width: 1380px;">
            <thead>
              <tr>
                <th>Mã lô</th>
                <th>Nguồn</th>
                <th>Phiếu nhập gốc</th>
                <th>Ngày nhập</th>
                <th>Nhà cung cấp</th>
                <th>Hạn dùng</th>
                <th>SL ban đầu</th>
                <th>SL còn lại</th>
                <th>Giá nhập</th>
                <th>Giá trị còn lại</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="lot in selectedLots" :key="lot.id">
                <td><b>{{ lot.id }}</b><div v-if="lot.source_lot_id" class="small subtle">Lô nguồn: {{ lot.source_lot_id }}</div></td>
                <td><span class="badge blue">{{ lot.source_label }}</span></td>
                <td>{{ lot.import_code || '-' }}</td>
                <td>{{ lot.import_date ? formatDateTime(lot.import_date) : '-' }}</td>
                <td>{{ lot.supplier_name || '-' }}</td>
                <td>{{ lot.expiry_date ? formatDateTime(lot.expiry_date) : '-' }}</td>
                <td>{{ quantityText(lot.received_quantity) }}</td>
                <td><b>{{ quantityText(lot.available_quantity) }}</b></td>
                <td>{{ lot.unit_cost === null ? 'Chưa xác định' : currencyText(lot.unit_cost) }}</td>
                <td><b>{{ lot.remaining_value === null ? 'Chưa xác định' : currencyText(lot.remaining_value) }}</b></td>
              </tr>
              <tr v-if="!selectedLots.length"><td colspan="10" class="empty">Dòng tồn này hiện không còn lô hàng khả dụng.</td></tr>
            </tbody>
          </table>
        </div>
      </template>

      <template v-else>
        <div class="detail-grid" style="margin-bottom: 14px;">
          <div class="detail-item"><label>Tổng nhập</label><strong>{{ quantityText(selected.movement_in) }}</strong></div>
          <div class="detail-item"><label>Tổng xuất</label><strong>{{ quantityText(selected.movement_out) }}</strong></div>
          <div class="detail-item"><label>Tổng điều chỉnh</label><strong>{{ quantityText(selected.movement_adjustment) }}</strong></div>
        </div>

        <div class="table-wrap">
          <table style="min-width: 1040px;">
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
      </template>
    </BaseModal>
  </AppShell>
</template>
