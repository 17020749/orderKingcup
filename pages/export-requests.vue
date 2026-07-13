<script setup lang="ts">
import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import type { FulfillmentRow } from "~/composables/useWarehouseLogic";
import type {
  OrderDoc,
  OrderItemDoc,
  ProductDoc,
  WarehouseDoc,
} from "~/types/models";
import {
  formatDateTime,
  isActive,
  makeCode,
  makeId,
  normalizeText,
  safeJsonParse,
  todayKey,
  toNumber,
} from "~/utils/format";
import { reportFirebaseError } from "~/utils/firebaseErrors";

const { db } = useFirebaseServices();
const { appUser, hasPermission } = useAuth();
const {
  loadScopedOrders,
  loadScopedOrderItems,
  loadScopedExportRequests,
  loadProducts,
  loadWarehouses,
} = useScopedQueries();
const {
  buildFulfillmentRows,
  orderSummary,
  requestItems,
  requestLineProgress,
} = useWarehouseLogic();
const { showToast, withLoading } = useUi();
const { processExportRequestToExportOrder } = useWarehouseTransactions();
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog();
const { invalidateScopedCache } = useRepo();

const loading = ref(false);
const saving = ref(false);
const processing = ref(false);
const search = ref("");
const rows = ref<any[]>([]);
const orders = ref<OrderDoc[]>([]);
const products = ref<ProductDoc[]>([]);
const warehouses = ref<WarehouseDoc[]>([]);
const itemsByOrder = ref<Record<string, OrderItemDoc[]>>({});
const showModal = ref(false);
const showDetailModal = ref(false);
const showProcessModal = ref(false);
const selectedRequest = ref<any>(null);
const processRequest = ref<any>(null);
const editing = ref<any>(null);
const exportLines = ref<Array<FulfillmentRow & { export_quantity: number }>>(
  [],
);
const form = reactive<any>({});
const processForm = reactive({
  warehouse_id: "",
  note: "",
  export_date: todayKey(),
});

const filtered = computed(() =>
  rows.value.filter((row) =>
    normalizeText(
      `${row.request_id} ${row.order_code} ${row.customer_name} ${row.status} ${row.requested_by}`,
    ).includes(normalizeText(search.value)),
  ),
);

const summary = computed(() =>
  filtered.value.reduce(
    (out, row) => {
      out.total++;
      if (["cho_xu_ly", "dang_xu_ly"].includes(row.status)) out.waiting++;
      if (["da_tiep_nhan", "cho_xuat_kho"].includes(row.status)) out.accepted++;
      if (row.status === "da_xuat") out.exported++;
      return out;
    },
    { total: 0, waiting: 0, accepted: 0, exported: 0 },
  ),
);

const selectedOrder = computed(() =>
  orders.value.find((order) => order.id === form.order_id),
);
const canDeletePermission = computed(
  () =>
    hasPermission("*") ||
    hasPermission("export_requests.delete") ||
    hasPermission("orders.delete"),
);
const orderOptions = computed(() =>
  orders.value.map((order) => ({
    value: order.id,
    label: `${order.order_code || ""} - ${order.customer_name || ""}`,
    subLabel: [order.phone, order.sale_name].filter(Boolean).join(" · "),
    search: `${order.order_code || ""} ${order.customer_name || ""} ${order.phone || ""} ${order.sale_name || ""}`,
  })),
);

const warehouseOptions = computed(() =>
  warehouses.value.map((warehouse) => ({
    value: warehouse.id,
    label: warehouse.name || warehouse.warehouse_code || warehouse.id,
    subLabel: warehouse.address || "",
    search: `${warehouse.name || ""} ${warehouse.warehouse_code || ""} ${warehouse.address || ""}`,
  })),
);

async function loadRows(force = false) {
  loading.value = true;
  try {
    const loadedOrders = await loadScopedOrders(force);
    orders.value = loadedOrders.filter(isActive);
    const [requests, items, productRows, warehouseRows] = await Promise.all([
      loadScopedExportRequests(orders.value, force),
      loadScopedOrderItems(orders.value, force),
      loadProducts(force),
      loadWarehouses(force),
    ]);
    rows.value = requests.filter(isActive);
    products.value = productRows;
    warehouses.value = warehouseRows;

    itemsByOrder.value = items.reduce(
      (map, item) => {
        if (!map[item.order_id]) map[item.order_id] = [];
        map[item.order_id].push(item);
        return map;
      },
      {} as Record<string, OrderItemDoc[]>,
    );

    applyAllLocalOrderSummaries();
  } catch (error) {
    showToast(
      reportFirebaseError(error, "Không tải được phiếu xuất kho."),
      "error",
    );
  } finally {
    loading.value = false;
  }
}

