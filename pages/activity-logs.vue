<script setup lang="ts">
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { normalizeText } from '~/utils/format'
import { isDateInRange, matchesKeyword, uniqueOptions } from '~/utils/listFilters'
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

const moduleOptions = computed(() => uniqueOptions(rows.value, 'module'))
const actionOptions = computed(() => uniqueOptions(rows.value, 'action'))
const actorOptions = computed(() => uniqueOptions(rows.value, 'changed_by'))
const filterValues = computed(() => ({ module: moduleFilter.value, action: actionFilter.value, actor: actorFilter.value, from: dateFrom.value, to: dateTo.value }))
const toolbarFilters = computed(() => [
  { key: 'module', allLabel: 'Tất cả module', width: '200px', options: moduleOptions.value.map(module => ({ label: module, value: normalizeText(module) })) },
  { key: 'action', allLabel: 'Tất cả hành động', width: '180px', options: actionOptions.value.map(action => ({ label: action, value: normalizeText(action) })) },
  { key: 'actor', allLabel: 'Tất cả người đổi', width: '240px', options: actorOptions.value.map(actor => ({ label: actor, value: normalizeText(actor) })) },
  { key: 'from', type: 'date' as const, label: 'Từ ngày' },
  { key: 'to', type: 'date' as const, label: 'Đến ngày' },
])

function updateFilter(key: string, value: string) {
  if (key === 'module') moduleFilter.value = value
  if (key === 'action') actionFilter.value = value
  if (key === 'actor') actorFilter.value = value
  if (key === 'from') dateFrom.value = value
  if (key === 'to') dateTo.value = value
}

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return rows.value.filter(row => {
    const matchedText = matchesKeyword([row.module, row.action, row.item_code, row.item_name, row.changed_by], keyword)
    const matchedModule = !moduleFilter.value || normalizeText(row.module) === moduleFilter.value
    const matchedAction = !actionFilter.value || normalizeText(row.action) === actionFilter.value
    const matchedActor = !actorFilter.value || normalizeText(row.changed_by) === actorFilter.value
    const matchedDate = isDateInRange(row.created_at, dateFrom.value, dateTo.value)
    return matchedText && matchedModule && matchedAction && matchedActor && matchedDate
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
      <FilterToolbar
        v-model:search="search"
        search-width="480px"
        search-placeholder="Tìm log..."
        :filters="toolbarFilters"
        :values="filterValues"
        :result-count="filtered.length"
        :loading="loading"
        show-refresh
        @update:filter="updateFilter"
        @reset="resetFilters"
        @refresh="loadRows"
      />
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
