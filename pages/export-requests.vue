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
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import {
  exportRequestActionDecision,
  permissionDecisionMessage,
} from "~/utils/permissionDecisions.mjs";
import { isDateInRange, matchesKeyword, uniqueOptions } from "~/utils/listFilters";
import {
  buildNotificationPayload,
  WAREHOUSE_NOTIFICATION_PERMISSIONS,
} from "~/composables/useNotifications";

const { db } = useFirebaseServices();
const { appUser, permissions } = useAuth();
const {
  loadScopedOrders,
  loadScopedOrderItems,
  listenScopedExportRequests,
} = useScopedQueries();
const {
  buildFulfillmentRows,
  orderSummary,
  requestItems,
  requestLineProgress,
} = useWarehouseLogic();
const { showToast, withLoading } = useUi();
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog();
const { invalidateScopedCache } = useRepo();

const supportingLoading = ref(false);
const realtimeLoading = ref(true);
const loading = computed(() => supportingLoading.value || realtimeLoading.value);
const saving = ref(false);
const search = ref("");
const statusFilter = ref("");
const dateFrom = ref("");
const dateTo = ref("");
const requestedByFilter = ref("");
const rows = ref<any[]>([]);
const orders = ref<OrderDoc[]>([]);
const itemsByOrder = ref<Record<string, OrderItemDoc[]>>({});
const showModal = ref(false);
const showDetailModal = ref(false);
const selectedRequest = ref<any>(null);
const editing = ref<any>(null);
const exportLines = ref<Array<FulfillmentRow & { export_quantity: number }>>(
  [],
);
const form = reactive<any>({});
let stopRequestsListener: (() => void) | null = null;
let lastRealtimeError = "";


const requestedByOptions = computed(() => uniqueOptions(rows.value, "requested_by"));
const statusOptions = computed(() => uniqueOptions(rows.value, "status"));
const filterValues = computed(() => ({ status: statusFilter.value, from: dateFrom.value, to: dateTo.value, requestedBy: requestedByFilter.value }));
const toolbarFilters = computed(() => [
  { key: "status", label: "Trạng thái", allLabel: "Tất cả trạng thái", width: "200px", options: statusOptions.value.map(status => ({ label: statusLabel(status), value: status })) },
  { key: "requestedBy", label: "Người yêu cầu", allLabel: "Tất cả người yêu cầu", width: "240px", options: requestedByOptions.value.map(user => ({ label: user, value: normalizeText(user) })) },
  { key: "from", type: "date" as const, label: "Từ ngày" },
  { key: "to", type: "date" as const, label: "Đến ngày" },
]);

function updateFilter(key: string, value: string) {
  if (key === "status") statusFilter.value = value;
  if (key === "requestedBy") requestedByFilter.value = value;
  if (key === "from") dateFrom.value = value;
  if (key === "to") dateTo.value = value;
}

const filtered = computed(() => {
  const keyword = normalizeText(search.value);
  return rows.value.filter((row) => {
    const matchedText = matchesKeyword([row.request_id, row.order_code, row.customer_name, row.status, statusLabel(row.status), row.requested_by], keyword);
    const matchedStatus = !statusFilter.value || String(row.status || "") === statusFilter.value;
    const matchedDate = isDateInRange(row.requested_at || row.created_at, dateFrom.value, dateTo.value);
    const matchedRequester = !requestedByFilter.value || normalizeText(row.requested_by) === requestedByFilter.value;
    return matchedText && matchedStatus && matchedDate && matchedRequester;
  });
});

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
const currentEmail = computed(() => String(appUser.value?.email || "").trim().toLowerCase());

function parentOrder(request: any) {
  return orders.value.find(order => order.id === request?.order_id) || null;
}

function requestActionDecision(action: "create" | "edit" | "delete", request?: any, order?: OrderDoc | null, phase: "start" | "commit" = "commit") {
  return exportRequestActionDecision({
    action,
    request: request || null,
    order: order || (request ? parentOrder(request) : selectedOrder.value) || null,
    permissions: permissions.value,
    currentUserEmail: currentEmail.value,
    phase,
  });
}

