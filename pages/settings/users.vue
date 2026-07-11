<script setup lang="ts">
import { collection, getDocs, doc, setDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { PERMISSION_CATALOG } from '~/constants/permissions'
import { isActive, normalizeEmail } from '~/utils/format'
import type { AppUser, RoleDoc } from '~/types/models'
import { reportFirebaseError } from '~/utils/firebaseErrors'

const { db } = useFirebaseServices()
const { hasPermission, firebaseUser, loadProfile } = useAuth()
const { showToast } = useUi()
const loading = ref(false)
const saving = ref(false)
const activeTab = ref<'users' | 'roles'>('users')
const users = ref<AppUser[]>([])
const roles = ref<RoleDoc[]>([])
const showUserModal = ref(false)
const showRoleModal = ref(false)
const showDetailModal = ref(false)
const selectedDetail = ref<any>(null)
const detailTitle = ref('Chi tiết')
const userForm = reactive<any>({})
const roleForm = reactive<any>({})

async function loadRows() {
  loading.value = true
  try {
    const [userSnap, roleSnap] = await Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'roles'))])
    users.value = userSnap.docs.map(d => ({ ...d.data(), id: d.id, email: d.id } as AppUser)).filter(isActive)
    roles.value = roleSnap.docs.map(d => ({ ...d.data(), id: d.id } as RoleDoc)).filter(isActive)
  } catch (error) { showToast(reportFirebaseError(error, 'Không tải được người dùng và vai trò.'), 'error') }
  finally { loading.value = false }
}
function openDetail(row: any, title: string) {
  selectedDetail.value = row
  detailTitle.value = title
  showDetailModal.value = true
}