function requestsForOrder(orderId: string) {
  return rows.value.filter((row) => row.order_id === orderId && isActive(row));
}

function applyLocalOrderSummary(orderId: string) {
  const order = orders.value.find((item) => item.id === orderId);
  if (!order) return;
  const orderRequests = requestsForOrder(orderId);
  const progress = buildFulfillmentRows(
    itemsByOrder.value[orderId] || [],
    orderRequests,
  );
  Object.assign(order, orderSummary(progress, orderRequests));
}

function applyAllLocalOrderSummaries() {
  orders.value.forEach((order) => applyLocalOrderSummary(order.id));
}

function prepareLines() {
  const order = selectedOrder.value;
  if (!order) {
    exportLines.value = [];
    return;
  }
  const current = editing.value
    ? String(editing.value.request_id || editing.value.id)
    : "";
  const progress = buildFulfillmentRows(
    itemsByOrder.value[order.id] || [],
    requestsForOrder(order.id),
    current,
  );
  const oldQuantities = new Map(
    requestItems(editing.value).map((item: any) => [
      `${item.product_code}|${item.logo || ""}`.toUpperCase(),
      toNumber(item.export_quantity),
    ]),
  );
  exportLines.value = progress.map((row) => ({
    ...row,
    export_quantity:
      oldQuantities.get(`${row.product_code}|${row.logo}`.toUpperCase()) || 0,
  }));
  form.order_code = order.order_code;
  form.customer_name = order.customer_name;
}

function openModal(request?: any) {
  if (!hasPermission("orders.warehouse_export") && !hasPermission("*")) {
    return showToast(
      "Bạn không có quyền tạo hoặc sửa phiếu xuất kho.",
      "error",
    );
  }
  if (
    request &&
    !["cho_xu_ly", "dang_xu_ly", "da_tiep_nhan"].includes(
      String(request.status),
    )
  ) {
    return showToast(
      "Phiếu đã được Warehouse xử lý xong nên không thể sửa.",
      "error",
    );
  }

  editing.value = request || null;
  Object.assign(
    form,
    request
      ? {
          ...request,
          note: safeJsonParse(request.payload_json, {}).note || "",
          id: request.id,
          request_id: request.request_id || request.id,
        }
      : {
          id: makeId("req"),
          request_id: makeCode("YCXK"),
          order_id: "",
          order_code: "",
          customer_name: "",
          export_date: todayKey(),
          note: "",
          status: "cho_xu_ly",
        },
  );
  prepareLines();
  showModal.value = true;
}

function validLines() {
  return exportLines.value.filter((line) => toNumber(line.export_quantity) > 0);
}

