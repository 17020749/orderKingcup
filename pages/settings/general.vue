<script setup lang="ts">
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { invalidateScopedCache } from '~/composables/useScopedQueries'
import { reportFirebaseError } from '~/utils/firebaseErrors'
import { normalizeEmail, toNumber } from '~/utils/format'

const { db } = useFirebaseServices()
const { hasPermission } = useAuth()
const { showToast } = useUi()

const loading = ref(false)
const saving = ref(false)
const cleaning = ref(false)
const exists = ref(false)
const legacyCostCount = ref<number | null>(null)
const form = reactive({
  strategy: 'fifo',
  fallback_strategy: 'fifo',
  max_lots_per_line: 50,
  revision: 1,
})

const canManage = computed(() => hasPermission('*'))

const strategyDescription = computed(() => ({
  fifo: 'Ưu tiên lô có ngày nhập cũ nhất. Đây là lựa chọn mặc định và phù hợp với phần lớn hàng hóa.',
  fefo: 'Ưu tiên lô có hạn dùng gần nhất; nếu không có hạn dùng thì quay về thứ tự nhập trước.',
  smallest_lot_first: 'Ưu tiên các lô còn ít hàng để đóng lô lẻ trước.',
} as Record<string, string>)[form.strategy] || '')

async function countLegacyProductCosts() {
  if (!canManage.value) return
  const snapshot = await getDocs(collection(db, 'products'))
  legacyCostCount.value = snapshot.docs.filter(item => Object.prototype.hasOwnProperty.call(item.data() || {}, 'cost_price')).length
}

async function loadSetting() {
  loading.value = true
  try {
    const snapshot = await getDoc(doc(db, 'app_meta', 'warehouse_issue'))
    exists.value = snapshot.exists()
    if (snapshot.exists()) {
      const data = snapshot.data() || {}
      form.strategy = ['fifo', 'fefo', 'smallest_lot_first'].includes(String(data.strategy)) ? String(data.strategy) : 'fifo'
      form.fallback_strategy = 'fifo'
      form.max_lots_per_line = Math.max(1, Math.min(100, Math.floor(toNumber(data.max_lots_per_line) || 50)))
      form.revision = Math.max(1, Math.floor(toNumber(data.revision) || 1))
    }
    await countLegacyProductCosts()
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được cấu hình xuất kho.'), 'error')
  } finally {
    loading.value = false
  }
}

async function cleanupLegacyProductCosts(showResult = true) {
  if (!canManage.value) throw new Error('Chỉ Admin được dọn giá vốn cũ khỏi danh mục sản phẩm.')
  cleaning.value = true
  try {
    const snapshot = await getDocs(collection(db, 'products'))
    const targets = snapshot.docs.filter(item => Object.prototype.hasOwnProperty.call(item.data() || {}, 'cost_price'))
    for (let index = 0; index < targets.length; index += 400) {
      const batch = writeBatch(db)
      targets.slice(index, index + 400).forEach(item => {
        batch.update(item.ref, {
          cost_price: deleteField(),
          updated_at: serverTimestamp(),
        })
      })
      await batch.commit()
    }
    legacyCostCount.value = 0
    invalidateScopedCache('products')
    if (showResult) showToast(`Đã xóa giá vốn cũ khỏi ${targets.length} sản phẩm.`, 'success')
    return targets.length
  } finally {
    cleaning.value = false
  }
}

async function saveSetting() {
  if (!canManage.value) return showToast('Chỉ tài khoản Admin được thay đổi cấu hình xuất kho.', 'error')
  saving.value = true
  try {
    const nextRevision = exists.value ? form.revision + 1 : 1
    await setDoc(doc(db, 'app_meta', 'warehouse_issue'), {
      id: 'warehouse_issue',
      strategy: form.strategy,
      fallback_strategy: 'fifo',
      max_lots_per_line: Math.max(1, Math.min(100, Math.floor(toNumber(form.max_lots_per_line) || 50))),
      allocation_time: 'on_release',
      insufficient_stock_policy: 'block',
      expose_cost_to_warehouse: false,
      revision: nextRevision,
      active: true,
      deleted: false,
      updated_by: normalizeEmail(appUser.value?.email),
      updated_at: serverTimestamp(),
      ...(!exists.value ? {
        created_by: normalizeEmail(appUser.value?.email),
        created_at: serverTimestamp(),
      } : {}),
    }, { merge: true })
    const removed = await cleanupLegacyProductCosts(false)
    form.revision = nextRevision
    exists.value = true
    showToast(removed
      ? `Đã lưu cấu hình và xóa giá vốn cũ khỏi ${removed} sản phẩm.`
      : 'Đã lưu cấu hình xuất kho.', 'success')
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không lưu được cấu hình xuất kho.'), 'error')
  } finally {
    saving.value = false
  }
}

