<script setup lang="ts">
import type {
  ImportOrderDoc,
  ImportOrderItemDoc,
  ProductDoc,
  SupplierDoc,
  WarehouseDoc,
} from "~/types/models";
import {
  formatDateTime,
  normalizeText,
  makeId,
  toNumber,
  todayKey,
} from "~/utils/format";
import { reportFirebaseError } from "~/utils/firebaseErrors";

const {
  loadImportOrders,
  loadImportOrderItems,
  loadProducts,
  loadWarehouses,
  loadSuppliers,
} = useScopedQueries();
const { createImportOrder, updateImportOrder, deleteImportOrder } = useWarehouseTransactions();
const { hasPermission } = useAuth();
const { showToast } = useUi();
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog();

const loading = ref(false);
const saving = ref(false);
const search = ref("");
const rows = ref<ImportOrderDoc[]>([]);
const items = ref<ImportOrderItemDoc[]>([]);
const products = ref<ProductDoc[]>([]);
const warehouses = ref<WarehouseDoc[]>([]);
const suppliers = ref<SupplierDoc[]>([]);
const selected = ref<ImportOrderDoc | null>(null);
const editing = ref<ImportOrderDoc | null>(null);
const showDetailModal = ref(false);
const showCreateModal = ref(false);

const form = reactive({
  import_date: todayKey(),
  supplier_id: "",
  note: "",
  operation_id: makeId("op_import_create"),
  lines: [newBlankLine()],
});

const canCreate = computed(
  () => hasPermission("*") || hasPermission("import.create"),
);

const canEdit = computed(
  () => hasPermission("*") || hasPermission("import.edit"),
);
const canDelete = computed(
  () => hasPermission("*") || hasPermission("import.delete"),
);