async function saveRequest() {
  if (!selectedOrder.value)
    return showToast("Vui lòng chọn đơn hàng.", "error");
  const chosen = validLines();
  if (!chosen.length)
    return showToast(
      "Vui lòng nhập ít nhất một sản phẩm có số lượng xuất lớn hơn 0.",
      "error",
    );
  const invalid = chosen.find(
    (line) => toNumber(line.export_quantity) > line.available_to_request_qty,
  );
  if (invalid) {
    return showToast(
      `${invalid.product_code}${invalid.logo ? ` / ${invalid.logo}` : ""} chỉ còn có thể yêu cầu ${invalid.available_to_request_qty}.`,
      "error",
    );
  }

  saving.value = true;
  await withLoading(async () => {
    const order = selectedOrder.value!;
    const now = new Date().toISOString();
    const items = chosen.map((line) => ({
      product_code: line.product_code,
      product_name: line.product_name,
      logo: line.logo,
      unit: line.unit,
      order_quantity: line.ordered_qty,
      requested_before_quantity: line.requested_qty,
      processed_before_quantity: line.processed_qty,
      exported_before_quantity: line.exported_qty,
      available_before_quantity: line.available_to_request_qty,
      // Giữ hai field cũ để nguồn Warehouse hiện tại không bị gián đoạn.
      accepted_quantity: line.exported_qty,
      pending_quantity: line.pending_qty,
      export_quantity: toNumber(line.export_quantity),
    }));

    const previousTimeline = safeJsonParse(
      editing.value?.request_timeline_json,
      [],
    );
    const timeline = [
      ...(Array.isArray(previousTimeline) ? previousTimeline : []),
      {
        action: editing.value ? "update" : "create",
        title: editing.value
          ? "Kingcup sửa yêu cầu xuất kho"
          : "Kingcup tạo yêu cầu xuất kho",
        actor: appUser.value?.email || "",
        time: now,
        status: form.status || "cho_xu_ly",
        note: form.note || "",
      },
    ];

    const payload = {
      request_id: form.request_id,
      order_id: order.id,
      order_code: order.order_code,
      order_date: order.order_date || "",
      export_date: form.export_date,
      customer_name: order.customer_name || "",
      note: form.note || "",
      requested_by: editing.value?.requested_by || appUser.value?.email || "",
      requested_by_name:
        appUser.value?.display_name || appUser.value?.email || "",
      sale_name: order.sale_name || "",
      items,
    };

    const record = {
      id: form.id,
      request_id: form.request_id,
      order_id: order.id,
      order_code: order.order_code,
      customer_name: order.customer_name || "",
      export_date: form.export_date,
      requested_by: editing.value?.requested_by || appUser.value?.email || "",
      requested_at: editing.value?.requested_at || now,
      updated_by: appUser.value?.email || "",
      order_owner_email: order.owner_email || "",
      order_created_by: order.created_by || "",
      order_sale_email: order.sale_email || "",
      status: editing.value?.status || "cho_xu_ly",
      payload_json: JSON.stringify(payload),
      request_timeline_json: JSON.stringify(timeline),
      warehouse_export_code: editing.value?.warehouse_export_code || "",
      warehouse_handled_by: editing.value?.warehouse_handled_by || "",
      warehouse_handled_at: editing.value?.warehouse_handled_at || "",
      warehouse_note: editing.value?.warehouse_note || "",
      active: true,
      deleted: false,
    };

    const nowLocal = new Date().toISOString();
    const nextRow = {
      ...record,
      created_at: editing.value?.created_at || nowLocal,
      updated_at: nowLocal,
    };
    const nextRequests = [
      ...rows.value.filter((row) => row.id !== form.id),
      nextRow,
    ].filter((row) => row.order_id === order.id && isActive(row));
    const nextSummary = orderSummary(
      buildFulfillmentRows(itemsByOrder.value[order.id] || [], nextRequests),
      nextRequests,
    );

    const batch = writeBatch(db);
    batch.set(
      doc(db, "order_export_requests", form.id),
      {
        ...record,
        updated_at: serverTimestamp(),
        ...(!editing.value ? { created_at: serverTimestamp() } : {}),
      },
      { merge: true },
    );
    batch.update(doc(db, "orders", order.id), {
      ...nextSummary,
      updated_at: serverTimestamp(),
    });
    batch.set(doc(collection(db, "activity_logs")), {
      module: "order_export_requests",
      action: editing.value ? "update" : "create",
      item_code: form.request_id,
      item_name: `${order.order_code} - ${order.customer_name || ""}`,
      changed_by: appUser.value?.email || "",
      after_json: JSON.stringify(record),
      created_at: serverTimestamp(),
      active: true,
      deleted: false,
    });
    await batch.commit();

    const index = rows.value.findIndex((row) => row.id === form.id);
    if (index >= 0) rows.value[index] = nextRow;
    else rows.value.unshift(nextRow);
    Object.assign(order, nextSummary);
    invalidateScopedCache("order_export_requests");
    invalidateScopedCache("orders");
    invalidateScopedCache("activity_logs");
    showModal.value = false;
    showToast(
      editing.value
        ? "Đã cập nhật phiếu xuất kho."
        : "Đã gửi yêu cầu xuất kho sang Warehouse.",
      "success",
    );
  })
    .catch((error) => {
      showToast(
        reportFirebaseError(
          error,
          editing.value
            ? "Không cập nhật được phiếu xuất kho."
            : "Không tạo được phiếu xuất kho.",
        ),
        "error",
      );
    })
    .finally(() => {
      saving.value = false;
    });
}