function openUserModal(row?: AppUser) {
  Object.assign(userForm, row ? { ...row, roles: row.roles || (row.role ? [row.role] : []) } : { email: '', display_name: '', roles: [], status: 'active', active: true, deleted: false })
  showUserModal.value = true
}
function openRoleModal(row?: RoleDoc) {
  Object.assign(roleForm, row ? { ...row, permissions: [...(row.permissions || [])] } : { id: '', name: '', description: '', permissions: [], status: 'active', active: true, deleted: false })
  showRoleModal.value = true
}
function roleIsAdminByNames(roleNames: string[]) {
  return roleNames.some(name => String(name).toLowerCase() === 'admin')
}
async function saveUser() {
  const email = normalizeEmail(userForm.email)
  if (!email) return showToast('Thiếu email.', 'error')
  saving.value = true
  try {
    const roleNames = Array.isArray(userForm.roles) ? userForm.roles : []
    const matchedPerms = roles.value.filter(r => roleNames.includes(r.name) || roleNames.includes(r.id)).flatMap(r => r.permissions || [])
    const payload = {
      ...userForm,
      email,
      roles: roleNames,
      role: roleNames[0] || '',
      is_admin: roleIsAdminByNames(roleNames) || matchedPerms.includes('*'),
      permissions_flat: Array.from(new Set(matchedPerms)),
      active: userForm.status !== 'inactive' && userForm.status !== 'deleted',
      deleted: false,
      updated_at: serverTimestamp(),
      created_at: userForm.created_at || serverTimestamp()
    }
    await setDoc(doc(db, 'users', email), payload, { merge: true })
    const idx = users.value.findIndex(u => normalizeEmail(u.email) === email)
    if (idx >= 0) users.value[idx] = { ...users.value[idx], ...payload }
    else users.value.unshift(payload as AppUser)
    showUserModal.value = false
    showToast('Đã lưu người dùng.', 'success')
  } catch (error) { showToast(reportFirebaseError(error, 'Không lưu được người dùng.'), 'error') }
  finally { saving.value = false }
}
async function saveRole() {
  if (!roleForm.name) return showToast('Thiếu tên vai trò.', 'error')
  const roleId = roleForm.id || roleForm.name
  saving.value = true
  try {
    const payload = { ...roleForm, id: roleId, active: true, deleted: false, updated_at: serverTimestamp(), created_at: roleForm.created_at || serverTimestamp() }
    await setDoc(doc(db, 'roles', roleId), payload, { merge: true })
    const nextRoles = roles.value.map(r => r.id === roleId ? ({ ...r, ...payload } as RoleDoc) : r)
    if (!nextRoles.some(r => r.id === roleId)) nextRoles.unshift(payload as RoleDoc)
    roles.value = nextRoles

    const affected = users.value.filter(user => {
      const names = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : [])
      return names.includes(roleId) || names.includes(roleForm.name)
    })
    const batch = writeBatch(db)
    affected.forEach(user => {
      const names = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : [])
      const permissions = nextRoles
        .filter(role => names.includes(role.id) || names.includes(role.name))
        .flatMap(role => role.permissions || [])
      const patch = {
        permissions_flat: Array.from(new Set(permissions)),
        is_admin: roleIsAdminByNames(names) || permissions.includes('*'),
        updated_at: serverTimestamp()
      }
      batch.set(doc(db, 'users', normalizeEmail(user.email)), patch, { merge: true })
      Object.assign(user, patch)
    })
    if (affected.length) await batch.commit()
    if (firebaseUser.value && affected.some(user => normalizeEmail(user.email) === normalizeEmail(firebaseUser.value?.email || ''))) {
      await loadProfile(firebaseUser.value)
    }
    showRoleModal.value = false
    showToast(`Đã cập nhật vai trò và đồng bộ quyền cho ${affected.length} người dùng.`, 'success')
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không cập nhật được vai trò.'), 'error')
  } finally { saving.value = false }
}
function togglePermission(key: string) {
  roleForm.permissions = Array.isArray(roleForm.permissions) ? roleForm.permissions : []
  const index = roleForm.permissions.indexOf(key)
  if (index >= 0) roleForm.permissions.splice(index, 1)
  else roleForm.permissions.push(key)
}
onMounted(loadRows)
</script>
<template>
  <AppShell>
    <PageHeader title="Cài đặt" subtitle="Quản lý user/role trực tiếp trên Firestore">
      <button class="btn" @click="loadRows">Làm mới</button>
    </PageHeader>
    <div class="card">
      <div class="row" style="margin-bottom:16px"><button class="btn" :class="{primary: activeTab==='users'}" @click="activeTab='users'">Người dùng</button><button class="btn" :class="{primary: activeTab==='roles'}" @click="activeTab='roles'">Vai trò & quyền</button></div>
      <LoadingState v-if="loading" />
      <template v-else-if="activeTab==='users'">
        <div class="toolbar"><h3>Người dùng</h3><button v-if="hasPermission('users.manage')" class="btn primary" @click="openUserModal()">+ Thêm người dùng</button></div>
        <div class="table-wrap"><table><thead><tr><th>Email</th><th>Tên</th><th>Vai trò</th><th>Admin</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
          <tr v-for="u in users" :key="u.email"><td><b>{{ u.email }}</b></td><td>{{ u.display_name }}</td><td>{{ (u.roles || [u.role]).filter(Boolean).join(', ') }}</td><td>{{ u.is_admin ? 'Có' : '' }}</td><td><span class="badge green">{{ u.status || 'active' }}</span></td><td><div class="action-buttons"><button class="btn-sm btn-view" @click="openDetail(u, 'Chi tiết người dùng')">Xem</button><button v-if="hasPermission('users.manage')" class="btn-sm" @click="openUserModal(u)">Sửa</button></div></td></tr>
        </tbody></table></div>
      </template>
      <template v-else>
        <div class="toolbar"><h3>Vai trò</h3><button v-if="hasPermission('roles.manage')" class="btn primary" @click="openRoleModal()">+ Thêm vai trò</button></div>
        <div class="table-wrap"><table><thead><tr><th>ID</th><th>Tên</th><th>Mô tả</th><th>Số quyền</th><th>Thao tác</th></tr></thead><tbody>
          <tr v-for="r in roles" :key="r.id"><td>{{ r.id }}</td><td><b>{{ r.name }}</b></td><td>{{ r.description }}</td><td>{{ r.permissions?.length || 0 }}</td><td><div class="action-buttons"><button class="btn-sm btn-view" @click="openDetail(r, 'Chi tiết vai trò')">Xem</button><button v-if="hasPermission('roles.manage')" class="btn-sm" @click="openRoleModal(r)">Sửa</button></div></td></tr>
        </tbody></table></div>
      </template>
    </div>
    <BaseModal v-if="showUserModal" title="Người dùng" :loading="saving" @close="showUserModal=false" @save="saveUser">
      <div class="form-grid">
        <div class="form-group"><label>Email</label><input v-model="userForm.email" class="input" /></div>
        <div class="form-group"><label>Tên hiển thị</label><input v-model="userForm.display_name" class="input" /></div>
        <div class="form-group"><label>Trạng thái</label><select v-model="userForm.status" class="select"><option value="active">active</option><option value="inactive">inactive</option></select></div>
      </div>
      <h3>Vai trò</h3>
      <div class="grid grid-3">
        <label v-for="r in roles" :key="r.id" class="card" style="box-shadow:none; padding:10px"><input v-model="userForm.roles" type="checkbox" :value="r.name" /> {{ r.name }}</label>
      </div>
    </BaseModal>
    <BaseModal v-if="showRoleModal" title="Vai trò" :loading="saving" @close="showRoleModal=false" @save="saveRole">
      <div class="form-grid">
        <div class="form-group"><label>ID</label><input v-model="roleForm.id" class="input" placeholder="Để trống sẽ dùng tên" /></div>
        <div class="form-group"><label>Tên vai trò</label><input v-model="roleForm.name" class="input" /></div>
      </div>
      <div class="form-group" style="margin-top:12px"><label>Mô tả</label><input v-model="roleForm.description" class="input" /></div>
      <h3>Quyền</h3>
      <div class="grid grid-3">
        <label v-for="p in PERMISSION_CATALOG" :key="p.key" class="card" style="box-shadow:none; padding:10px"><input type="checkbox" :checked="roleForm.permissions?.includes(p.key)" @change="togglePermission(p.key)" /> <b>{{ p.name }}</b><div class="small subtle">{{ p.group }} · {{ p.key }}</div></label>
      </div>
    </BaseModal>
    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      :title="detailTitle"
      :record="selectedDetail"
      :field-order="['id','email','display_name','name','description','roles','role','permissions','permissions_flat','is_admin','status','active','deleted','created_at','updated_at']"
      @close="showDetailModal = false"
    />
  </AppShell>
</template>
