<script setup lang="ts">
import {
  collection,
  getDocs,
  doc,
  setDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import {
  PERMISSION_CATALOG,
  type PermissionItem,
} from "~/constants/permissions";
import { isActive, normalizeEmail } from "~/utils/format";
import type { AppUser, RoleDoc } from "~/types/models";
import { reportFirebaseError } from "~/utils/firebaseErrors";

const { db } = useFirebaseServices();
const { hasPermission, firebaseUser, loadProfile } = useAuth();
const { showToast } = useUi();
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog();
const loading = ref(false);
const saving = ref(false);
const activeTab = ref<"users" | "roles">("users");
const users = ref<AppUser[]>([]);
const roles = ref<RoleDoc[]>([]);
const showUserModal = ref(false);
const showRoleModal = ref(false);
const showDetailModal = ref(false);
const selectedDetail = ref<any>(null);
const detailTitle = ref("Chi tiết");
const userForm = reactive<any>({});
const roleForm = reactive<any>({});

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

function groupSortIndex(name: string) {
  const index = PERMISSION_GROUP_ORDER.indexOf(name);
  return index >= 0 ? index : 999;
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
  Object.assign(
    userForm,
    row
      ? { ...row, roles: roleNamesOfUser(row) }
      : {
          email: "",
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
  const normalized = String(name || "")
    .toLowerCase()
    .trim();
  return (
    normalized ===
      String(role.id || "")
        .toLowerCase()
        .trim() ||
    normalized ===
      String(role.name || "")
        .toLowerCase()
        .trim()
  );
}

function roleIsAdminByNames(roleNames: string[]) {
  return roleNames.some((name) => String(name).toLowerCase() === "admin");
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
  return Array.from(
    new Set(
      sourceRoles
        .filter((role) => roleNames.some((name) => roleMatchesName(role, name)))
        .flatMap((role) => role.permissions || []),
    ),
  );
}

function userPermissionPatch(roleNames: string[], sourceRoles = roles.value) {
  const permissions = permissionsFromRoleNames(roleNames, sourceRoles);
  return {
    roles: roleNames,
    role: roleNames[0] || "",
    is_admin: roleIsAdminByNames(roleNames) || permissions.includes("*"),
    permissions_flat: permissions,
    updated_at: serverTimestamp(),
  };
}

async function saveUser() {
  const email = normalizeEmail(userForm.email);
  if (!email) return showToast("Thiếu email.", "error");
  saving.value = true;
  try {
    const roleNames = Array.isArray(userForm.roles)
      ? userForm.roles.filter(Boolean)
      : [];
    const payload = {
      ...userForm,
      email,
      ...userPermissionPatch(roleNames),
      active: userForm.status !== "inactive" && userForm.status !== "deleted",
      deleted: false,
      created_at: userForm.created_at || serverTimestamp(),
    };
    await setDoc(doc(db, "users", email), payload, { merge: true });
    const idx = users.value.findIndex((u) => normalizeEmail(u.email) === email);
    if (idx >= 0) users.value[idx] = { ...users.value[idx], ...payload };
    else users.value.unshift(payload as AppUser);
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
  saving.value = true;
  try {
    const payload = {
      ...roleForm,
      id: roleId,
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
    showToast(
      `Đã cập nhật vai trò và đồng bộ quyền cho ${affected.length} người dùng.`,
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

function togglePermission(key: string) {
  roleForm.permissions = Array.isArray(roleForm.permissions)
    ? roleForm.permissions
    : [];
  const index = roleForm.permissions.indexOf(key);
  if (index >= 0) roleForm.permissions.splice(index, 1);
  else roleForm.permissions.push(key);
}

function groupCheckedCount(items: PermissionItem[]) {
  const selected = Array.isArray(roleForm.permissions)
    ? roleForm.permissions
    : [];
  return items.filter((item) => selected.includes(item.key)).length;
}

onMounted(loadRows);
</script>
<template>
  <AppShell>
    <PageHeader
      title="Cài đặt"
      subtitle="Quản lý người dùng và vai trò"
    >
      <button class="btn" @click="loadRows">Làm mới</button>
    </PageHeader>
    <div class="card" style="margin: 24px;">
      <div class="row" style="margin-bottom: 16px">
        <button
          class="btn"
          :class="{ primary: activeTab === 'users' }"
          @click="activeTab = 'users'"
        >
          Người dùng
        </button>
        <button
          class="btn"
          :class="{ primary: activeTab === 'roles' }"
          @click="activeTab = 'roles'"
        >
          Vai trò & quyền
        </button>
      </div>
      <LoadingState v-if="loading" />
      <template v-else-if="activeTab === 'users'">
        <div class="toolbar">
          <h3>Người dùng</h3>
          <button
            v-if="hasPermission('users.manage')"
            class="btn primary"
            @click="openUserModal()"
          >
            + Thêm người dùng
          </button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Tên</th>
                <th>Vai trò</th>
                <th>Admin</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in users" :key="u.email">
                <td>
                  <b>{{ u.email }}</b>
                </td>
                <td>{{ u.display_name }}</td>
                <td>{{ roleNamesOfUser(u).join(", ") }}</td>
                <td>{{ u.is_admin ? "Có" : "" }}</td>
                <td>
                  <span class="badge green">{{ u.status || "active" }}</span>
                </td>
                <td>
                  <div class="action-buttons">
                    <button
                      class="btn-sm btn-view"
                      @click="openDetail(u, 'Chi tiết người dùng')"
                    >
                      Xem</button
                    ><button
                      v-if="hasPermission('users.manage')"
                      class="btn-sm"
                      @click="openUserModal(u)"
                    >
                      Sửa</button
                    ><button
                      v-if="hasPermission('users.manage')"
                      class="btn-sm btn-delete"
                      @click="deleteUser(u)"
                    >
                      Xóa
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <template v-else>
        <div class="toolbar">
          <h3>Vai trò</h3>
          <button
            v-if="hasPermission('roles.manage')"
            class="btn primary"
            @click="openRoleModal()"
          >
            + Thêm vai trò
          </button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Tên</th>
                <th>Mô tả</th>
                <th>Số quyền</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in roles" :key="r.id">
                <td>{{ r.id }}</td>
                <td>
                  <b>{{ r.name }}</b>
                </td>
                <td>{{ r.description }}</td>
                <td>{{ r.permissions?.length || 0 }}</td>
                <td>
                  <div class="action-buttons">
                    <button
                      class="btn-sm btn-view"
                      @click="openDetail(r, 'Chi tiết vai trò')"
                    >
                      Xem</button
                    ><button
                      v-if="hasPermission('roles.manage')"
                      class="btn-sm"
                      @click="openRoleModal(r)"
                    >
                      Sửa</button
                    ><button
                      v-if="hasPermission('roles.manage')"
                      class="btn-sm btn-delete"
                      @click="deleteRole(r)"
                    >
                      Xóa
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
    <BaseModal
      v-if="showUserModal"
      title="Người dùng"
      size="xl"
      :loading="saving"
      @close="showUserModal = false"
      @save="saveUser"
    >
      <div class="form-grid">
        <div class="form-group">
          <label>Email</label><input v-model="userForm.email" class="input" />
        </div>
        <div class="form-group">
          <label>Tên hiển thị</label
          ><input v-model="userForm.display_name" class="input" />
        </div>
        <div class="form-group">
          <label>Trạng thái</label
          ><select v-model="userForm.status" class="select">
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </div>
      </div>
      <h3>Vai trò</h3>
      <div class="role-checkbox-grid">
        <label v-for="r in roles" :key="r.id" class="card role-checkbox-item"
          ><input v-model="userForm.roles" type="checkbox" :value="r.name" />
          {{ r.name }}</label
        >
      </div>
    </BaseModal>
    <BaseModal
      v-if="showRoleModal"
      title="Vai trò"
      size="full"
      :loading="saving"
      @close="showRoleModal = false"
      @save="saveRole"
    >
      <div class="form-grid">
        <div class="form-group">
          <label>ID</label
          ><input
            v-model="roleForm.id"
            class="input"
            placeholder="Để trống sẽ dùng tên"
          />
        </div>
        <div class="form-group">
          <label>Tên vai trò</label
          ><input v-model="roleForm.name" class="input" />
        </div>
      </div>
      <div class="form-group" style="margin-top: 12px">
        <label>Mô tả</label
        ><input v-model="roleForm.description" class="input" />
      </div>
      <div class="form-section-label">
        <span>Quyền theo từng page/module</span>
        <span class="small subtle"
          >Đã chọn {{ roleForm.permissions?.length || 0 }} quyền</span
        >
      </div>
      <div class="permission-group-list">
        <section
          v-for="group in permissionGroups"
          :key="group.name"
          class="permission-group-card"
        >
          <div class="permission-group-header">
            <h4>{{ group.name }}</h4>
            <span class="small"
              >{{ groupCheckedCount(group.items) }}/{{
                group.items.length
              }}
              quyền</span
            >
          </div>
          <div class="permission-grid">
            <label
              v-for="p in group.items"
              :key="p.key"
              class="permission-item"
            >
              <input
                type="checkbox"
                :checked="roleForm.permissions?.includes(p.key)"
                @change="togglePermission(p.key)"
              />
              <span
                ><b>{{ p.name }}</b
                ><code>{{ p.key }}</code></span
              >
            </label>
          </div>
        </section>
      </div>
    </BaseModal>
    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      :title="detailTitle"
      :record="selectedDetail"
      :field-order="[
        'id',
        'email',
        'display_name',
        'name',
        'description',
        'roles',
        'role',
        'permissions',
        'permissions_flat',
        'is_admin',
        'status',
        'active',
        'deleted',
        'created_at',
        'updated_at',
      ]"
      @close="showDetailModal = false"
    />
    <ConfirmModal
      :show="confirmState.show"
      :title="confirmState.title"
      :message="confirmState.message"
      :confirm-label="confirmState.confirmLabel"
      :cancel-label="confirmState.cancelLabel"
      :variant="confirmState.variant"
      @confirm="resolveConfirm(true)"
      @cancel="resolveConfirm(false)"
    />
  </AppShell>
</template>