async function runCleanup() {
  try {
    await cleanupLegacyProductCosts(true)
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không dọn được giá vốn cũ khỏi sản phẩm.'), 'error')
  }
}

onMounted(loadSetting)
</script>

<template>
  <AppShell>
    <PageHeader title="Cấu hình xuất kho" subtitle="Hệ thống tự chọn lô ngầm; Sale và Kho chỉ thao tác số lượng">
      <button class="btn" :disabled="loading" @click="loadSetting">Làm mới</button>
      <button v-if="canManage" class="btn" :disabled="cleaning" @click="runCleanup">
        {{ cleaning ? 'Đang dọn...' : 'Dọn giá vốn cũ' }}
      </button>
      <button v-if="canManage" class="btn primary" :disabled="saving || cleaning" @click="saveSetting">
        {{ saving ? 'Đang lưu...' : 'Lưu cấu hình' }}
      </button>
    </PageHeader>

    <LoadingState v-if="loading" />
    <div v-else class="card" style="margin: 24px; max-width: 980px;">
      <div class="form-grid">
        <div class="form-group">
          <label>Nguyên tắc chọn lô khi xuất</label>
          <select v-model="form.strategy" class="select">
            <option value="fifo">FIFO — Nhập trước, xuất trước</option>
            <option value="fefo">FEFO — Hết hạn trước, xuất trước</option>
            <option value="smallest_lot_first">Lô còn ít trước</option>
          </select>
          <div class="small subtle" style="margin-top: 6px;">{{ strategyDescription }}</div>
        </div>

        <div class="form-group">
          <label>Số lô tối đa cho một dòng xuất</label>
          <input v-model.number="form.max_lots_per_line" class="input" type="number" min="1" max="100" step="1" />
          <div class="small subtle" style="margin-top: 6px;">Giới hạn tránh một lần xuất phải cập nhật quá nhiều lô trong một transaction.</div>
        </div>
      </div>

      <div class="detail-grid" style="margin-top: 18px;">
        <div class="detail-item"><label>Thời điểm phân bổ</label><strong>Khi bấm Cho xuất kho</strong></div>
        <div class="detail-item"><label>Khi thiếu tồn</label><strong>Chặn toàn bộ phiếu</strong></div>
        <div class="detail-item"><label>Chiến lược dự phòng</label><strong>FIFO</strong></div>
        <div class="detail-item"><label>Phiên bản cấu hình</label><strong>{{ form.revision }}</strong></div>
      </div>

      <div class="card" style="margin-top: 18px; background: var(--surface-soft, #f8fafc);">
        <h3 style="margin-top: 0;">Quy tắc bảo mật giá nhập</h3>
        <p>Giá nhập chỉ nằm trong chi tiết phiếu nhập. Dữ liệu lô dùng khi xuất chỉ có mã lô, ngày nhập, hạn dùng và số lượng còn lại.</p>
        <p>Phiếu xuất, yêu cầu xuất kho, tồn kho của nhân viên Kho và kết quả trả về sau khi xuất không chứa trường giá nhập.</p>
        <p><b>Giá vốn cũ trong danh mục sản phẩm:</b> {{ legacyCostCount === null ? 'Chưa kiểm tra' : `${legacyCostCount} sản phẩm` }}.</p>
        <p class="small subtle">Khi lưu cấu hình, hệ thống tự xóa trường `cost_price` cũ khỏi collection products để tài khoản Kho không thể đọc qua DevTools. Giá bán vẫn được giữ nguyên.</p>
        <p class="small subtle">Giải pháp này không dùng Cloud Functions và không yêu cầu chuyển Firebase sang gói Blaze.</p>
      </div>

      <div v-if="!canManage" class="empty" style="margin-top: 16px;">Bạn được xem cấu hình đang áp dụng nhưng chỉ Admin mới được thay đổi.</div>
    </div>
  </AppShell>
</template>
