<script setup lang="ts">
import { doc, getDoc } from 'firebase/firestore';
import type {
  InventoryAdjustmentDoc,
  ProductDoc,
  WarehouseDoc,
} from "~/types/models";
import {
  formatDateTime,
  makeId,
  normalizeText,
  toNumber,
  todayKey,
} from "~/utils/format";
import { reportFirebaseError } from "~/utils/firebaseErrors";

const { loadInventoryAdjustmentsPage, loadWarehouses, loadProducts } =
  useScopedQueries();
const { createInventoryAdjustment, readInventoryBalance } = useWarehouseTransactions();
const { db } = useFirebaseServices();
const { hasPermission } = useAuth();
const { showToast } = useUi();

const loading = ref(false);
const saving = ref(false);
const search = ref("");
const warehouseFilter = ref("");
const dateFrom = ref("");
const dateTo = ref("");
const quantityTypeFilter = ref("");
const productFilter = ref("");
const rows = ref<InventoryAdjustmentDoc[]>([]);
const PAGE_SIZE = 50;
const pageCursor = shallowRef<any>(null);
const hasMoreRows = ref(false);
const pageMode = ref<'cursor' | 'full'>('cursor');
const loadingMore = ref(false);
const warehouses = ref<WarehouseDoc[]>([]);
const products = ref<ProductDoc[]>([]);
const selected = ref<InventoryAdjustmentDoc | null>(null);
const showDetailModal = ref(false);
const showCreateModal = ref(false);
const adjustmentLots = ref<any[]>([]);
const adjustmentLotCosts = ref<Record<string, any>>({});

const filterValues = computed(() => ({ warehouse: warehouseFilter.value, from: dateFrom.value, to: dateTo.value, quantity: quantityTypeFilter.value, product: productFilter.value }));
const toolbarFilters = computed(() => [
  { key: 'warehouse', label: 'Kho', allLabel: 'Tất cả kho', options: warehouseOptions.value.map(row => ({ label: row.label, value: row.value })) },
  { key: 'from', label: 'Từ ngày', type: 'date' as const },
  { key: 'to', label: 'Đến ngày', type: 'date' as const },
  { key: 'quantity', label: 'Loại điều chỉnh', allLabel: 'Tất cả loại', options: [{ label: 'Tăng tồn', value: 'increase' }, { label: 'Giảm tồn', value: 'decrease' }] },
  { key: 'product', label: 'Sản phẩm', allLabel: 'Tất cả sản phẩm', options: productOptions.value.map(row => ({ label: row.label, value: row.value })) },
]);
function updateFilter(key: string, value: string) {
  if (key === 'warehouse') warehouseFilter.value = value;
  if (key === 'from') dateFrom.value = value;
  if (key === 'to') dateTo.value = value;
  if (key === 'quantity') quantityTypeFilter.value = value;
  if (key === 'product') productFilter.value = value;
}

const form = reactive({
  adjustment_date: todayKey(),
  product_id: "",
  warehouse_id: "",
  logo: "",
  quantity: 0,
  unit: "",
  reason: "",
  note: "",
  operation_id: makeId("op_inventory_adjust"),
  unit_cost: 0,
  vat_rate: 0,
  allocation_mode: "automatic",
  lot_allocations: [] as Array<{ lot_id: string; quantity: number }>,
});

const canAdjust = computed(
  () => hasPermission("*") || hasPermission("inventory.adjust"),
);

const productOptions = computed(() =>
  products.value.map((row) => ({
    value: row.id,
    label: `${row.product_code || ""} - ${row.product_name || ""}`,
    subLabel: row.unit || "",
    search: `${row.product_code || ""} ${row.product_name || ""} ${row.unit || ""}`,
  })),
);

const warehouseOptions = computed(() =>
  warehouses.value.map((row) => ({
    value: row.id,
    label: row.name || row.warehouse_code || row.id,
    subLabel: row.address || "",
    search: `${row.name || ""} ${row.warehouse_code || ""} ${row.address || ""}`,
  })),
);

