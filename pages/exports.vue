<script setup lang="ts">
import type {
  ExportOrderDoc,
  ExportOrderItemDoc,
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

const { loadExportOrders, loadExportOrderItems, loadProducts, loadWarehouses } =
  useScopedQueries();
const { createExportOrder, updateExportOrder, deleteExportOrder } = useWarehouseTransactions();
const { hasPermission } = useAuth();
const { showToast } = useUi();
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog();

const loading = ref(false);
const saving = ref(false);
const search = ref("");
const destinationFilter = ref("");
const rows = ref<ExportOrderDoc[]>([]);
const items = ref<ExportOrderItemDoc[]>([]);
const products = ref<ProductDoc[]>([]);
const warehouses = ref<WarehouseDoc[]>([]);
const selected = ref<ExportOrderDoc | null>(null);
const showDetailModal = ref(false);
const showCreateModal = ref(false);
const editing = ref<ExportOrderDoc | null>(null);

const form = reactive({
  export_date: todayKey(),
  destination_type: "customer",
  from_warehouse_id: "",
  to_warehouse_id: "",
  customer_name: "",
  source_order_code: "",
  note: "",
  operation_id: makeId("op_export_create"),
  lines: [newBlankLine()],
});

const canCreate = computed(
  () => hasPermission("*") || hasPermission("export.create"),
);
const canEdit = computed(
  () => hasPermission("*") || hasPermission("export.edit"),
);
const canDelete = computed(
  () => hasPermission("*") || hasPermission("export.delete"),
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
  const map = new Map<string, ExportOrderItemDoc[]>();
  items.value.forEach((item) => {
    const key = String(item.export_order_id || "");
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
  return enrichedRows.value.filter((row) => {
    const matchedDestination =
      !destinationFilter.value ||
      row.destination_type === destinationFilter.value;
    const matchedText =
      !keyword ||
      normalizeText(
        [
          row.code,
          row.export_code,
          row.source_order_code,
          row.customer_name,
          row.destination_name,
          row.created_by,
          row.status,
          row.sync_source,
          row.note,
          row.product_search_text,
        ].join(" "),
      ).includes(keyword);
    return matchedDestination && matchedText;
  });
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

function newBlankLine() {
  return {
    product_id: "",
    from_warehouse_id: "",
    source_logo: "",
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

function codeOf(row: ExportOrderDoc) {
  return row.code || row.export_code || row.id;
}

function quantityText(value: any) {
  return toNumber(value).toLocaleString("vi-VN");
}

function destinationLabel(value: any) {
  if (value === "warehouse") return "Xuất tới kho";
  if (value === "customer") return "Xuất tới khách";
  return value || "-";
}

function detailWarehouseReceiver(row: any) {
  if (row?.destination_type !== "warehouse") return "-";
  return row.to_warehouse_name || row.destination_name || "-";
}

function detailCustomerReceiver(row: any) {
  if (row?.destination_type === "warehouse") return "-";
  return row.customer_name || row.destination_name || "-";
}

function itemWarehouseReceiver(item: any) {
  return item.to_warehouse_name || item.to_warehouse_id || "-";
}

function itemCustomerReceiver(item: any) {
  return item.to_warehouse_id || item.to_warehouse_name ? "-" : (item.destination_name || selected.value?.customer_name || selected.value?.destination_name || "-");
}

function itemSourceLogoText(item: any) {
  const logo = Object.prototype.hasOwnProperty.call(item, "source_logo")
    ? item.source_logo
    : item.logo;
  return logo || "Không logo";
}

function isRequestGenerated(row: any) {
  return Boolean(
    String(row?.source_request_id || "").trim()
    || String(row?.source || "").trim() === "kingcup_firestore"
    || String(row?.sync_source || "").trim().startsWith("kingcup_firestore:")
  );
}

function canEditRow(row: ExportOrderDoc) {
  return canEdit.value
    && !isRequestGenerated(row)
    && row.deleted !== true
    && row.active !== false
    && !["cancelled", "deleted"].includes(String(row.status || ""));
}

function canDeleteRow(row: ExportOrderDoc) {
  return canDelete.value
    && !isRequestGenerated(row)
    && row.deleted !== true
    && row.active !== false
    && !["cancelled", "deleted"].includes(String(row.status || ""));
}

function openDetail(row: ExportOrderDoc) {
  selected.value = row;
  showDetailModal.value = true;
}

function openCreateModal() {
  editing.value = null;
  Object.assign(form, {
    export_date: todayKey(),
    destination_type: "customer",
    from_warehouse_id: "",
    to_warehouse_id: "",
    customer_name: "",
    source_order_code: "",
    note: "",
    operation_id: makeId("op_export_create"),
    lines: [newBlankLine()],
  });
  showCreateModal.value = true;
}

function openEditModal(row: ExportOrderDoc) {
  if (!canEditRow(row)) {
    return showToast(
      isRequestGenerated(row)
        ? "Phiếu sinh từ yêu cầu sale chỉ được xem, không được sửa tại đây."
        : "Bạn không có quyền sửa phiếu xuất này.",
      "error",
    );
  }
  const orderItems = itemsByOrder.value.get(row.id) || [];
  const firstItem = orderItems[0];
  editing.value = row;
  Object.assign(form, {
    export_date: row.export_date || todayKey(),
    destination_type: row.destination_type || "customer",
    from_warehouse_id: firstItem?.from_warehouse_id || "",
    to_warehouse_id: firstItem?.to_warehouse_id || row.to_warehouse_id || "",
    customer_name: row.customer_name || row.destination_name || "",
    source_order_code: row.source_order_code || "",
    note: row.note || "",
    operation_id: makeId("op_export_update"),
    lines: orderItems.length
      ? orderItems.map((item) => ({
          product_id: item.product_id || "",
          from_warehouse_id: item.from_warehouse_id || "",
          source_logo: Object.prototype.hasOwnProperty.call(item, "source_logo")
            ? (item as any).source_logo || ""
            : item.logo || "",
          logo: item.logo || "",
          quantity: toNumber(item.quantity),
          unit: item.unit || "",
          note: item.note || "",
        }))
      : [newBlankLine()],
  });
  showCreateModal.value = true;
}

async function cancelExportOrder(row: ExportOrderDoc) {
  if (!canDeleteRow(row)) {
    return showToast(
      isRequestGenerated(row)
        ? "Phiếu sinh từ yêu cầu sale không được hủy tại trang Xuất kho thật."
        : "Bạn không có quyền hủy phiếu xuất này.",
      "error",
    );
  }
  const confirmed = await askConfirm({
    title: "Hủy phiếu xuất kho",
    message: `Hủy ${codeOf(row)} sẽ hoàn tồn bằng transaction và giữ lại lịch sử. Bạn chắc chắn?`,
    confirmLabel: "Hủy phiếu",
  });
  if (!confirmed) return;

  saving.value = true;
  try {
    await deleteExportOrder({
      order: row,
      existingItems: itemsByOrder.value.get(row.id) || [],
      reason: "Hủy phiếu xuất từ trang Xuất kho thật",
      operation_id: `export_cancel:${row.id}:${toNumber((row as any).revision)}`,
      expected_revision: toNumber((row as any).revision),
    });
    showToast(`Đã hủy phiếu ${codeOf(row)} và hoàn tồn.`, "success");
    await loadRows(true);
  } catch (error) {
    showToast(
      reportFirebaseError(error, "Không hủy được phiếu xuất kho."),
      "error",
    );
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

async function saveExportOrder() {
  if (form.destination_type === "warehouse" && !form.to_warehouse_id)
    return showToast("Vui lòng chọn kho nhận.", "error");

  const validLines = form.lines.filter(
    (line) => line.product_id && toNumber(line.quantity) > 0,
  );
  if (!validLines.length)
    return showToast(
      "Vui lòng nhập ít nhất một dòng sản phẩm và số lượng xuất hợp lệ.",
      "error",
    );
  const missingWarehouse = validLines.find((line) => !line.from_warehouse_id);
  if (missingWarehouse)
    return showToast("Vui lòng chọn kho xuất cho từng dòng sản phẩm.", "error");
  const missingWarehouseDoc = validLines.find(
    (line) => !findWarehouse(line.from_warehouse_id),
  );
  if (missingWarehouseDoc)
    return showToast(
      "Kho xuất đã chọn không còn trong danh mục kho. Vui lòng tải lại trang và chọn lại.",
      "error",
    );
  if (
    form.destination_type === "warehouse" &&
    validLines.some((line) => line.from_warehouse_id === form.to_warehouse_id)
  )
    return showToast("Kho nhận phải khác kho xuất ở từng dòng.", "error");

  saving.value = true;
  try {
    const toWarehouse =
      form.destination_type === "warehouse"
        ? findWarehouse(form.to_warehouse_id)
        : null;
    const payload = {
      export_date: form.export_date,
      destination_type: form.destination_type,
      source_order_code: form.source_order_code,
      customer_name: form.customer_name,
      destination_name:
        form.destination_type === "warehouse"
          ? toWarehouse?.name
          : form.customer_name,
      toWarehouse,
      note: form.note,
      operation_id: form.operation_id,
      lines: validLines.map((line) => {
        const fromWarehouse = findWarehouse(line.from_warehouse_id);
        return {
          product: findProduct(line.product_id),
          fromWarehouse,
          warehouse: fromWarehouse,
          from_warehouse_id: line.from_warehouse_id,
          warehouse_id: line.from_warehouse_id,
          source_logo:
            form.destination_type === "warehouse"
              ? line.source_logo || ""
              : line.logo || "",
          target_logo: line.logo || "",
          logo: line.logo,
          quantity: toNumber(line.quantity),
          unit: line.unit || findProduct(line.product_id)?.unit || "",
          note: line.note,
        };
      }),
    };
    const result = editing.value
      ? await updateExportOrder({
          ...payload,
          order: editing.value,
          existingItems: itemsByOrder.value.get(editing.value.id) || [],
          expected_revision: toNumber((editing.value as any).revision),
        })
      : await createExportOrder(payload);
    showCreateModal.value = false;
    showToast(
      editing.value
        ? `Đã sửa phiếu xuất ${result.code}.`
        : `Đã tạo phiếu xuất ${result.code}.`,
      "success",
    );
    editing.value = null;
    await loadRows(true);
  } catch (error) {
    showToast(
      reportFirebaseError(error, "Không tạo được phiếu xuất kho thật."),
      "error",
    );
  } finally {
    saving.value = false;
  }
}

async function loadRows(force = false) {
  loading.value = true;
  try {
    const [orderRows, itemRows, productRows, warehouseRows] = await Promise.all(
      [
        loadExportOrders(force),
        loadExportOrderItems(force),
        loadProducts(force),
        loadWarehouses(force),
      ],
    );
    rows.value = orderRows;
    items.value = itemRows;
    products.value = productRows;
    warehouses.value = warehouseRows;
  } catch (error) {
    showToast(
      reportFirebaseError(error, "Không tải được phiếu xuất kho thật."),
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
      title="Xuất kho thật"
      subtitle="Quản lý phiếu xuất kho và cập nhật tồn"
    >
      <button v-if="canCreate" class="btn primary" @click="openCreateModal">
        + Tạo phiếu xuất
      </button>
      <button class="btn" @click="loadRows(true)">Làm mới</button>
    </PageHeader>

    <div class="summary-grid">
      <div class="summary-card"><label>Số phiếu</label><strong>{{ summary.orders.toLocaleString("vi-VN") }}</strong></div>
      <div class="summary-card"><label>Số dòng hàng</label><strong>{{ summary.lines.toLocaleString("vi-VN") }}</strong></div>
      <div class="summary-card"><label>Tổng SL xuất</label><strong>{{ quantityText(summary.quantity) }}</strong></div>
      <div class="summary-card"><label>Ghi tồn</label><strong>Transaction</strong></div>
    </div>

    <div class="card" style="margin: 24px;">
      <div class="toolbar">
        <input
          v-model="search"
          class="input"
          style="max-width: 620px"
          placeholder="Tìm mã phiếu, đơn hàng, khách hàng, tên/mã sản phẩm, người tạo..."
        />
        <select v-model="destinationFilter" class="select" style="max-width: 220px">
          <option value="">Tất cả loại xuất</option>
          <option value="customer">Xuất tới khách</option>
          <option value="warehouse">Xuất tới kho</option>
        </select>
      </div>

      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table style="min-width: 1180px">
          <thead><tr><th>Mã phiếu</th><th>Ngày xuất</th><th>Loại xuất</th><th>Đích xuất</th><th>Số dòng</th><th>Tổng SL</th><th>Người tạo</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td><b>{{ codeOf(row) }}</b><div class="small subtle">{{ row.source_order_code || row.sync_source || row.id }}</div></td>
              <td>{{ formatDateTime(row.export_date || row.created_at) }}</td>
              <td>{{ destinationLabel(row.destination_type) }}</td>
              <td>{{ row.destination_name || row.customer_name || "-" }}</td>
              <td>{{ row.item_count }}</td>
              <td><b>{{ quantityText(row.total_quantity) }}</b></td>
              <td>{{ row.created_by || "-" }}</td>
              <td><span class="badge blue">{{ row.status || "active" }}</span></td>
              <td>
                <div class="action-buttons">
                  <button class="btn-sm btn-view" @click="openDetail(row)">Xem chi tiết</button>
                  <button v-if="canEditRow(row)" class="btn-sm" @click="openEditModal(row)">Sửa</button>
                  <button v-if="canDeleteRow(row)" class="btn-sm btn-delete" @click="cancelExportOrder(row)">Hủy</button>
                  <span v-if="isRequestGenerated(row)" class="small subtle" title="Phiếu này được sinh từ yêu cầu sale">Khóa sửa/hủy</span>
                </div>
              </td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="9" class="empty">Không có phiếu xuất kho thật.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal
      v-if="showCreateModal"
      :title="editing ? `Sửa phiếu xuất ${codeOf(editing)}` : 'Tạo phiếu xuất kho thật'"
      size="xl"
      :loading="saving"
      :save-label="editing ? 'Lưu thay đổi' : 'Tạo phiếu xuất'"
      @close="showCreateModal = false; editing = null"
      @save="saveExportOrder"
    >
      <div class="form-grid">
        <div class="form-group"><label>Ngày xuất</label><input v-model="form.export_date" class="input" type="date" /></div>
        <div class="form-group"><label>Loại xuất</label><select v-model="form.destination_type" class="select"><option value="customer">Xuất tới khách</option><option value="warehouse">Xuất tới kho</option></select></div>
        <div v-if="form.destination_type === 'warehouse'" class="form-group"><label>Kho nhận</label><SearchableSelect v-model="form.to_warehouse_id" :options="warehouseOptions" placeholder="Chọn kho nhận" /></div>
        <div v-else class="form-group"><label>Khách hàng / nơi nhận</label><input v-model="form.customer_name" class="input" placeholder="Tên khách hàng hoặc nơi nhận" /></div>
        <div class="form-group"><label>Mã đơn liên quan</label><input v-model="form.source_order_code" class="input" placeholder="Nếu có" /></div>
      </div>

      <div class="table-wrap" style="margin-top: 14px">
        <table :style="{ minWidth: form.destination_type === 'warehouse' ? '1380px' : '1180px' }">
          <thead>
            <tr>
              <th>Kho xuất</th>
              <th>Sản phẩm</th>
              <th v-if="form.destination_type === 'warehouse'">Logo kho xuất</th>
              <th>{{ form.destination_type === 'warehouse' ? 'Logo kho nhận' : 'Logo' }}</th>
              <th>Đơn vị</th>
              <th>Số lượng</th>
              <th>Ghi chú</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, index) in form.lines" :key="index">
              <td><SearchableSelect v-model="line.from_warehouse_id" :options="warehouseOptions" placeholder="Chọn kho xuất" /></td>
              <td><SearchableSelect v-model="line.product_id" :options="productOptions" placeholder="Tìm theo mã hoặc tên sản phẩm" @change="onProductChanged(line)" /></td>
              <td v-if="form.destination_type === 'warehouse'"><input v-model="line.source_logo" class="input" placeholder="Để trống nếu hàng trơn" /></td>
              <td><input v-model="line.logo" class="input" :placeholder="form.destination_type === 'warehouse' ? 'Logo nhập vào kho nhận' : 'Để trống nếu không logo'" /></td>
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
      <p class="small subtle">Khi lưu, hệ thống sẽ kiểm tra tồn hiện tại trong <b>inventory_balances</b>. Nếu thiếu tồn, phiếu sẽ không được tạo.</p>
    </BaseModal>

    <BaseModal
      v-if="showDetailModal && selected"
      :title="`Chi tiết xuất kho ${codeOf(selected)}`"
      size="xl"
      :show-footer="false"
      @close="showDetailModal = false"
    >
      <div class="detail-grid">
        <div class="detail-item"><label>Mã phiếu</label><strong>{{ codeOf(selected) }}</strong></div>
        <div class="detail-item"><label>Ngày xuất</label><strong>{{ formatDateTime(selected.export_date || selected.created_at) }}</strong></div>
        <div class="detail-item"><label>Loại xuất</label><strong>{{ destinationLabel(selected.destination_type) }}</strong></div>
        <div class="detail-item"><label>Kho nhận</label><strong>{{ detailWarehouseReceiver(selected) }}</strong></div>
        <div class="detail-item"><label>Khách nhận</label><strong>{{ detailCustomerReceiver(selected) }}</strong></div>
        <div class="detail-item"><label>Mã đơn liên quan</label><strong>{{ selected.source_order_code || "-" }}</strong></div>
        <div class="detail-item"><label>Nguồn sync</label><strong>{{ selected.sync_source || selected.source || "-" }}</strong></div>
        <div class="detail-item"><label>Quyền sửa/hủy</label><strong>{{ isRequestGenerated(selected) ? "Khóa - sinh từ yêu cầu sale" : "Phiếu thủ công" }}</strong></div>
        <div class="detail-item"><label>Người tạo</label><strong>{{ selected.created_by || "-" }}</strong></div>
        <div class="detail-item"><label>Ghi chú</label><strong>{{ selected.note || "-" }}</strong></div>
      </div>

      <div class="table-wrap">
        <table style="min-width: 1180px">
          <thead><tr><th>Sản phẩm</th><th>Kho xuất</th><th>Kho nhận</th><th>Khách nhận</th><th>Logo kho xuất</th><th>Logo kho nhận/khách</th><th>Đơn vị</th><th>Số lượng</th><th>Ghi chú</th></tr></thead>
          <tbody>
            <tr v-for="item in selectedItems" :key="item.id">
              <td><b>{{ item.product_code }}</b><div class="small subtle">{{ item.product_name }}</div></td>
              <td>{{ item.from_warehouse_name || item.from_warehouse_id || "-" }}</td>
              <td>{{ itemWarehouseReceiver(item) }}</td>
              <td>{{ itemCustomerReceiver(item) }}</td>
              <td>{{ itemSourceLogoText(item) }}</td>
              <td>{{ item.logo || "Không logo" }}</td>
              <td>{{ item.unit || "-" }}</td>
              <td><b>{{ quantityText(item.quantity) }}</b></td>
              <td>{{ item.note || "-" }}</td>
            </tr>
            <tr v-if="!selectedItems.length"><td colspan="9" class="empty">Phiếu này chưa có dòng chi tiết.</td></tr>
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
