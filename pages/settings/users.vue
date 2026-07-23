<script setup lang="ts">
import {
  collection,
  getDocs,
  doc,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import {
  PERMISSION_CATALOG,
  type PermissionItem,
} from "~/constants/permissions";
// @ts-ignore Shared ESM matrix is also executed directly by Node client tests.
import {
  NON_ASSIGNABLE_PERMISSION_KEYS,
  directPermissionDependencies,
  missingPermissionDependencies,
  removePermissionWithDependents,
  resolvePermissionDependencies,
} from "~/constants/accessMatrix.mjs";
import { isActive, normalizeEmail } from "~/utils/format";
import {
  normalizeUserCode,
  userCodeValidationError,
} from "~/utils/orderCode";
import type { AppUser, RoleDoc } from "~/types/models";
import { reportFirebaseError } from "~/utils/firebaseErrors";

const PERMISSION_SCHEMA_VERSION = 3;
const { db } = useFirebaseServices();
const { hasPermission, firebaseUser, loadProfile } = useAuth();
const { showToast } = useUi();
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog();
const loading = ref(false);
const saving = ref(false);
const activeTab = ref<"users" | "roles" | "permission_errors">("users");
const users = ref<AppUser[]>([]);
const roles = ref<RoleDoc[]>([]);
const permissionErrors = ref<any[]>([]);
const permissionErrorSearch = ref("");
const permissionErrorsLoaded = ref(false);
const showUserModal = ref(false);
const showRoleModal = ref(false);
const showDetailModal = ref(false);
const selectedDetail = ref<any>(null);
const detailTitle = ref("Chi tiết");
const editingUserEmail = ref("");
const userForm = reactive<any>({});
const roleForm = reactive<any>({});
const isEditingUser = computed(() => !!editingUserEmail.value);
const filteredPermissionErrors = computed(() => {
  const keyword = permissionErrorSearch.value.trim().toLowerCase();
  if (!keyword) return permissionErrors.value;
  return permissionErrors.value.filter((row) => [
    row.user_email,
    row.route,
    row.module,
    row.operation,
    row.error_type,
    row.record_id,
    row.diagnostic_summary,
    permissionListFromJson(row.missing_permissions_json).join(" "),
  ].some((value) => String(value || "").toLowerCase().includes(keyword)));
});

const PERMISSION_GROUP_ORDER = [
  "Quản trị",
  "Dashboard",
  "Đơn hàng",
  "Yêu cầu xuất kho (Sale)",
  "Kho xử lý yêu cầu xuất",
  "Nhập kho",
  "Xuất kho thật",
  "Tồn kho",
  "Danh mục kho",
  "Khách hàng",
  "Sản phẩm",
  "Thanh toán",
  "Tiến độ in ấn",
  "Vận chuyển",
  "Hóa đơn",
  "Cài đặt",
  "Nhật ký",
];

const permissionByKey = new Map(PERMISSION_CATALOG.map((permission) => [permission.key, permission]));
const permissionGroups = computed(() => {
  const grouped = new Map<string, PermissionItem[]>();
  PERMISSION_CATALOG.forEach((permission) => {
    if (!grouped.has(permission.group)) grouped.set(permission.group, []);
    grouped.get(permission.group)!.push(permission);
  });
  return Array.from(grouped.entries())
    .map(([name, items]) => ({ name, items }))
    .sort((a, b) => groupSortIndex(a.name) - groupSortIndex(b.name));
});
const selectedRolePermissions = computed<string[]>(() =>
  Array.isArray(roleForm.permissions) ? roleForm.permissions : [],
);
const pendingDependencyPermissions = computed(() =>
  missingPermissionDependencies(selectedRolePermissions.value),
);
const pendingDependencyLabels = computed(() =>
  pendingDependencyPermissions.value.map(permissionLabel),
);
const blockedLegacyPermissions = computed(() =>
  selectedRolePermissions.value.filter((key) => NON_ASSIGNABLE_PERMISSION_KEYS.includes(key)),
);

function groupSortIndex(name: string) {
  const index = PERMISSION_GROUP_ORDER.indexOf(name);
  return index >= 0 ? index : 999;
}

function permissionLabel(key: string) {
  const permission = permissionByKey.get(key);
  return permission ? `${permission.name} (${key})` : key;
}

function permissionDependencyLabels(key: string) {
  return directPermissionDependencies(key).map(permissionLabel);
}

function permissionIsDisabled(permission: PermissionItem) {
  return permission.assignable === false;
}

function permissionListFromJson(value: unknown) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function permissionErrorTime(value: any) {
  const date = typeof value?.toDate === "function" ? value.toDate() : new Date(value || 0);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("vi-VN");
}

async function loadPermissionErrors(force = false) {
  if (permissionErrorsLoaded.value && !force) return;
  loading.value = true;
  try {
    const snapshot = await getDocs(query(
      collection(db, "permission_error_logs"),
      orderBy("created_at", "desc"),
      limit(300),
    ));
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    permissionErrors.value = snapshot.docs
      .map((item) => ({ ...item.data(), id: item.id }))
      .filter((row: any) => {
        const createdAt = typeof row.created_at?.toMillis === "function"
          ? row.created_at.toMillis()
          : new Date(row.created_at || 0).getTime();
        return createdAt >= cutoff;
      });
    permissionErrorsLoaded.value = true;
  } catch (error) {
    showToast(reportFirebaseError(error, "Không tải được lỗi phân quyền.", {
      module: "permission_error_logs",
      operation: "list",
      record: "latest-30-days",
    }), "error");
  } finally {
    loading.value = false;
  }
}

async function refreshCurrentTab() {
  if (activeTab.value === "permission_errors") {
    await loadPermissionErrors(true);
    return;
  }
  await loadRows();
}

async function selectTab(tab: "users" | "roles" | "permission_errors") {
  activeTab.value = tab;
  if (tab === "permission_errors") await loadPermissionErrors();
}

async function loadRows() {
  loading.value = true;
  try {
    const [userSnap, roleSnap] = await Promise.all([
      getDocs(collection(db, "users")),
      getDocs(collection(db, "roles")),
    ]);
    users.value = userSnap.docs
      .map((d) => ({ ...d.data(), id: d.id, email: d.id }) as AppUser)
      .filter(isActive);
    roles.value = roleSnap.docs
      .map((d) => ({ ...d.data(), id: d.id }) as RoleDoc)
      .filter(isActive);
  } catch (error) {
    showToast(
      reportFirebaseError(error, "Không tải được người dùng và vai trò."),
      "error",
    );
  } finally {
    loading.value = false;
  }
}

function openDetail(row: any, title: string) {
  selectedDetail.value = row;
  detailTitle.value = title;
  showDetailModal.value = true;
}

function openUserModal(row?: AppUser) {
  editingUserEmail.value = row ? normalizeEmail(row.email) : "";
  Object.keys(userForm).forEach((key) => delete userForm[key]);
  Object.assign(
    userForm,
    row
      ? { ...row, roles: roleNamesOfUser(row) }
      : {
          email: "",
          user_code: "",
          display_name: "",
          roles: [],
          status: "active",
          active: true,
          deleted: false,
        },
  );
  showUserModal.value = true;
}

function openRoleModal(row?: RoleDoc) {
  Object.keys(roleForm).forEach((key) => delete roleForm[key]);
  Object.assign(
    roleForm,
    row
      ? { ...row, permissions: [...(row.permissions || [])] }
      : {
          id: "",
          name: "",
          description: "",
          permissions: [],
          status: "active",
          active: true,
          deleted: false,
        },
  );
  showRoleModal.value = true;
}

function roleNamesOfUser(user: any) {
  const roleNames = Array.isArray(user.roles) ? user.roles.filter(Boolean) : [];
  if (!roleNames.length && user.role) roleNames.push(user.role);
  return roleNames;
}

function roleMatchesName(role: RoleDoc, name: string) {
  const normalized = String(name || "").toLowerCase().trim();
  return (
    normalized === String(role.id || "").toLowerCase().trim() ||
    normalized === String(role.name || "").toLowerCase().trim()
  );
}

function roleIsProtected(role: RoleDoc) {
  return (
    String(role.id || "").toLowerCase() === "admin" ||
    String(role.name || "").toLowerCase() === "admin" ||
    (role.permissions || []).includes("*")
  );
}

function permissionsFromRoleNames(
  roleNames: string[],
  sourceRoles = roles.value,
) {
  return resolvePermissionDependencies(
    sourceRoles
      .filter((role) => roleNames.some((name) => roleMatchesName(role, name)))
      .flatMap((role) => role.permissions || []),
  );
}

function userPermissionPatch(roleNames: string[], sourceRoles = roles.value) {
  const permissions = permissionsFromRoleNames(roleNames, sourceRoles);
  return {
    roles: roleNames,
    role: roleNames[0] || "",
    is_admin: permissions.includes("*"),
    permissions_flat: permissions,
    permission_schema_version: PERMISSION_SCHEMA_VERSION,
    updated_at: serverTimestamp(),
  };
}

async function saveUser() {
  const email = editingUserEmail.value || normalizeEmail(userForm.email);
  if (!email) return showToast("Thiếu email.", "error");
  const userCode = normalizeUserCode(userForm.user_code);
  const userCodeError = userCodeValidationError(userCode);
  if (userCodeError) return showToast(userCodeError, "error");
  const duplicate = users.value.find(
    (user) =>
      normalizeEmail(user.email) !== email &&
      normalizeUserCode(user.user_code) === userCode,
  );
  if (duplicate) {
    return showToast(
      `Mã Người dùng ${userCode} đang thuộc về ${duplicate.email}.`,
      "error",
    );
  }

  saving.value = true;
  try {
    const roleNames = Array.isArray(userForm.roles)
      ? userForm.roles.filter(Boolean)
      : [];
    const userRef = doc(db, "users", email);
    const codeRef = doc(db, "user_codes", userCode);
    const actorEmail = normalizeEmail(firebaseUser.value?.email || "");
    let payload: any = null;

    await runTransaction(db, async (transaction) => {
      const existingUser = await transaction.get(userRef);
      const reservedCode = await transaction.get(codeRef);
      const oldUserCode = normalizeUserCode(
        existingUser.exists() ? existingUser.data().user_code : "",
      );

      if (
        reservedCode.exists() &&
        normalizeEmail(reservedCode.data().email) !== email
      ) {
        throw new Error(
          `Mã Người dùng ${userCode} đã được cấp cho tài khoản khác.`,
        );
      }

      const { id: _id, firestore_id: _firestoreId, ...formData } = userForm;
      payload = {
        ...formData,
        email,
        user_code: userCode,
        ...userPermissionPatch(roleNames),
        active:
          userForm.status !== "inactive" && userForm.status !== "deleted",
        deleted: false,
        updated_at: serverTimestamp(),
        ...(existingUser.exists()
          ? {}
          : { created_at: serverTimestamp(), created_by: actorEmail }),
      };
      transaction.set(userRef, payload, { merge: true });

      transaction.set(
        codeRef,
        {
          user_code: userCode,
          email,
          active: true,
          deleted: false,
          updated_by: actorEmail,
          updated_at: serverTimestamp(),
          ...(reservedCode.exists() ? {} : { created_at: serverTimestamp() }),
        },
        { merge: true },
      );

      if (oldUserCode && oldUserCode !== userCode) {
        transaction.set(
          doc(db, "user_codes", oldUserCode),
          {
            user_code: oldUserCode,
            email,
            active: false,
            deleted: false,
            updated_by: actorEmail,
            updated_at: serverTimestamp(),
          },
          { merge: true },
        );
      }
    });

    const now = new Date().toISOString();
    const localPayload = {
      ...payload,
      email,
      user_code: userCode,
      updated_at: now,
      created_at: userForm.created_at || now,
    } as AppUser;
    const idx = users.value.findIndex((u) => normalizeEmail(u.email) === email);
    if (idx >= 0) users.value[idx] = { ...users.value[idx], ...localPayload };
    else users.value.unshift(localPayload);
    if (
      firebaseUser.value &&
      normalizeEmail(firebaseUser.value.email || "") === email
    ) {
      await loadProfile(firebaseUser.value);
    }
    showUserModal.value = false;
    showToast("Đã lưu người dùng.", "success");
  } catch (error) {
    showToast(
      reportFirebaseError(error, "Không lưu được người dùng."),
      "error",
    );
  } finally {
    saving.value = false;
  }
}

async function saveRole() {
  if (!roleForm.name) return showToast("Thiếu tên vai trò.", "error");
  const roleId = roleForm.id || roleForm.name;
  const isNamedAdmin = [roleId, roleForm.name]
    .some((value) => String(value || "").trim().toLowerCase() === "admin");
  const normalizedPermissions = resolvePermissionDependencies(selectedRolePermissions.value);
  if (isNamedAdmin && !normalizedPermissions.includes("*")) {
    return showToast("Vai trò Admin bắt buộc phải có quyền Toàn quyền hệ thống (*).", "error");
  }

  const autoAdded = normalizedPermissions.filter(
    (permission: string) => !selectedRolePermissions.value.includes(permission),
  );
  const removedBlocked = blockedLegacyPermissions.value.map(permissionLabel);
  saving.value = true;
  try {
    const payload = {
      ...roleForm,
      id: roleId,
      permissions: normalizedPermissions,
      active: true,
      deleted: false,
      updated_at: serverTimestamp(),
      created_at: roleForm.created_at || serverTimestamp(),
    };
    await setDoc(doc(db, "roles", roleId), payload, { merge: true });
    const nextRoles = roles.value.map((r) =>
      r.id === roleId ? ({ ...r, ...payload } as RoleDoc) : r,
    );
    if (!nextRoles.some((r) => r.id === roleId))
      nextRoles.unshift(payload as RoleDoc);
    roles.value = nextRoles;

    const affected = users.value.filter((user) => {
      const names = roleNamesOfUser(user);
      return names.includes(roleId) || names.includes(roleForm.name);
    });
    const batch = writeBatch(db);
    affected.forEach((user) => {
      const names = roleNamesOfUser(user);
      const patch = userPermissionPatch(names, nextRoles);
      batch.set(doc(db, "users", normalizeEmail(user.email)), patch, {
        merge: true,
      });
      Object.assign(user, patch);
    });
    if (affected.length) await batch.commit();
    if (
      firebaseUser.value &&
      affected.some(
        (user) =>
          normalizeEmail(user.email) ===
          normalizeEmail(firebaseUser.value?.email || ""),
      )
    ) {
      await loadProfile(firebaseUser.value);
    }
    showRoleModal.value = false;
    const notes = [
      autoAdded.length ? `Tự bổ sung ${autoAdded.length} quyền phụ thuộc.` : "",
      removedBlocked.length ? `Loại ${removedBlocked.length} quyền chỉ dành cho admin tuyệt đối.` : "",
    ].filter(Boolean).join(" ");
    showToast(
      `Đã cập nhật vai trò và đồng bộ quyền cho ${affected.length} người dùng.${notes ? ` ${notes}` : ""}`,
      "success",
    );
  } catch (error) {
    showToast(
      reportFirebaseError(error, "Không cập nhật được vai trò."),
      "error",
    );
  } finally {
    saving.value = false;
  }
}

async function deleteUser(row: AppUser) {
  const email = normalizeEmail(row.email);
  if (!email) return;
  if (
    firebaseUser.value &&
    email === normalizeEmail(firebaseUser.value.email || "")
  ) {
    return showToast("Không thể xóa chính tài khoản đang đăng nhập.", "error");
  }
  const confirmed = await askConfirm({
    title: "Xóa người dùng?",
    message: `Người dùng ${email} sẽ được chuyển sang trạng thái đã xóa. Dữ liệu cũ vẫn được giữ để truy vết.`,
    confirmLabel: "Xóa người dùng",
    variant: "danger",
  });
  if (!confirmed) return;
  saving.value = true;
  try {
    const payload = {
      active: false,
      deleted: true,
      status: "deleted",
      deleted_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    };
    await setDoc(doc(db, "users", email), payload, { merge: true });
    users.value = users.value.filter(
      (user) => normalizeEmail(user.email) !== email,
    );
    showToast("Đã xóa người dùng.", "success");
  } catch (error) {
    showToast(
      reportFirebaseError(error, "Không xóa được người dùng."),
      "error",
    );
  } finally {
    saving.value = false;
  }
}

async function deleteRole(row: RoleDoc) {
  if (roleIsProtected(row))
    return showToast("Không thể xóa vai trò admin/toàn quyền.", "error");
  const affected = users.value.filter((user) =>
    roleNamesOfUser(user).some((name) => roleMatchesName(row, name)),
  );
  const confirmed = await askConfirm({
    title: "Xóa vai trò?",
    message: `Vai trò ${row.name || row.id} sẽ được chuyển sang trạng thái đã xóa.${affected.length ? `\n${affected.length} người dùng đang dùng vai trò này sẽ được gỡ vai trò và đồng bộ lại quyền.` : ""}`,
    confirmLabel: "Xóa vai trò",
    variant: "danger",
  });
  if (!confirmed) return;
  saving.value = true;
  try {
    const nextRoles = roles.value.filter((role) => role.id !== row.id);
    const batch = writeBatch(db);
    batch.set(
      doc(db, "roles", row.id),
      {
        active: false,
        deleted: true,
        status: "deleted",
        deleted_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      },
      { merge: true },
    );
    affected.forEach((user) => {
      const nextNames = roleNamesOfUser(user).filter(
        (name) => !roleMatchesName(row, name),
      );
      const patch = userPermissionPatch(nextNames, nextRoles);
      batch.set(doc(db, "users", normalizeEmail(user.email)), patch, {
        merge: true,
      });
      Object.assign(user, patch);
    });
    await batch.commit();
    roles.value = nextRoles;
    if (
      firebaseUser.value &&
      affected.some(
        (user) =>
          normalizeEmail(user.email) ===
          normalizeEmail(firebaseUser.value?.email || ""),
      )
    ) {
      await loadProfile(firebaseUser.value);
    }
    showToast(
      `Đã xóa vai trò. Đã đồng bộ ${affected.length} người dùng.`,
      "success",
    );
  } catch (error) {
    showToast(reportFirebaseError(error, "Không xóa được vai trò."), "error");
  } finally {
    saving.value = false;
  }
}

function togglePermission(permission: PermissionItem) {
  if (permissionIsDisabled(permission)) {
    return showToast(permission.note || "Quyền này chỉ dành cho admin tuyệt đối.", "error");
  }

  const selected = selectedRolePermissions.value;
  if (selected.includes(permission.key)) {
    const next = removePermissionWithDependents(selected, permission.key);
    const removed = selected.filter((key) => !next.includes(key));
    roleForm.permissions = next;
    if (removed.length > 1) {
      showToast(
        `Đã bỏ ${permissionLabel(permission.key)} và ${removed.length - 1} quyền phụ thuộc vào quyền này.`,
        "info",
      );
    }
    return;
  }

  const next = resolvePermissionDependencies([...selected, permission.key]);
  const added = next.filter((key: string) => !selected.includes(key));
  roleForm.permissions = next;
  if (added.length > 1) {
    showToast(
      `Đã chọn ${permissionLabel(permission.key)} và tự thêm ${added.length - 1} quyền cần thiết cho luồng nghiệp vụ.`,
      "info",
    );
  }
}

function groupCheckedCount(items: PermissionItem[]) {
  return items.filter((item) => selectedRolePermissions.value.includes(item.key)).length;
}

onMounted(loadRows);
</script>

<template>
  <AppShell>
    <PageHeader title="Cài đặt" subtitle="Quản lý người dùng và vai trò">
      <button class="btn" @click="refreshCurrentTab">Làm mới</button>
    </PageHeader>
    <div class="card" style="margin: 24px;">
      <div class="row" style="margin-bottom: 16px">
        <button class="btn" :class="{ primary: activeTab === 'users' }" @click="selectTab('users')">Người dùng</button>
        <button class="btn" :class="{ primary: activeTab === 'roles' }" @click="selectTab('roles')">Vai trò & quyền</button>
        <button class="btn" :class="{ primary: activeTab === 'permission_errors' }" @click="selectTab('permission_errors')">Lỗi phân quyền</button>
      </div>
      <LoadingState v-if="loading" />
      <template v-else-if="activeTab === 'users'">
        <div class="toolbar">
          <h3>Người dùng</h3>
          <button v-if="hasPermission('users.manage')" class="btn primary" @click="openUserModal()">+ Thêm người dùng</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Mã người dùng</th><th>Email</th><th>Tên</th><th>Vai trò</th><th>Admin</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
            <tbody>
              <tr v-for="u in users" :key="u.email">
                <td><b>{{ u.user_code || "-" }}</b></td>
                <td><b>{{ u.email }}</b></td>
                <td>{{ u.display_name }}</td>
                <td>{{ roleNamesOfUser(u).join(", ") }}</td>
                <td>{{ u.is_admin ? "Có" : "" }}</td>
                <td><span class="badge green">{{ u.status || "active" }}</span></td>
                <td><div class="action-buttons">
                  <button class="btn-sm btn-view" @click="openDetail(u, 'Chi tiết người dùng')">Xem</button>
                  <button v-if="hasPermission('users.manage')" class="btn-sm" @click="openUserModal(u)">Sửa</button>
                  <button v-if="hasPermission('users.manage')" class="btn-sm btn-delete" @click="deleteUser(u)">Xóa</button>
                </div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <template v-else-if="activeTab === 'roles'">
        <div class="toolbar">
          <h3>Vai trò</h3>
          <button v-if="hasPermission('roles.manage')" class="btn primary" @click="openRoleModal()">+ Thêm vai trò</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>Tên</th><th>Mô tả</th><th>Số quyền</th><th>Thao tác</th></tr></thead>
            <tbody>
              <tr v-for="r in roles" :key="r.id">
                <td>{{ r.id }}</td><td><b>{{ r.name }}</b></td><td>{{ r.description }}</td><td>{{ r.permissions?.length || 0 }}</td>
                <td><div class="action-buttons">
                  <button class="btn-sm btn-view" @click="openDetail(r, 'Chi tiết vai trò')">Xem</button>
                  <button v-if="hasPermission('roles.manage')" class="btn-sm" @click="openRoleModal(r)">Sửa</button>
                  <button v-if="hasPermission('roles.manage')" class="btn-sm btn-delete" @click="deleteRole(r)">Xóa</button>
                </div></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <template v-else>
        <div class="toolbar">
          <div>
            <h3>Lỗi phân quyền</h3>
            <div class="small subtle">Chỉ admin được xem. Nhật ký hiển thị trong 30 ngày gần nhất.</div>
          </div>
          <input
            v-model="permissionErrorSearch"
            class="input"
            style="max-width: 420px"
            placeholder="Tìm email, route, thao tác, quyền thiếu..."
          />
        </div>
        <div class="table-wrap">
          <table style="min-width: 1250px">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Người dùng</th>
                <th>Route</th>
                <th>Module / thao tác</th>
                <th>Loại lỗi</th>
                <th>Quyền thiếu</th>
                <th>Bản ghi</th>
                <th>Chi tiết</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in filteredPermissionErrors" :key="row.id">
                <td>{{ permissionErrorTime(row.created_at) }}</td>
                <td><b>{{ row.user_email }}</b></td>
                <td><code>{{ row.route || "-" }}</code></td>
                <td>{{ row.module }} / {{ row.operation }}</td>
                <td><span class="badge" :class="row.error_type === 'missing_permission' ? 'orange' : 'blue'">{{ row.error_type }}</span></td>
                <td>
                  <code v-if="permissionListFromJson(row.missing_permissions_json).length">
                    {{ permissionListFromJson(row.missing_permissions_json).join(", ") }}
                  </code>
                  <span v-else>-</span>
                </td>
                <td>{{ row.record_id || "-" }}</td>
                <td><button class="btn-sm btn-view" @click="openDetail(row, 'Chi tiết lỗi phân quyền')">Xem</button></td>
              </tr>
              <tr v-if="!filteredPermissionErrors.length">
                <td colspan="8" class="empty">Không có lỗi phân quyền phù hợp trong 30 ngày gần nhất.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>

    <BaseModal v-if="showUserModal" :title="isEditingUser ? 'Sửa người dùng' : 'Thêm người dùng'" size="xl" :loading="saving" @close="showUserModal = false" @save="saveUser">
      <div class="form-grid">
        <div class="form-group"><label>Email</label><input v-model="userForm.email" class="input" :readonly="isEditingUser" /></div>
        <div class="form-group"><label>Mã Người dùng *</label><input v-model="userForm.user_code" class="input" maxlength="12" placeholder="VD: HIEU01" @blur="userForm.user_code = normalizeUserCode(userForm.user_code)" /><div class="small subtle">Chỉ dùng chữ A-Z và số; mã không được trùng.</div></div>
        <div class="form-group"><label>Tên hiển thị</label><input v-model="userForm.display_name" class="input" /></div>
<div class="form-group"><label>Trạng thái</label><select v-model="userForm.status" class="select"><option value="active">Đang hoạt động</option><option value="inactive">Ngừng hoạt động</option></select></div>
      </div>
      <h3>Vai trò</h3>
      <div class="role-checkbox-grid">
        <label v-for="r in roles" :key="r.id" class="card role-checkbox-item"><input v-model="userForm.roles" type="checkbox" :value="r.name" /> {{ r.name }}</label>
      </div>
    </BaseModal>

    <BaseModal v-if="showRoleModal" title="Vai trò" size="full" :loading="saving" @close="showRoleModal = false" @save="saveRole">
      <div class="form-grid">
        <div class="form-group"><label>ID</label><input v-model="roleForm.id" class="input" placeholder="Để trống sẽ dùng tên" /></div>
        <div class="form-group"><label>Tên vai trò</label><input v-model="roleForm.name" class="input" /></div>
      </div>
      <div class="form-group" style="margin-top: 12px"><label>Mô tả</label><input v-model="roleForm.description" class="input" /></div>
      <div class="form-section-label">
        <span>Quyền theo từng page/module</span>
        <span class="small subtle">Đã chọn {{ roleForm.permissions?.length || 0 }} quyền</span>
      </div>
      <div v-if="pendingDependencyLabels.length" class="alert warning" style="margin-bottom: 12px">
        Role cũ đang thiếu quyền phụ thuộc. Khi lưu sẽ tự bổ sung: <b>{{ pendingDependencyLabels.join(", ") }}</b>
      </div>
      <div v-if="blockedLegacyPermissions.length" class="alert warning" style="margin-bottom: 12px">
        Các quyền quản trị không còn được cấp riêng cho role thường và sẽ bị loại khi lưu: <b>{{ blockedLegacyPermissions.map(permissionLabel).join(", ") }}</b>
      </div>
      <div class="permission-group-list">
        <section v-for="group in permissionGroups" :key="group.name" class="permission-group-card">
          <div class="permission-group-header"><h4>{{ group.name }}</h4><span class="small">{{ groupCheckedCount(group.items) }}/{{ group.items.length }} quyền</span></div>
          <div class="permission-grid">
            <label v-for="p in group.items" :key="p.key" class="permission-item" :style="permissionIsDisabled(p) ? 'opacity:.6' : ''">
              <input type="checkbox" :checked="roleForm.permissions?.includes(p.key)" :disabled="permissionIsDisabled(p)" @change="togglePermission(p)" />
              <span>
                <b>{{ p.name }}</b><code>{{ p.key }}</code>
                <small v-if="permissionDependencyLabels(p.key).length" class="subtle">Cần: {{ permissionDependencyLabels(p.key).join(", ") }}</small>
                <small v-if="p.note" style="color:#b45309">{{ p.note }}</small>
              </span>
            </label>
          </div>
        </section>
      </div>
    </BaseModal>

    <RecordDetailModal v-if="showDetailModal && selectedDetail" :title="detailTitle" :record="selectedDetail" :field-order="['id','created_at','user_email','route','module','operation','stage','source','error_type','record_id','record_status','firebase_code','diagnostic_summary','required_permissions_json','missing_permissions_json','granted_permissions_json','firebase_message','context_json','stack','expires_at','user_code','email','display_name','name','description','roles','role','permissions','permissions_flat','is_admin','status','active','deleted','updated_at']" @close="showDetailModal = false" />
    <ConfirmModal :show="confirmState.show" :title="confirmState.title" :message="confirmState.message" :confirm-label="confirmState.confirmLabel" :cancel-label="confirmState.cancelLabel" :variant="confirmState.variant" @confirm="resolveConfirm(true)" @cancel="resolveConfirm(false)" />
  </AppShell>
</template>