function requestDecisionMessage(decision: any, action: string, request?: any) {
  return permissionDecisionMessage(decision, {
    operation: `${action} yêu cầu xuất kho`,
    record: request?.request_id || request?.id || form.request_id || "(mới)",
    status: request?.status || form.status || "(mới)",
  });
}

function canStartCreateRequest() {
  return requestActionDecision("create", null, null, "start").allowed;
}

function canEditRequest(row: any) {
  return requestActionDecision("edit", row).allowed;
}
const orderOptions = computed(() =>
  orders.value.map((order) => ({
    value: order.id,
    label: `${order.order_code || ""} - ${order.customer_name || ""}`,
    subLabel: [order.phone, order.sale_name].filter(Boolean).join(" · "),
    search: `${order.order_code || ""} ${order.customer_name || ""} ${order.phone || ""} ${order.sale_name || ""}`,
  })),
);

function timestampKey(value: any) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return String(value || "");
}

function resetFilters() {
  search.value = "";
  statusFilter.value = "";
  dateFrom.value = "";
  dateTo.value = "";
  requestedByFilter.value = "";
}

function requestRevision(row: any) {
  return [
    row?.status || "",
    timestampKey(row?.updated_at),
    row?.active !== false,
    row?.deleted === true,
    row?.payload_json || "",
    row?.request_timeline_json || "",
    row?.warehouse_export_code || "",
    row?.warehouse_note || "",
  ].join("|");
}

function syncOpenRequestState(nextRows: any[]) {
  if (selectedRequest.value) {
    const fresh = nextRows.find(row => row.id === selectedRequest.value.id);
    if (fresh) selectedRequest.value = fresh;
    else {
      selectedRequest.value = null;
      showDetailModal.value = false;
    }
  }

  if (!editing.value || !showModal.value || saving.value) return;
  const fresh = nextRows.find(row => row.id === editing.value.id);
  if (fresh && requestRevision(fresh) === requestRevision(editing.value)) return;
  showModal.value = false;
  editing.value = null;
  showToast(
    fresh
      ? "Phiếu đang sửa vừa được cập nhật từ tài khoản khác. Vui lòng mở lại để dùng dữ liệu mới."
      : "Phiếu đang sửa không còn khả dụng.",
    "info",
  );
}

function startRequestsListener() {
  stopRequestsListener?.();
  stopRequestsListener = null;
  realtimeLoading.value = true;
  stopRequestsListener = listenScopedExportRequests(
    orders.value,
    nextRows => {
      syncOpenRequestState(nextRows);
      rows.value = nextRows;
      applyAllLocalOrderSummaries();
      realtimeLoading.value = false;
      lastRealtimeError = "";
    },
    error => {
      realtimeLoading.value = false;
      const message = reportFirebaseError(
        error,
        "Mất kết nối realtime với yêu cầu xuất kho.",
      );
      if (message !== lastRealtimeError) showToast(message, "error");
      lastRealtimeError = message;
    },
  );
}

