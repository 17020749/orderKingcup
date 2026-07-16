<script setup lang="ts">
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { normalizeText } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

const { db } = useFirebaseServices()
const { showToast } = useUi()
const loading = ref(false)
const rows = ref<any[]>([])
const search = ref('')
const showDetailModal = ref(false)
const selectedDetail = ref<any>(null)

const filtered = computed(() => rows.value.filter(row =>
  normalizeText(`${row.module} ${row.action} ${row.item_code} ${row.item_name} ${row.changed_by}`)
    .includes(normalizeText(search.value))
))

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