function requestHasExported(row: any) {
  const status = normalizeText(row?.status).replace(/\s+/g, "_");
  if (
    [
      "da_xuat",
      "da_xuat_kho",
      "da_xuat_du",
      "exported",
      "completed",
      "hoan_thanh",
    ].includes(status)
  )
    return true;
  return requestLineProgress(row).some(
    (line: any) => toNumber(line.exported_qty) > 0,
  );
}

function canDeleteRequest(row: any) {
  return (
    canDeletePermission.value &&
    !requestHasExported(row) &&
    !String(row.warehouse_export_code || "").trim()
  );
}

function canProcessRequest(row: any) {
  return (
    (hasPermission("*") || hasPermission("export_requests.process")) &&
    !requestHasExported(row) &&
    ["cho_xu_ly", "dang_xu_ly", "da_tiep_nhan", "cho_xuat_kho"].includes(
      String(row.status || ""),
    )
  );
}

function normalizeCode(value: any) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function findProductByCode(code: any) {
  const wanted = normalizeCode(code);
  return products.value.find(
    (product) =>
      normalizeCode(product.product_code) === wanted ||
      normalizeCode((product as any).code) === wanted,
  );
}

function findWarehouse(id: string) {
  return warehouses.value.find((warehouse) => warehouse.id === id);
}

function openProcessModal(row: any) {
  if (!canProcessRequest(row))
    return showToast(
      "Phiếu này không còn ở trạng thái có thể cho xuất.",
      "error",
    );
  processRequest.value = row;
  Object.assign(processForm, {
    warehouse_id: warehouses.value[0]?.id || "",
    note: "",
    export_date: row.export_date || todayKey(),
  });
  showProcessModal.value = true;
}

function buildProcessedOrderSummary(row: any) {
  const order = orders.value.find((item) => item.id === row.order_id);
  if (!order) return {};
  const nextRows = rows.value
    .map((item) =>
      item.id === row.id
        ? {
            ...item,
            status: "da_xuat",
            warehouse_export_code:
              item.warehouse_export_code || "pending_firestore",
          }
        : item,
    )
    .filter((item) => item.order_id === row.order_id && isActive(item));
  return orderSummary(
    buildFulfillmentRows(itemsByOrder.value[row.order_id] || [], nextRows),
    nextRows,
  );
}

async function processToRealExport() {
  const row = processRequest.value;
  if (!row) return;
  const warehouse = findWarehouse(processForm.warehouse_id);
  if (!warehouse) return showToast("Vui lòng chọn kho xuất.", "error");

  const lines = requestLineProgress(row).filter(
    (line: any) => toNumber(line.requested_qty) > 0,
  );
  if (!lines.length)
    return showToast("Yêu cầu xuất kho chưa có dòng hàng hợp lệ.", "error");

  const missing = lines.filter(
    (line: any) => !findProductByCode(line.product_code),
  );
  if (missing.length) {
    return showToast(
      `Chưa map được sản phẩm Firestore cho mã: ${missing.map((line: any) => line.product_code).join(", ")}.`,
      "error",
    );
  }

  processing.value = true;
  try {
    const result = await processExportRequestToExportOrder({
      request: row,
      warehouse,
      customer_name: row.customer_name,
      export_date: processForm.export_date,
      note: processForm.note,
      timeline: timeline(row),
      orderSummaryPatch: buildProcessedOrderSummary(row),
      lines: lines.map((line: any) => ({
        product: findProductByCode(line.product_code),
        logo: line.logo,
        quantity: toNumber(line.requested_qty),
        unit: line.unit,
        note: line.note || "",
      })),
    });

    const nextRow = {
      ...row,
      status: "da_xuat",
      warehouse_export_code: result.code,
      warehouse_export_id: result.id,
      warehouse_export_order_id: result.id,
      export_order_id: result.id,
      warehouse_handled_by: appUser.value?.email || "",
      warehouse_handled_at: new Date().toISOString(),
      warehouse_note: processForm.note,
    };
    const index = rows.value.findIndex((item) => item.id === row.id);
    if (index >= 0) rows.value[index] = nextRow;
    const order = orders.value.find((item) => item.id === row.order_id);
    if (order) Object.assign(order, buildProcessedOrderSummary(nextRow));
    showProcessModal.value = false;
    showToast(
      result.alreadyProcessed
        ? "Phiếu đã được xử lý trước đó."
        : `Đã cho xuất và tạo phiếu kho ${result.code}.`,
      "success",
    );
    await loadRows(true);
  } catch (error) {
    showToast(
      reportFirebaseError(error, "Không cho xuất được phiếu này."),
      "error",
    );
  } finally {
    processing.value = false;
  }
}