const filtered = computed(() => {
  const keyword = normalizeText(search.value);
  return rows.value.filter((row) => {
    const matchedWarehouse =
      !warehouseFilter.value || row.warehouse_id === warehouseFilter.value;
    const rowDate = String(row.adjustment_date || row.created_at || "").slice(0, 10);
    const matchedDateFrom = !dateFrom.value || rowDate >= dateFrom.value;
    const matchedDateTo = !dateTo.value || rowDate <= dateTo.value;
    const matchedQuantityType =
      !quantityTypeFilter.value ||
      (quantityTypeFilter.value === "increase" && toNumber(row.quantity) > 0) ||
      (quantityTypeFilter.value === "decrease" && toNumber(row.quantity) < 0);
    const matchedProduct = !productFilter.value || row.product_id === productFilter.value;
    const matchedText =
      !keyword ||
      normalizeText(
        [
          row.product_code,
          row.product_name,
          row.warehouse_name,
          row.logo,
          row.reason,
          row.note,
          row.created_by,
        ].join(" "),
      ).includes(keyword);
    return matchedWarehouse && matchedDateFrom && matchedDateTo && matchedQuantityType && matchedProduct && matchedText;
  });
});

function resetFilters() {
  search.value = "";
  warehouseFilter.value = "";
  dateFrom.value = "";
  dateTo.value = "";
  quantityTypeFilter.value = "";
  productFilter.value = "";
}

const summary = computed(() => ({
  rows: filtered.value.length,
  plus: filtered.value
    .filter((row) => toNumber(row.quantity) > 0)
    .reduce((sum, row) => sum + toNumber(row.quantity), 0),
  minus: filtered.value
    .filter((row) => toNumber(row.quantity) < 0)
    .reduce((sum, row) => sum + Math.abs(toNumber(row.quantity)), 0),
  net: filtered.value.reduce((sum, row) => sum + toNumber(row.quantity), 0),
}));

function findProduct(id: string) {
  return products.value.find((row) => row.id === id);
}

function findWarehouse(id: string) {
  return warehouses.value.find((row) => row.id === id);
}

function quantityText(value: any) {
  return toNumber(value).toLocaleString("vi-VN", { maximumFractionDigits: 3 });
}
function lotCostText(lot: any) {
  const source = adjustmentLotCosts.value[String(lot.cost_item_id || lot.import_order_item_id || lot.cost_lot_id || '')];
  if (!source) return 'Thiếu giá';
  const vatRate = Math.max(0, Math.min(100, toNumber(source.vat_rate ?? source.vat_percent)));
  const withVat = Object.prototype.hasOwnProperty.call(source, 'unit_cost_with_vat')
    ? toNumber(source.unit_cost_with_vat)
    : toNumber(source.unit_cost) * (1 + vatRate / 100);
  return withVat.toLocaleString('vi-VN', { maximumFractionDigits: 3 }) + ' (VAT ' + vatRate.toLocaleString('vi-VN', { maximumFractionDigits: 3 }) + '%)';
}

function openDetail(row: InventoryAdjustmentDoc) {
  selected.value = row;
  showDetailModal.value = true;
}

function openCreateModal() {
  Object.assign(form, {
    adjustment_date: todayKey(),
    product_id: "",
    warehouse_id: "",
    logo: "",
    quantity: 0,
    unit: "",
    reason: "",
    note: "",
    operation_id: makeId("op_inventory_adjust"),
    unit_cost: 0,
    vat_rate: 0,
    allocation_mode: "automatic",
    lot_allocations: [],
  });
  showCreateModal.value = true;
}

