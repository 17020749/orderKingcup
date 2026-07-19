<script setup lang="ts">
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { PERMISSION_CATALOG } from '~/constants/permissions'
import { normalizeText } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared ESM module is executed directly by Node client tests.
import {
  PERMISSION_SCHEMA_VERSION,
  auditPermissionAssignments,
  buildPermissionSyncPatch,
  summarizePermissionAudit,
} from '~/utils/permissionAudit.mjs'

const { db } = useFirebaseServices()
const { appUser, firebaseUser, isAdmin, loadProfile } = useAuth()
const { showToast, withLoading } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()

const loading = ref(false)
const syncing = ref(false)
const search = ref('')
const statusFilter = ref('drift')
const users = ref<any[]>([])
const roles = ref<any[]>([])

const catalogKeys = computed(() => PERMISSION_CATALOG.map(permission => permission.key))
const auditRows = computed(() => auditPermissionAssignments({
  users: users.value,
  roles: roles.value,
  catalogKeys: catalogKeys.value,
}))
const summary = computed(() => summarizePermissionAudit(auditRows.value, roles.value, catalogKeys.value))
const filteredRows = computed(() => {
  const keyword = normalizeText(search.value)
  return auditRows.value.filter((row: any) => {
    if (statusFilter.value === 'drift' && row.isInSync) return false
    if (statusFilter.value === 'safe' && (row.isInSync || !row.safeToAutoSync)) return false
    if (statusFilter.value === 'blocked' && (row.isInSync || row.safeToAutoSync)) return false
    if (!keyword) return true
    return normalizeText([
      row.email,
      row.displayName,
      row.roleNames.join(' '),
      row.missingPermissions.join(' '),
      row.extraPermissions.join(' '),
      row.unknownRoles.join(' '),
    ].join(' ')).includes(keyword)
  })
})

function rowState(row: any) {
  if (row.isInSync) return { label: 'Đồng bộ', css: 'green' }
  if (row.protectedAdminMismatch) return { label: 'Chặn bảo vệ admin', css: 'red' }
  if (row.unknownRoles.length) return { label: 'Role không tồn tại', css: 'red' }
  if (row.unknownPermissions.length) return { label: 'Có quyền lạ', css: 'yellow' }
  return { label: 'Lệch quyền', css: 'yellow' }
}

async function loadRows() {
  if (!isAdmin.value) return navigateTo('/forbidden', { replace: true })
  loading.value = true
  try {
    const [userSnapshot, roleSnapshot] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'roles')),
    ])
    users.value = userSnapshot.docs.map(item => ({ ...item.data(), id: item.id, email: item.id }))
    roles.value = roleSnapshot.docs.map(item => ({ ...item.data(), id: item.id }))
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được dữ liệu kiểm tra quyền.'), 'error')
  } finally {
    loading.value = false
  }
}

function syncCandidates(rows: any[]) {
  return rows.filter(row => !row.isInSync && row.safeToAutoSync)
}

async function applySync(rows: any[]) {
  const candidates = syncCandidates(rows)
  if (!candidates.length) throw new Error('Không có tài khoản nào đủ điều kiện đồng bộ tự động.')

  for (let index = 0; index < candidates.length; index += 100) {
    const group = candidates.slice(index, index + 100)
    const batch = writeBatch(db)
    group.forEach(row => {
      const patch = buildPermissionSyncPatch(row)
      batch.set(doc(db, 'users', row.email), {
        ...patch,
        permission_synced_at: serverTimestamp(),
        permission_synced_by: appUser.value?.email || '',
        updated_at: serverTimestamp(),
      }, { merge: true })
      batch.set(doc(collection(db, 'activity_logs')), {
        module: 'permissions',
        action: 'sync_permissions_flat',
        item_code: row.email,
        item_name: row.displayName || row.email,
        changed_by: appUser.value?.email || '',
        before_json: JSON.stringify({
          roles: row.roleNames,
          permissions_flat: row.actualPermissions,
          is_admin: row.currentAdmin,
          permission_schema_version: row.permissionSchemaVersion,
        }),
        after_json: JSON.stringify(patch),
        permission_schema_version: PERMISSION_SCHEMA_VERSION,
        created_at: serverTimestamp(),
        active: true,
        deleted: false,
      })
    })
    await batch.commit()
  }

  if (firebaseUser.value && candidates.some(row => row.email === String(firebaseUser.value?.email || '').toLowerCase())) {
    await loadProfile(firebaseUser.value)
  }
  return candidates.length
}

async function syncOne(row: any) {
  if (!row.safeToAutoSync) {
    return showToast('Tài khoản này có role/quyền lạ hoặc xung đột admin; cần xử lý thủ công trước.', 'error')
  }
  const confirmed = await askConfirm({
    title: 'Đồng bộ quyền người dùng',
    message: `Đồng bộ ${row.email} theo các role: ${row.roleNames.join(', ') || '(không có role)'}?\nQuyền hiện tại sẽ được thay bằng quyền tính từ role và có log trước/sau.`,
    confirmLabel: 'Đồng bộ quyền',
  })
  if (!confirmed) return

  syncing.value = true
  await withLoading(async () => {
    await applySync([row])
    await loadRows()
    showToast(`Đã đồng bộ quyền cho ${row.email}.`, 'success')
  }).catch(error => showToast((error as any)?.message || 'Không đồng bộ được quyền.', 'error'))
    .finally(() => { syncing.value = false })
}