async function removeRequest(row: any) {
  if (!canDeleteRequest(row)) {
    return showToast(
      "Phiếu đã xuất kho hoặc đã có mã phiếu kho nên không thể xóa.",
      "error",
    );
  }
  const confirmed = await askConfirm({
    title: "Xóa phiếu xuất kho",
    message: `Bạn chắc chắn muốn xóa phiếu xuất kho ${row.request_id}?\nPhiếu đã xuất kho hoặc đã có mã phiếu kho sẽ không được xóa.`,
    confirmLabel: "Xóa phiếu",
  });
  if (!confirmed) return;

  await withLoading(async () => {
    const remainingRequests = rows.value.filter(
      (item) =>
        item.id !== row.id && item.order_id === row.order_id && isActive(item),
    );
    const nextSummary = orderSummary(
      buildFulfillmentRows(
        itemsByOrder.value[row.order_id] || [],
        remainingRequests,
      ),
      remainingRequests,
    );
    const deletedAt = serverTimestamp();
    const batch = writeBatch(db);
    batch.update(doc(db, "order_export_requests", row.id), {
      deleted: true,
      active: false,
      status: "deleted",
      deleted_at: deletedAt,
      updated_at: deletedAt,
    });
    batch.update(doc(db, "orders", row.order_id), {
      ...nextSummary,
      updated_at: deletedAt,
    });
    batch.set(doc(collection(db, "activity_logs")), {
      module: "order_export_requests",
      action: "delete",
      item_code: row.request_id,
      item_name: row.order_code || row.request_id,
      changed_by: appUser.value?.email || "",
      after_json: JSON.stringify({
        id: row.id,
        request_id: row.request_id,
        deleted: true,
      }),
      created_at: deletedAt,
      active: true,
      deleted: false,
    });
    await batch.commit();
    rows.value = rows.value.filter((item) => item.id !== row.id);
    const order = orders.value.find((item) => item.id === row.order_id);
    if (order) Object.assign(order, nextSummary);
    invalidateScopedCache("order_export_requests");
    invalidateScopedCache("orders");
    invalidateScopedCache("activity_logs");
    showToast("Đã xóa phiếu xuất kho.", "success");
  }).catch((error) =>
    showToast(
      reportFirebaseError(error, "Không xóa được phiếu xuất kho."),
      "error",
    ),
  );
}

function statusLabel(status: any) {
  return (
    (
      {
        cho_xu_ly: "Chờ xử lý",
        dang_xu_ly: "Đang xử lý",
        da_tiep_nhan: "Đã tiếp nhận/chờ xuất kho",
        cho_xuat_kho: "Chờ xuất kho",
        da_xuat: "Đã xuất kho",
        tu_choi: "Từ chối",
        loi: "Lỗi xử lý",
      } as any
    )[status] ||
    status ||
    "-"
  );
}

function openDetail(row: any) {
  selectedRequest.value = row;
  showDetailModal.value = true;
}

function timeline(row: any) {
  const value = safeJsonParse(row?.request_timeline_json, []);
  return Array.isArray(value) ? value : [];
}

function detailRequestLines(row: any) {
  const order = orders.value.find((item) => item.id === row?.order_id);
  if (!order) return requestLineProgress(row);
  const previousRows = buildFulfillmentRows(
    itemsByOrder.value[order.id] || [],
    requestsForOrder(order.id),
    String(row.request_id || row.id),
  );
  return requestLineProgress(row).map((item: any) => {
    const previous = previousRows.find(
      (line) =>
        String(line.product_code || "")
          .trim()
          .toUpperCase() ===
          String(item.product_code || "")
            .trim()
            .toUpperCase() &&
        String(line.logo || "")
          .trim()
          .toUpperCase() ===
          String(item.logo || "")
            .trim()
            .toUpperCase(),
    );
    const ordered = previous?.ordered_qty || toNumber(item.order_quantity);
    const totalRequested = Math.min(
      ordered,
      toNumber(previous?.requested_qty) + toNumber(item.requested_qty),
    );
    const totalProcessed = Math.min(
      totalRequested,
      toNumber(previous?.processed_qty) + toNumber(item.processed_qty),
    );
    const totalExported = Math.min(
      totalProcessed || totalRequested,
      toNumber(previous?.exported_qty) + toNumber(item.exported_qty),
    );
    return {
      ...item,
      ordered_qty: ordered,
      requested_before_qty: toNumber(previous?.requested_qty),
      processed_total_qty: totalProcessed,
      exported_total_qty: totalExported,
      available_after_qty: Math.max(0, ordered - totalRequested),
      remaining_after_qty: Math.max(0, ordered - totalExported),
    };
  });
}