async function loadAdjustmentLots() {
  if (!form.product_id || !form.warehouse_id) return showToast("Chọn sản phẩm và kho trước khi tải lô.", "error");
  const balance = await readInventoryBalance(form.product_id, form.warehouse_id, form.logo);
  const lots = Array.isArray((balance as any)?.lots) ? (balance as any).lots.filter((lot: any) => toNumber(lot.available_quantity) > 0) : [];
  const costIds = [...new Set(lots.map((lot: any) => String(lot.cost_item_id || lot.import_order_item_id || lot.cost_lot_id || '')).filter(Boolean))];
  const snapshots = await Promise.all(costIds.map(async costId => {
    const importCost = await getDoc(doc(db, 'import_order_items', costId));
    if (importCost.exists()) return { id: costId, ...importCost.data() };
    const adjustmentCost = await getDoc(doc(db, 'inventory_lot_costs', costId));
    return adjustmentCost.exists() ? { id: costId, ...adjustmentCost.data() } : null;
  }));
  adjustmentLotCosts.value = Object.fromEntries(snapshots.filter(Boolean).map((row: any) => [row.id, row]));
  adjustmentLots.value = lots;
}
function setLotQuantity(lotId: string, quantity: any) {
  const next = toNumber(quantity); const index = form.lot_allocations.findIndex(row => row.lot_id === lotId);
  if (next <= 0) { if (index >= 0) form.lot_allocations.splice(index, 1); return; }
  if (index >= 0) form.lot_allocations[index].quantity = next;
  else form.lot_allocations.push({ lot_id: lotId, quantity: next });
}
function onProductChanged() {
  const product = findProduct(form.product_id);
  if (product && !form.unit) form.unit = product.unit || "";
}

async function saveAdjustment() {
  if (!form.product_id) return showToast("Vui lòng chọn sản phẩm.", "error");
  if (!form.warehouse_id) return showToast("Vui lòng chọn kho.", "error");
  if (toNumber(form.quantity) > 0 && toNumber(form.unit_cost) <= 0) return showToast("Vui lòng nhập giá chưa VAT lớn hơn 0.", "error");
  if (toNumber(form.quantity) === 0)
    return showToast(
      "Số lượng điều chỉnh phải khác 0. Dùng số âm để giảm tồn.",
      "error",
    );

  saving.value = true;
  try {
    const result = await createInventoryAdjustment({
      adjustment_date: form.adjustment_date,
      product: findProduct(form.product_id),
      warehouse: findWarehouse(form.warehouse_id),
      logo: form.logo,
      quantity: toNumber(form.quantity),
      unit: form.unit || findProduct(form.product_id)?.unit || "",
      reason: form.reason,
      note: form.note,
      operation_id: form.operation_id,
      unit_cost: form.unit_cost,
      vat_rate: form.vat_rate,
      allocation_mode: form.allocation_mode,
      lot_allocations: form.lot_allocations,
    });
    showCreateModal.value = false;
    showToast(`Đã tạo điều chỉnh tồn ${result.id}.`, "success");
    await loadRows(true);
  } catch (error) {
    showToast(
      reportFirebaseError(error, "Không tạo được điều chỉnh tồn."),
      "error",
    );
  } finally {
    saving.value = false;
  }
}