async function loadRows(force = false) {
  supportingLoading.value = true;
  try {
    const loadedOrders = await loadScopedOrders(force);
    orders.value = loadedOrders.filter(isActive);
    const items = await loadScopedOrderItems(orders.value, force);

    itemsByOrder.value = items.reduce(
      (map, item) => {
        if (!map[item.order_id]) map[item.order_id] = [];
        map[item.order_id].push(item);
        return map;
      },
      {} as Record<string, OrderItemDoc[]>,
    );

    applyAllLocalOrderSummaries();
    startRequestsListener();
  } catch (error) {
    realtimeLoading.value = false;
    showToast(
      reportFirebaseError(error, "Không tải được yêu cầu xuất kho."),
      "error",
    );
  } finally {
    supportingLoading.value = false;
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
  const decision = request
    ? requestActionDecision("edit", request)
    : requestActionDecision("create", null, null, "start");
  if (!decision.allowed) return showToast(requestDecisionMessage(decision, request ? "sửa" : "tạo", request), "error");

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
  const action = editing.value ? "edit" : "create";
  const decision = requestActionDecision(action, editing.value, selectedOrder.value);
  if (!decision.allowed) return showToast(requestDecisionMessage(decision, action === "edit" ? "sửa" : "tạo", editing.value), "error");
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
      order_item_id: line.order_item_id,
      product_id: line.product_id,
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
          ? "Sale sửa yêu cầu xuất kho"
          : "Sale tạo yêu cầu xuất kho",
        actor: appUser.value?.email || "",
        actor_name: appUser.value?.display_name || order.sale_name || appUser.value?.email || "",
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
    const requestRef = doc(db, "order_export_requests", form.id);
    if (editing.value) {
      // Chỉ cập nhật các field nghiệp vụ Sale được phép sửa. Không gửi lại
      // identity/status/field xử lý kho để tránh Rules hiểu là thay đổi quyền sở hữu.
      batch.update(requestRef, {
        order_code: record.order_code,
        customer_name: record.customer_name,
        export_date: record.export_date,
        updated_by: record.updated_by,
        payload_json: record.payload_json,
        request_timeline_json: record.request_timeline_json,
        updated_at: serverTimestamp(),
      });
    } else {
      batch.set(requestRef, {
        ...record,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      });
    }
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
    {
      const notificationType = editing.value
        ? "warehouse_export_request_updated"
        : "warehouse_export_request_created";
      const notificationTitle = editing.value
        ? "Yêu cầu xuất kho vừa được cập nhật"
        : "Có yêu cầu xuất kho mới";
      const notificationMessage = editing.value
        ? `${form.request_id} · Đơn ${order.order_code || "-"} vừa được Sale cập nhật.`
        : `${form.request_id} · Đơn ${order.order_code || "-"} · ${order.customer_name || "Khách hàng"}`;
      batch.set(
        doc(collection(db, "notifications")),
        buildNotificationPayload({
          type: notificationType,
          title: notificationTitle,
          message: notificationMessage,
          route: "/warehouse-export-requests",
          entity_collection: "order_export_requests",
          entity_id: form.id,
          entity_code: form.request_id,
          created_by: appUser.value?.email || "",
          audience: "warehouse_export",
          audience_permissions: WAREHOUSE_NOTIFICATION_PERMISSIONS,
          metadata: {
            order_id: order.id,
            order_code: order.order_code || "",
            customer_name: order.customer_name || "",
          },
        }),
      );
    }
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
        ? "Đã cập nhật yêu cầu xuất kho."
        : "Đã gửi yêu cầu xuất kho sang kho.",
      "success",
    );
  })
    .catch((error) => {
      showToast(
        reportFirebaseError(
          error,
          editing.value
            ? "Không cập nhật được yêu cầu xuất kho."
            : "Không tạo được yêu cầu xuất kho.",
          {
            operation: editing.value ? "export_requests.edit" : "export_requests.create",
            record: form.id || order.id,
            status: editing.value?.status || "new",
            actionPermission: "orders.warehouse_export",
            scopePermission: "export_requests.view_all",
          },
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
  return requestActionDecision("delete", row).allowed && !requestHasExported(row);
}

async function removeRequest(row: any) {
  const decision = requestActionDecision("delete", row);
  if (!decision.allowed) return showToast(requestDecisionMessage(decision, "xóa", row), "error");
  if (requestHasExported(row)) return showToast(`Xóa yêu cầu xuất kho bị chặn (record=${row.request_id || row.id}, code=export_request_has_exported_quantity, status=${row.status || "(unknown)"}).`, "error");
  const confirmed = await askConfirm({
    title: "Xóa yêu cầu xuất kho",
    message: `Bạn chắc chắn muốn xóa yêu cầu xuất kho ${row.request_id}?\nSau khi Kho tiếp nhận, Sale sẽ không thể xóa phiếu.`,
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
    showToast("Đã xóa yêu cầu xuất kho.", "success");
  }).catch((error) =>
    showToast(
      reportFirebaseError(error, "Không xóa được yêu cầu xuất kho.", {
        operation: "export_requests.delete",
        record: row.id,
        status: row.status,
        actionPermission: "export_requests.delete",
        scopePermission: "export_requests.view_all",
      }),
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

function timelineActorText(step: any, row?: any) {
  const payload = row ? safeJsonParse(row.payload_json, {}) : {}
  const actor = String(step?.actor || '').trim()
  const name = String(step?.actor_name || payload.requested_by_name || row?.requested_by_name || row?.sale_name || '').trim()
  if (name && actor && name.toLowerCase() !== actor.toLowerCase()) return `${name} · ${actor}`
  return name || actor || '-'
}

function timelineNoteText(step: any) {
  const note = String(step?.note || '').trim()
  return note ? `Ghi chú: ${note}` : ''
}

function timelineTitleText(step: any) {
  return String(step?.title || statusLabel(step?.status))
    .replace('Kingcup tạo yêu cầu xuất kho', 'Sale tạo yêu cầu xuất kho')
    .replace('Kingcup sửa yêu cầu xuất kho', 'Sale sửa yêu cầu xuất kho')
    .replace('Warehouse đã tiếp nhận', 'Kho đã tiếp nhận')
    .replace('Warehouse đã từ chối', 'Kho đã từ chối')
    .replace('Warehouse cho xuất kho', 'Kho cho xuất kho')
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
onBeforeUnmount(() => {
  stopRequestsListener?.();
  stopRequestsListener = null;
});
</script>

<template>
  <AppShell>
    <PageHeader
      title="Yêu cầu xuất kho"
      subtitle="Sale tạo, sửa, xóa và theo dõi trạng thái yêu cầu gửi Kho"
    >
      <button
        v-if="canStartCreateRequest()"
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
        <label>Chờ kho</label><strong>{{ summary.waiting }}</strong>
      </div>
      <div class="summary-card">
        <label>Đã tiếp nhận</label><strong>{{ summary.accepted }}</strong>
      </div>
      <div class="summary-card">
        <label>Đã xuất kho</label><strong>{{ summary.exported }}</strong>
      </div>
    </div>

    <div class="card" style="margin: 24px;">
      <FilterToolbar
        v-model:search="search"
        search-width="480px"
        search-placeholder="Tìm phiếu, mã đơn, khách hàng..."
        :filters="toolbarFilters"
        :values="filterValues"
        :result-count="filtered.length"
        :loading="loading"
        show-refresh
        @update:filter="updateFilter"
        @reset="resetFilters"
        @refresh="loadRows(true)"
      />
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
                    v-if="
                      canEditRequest(row)
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
                    v-else-if="requestActionDecision('delete', row).code !== 'missing_action'"
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
                Không có yêu cầu xuất kho phù hợp.
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
      save-label="Lưu yêu cầu"
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
        <label>Ghi chú gửi kho</label
        ><textarea v-model="form.note" class="textarea" rows="3" />
      </div>
    </BaseModal>

    <BaseModal
      v-if="showDetailModal && selectedRequest"
      title="Chi tiết yêu cầu xuất kho"
      size="xl"
      :show-footer="false"
      @close="showDetailModal = false"
    >
      <div class="detail-grid">
        <div class="detail-item">
          <label>ID hệ thống</label><strong>{{ selectedRequest.id }}</strong>
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
          <label>Mã phiếu kho</label
          ><strong>{{ selectedRequest.warehouse_export_code || "-" }}</strong>
        </div>
        <div class="detail-item">
          <label>Kho xử lý</label
          ><strong>{{ selectedRequest.warehouse_handled_by || "-" }}</strong>
        </div>
        <div class="detail-item">
          <label>Ngày Kho xử lý</label
          ><strong>{{
            formatDateTime(selectedRequest.warehouse_handled_at) || "-"
          }}</strong>
        </div>
        <div class="detail-item">
          <label>Ghi chú kho</label
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
        <strong>{{ timelineTitleText(step) }}</strong>
        <div class="small subtle">
          {{ formatDateTime(step.time) }} · {{ timelineActorText(step, selectedRequest) }}
        </div>
        <div v-if="timelineNoteText(step)">{{ timelineNoteText(step) }}</div>
      </div>
    </BaseModal>



    <ConfirmModal
      v-bind="confirmState"
      @cancel="resolveConfirm(false)"
      @confirm="resolveConfirm(true)"
    />
  </AppShell>
</template>
