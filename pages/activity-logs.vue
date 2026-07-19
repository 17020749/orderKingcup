<script setup lang="ts">
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { normalizeText } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

const { db } = useFirebaseServices()
const { showToast } = useUi()
const loading = ref(false)
const rows = ref<any[]>([])
const search = ref('')
const moduleFilter = ref('')
const actionFilter = ref('')
const actorFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const showDetailModal = ref(false)
const selectedDetail = ref<any>(null)

function uniqueOptions(values: any[]) {
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'vi'))
}

function dateKey(value: any) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

const moduleOptions = computed(() => uniqueOptions(rows.value.map(row => row.module)))
const actionOptions = computed(() => uniqueOptions(rows.value.map(row => row.action)))
const actorOptions = computed(() => uniqueOptions(rows.value.map(row => row.changed_by)))

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return rows.value.filter(row => {
    const rowDate = dateKey(row.created_at)
    const matchedText = !keyword || normalizeText(`${row.module} ${row.action} ${row.item_code} ${row.item_name} ${row.changed_by}`).includes(keyword)
    const matchedModule = !moduleFilter.value || normalizeText(row.module) === moduleFilter.value
    const matchedAction = !actionFilter.value || normalizeText(row.action) === actionFilter.value
    const matchedActor = !actorFilter.value || normalizeText(row.changed_by) === actorFilter.value
    const matchedFrom = !dateFrom.value || (rowDate && rowDate >= dateFrom.value)
    const matchedTo = !dateTo.value || (rowDate && rowDate <= dateTo.value)
    return matchedText && matchedModule && matchedAction && matchedActor && matchedFrom && matchedTo
  })
})

function resetFilters() {
  search.value = ''
  moduleFilter.value = ''
  actionFilter.value = ''
  actorFilter.value = ''
  dateFrom.value = ''
  dateTo.value = ''
}

function openDetail(row: any) {
  selectedDetail.value = row
  showDetailModal.value = true
}

async function loadRows() {
  loading.value = true
  try {
    const snap = await getDocs(query(collection(db, 'activity_logs'), orderBy('created_at', 'desc'), limit(300)))
    rows.value = snap.docs.map(d => ({ ...d.data(), id: d.id }))
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được nhật ký.'), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(loadRows)
</script>

<template>
  <AppShell>
    <PageHeader title="Nhật ký hoạt động" subtitle="Theo dõi các thao tác trong hệ thống">
      <button class="btn" @click="loadRows">Làm mới</button>
    </PageHeader>

    <div class="card" style="margin: 24px;">
      <div class="toolbar">
        <input v-model="search" class="input" style="max-width:480px" placeholder="Tìm log..." />
        <select v-model="moduleFilter" class="select" style="max-width: 200px">
          <option value="">Tất cả module</option>
          <option v-for="module in moduleOptions" :key="module" :value="normalizeText(module)">{{ module }}</option>
        </select>
        <select v-model="actionFilter" class="select" style="max-width: 180px">
          <option value="">Tất cả hành động</option>
          <option v-for="action in actionOptions" :key="action" :value="normalizeText(action)">{{ action }}</option>
        </select>
        <select v-model="actorFilter" class="select" style="max-width: 240px">
          <option value="">Tất cả người đổi</option>
          <option v-for="actor in actorOptions" :key="actor" :value="normalizeText(actor)">{{ actor }}</option>
        </select>
        <input v-model="dateFrom" class="input" type="date" style="max-width: 170px" />
        <input v-model="dateTo" class="input" type="date" style="max-width: 170px" />
        <button class="btn" @click="resetFilters">Xóa lọc</button>
      </div>
      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Thời gian</th><th>Module</th><th>Hành động</th><th>Mã/Tên</th><th>Người đổi</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td>{{ row.created_at?.toDate ? row.created_at.toDate().toLocaleString('vi-VN') : row.created_at }}</td>
              <td>{{ row.module }}</td>
              <td>{{ row.action }}</td>
              <td><b>{{ row.item_code }}</b><div class="small subtle">{{ row.item_name }}</div></td>
              <td>{{ row.changed_by }}</td>
              <td><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      title="Chi tiết nhật ký hoạt động"
      :record="selectedDetail"
      :field-order="['id','created_at','module','action','item_code','item_name','changed_by','before_json','after_json','status','active','deleted']"
      @close="showDetailModal = false"
    />
  </AppShell>
</template>