async function loadRows(force = false, append = false) {
  if (append && (!hasMoreRows.value || loadingMore.value)) return;
  if (append) loadingMore.value = true;
  else loading.value = true;
  try {
    const pagePromise = loadInventoryAdjustmentsPage(append ? pageCursor.value : null, PAGE_SIZE);
    const referencesPromise = append
      ? Promise.resolve([warehouses.value, products.value] as const)
      : Promise.all([loadWarehouses(force), loadProducts(force)]);
    const [page, [warehouseRows, productRows]] = await Promise.all([pagePromise, referencesPromise]);
    rows.value = append ? appendUniqueRows(rows.value, page.rows) : page.rows;
    if (!append) {
      warehouses.value = warehouseRows;
      products.value = productRows;
    }
    pageCursor.value = page.cursor;
    hasMoreRows.value = page.hasMore;
    pageMode.value = page.mode;
  } catch (error) {
    showToast(
      reportFirebaseError(error, "Không tải được điều chỉnh tồn."),
      "error",
    );
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

async function loadMoreRows() { await loadRows(false, true); }

onMounted(() => loadRows());
</script>

<template>
  <AppShell>
    <PageHeader
      title="Điều chỉnh tồn"
      subtitle="Điều chỉnh tăng hoặc giảm tồn kho"
    >
      <button v-if="canAdjust" class="btn primary" @click="openCreateModal">
        + Điều chỉnh tồn
      </button>
      <button class="btn" @click="loadRows(true)">Làm mới</button>
    </PageHeader>

    <div class="summary-grid">
      <div class="summary-card">
        <label>Số dòng điều chỉnh</label
        ><strong>{{ summary.rows.toLocaleString("vi-VN") }}</strong>
      </div>
      <div class="summary-card">
        <label>Tổng cộng tăng</label
        ><strong>{{ quantityText(summary.plus) }}</strong>
      </div>
      <div class="summary-card">
        <label>Tổng cộng giảm</label
        ><strong>{{ quantityText(summary.minus) }}</strong>
      </div>
      <div class="summary-card">
        <label>Chênh lệch ròng</label
        ><strong>{{ quantityText(summary.net) }}</strong>
      </div>
    </div>

    <div class="card" style="margin: 24px;">
      <FilterToolbar v-model:search="search" search-placeholder="Tìm sản phẩm, kho, logo, lý do..." :filters="toolbarFilters" :values="filterValues" :result-count="filtered.length" :loading="loading" @update:filter="updateFilter" @reset="resetFilters" />
      <div v-if="false" class="toolbar">
        <input
          v-model="search"
          class="input"
          style="max-width: 560px"
          placeholder="Tìm sản phẩm, kho, logo, lý do, ghi chú..."
        />
        <select
          v-model="warehouseFilter"
          class="select"
          style="max-width: 240px"
        >
          <option value="">Tất cả kho</option>
          <option
            v-for="warehouse in warehouses"
            :key="warehouse.id"
            :value="warehouse.id"
          >
            {{ warehouse.name || warehouse.warehouse_code || warehouse.id }}
          </option>
        </select>
        <input v-model="dateFrom" class="input" type="date" style="max-width: 160px" title="Từ ngày" />
        <input v-model="dateTo" class="input" type="date" style="max-width: 160px" title="Đến ngày" />
        <select v-model="quantityTypeFilter" class="select" style="max-width: 180px">
          <option value="">Tất cả tăng/giảm</option>
          <option value="increase">Điều chỉnh tăng</option>
          <option value="decrease">Điều chỉnh giảm</option>
        </select>
        <select v-model="productFilter" class="select" style="max-width: 260px">
          <option value="">Tất cả sản phẩm</option>
          <option v-for="product in products" :key="product.id" :value="product.id">{{ product.product_code || product.id }} - {{ product.product_name || product.id }}</option>
        </select>
        <button class="btn" type="button" @click="resetFilters">Xóa lọc</button>
      </div>

      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table style="min-width: 1120px">
          <thead>
            <tr>
              <th>Ngày điều chỉnh</th>
              <th>Kho</th>
              <th>Sản phẩm</th>
              <th>Logo</th>
              <th>Đơn vị</th>
              <th>Số lượng</th>
              <th>Lý do</th>
              <th>Người tạo</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td>
                {{ formatDateTime(row.adjustment_date || row.created_at) }}
              </td>
              <td>{{ row.warehouse_name || row.warehouse_id || "-" }}</td>
              <td>
                <b>{{ row.product_code }}</b>
                <div class="small subtle">{{ row.product_name }}</div>
              </td>
              <td>{{ row.logo || "Không logo" }}</td>
              <td>{{ row.unit || "-" }}</td>
              <td>
                <span
                  class="badge"
                  :class="toNumber(row.quantity) < 0 ? 'red' : 'green'"
                  >{{ quantityText(row.quantity) }}</span
                >
              </td>
              <td>{{ row.reason || row.note || "-" }}</td>
              <td>{{ row.created_by || "-" }}</td>
              <td>
                <button class="btn-sm btn-view" @click="openDetail(row)">
                  Xem
                </button>
              </td>
            </tr>
            <tr v-if="!filtered.length">
              <td colspan="9" class="empty">
                Không có dữ liệu điều chỉnh tồn.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <CursorLoadMore :loaded-count="rows.length" :has-more="hasMoreRows" :loading="loadingMore" :mode="pageMode" @load-more="loadMoreRows" />
    </div>

    <BaseModal
      v-if="showCreateModal"
      title="Điều chỉnh tồn kho"
      size="lg"
      :loading="saving"
      save-label="Lưu điều chỉnh"
      @close="showCreateModal = false"
      @save="saveAdjustment"
    >
      <div class="form-grid">
        <div class="form-group">
          <label>Ngày điều chỉnh</label
          ><input v-model="form.adjustment_date" class="input" type="date" />
        </div>
        <div class="form-group">
          <label>Sản phẩm</label>
          <SearchableSelect
            v-model="form.product_id"
            :options="productOptions"
            placeholder="Chọn sản phẩm"
            @change="onProductChanged"
          />
        </div>
        <div class="form-group">
          <label>Kho</label>
          <SearchableSelect
            v-model="form.warehouse_id"
            :options="warehouseOptions"
            placeholder="Chọn kho"
          />
        </div>
        <div class="form-group">
          <label>Logo</label
          ><input
            v-model="form.logo"
            class="input"
            placeholder="Để trống nếu không logo"
          />
        </div>
        <div class="form-group">
          <label>Đơn vị</label
          ><input v-model="form.unit" class="input" placeholder="Đơn vị" />
        </div>
        <div class="form-group">
          <label>Số lượng điều chỉnh</label
          ><input
            v-model.number="form.quantity"
            class="input"
            type="number"
            step="1"
            placeholder="Dùng số âm để giảm tồn"
          />
        </div>
      </div>
      <div v-if="toNumber(form.quantity) > 0" class="form-grid">
        <div class="form-group"><label>Giá chưa VAT</label><input v-model.number="form.unit_cost" class="input" type="number" min="0" step="0.001" /></div>
        <div class="form-group"><label>VAT (%)</label><input v-model.number="form.vat_rate" class="input" type="number" min="0" max="100" step="0.001" /></div>
        <div class="form-group"><label>Giá có VAT</label><div style="padding-top:9px"><b>{{ (toNumber(form.unit_cost) * (1 + toNumber(form.vat_rate) / 100)).toLocaleString('vi-VN', { maximumFractionDigits: 3 }) }}</b></div></div>
      </div>
      <div v-if="toNumber(form.quantity) < 0" class="form-group">
        <label>Cách chọn lô</label><select v-model="form.allocation_mode" class="select"><option value="automatic">Tự phân bổ theo cấu hình kho</option><option value="manual">Chọn lô thủ công</option></select>
        <button v-if="form.allocation_mode === 'manual'" type="button" class="btn" style="margin-top:8px" @click="loadAdjustmentLots">Tải lô còn hàng</button>
        <div v-if="form.allocation_mode === 'manual' && adjustmentLots.length" class="table-wrap" style="margin-top:8px"><table><thead><tr><th>Lô</th><th>Tồn</th><th>Giá có VAT</th><th>Lấy giảm</th></tr></thead><tbody><tr v-for="lot in adjustmentLots" :key="lot.id"><td>{{ lot.import_code || lot.id }}</td><td>{{ quantityText(lot.available_quantity) }}</td><td>{{ lotCostText(lot) }}</td><td><input class="input" type="number" min="0" :max="lot.available_quantity" step="0.001" :value="form.lot_allocations.find(row => row.lot_id === lot.id)?.quantity || ''" @input="setLotQuantity(lot.id, ($event.target as HTMLInputElement).value)" /></td></tr></tbody></table></div>
      </div>
      <div class="form-group">
        <label>Lý do</label
        ><input
          v-model="form.reason"
          class="input"
          placeholder="Ví dụ: kiểm kê lệch, hư hỏng, bổ sung tồn..."
        />
      </div>
      <div class="form-group">
        <label>Ghi chú</label
        ><textarea v-model="form.note" class="textarea" rows="3" />
      </div>
      <p class="small subtle">
        Nếu số lượng âm làm tồn kho nhỏ hơn 0, transaction sẽ chặn và không ghi
        dữ liệu.
      </p>
    </BaseModal>

    <RecordDetailModal
      v-if="showDetailModal && selected"
      title="Chi tiết điều chỉnh tồn"
      :record="selected"
      :field-order="[
        'id',
        'legacy_id',
        'adjustment_date',
        'warehouse_id',
        'warehouse_name',
        'product_id',
        'product_code',
        'product_name',
        'logo',
        'unit',
        'quantity',
        'reason',
        'note',
        'created_by',
        'created_at',
        'updated_at',
        'source',
        'status',
        'active',
        'deleted',
      ]"
      @close="showDetailModal = false"
    />
  </AppShell>
</template>