async function syncAllSafe() {
  const candidates = syncCandidates(auditRows.value)
  if (!candidates.length) return showToast('Không có tài khoản lệch quyền nào đủ điều kiện đồng bộ tự động.', 'info')
  const confirmed = await askConfirm({
    title: 'Đồng bộ tất cả quyền an toàn',
    message: `Sẽ đồng bộ ${candidates.length} tài khoản theo role hiện tại.\nTài khoản có role không tồn tại, quyền lạ hoặc xung đột admin sẽ được bỏ qua. Mỗi thay đổi đều có log trước/sau.`,
    confirmLabel: `Đồng bộ ${candidates.length} tài khoản`,
  })
  if (!confirmed) return

  syncing.value = true
  await withLoading(async () => {
    const count = await applySync(candidates)
    await loadRows()
    showToast(`Đã đồng bộ quyền cho ${count} tài khoản.`, 'success')
  }).catch(error => showToast((error as any)?.message || 'Không đồng bộ được quyền.', 'error'))
    .finally(() => { syncing.value = false })
}

onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Kiểm tra quyền" subtitle="So sánh role với permissions_flat mà Firestore Rules đang sử dụng">
      <button class="btn" :disabled="loading || syncing" @click="loadRows">Làm mới</button>
      <button class="btn primary" :disabled="loading || syncing || !summary.safeToSyncUsers" @click="syncAllSafe">
        Đồng bộ an toàn ({{ summary.safeToSyncUsers }})
      </button>
    </PageHeader>

    <div class="summary-grid">
      <div class="summary-card"><label>Người dùng hoạt động</label><strong>{{ summary.totalUsers }}</strong></div>
      <div class="summary-card"><label>Đã đồng bộ</label><strong>{{ summary.inSyncUsers }}</strong></div>
      <div class="summary-card"><label>Đang lệch quyền</label><strong>{{ summary.driftUsers }}</strong></div>
      <div class="summary-card"><label>Có thể tự đồng bộ</label><strong>{{ summary.safeToSyncUsers }}</strong></div>
      <div class="summary-card"><label>Role không tồn tại</label><strong>{{ summary.unknownRoleUsers }}</strong></div>
      <div class="summary-card"><label>Xung đột admin</label><strong>{{ summary.protectedAdminUsers }}</strong></div>
    </div>

    <div class="card" style="margin: 24px;">
      <div class="toolbar">
        <input v-model="search" class="input" style="max-width:480px" placeholder="Tìm email, tên, role hoặc quyền..." />
        <select v-model="statusFilter" class="select" style="max-width:260px">
          <option value="drift">Chỉ tài khoản lệch</option>
          <option value="safe">Có thể tự đồng bộ</option>
          <option value="blocked">Cần xử lý thủ công</option>
          <option value="all">Tất cả tài khoản</option>
        </select>
      </div>

      <div v-if="summary.unknownPermissions.length" class="alert warning" style="margin-bottom:12px">
        Quyền đang có trong user nhưng không còn trong catalog: <b>{{ summary.unknownPermissions.join(', ') }}</b>
      </div>
      <div v-if="summary.catalogPermissionsNotAssignedToAnyRole.length" class="alert info" style="margin-bottom:12px">
        Quyền trong catalog chưa được role hoạt động nào sử dụng: <b>{{ summary.catalogPermissionsNotAssignedToAnyRole.join(', ') }}</b>
      </div>

      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table style="min-width:1500px">
          <thead>
            <tr>
              <th>Người dùng</th>
              <th>Role</th>
              <th>Trạng thái</th>
              <th>Thiếu trong user</th>
              <th>Thừa trong user</th>
              <th>Role lỗi</th>
              <th>Schema</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filteredRows" :key="row.email">
              <td><b>{{ row.email }}</b><div class="small subtle">{{ row.displayName || '-' }}</div></td>
              <td>{{ row.roleNames.join(', ') || '-' }}</td>
              <td><span class="badge" :class="rowState(row).css">{{ rowState(row).label }}</span></td>
              <td><span v-if="row.missingPermissions.length">{{ row.missingPermissions.join(', ') }}</span><span v-else>-</span></td>
              <td>
                <span v-if="row.extraPermissions.length">{{ row.extraPermissions.join(', ') }}</span><span v-else>-</span>
                <div v-if="row.unknownPermissions.length" class="small" style="color:#dc2626">Quyền lạ: {{ row.unknownPermissions.join(', ') }}</div>
              </td>
              <td>{{ row.unknownRoles.join(', ') || '-' }}</td>
              <td>{{ row.permissionSchemaVersion }} → {{ PERMISSION_SCHEMA_VERSION }}</td>
              <td>
                <button v-if="!row.isInSync" class="btn-sm" :disabled="syncing || !row.safeToAutoSync" @click="syncOne(row)">Đồng bộ</button>
                <span v-else class="small subtle">Không cần sửa</span>
              </td>
            </tr>
            <tr v-if="!filteredRows.length"><td colspan="8" class="empty">Không có tài khoản phù hợp bộ lọc.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <ConfirmModal v-bind="confirmState" @cancel="resolveConfirm(false)" @confirm="resolveConfirm(true)" />
  </AppShell>
</template>