const supplierOptions = computed(() =>
  suppliers.value.map((row) => ({
    value: row.id,
    label: row.name || row.supplier_code || row.id,
    subLabel: [row.phone, row.email].filter(Boolean).join(" · "),
    search: `${row.name || ""} ${row.supplier_code || ""} ${row.phone || ""} ${row.email || ""}`,
  })),
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

const itemsByOrder = computed(() => {
  const map = new Map<string, ImportOrderItemDoc[]>();
  items.value.forEach((item) => {
    const key = String(item.import_order_id || "");
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  });
  return map;
});

const enrichedRows = computed(() =>
  rows.value.map((row) => {
    const orderItems = itemsByOrder.value.get(row.id) || [];
    return {
      ...row,
      item_count: orderItems.length,
      total_quantity: orderItems.reduce(
        (sum, item) => sum + toNumber(item.quantity),
        0,
      ),
      product_search_text: orderItems
        .map((item) => `${item.product_code || ""} ${item.product_name || ""} ${item.logo || ""} ${item.unit || ""}`)
        .join(" "),
    };
  }),
);

const filtered = computed(() => {
  const keyword = normalizeText(search.value);
  if (!keyword) return enrichedRows.value;
  return enrichedRows.value.filter((row) =>
    normalizeText(
      [
        row.code,
        row.import_code,
        row.supplier_name,
        row.created_by,
        row.status,
        row.note,
        row.product_search_text,
      ].join(" "),
    ).includes(keyword),
  );
});

const summary = computed(() => ({
  orders: filtered.value.length,
  lines: filtered.value.reduce((sum, row) => sum + toNumber(row.item_count), 0),
  quantity: filtered.value.reduce(
    (sum, row) => sum + toNumber(row.total_quantity),
    0,
  ),
}));

const selectedItems = computed(() =>
  selected.value ? itemsByOrder.value.get(selected.value.id) || [] : [],
);

function itemsForOrder(row: ImportOrderDoc | null) {
  return row ? itemsByOrder.value.get(row.id) || [] : []
}

function newBlankLine() {
  return {
    product_id: "",
    warehouse_id: "",
    logo: "",
    quantity: 0,
    unit: "",
    note: "",
  };
}

function findProduct(id: string) {
  return products.value.find((row) => row.id === id);
}

function findWarehouse(id: string) {
  return warehouses.value.find((row) => row.id === id);
}

function findSupplier(id: string) {
  return suppliers.value.find((row) => row.id === id);
}

function codeOf(row: ImportOrderDoc) {
  return row.code || row.import_code || row.id;
}

function quantityText(value: any) {
  return toNumber(value).toLocaleString("vi-VN");
}

function openDetail(row: ImportOrderDoc) {
  selected.value = row;
  showDetailModal.value = true;
}

function openCreateModal() {
  editing.value = null;
  Object.assign(form, {
    import_date: todayKey(),
    supplier_id: "",
    note: "",
    operation_id: makeId("op_import_create"),
    lines: [newBlankLine()],
  });
  showCreateModal.value = true;
}

function openEditModal(row: ImportOrderDoc) {
  if (!canEdit.value) return showToast("Bạn không có quyền sửa phiếu nhập kho.", "error");
  editing.value = row;
  const orderItems = itemsForOrder(row);
  Object.assign(form, {
    import_date: String(row.import_date || todayKey()).slice(0, 10),
    supplier_id: row.supplier_id || "",
    note: row.note || "",
    operation_id: makeId("op_import_update"),
    lines: orderItems.length
      ? orderItems.map((item) => ({
          product_id: item.product_id || "",
          warehouse_id: item.warehouse_id || "",
          logo: item.logo || "",
          quantity: toNumber(item.quantity),
          unit: item.unit || "",
          note: item.note || "",
        }))
      : [newBlankLine()],
  });
  showCreateModal.value = true;
}

async function confirmDeleteImport(row: ImportOrderDoc) {
  if (!canDelete.value) return showToast("Bạn không có quyền xóa phiếu nhập kho.", "error");
  const ok = await askConfirm({
    title: "Xóa phiếu nhập kho",
    message: `Bạn chắc chắn muốn xóa mềm phiếu ${codeOf(row)}? Hệ thống sẽ đảo tồn các dòng nhập của phiếu này.`,
    confirmLabel: "Xóa phiếu",
  });
  if (!ok) return;
  saving.value = true;
  try {
    const result = await deleteImportOrder({
      order: row,
      existingItems: itemsForOrder(row),
      reason: "Xóa phiếu nhập kho",
      operation_id: `import_delete:${row.id}:${toNumber((row as any).revision)}`,
      expected_revision: toNumber((row as any).revision),
    });
    showToast(`Đã xóa phiếu nhập ${result.code}.`, "success");
    await loadRows(true);
  } catch (error) {
    showToast(reportFirebaseError(error, "Không xóa được phiếu nhập kho."), "error");
  } finally {
    saving.value = false;
  }
}

function addLine() {
  form.lines.push(newBlankLine());
}

function removeLine(index: number) {
  if (form.lines.length <= 1) {
    form.lines[0] = newBlankLine();
    return;
  }
  form.lines.splice(index, 1);
}

function onProductChanged(line: any) {
  const product = findProduct(line.product_id);
  if (product && !line.unit) line.unit = product.unit || "";
}

async function saveImportOrder() {
  const validLines = form.lines.filter(
    (line) =>
      line.product_id && line.warehouse_id && toNumber(line.quantity) > 0,
  );
  if (!validLines.length)
    return showToast(
      "Vui lòng nhập ít nhất một dòng sản phẩm, kho và số lượng hợp lệ.",
      "error",
    );

  saving.value = true;
  try {
    const payload = {
      import_date: form.import_date,
      supplier: findSupplier(form.supplier_id) || null,
      note: form.note,
      operation_id: form.operation_id,
      lines: validLines.map((line) => ({
        product: findProduct(line.product_id),
        warehouse: findWarehouse(line.warehouse_id),
        logo: line.logo,
        quantity: toNumber(line.quantity),
        unit: line.unit || findProduct(line.product_id)?.unit || "",
        note: line.note,
      })),
    };
    const result = editing.value
      ? await updateImportOrder({
          order: editing.value,
          existingItems: itemsForOrder(editing.value),
          expected_revision: toNumber((editing.value as any).revision),
          ...payload,
        })
      : await createImportOrder(payload);
    showCreateModal.value = false;
    showToast(`${editing.value ? "Đã sửa" : "Đã tạo"} phiếu nhập ${result.code}.`, "success");
    editing.value = null;
    await loadRows(true);
  } catch (error) {
    showToast(
      reportFirebaseError(error, editing.value ? "Không sửa được phiếu nhập kho." : "Không tạo được phiếu nhập kho."),
      "error",
    );
  } finally {
    saving.value = false;
  }
}

async function loadRows(force = false) {
  loading.value = true;
  try {
    const [orderRows, itemRows, productRows, warehouseRows, supplierRows] =
      await Promise.all([
        loadImportOrders(force),
        loadImportOrderItems(force),
        loadProducts(force),
        loadWarehouses(force),
        loadSuppliers(force),
      ]);
    rows.value = orderRows;
    items.value = itemRows;
    products.value = productRows;
    warehouses.value = warehouseRows;
    suppliers.value = supplierRows;
  } catch (error) {
    showToast(
      reportFirebaseError(error, "Không tải được phiếu nhập kho."),
      "error",
    );
  } finally {
    loading.value = false;
  }
}

onMounted(() => loadRows());
</script>

<template>
  <AppShell>
    <PageHeader
      title="Nhập kho"
      subtitle="Quản lý phiếu nhập kho và cập nhật tồn"
    >
      <button v-if="canCreate" class="btn primary" @click="openCreateModal">
        + Tạo phiếu nhập
      </button>
      <button class="btn" @click="loadRows(true)">Làm mới</button>
    </PageHeader>

    <div class="summary-grid">
      <div class="summary-card">
        <label>Số phiếu</label
        ><strong>{{ summary.orders.toLocaleString("vi-VN") }}</strong>
      </div>
      <div class="summary-card">
        <label>Số dòng hàng</label
        ><strong>{{ summary.lines.toLocaleString("vi-VN") }}</strong>
      </div>
      <div class="summary-card">
        <label>Tổng SL nhập</label
        ><strong>{{ quantityText(summary.quantity) }}</strong>
      </div>
      <div class="summary-card">
        <label>Ghi tồn</label><strong>Transaction</strong>
      </div>
    </div>

    <div class="card" style="margin: 24px;">
      <div class="toolbar">
        <input
          v-model="search"
          class="input"
          style="max-width: 620px"
          placeholder="Tìm mã phiếu, nhà cung cấp, tên/mã sản phẩm, người tạo, ghi chú..."
        />
      </div>

      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table style="min-width: 1120px">
          <thead>
            <tr>
              <th>Mã phiếu</th>
              <th>Ngày nhập</th>
              <th>Nhà cung cấp</th>
              <th>Số dòng</th>
              <th>Tổng SL</th>
              <th>Người tạo</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td>
                <b>{{ codeOf(row) }}</b>
                <div class="small subtle">{{ row.id }}</div>
              </td>
              <td>{{ formatDateTime(row.import_date || row.created_at) }}</td>
              <td>{{ row.supplier_name || "-" }}</td>
              <td>{{ row.item_count }}</td>
              <td><b>{{ quantityText(row.total_quantity) }}</b></td>
              <td>{{ row.created_by || "-" }}</td>
              <td><span class="badge blue">{{ row.status || "active" }}</span></td>
              <td>
                <div class="action-buttons">
                  <button class="btn-sm btn-view" @click="openDetail(row)">Xem chi tiết</button>
                  <button v-if="canEdit" class="btn-sm" @click="openEditModal(row)">Sửa</button>
                  <button v-if="canDelete" class="btn-sm btn-delete" @click="confirmDeleteImport(row)">Xóa</button>
                </div>
              </td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="8" class="empty">Không có phiếu nhập kho.</td></tr>
          </tbody>
        </table>
      </div>
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
        <div class="form-group">
          <label>Nhà cung cấp</label>
          <SearchableSelect v-model="form.supplier_id" :options="supplierOptions" placeholder="Chọn nhà cung cấp" />
        </div>
      </div>
      <div class="table-wrap" style="margin-top: 14px">
        <table style="min-width: 1120px">
          <thead><tr><th>Sản phẩm</th><th>Kho nhập</th><th>Logo</th><th>Đơn vị</th><th>Số lượng</th><th>Ghi chú</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(line, index) in form.lines" :key="index">
              <td><SearchableSelect v-model="line.product_id" :options="productOptions" placeholder="Tìm theo mã hoặc tên sản phẩm" @change="onProductChanged(line)" /></td>
              <td><SearchableSelect v-model="line.warehouse_id" :options="warehouseOptions" placeholder="Chọn kho" /></td>
              <td><input v-model="line.logo" class="input" placeholder="Để trống nếu không logo" /></td>
              <td><input v-model="line.unit" class="input" placeholder="Đơn vị" /></td>
              <td><input v-model.number="line.quantity" class="input" type="number" min="0" step="1" /></td>
              <td><input v-model="line.note" class="input" placeholder="Ghi chú dòng" /></td>
              <td><button class="btn-sm btn-delete" type="button" @click="removeLine(index)">Xóa</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <button class="btn" type="button" style="margin-top: 10px" @click="addLine">+ Thêm dòng</button>
      <div class="form-group" style="margin-top: 12px"><label>Ghi chú phiếu</label><textarea v-model="form.note" class="textarea" rows="3" /></div>
    </BaseModal>

    <BaseModal
      v-if="showDetailModal && selected"
      :title="`Chi tiết nhập kho ${codeOf(selected)}`"
      size="xl"
      :show-footer="false"
      @close="showDetailModal = false"
    >
      <div class="detail-grid">
        <div class="detail-item"><label>Mã phiếu</label><strong>{{ codeOf(selected) }}</strong></div>
        <div class="detail-item"><label>Ngày nhập</label><strong>{{ formatDateTime(selected.import_date || selected.created_at) }}</strong></div>
        <div class="detail-item"><label>Nhà cung cấp</label><strong>{{ selected.supplier_name || "-" }}</strong></div>
        <div class="detail-item"><label>Người tạo</label><strong>{{ selected.created_by || "-" }}</strong></div>
        <div class="detail-item"><label>Nguồn</label><strong>{{ selected.source || "-" }}</strong></div>
        <div class="detail-item"><label>Ghi chú</label><strong>{{ selected.note || "-" }}</strong></div>
      </div>

      <div class="table-wrap">
        <table style="min-width: 920px">
          <thead><tr><th>Sản phẩm</th><th>Kho</th><th>Logo</th><th>Đơn vị</th><th>Số lượng</th><th>Ghi chú</th></tr></thead>
          <tbody>
            <tr v-for="item in selectedItems" :key="item.id">
              <td><b>{{ item.product_code }}</b><div class="small subtle">{{ item.product_name }}</div></td>
              <td>{{ item.warehouse_name || item.warehouse_id || "-" }}</td>
              <td>{{ item.logo || "Không logo" }}</td>
              <td>{{ item.unit || "-" }}</td>
              <td><b>{{ quantityText(item.quantity) }}</b></td>
              <td>{{ item.note || "-" }}</td>
            </tr>
            <tr v-if="!selectedItems.length"><td colspan="6" class="empty">Phiếu này chưa có dòng chi tiết.</td></tr>
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