onMounted(() => loadRows());
</script>

<template>
  <AppShell>
    <PageHeader
      title="Phiếu xuất kho"
      subtitle="Yêu cầu xuất kho và trạng thái xử lý Warehouse"
    >
      <button
        v-if="hasPermission('orders.warehouse_export') || hasPermission('*')"
        class="btn primary"
        @click="openModal()"
      >
        + Tạo yêu cầu xuất
      </button>
    </PageHeader>

    <div class="summary-grid">
      <div class="summary-card">
        <label>Tổng phiếu</label><strong>{{ summary.total }}</strong>
      </div>
      <div class="summary-card">
        <label>Chờ Warehouse</label><strong>{{ summary.waiting }}</strong>
      </div>
      <div class="summary-card">
        <label>Đã tiếp nhận</label><strong>{{ summary.accepted }}</strong>
      </div>
      <div class="summary-card">
        <label>Đã xuất kho</label><strong>{{ summary.exported }}</strong>
      </div>
    </div>

    <div class="card">
      <div class="toolbar">
        <input
          v-model="search"
          class="input"
          style="max-width: 480px"
          placeholder="Tìm phiếu, mã đơn, khách hàng..."
        />
        <button class="btn" @click="loadRows(true)">Làm mới</button>
      </div>
      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mã YC</th>
              <th>Đơn hàng</th>
              <th>Ngày yêu cầu</th>
              <th>Người yêu cầu</th>
              <th>Trạng thái</th>
              <th>Phiếu kho</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td>
                <b>{{ row.request_id }}</b>
              </td>
              <td>
                {{ row.order_code }}
                <div class="small subtle">{{ row.customer_name }}</div>
              </td>
              <td>{{ formatDateTime(row.requested_at) }}</td>
              <td>{{ row.requested_by }}</td>
              <td>
                <span class="badge yellow">{{ statusLabel(row.status) }}</span>
              </td>
              <td>{{ row.warehouse_export_code || "-" }}</td>
              <td>
                <div class="action-buttons">
                  <button class="btn-sm" @click="openDetail(row)">Xem</button>
                  <button
                    v-if="canProcessRequest(row)"
                    class="btn-sm btn-view"
                    @click="openProcessModal(row)"
                  >
                    Cho xuất
                  </button>
                  <button
                    v-if="
                      (hasPermission('orders.warehouse_export') ||
                        hasPermission('*')) &&
                      ['cho_xu_ly', 'dang_xu_ly', 'da_tiep_nhan'].includes(
                        row.status,
                      )
                    "
                    class="btn-sm"
                    @click="openModal(row)"
                  >
                    Sửa
                  </button>
                  <button
                    v-if="canDeleteRequest(row)"
                    class="btn-sm btn-delete"
                    @click="removeRequest(row)"
                  >
                    Xóa
                  </button>
                  <button
                    v-else-if="canDeletePermission"
                    class="btn-sm"
                    disabled
                  >
                    {{ row.status === "da_xuat" ? "Đã xuất" : "Khóa" }}
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!filtered.length">
              <td colspan="7" class="empty">
                Không có phiếu xuất kho phù hợp.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal
      v-if="showModal"
      :title="editing ? `Sửa phiếu ${form.request_id}` : 'Tạo yêu cầu xuất kho'"
      size="xl"
      :loading="saving"
      save-label="Lưu phiếu xuất"
      @close="showModal = false"
      @save="saveRequest"
    >
      <div class="form-grid">
        <div class="form-group">
          <label>Đơn hàng</label>
          <SearchableSelect
            v-model="form.order_id"
            :options="orderOptions"
            :disabled="!!editing"
            placeholder="Tìm đơn hàng theo mã, khách hàng, SĐT..."
            @change="prepareLines"
          />
        </div>
        <div class="form-group">
          <label>Ngày xuất dự kiến</label
          ><input v-model="form.export_date" class="input" type="date" />
        </div>
      </div>
      <div v-if="selectedOrder" class="detail-grid">
        <div class="detail-item">
          <label>Khách hàng</label
          ><strong>{{ selectedOrder.customer_name }}</strong>
        </div>
        <div class="detail-item">
          <label>Trạng thái đơn</label
          ><strong>{{
            selectedOrder.warehouse_fulfillment_status || "Chưa xuất"
          }}</strong>
        </div>
      </div>
      <div class="table-wrap" style="margin-top: 16px">
        <table>
          <thead>
            <tr>
              <th>Sản phẩm</th>
              <th>Logo</th>
              <th>SL đơn</th>
              <th>Đã yêu cầu</th>
              <th>Đã xử lý</th>
              <th>Đã xuất</th>
              <th>Còn có thể yêu cầu</th>
              <th>SL yêu cầu mới</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="line in exportLines"
              :key="`${line.product_code}|${line.logo}`"
            >
              <td>
                {{ line.product_name }}
                <div class="small subtle">
                  {{ line.product_code }} · {{ line.unit }}
                </div>
              </td>
              <td>{{ line.logo || "-" }}</td>
              <td>{{ line.ordered_qty }}</td>
              <td>{{ line.requested_qty }}</td>
              <td>{{ line.processed_qty }}</td>
              <td>{{ line.exported_qty }}</td>
              <td>
                <b>{{ line.available_to_request_qty }}</b>
              </td>
              <td>
                <input
                  v-model.number="line.export_quantity"
                  class="input"
                  type="number"
                  min="0"
                  :max="line.available_to_request_qty"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="form-group" style="margin-top: 12px">
        <label>Ghi chú gửi Warehouse</label
        ><textarea v-model="form.note" class="textarea" rows="3" />
      </div>
    </BaseModal>

    <BaseModal
      v-if="showDetailModal && selectedRequest"
      title="Chi tiết phiếu xuất kho"
      size="xl"
      :show-footer="false"
      @close="showDetailModal = false"
    >
      <div class="detail-grid">
        <div class="detail-item">
          <label>ID Firestore</label><strong>{{ selectedRequest.id }}</strong>
        </div>
        <div class="detail-item">
          <label>Mã phiếu</label
          ><strong>{{ selectedRequest.request_id }}</strong>
        </div>
        <div class="detail-item">
          <label>Đơn hàng</label
          ><strong
            >{{ selectedRequest.order_code }} ·
            {{ selectedRequest.order_id }}</strong
          >
        </div>
        <div class="detail-item">
          <label>Khách hàng</label
          ><strong>{{ selectedRequest.customer_name || "-" }}</strong>
        </div>
        <div class="detail-item">
          <label>Trạng thái</label
          ><strong>{{ statusLabel(selectedRequest.status) }}</strong>
        </div>
        <div class="detail-item">
          <label>Người tạo phiếu</label
          ><strong>{{ selectedRequest.requested_by || "-" }}</strong>
        </div>
        <div class="detail-item">
          <label>Ngày giờ tạo</label
          ><strong>{{
            formatDateTime(
              selectedRequest.requested_at || selectedRequest.created_at,
            )
          }}</strong>
        </div>
        <div class="detail-item">
          <label>Cập nhật cuối</label
          ><strong>{{ formatDateTime(selectedRequest.updated_at) }}</strong>
        </div>
        <div class="detail-item">
          <label>Ngày xuất dự kiến</label
          ><strong>{{ formatDateTime(selectedRequest.export_date) }}</strong>
        </div>
        <div class="detail-item">
          <label>Mã phiếu Warehouse</label
          ><strong>{{ selectedRequest.warehouse_export_code || "-" }}</strong>
        </div>
        <div class="detail-item">
          <label>Warehouse xử lý</label
          ><strong>{{ selectedRequest.warehouse_handled_by || "-" }}</strong>
        </div>
        <div class="detail-item">
          <label>Ngày Warehouse xử lý</label
          ><strong>{{
            formatDateTime(selectedRequest.warehouse_handled_at) || "-"
          }}</strong>
        </div>
        <div class="detail-item">
          <label>Ghi chú Warehouse</label
          ><strong>{{ selectedRequest.warehouse_note || "-" }}</strong>
        </div>
        <div class="detail-item">
          <label>Ghi chú yêu cầu</label
          ><strong>{{
            safeJsonParse(selectedRequest.payload_json, {}).note || "-"
          }}</strong>
        </div>
      </div>
      <h3>Sản phẩm và tiến độ xuất</h3>
      <div class="table-wrap">
        <table style="min-width: 1050px">
          <thead>
            <tr>
              <th>Sản phẩm</th>
              <th>Logo</th>
              <th>SL đơn</th>
              <th>SL phiếu này</th>
              <th>Đã yêu cầu trước</th>
              <th>Đã xử lý</th>
              <th>Đã xuất</th>
              <th>Còn có thể yêu cầu</th>
              <th>Còn phải xuất</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(item, index) in detailRequestLines(selectedRequest)"
              :key="index"
            >
              <td>
                <b>{{ item.product_name }}</b>
                <div class="small subtle">
                  {{ item.product_code }} · {{ item.unit }}
                </div>
              </td>
              <td>{{ item.logo || "-" }}</td>
              <td>{{ item.ordered_qty }}</td>
              <td>{{ item.requested_qty }}</td>
              <td>{{ item.requested_before_qty }}</td>
              <td>{{ item.processed_total_qty }}</td>
              <td>{{ item.exported_total_qty }}</td>
              <td>
                <b>{{ item.available_after_qty }}</b>
              </td>
              <td>{{ item.remaining_after_qty }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3 v-if="timeline(selectedRequest).length">Timeline xử lý</h3>
      <div
        v-for="(step, index) in timeline(selectedRequest)"
        :key="index"
        class="detail-item"
        style="margin-bottom: 8px"
      >
        <strong>{{ step.title || statusLabel(step.status) }}</strong>
        <div class="small subtle">
          {{ formatDateTime(step.time) }} · {{ step.actor }}
        </div>
        <div>{{ step.note }}</div>
      </div>
    </BaseModal>

    <BaseModal
      v-if="showProcessModal && processRequest"
      :title="`Cho xuất kho ${processRequest.request_id}`"
      size="lg"
      :loading="processing"
      save-label="Cho xuất kho"
      @close="showProcessModal = false"
      @save="processToRealExport"
    >
      <div class="detail-grid">
        <div class="detail-item">
          <label>Mã yêu cầu</label
          ><strong>{{ processRequest.request_id }}</strong>
        </div>
        <div class="detail-item">
          <label>Đơn hàng</label
          ><strong>{{ processRequest.order_code }}</strong>
        </div>
        <div class="detail-item">
          <label>Khách hàng</label
          ><strong>{{ processRequest.customer_name || "-" }}</strong>
        </div>
        <div class="detail-item">
          <label>Số dòng</label
          ><strong>{{ requestLineProgress(processRequest).length }}</strong>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-group">
          <label>Ngày xuất thực tế</label
          ><input v-model="processForm.export_date" class="input" type="date" />
        </div>
        <div class="form-group">
          <label>Kho xuất</label>
          <SearchableSelect
            v-model="processForm.warehouse_id"
            :options="warehouseOptions"
            placeholder="Chọn kho xuất"
          />
        </div>
      </div>
      <div class="table-wrap" style="margin-top: 14px">
        <table style="min-width: 820px">
          <thead>
            <tr>
              <th>Sản phẩm</th>
              <th>Logo</th>
              <th>Đơn vị</th>
              <th>Số lượng sẽ xuất</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(line, index) in requestLineProgress(processRequest)"
              :key="index"
            >
              <td>
                <b>{{ line.product_code }}</b>
                <div class="small subtle">{{ line.product_name }}</div>
              </td>
              <td>{{ line.logo || "Không logo" }}</td>
              <td>{{ line.unit || "-" }}</td>
              <td>
                <b>{{ line.requested_qty }}</b>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="form-group" style="margin-top: 12px">
        <label>Ghi chú Warehouse</label
        ><textarea v-model="processForm.note" class="textarea" rows="3" />
      </div>
      <p class="small subtle">
        Khi xác nhận, hệ thống sẽ check tồn trong Firestore, tạo
        export_orders/export_order_items, ghi stock_movements và trừ
        inventory_balances bằng transaction.
      </p>
    </BaseModal>

    <ConfirmModal
      v-bind="confirmState"
      @cancel="resolveConfirm(false)"
      @confirm="resolveConfirm(true)"
    />
  </AppShell>
</template>
