<script setup lang="ts">
import type { OrderDoc, ShipmentDoc } from '~/types/models'
import { formatDateTime, isActive, makeId, money, normalizeText, todayKey, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

const { saveDoc, softDeleteDoc } = useRepo()
const { loadScopedOrders, loadScopedShipments } = useScopedQueries()
const { appUser, hasPermission } = useAuth()
const { showToast, withLoading } = useUi()

const rows = ref<ShipmentDoc[]>([])
const orders = ref<OrderDoc[]>([])
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const showModal = ref(false)
const showDetailModal = ref(false)
const selectedDetail = ref<ShipmentDoc | null>(null)
const editing = ref<ShipmentDoc | null>(null)
const form = reactive<any>({})

const filtered = computed(() => rows.value.filter(row =>
  normalizeText(`${row.order_code} ${row.carrier} ${row.tracking_code} ${row.shipping_status}`)
    .includes(normalizeText(search.value))
))

async function loadRows(force = false) {
  loading.value = true
  try {
    const [loadedOrders, loadedRows] = await Promise.all([
      loadScopedOrders(force),
      loadScopedShipments(force)
    ])
    orders.value = loadedOrders
    rows.value = loadedRows.filter(isActive)
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được dữ liệu vận chuyển.'), 'error')
  } finally {
    loading.value = false
  }
}

function chooseOrder() {
  const order = orders.value.find(row => row.id === form.order_id)
  if (!order) return
  form.order_code = order.order_code
  form.receiver_name ||= order.customer_name
  form.receiver_phone ||= order.phone
}

function openDetail(row: ShipmentDoc) {
  selectedDetail.value = row
  showDetailModal.value = true
}

function openModal(row?: ShipmentDoc) {
  editing.value = row || null
  Object.assign(form, row ? { ...row } : {
    id: makeId('shp'),
    order_id: '',
    order_code: '',
    carrier: '',
    tracking_code: '',
    shipping_fee: 0,
    cod_amount: 0,
    shipping_status: 'Chờ giao',
    shipped_date: todayKey(),
    delivered_date: '',
    receiver_name: '',
    receiver_phone: '',
    receiver_address: '',
    note: '',
    status: 'active'
  })
  showModal.value = true
}

async function save() {
  if (!form.order_id) return showToast('Vui lòng chọn đơn hàng.', 'error')
  saving.value = true
  await withLoading(async () => {
    chooseOrder()
    const order = orders.value.find(row => row.id === form.order_id)
    if (!order) throw new Error('Không tìm thấy đơn hàng')

    const record = await saveDoc('shipments', {
      ...form,
      shipping_fee: toNumber(form.shipping_fee),
      cod_amount: toNumber(form.cod_amount),
      created_by: editing.value?.created_by || appUser.value?.email || '',
      order_owner_email: order.owner_email || '',
      order_created_by: order.created_by || '',
      order_sale_email: order.sale_email || ''
    }, form.id, { isCreate: !editing.value }) as ShipmentDoc

    const index = rows.value.findIndex(row => row.id === record.id)
    if (index >= 0) rows.value[index] = { ...rows.value[index], ...record }
    else rows.value.unshift(record)
    showModal.value = false
    showToast(editing.value ? 'Đã cập nhật vận chuyển.' : 'Đã thêm vận chuyển.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không lưu được vận chuyển.'), 'error'))
    .finally(() => { saving.value = false })
}

async function remove(row: ShipmentDoc) {
  if (!confirm(`Xóa vận chuyển của đơn ${row.order_code}?`)) return
  await withLoading(async () => {
    await softDeleteDoc('shipments', row.id, row.order_code || row.id)
    rows.value = rows.value.filter(item => item.id !== row.id)
    showToast('Đã xóa vận chuyển.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không xóa được vận chuyển.'), 'error'))
}

onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Vận chuyển" subtitle="Theo dõi giao hàng, vận chuyển và COD">
      <button v-if="hasPermission('shipments.create') || hasPermission('*')" class="btn primary" @click="openModal()">+ Thêm vận chuyển</button>
    </PageHeader>
    <div class="card">
      <div class="toolbar">
        <input v-model="search" class="input" placeholder="Tìm đơn, nhà vận chuyển, mã vận đơn..." />
        <button class="btn" @click="loadRows(true)">Làm mới</button>
      </div>
      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table>
          <thead><tr><th>Đơn hàng</th><th>Nhà vận chuyển</th><th>Mã vận đơn</th><th>Ngày giao</th><th>Phí giao</th><th>COD</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td>{{ row.order_code }}</td><td>{{ row.carrier }}</td><td>{{ row.tracking_code }}</td><td>{{ formatDateTime(row.shipped_date) }}</td><td>{{ money(row.shipping_fee) }}</td><td>{{ money(row.cod_amount) }}</td><td><span class="badge">{{ row.shipping_status }}</span></td>
              <td><div class="action-buttons"><button class="btn-sm btn-view" @click="openDetail(row)">Xem</button><button v-if="hasPermission('shipments.edit') || hasPermission('*')" class="btn-sm" @click="openModal(row)">Sửa</button><button v-if="hasPermission('shipments.delete') || hasPermission('*')" class="btn-sm btn-delete" @click="remove(row)">Xóa</button></div></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="8" class="empty">Không có dữ liệu vận chuyển.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal v-if="showModal" :title="editing ? 'Sửa vận chuyển' : 'Thêm vận chuyển'" size="lg" :loading="saving" @close="showModal=false" @save="save">
      <div class="form-grid">
        <div class="form-group"><label>Đơn hàng</label><select v-model="form.order_id" class="select" @change="chooseOrder"><option value="">Chọn đơn</option><option v-for="order in orders" :key="order.id" :value="order.id">{{ order.order_code }} - {{ order.customer_name }}</option></select></div>
        <div class="form-group"><label>Nhà vận chuyển</label><input v-model="form.carrier" class="input" /></div>
        <div class="form-group"><label>Mã vận đơn</label><input v-model="form.tracking_code" class="input" /></div>
        <div class="form-group"><label>Ngày giao</label><input v-model="form.shipped_date" class="input" type="date" /></div>
        <div class="form-group"><label>Phí giao hàng</label><input v-model.number="form.shipping_fee" class="input" type="number" min="0" /></div>
        <div class="form-group"><label>Tiền COD</label><input v-model.number="form.cod_amount" class="input" type="number" min="0" /></div>
        <div class="form-group"><label>Trạng thái</label><select v-model="form.shipping_status" class="select"><option>Chờ giao</option><option>Đang giao</option><option>Đã giao</option><option>Giao thất bại</option><option>Hoàn hàng</option></select></div>
        <div class="form-group"><label>Người nhận</label><input v-model="form.receiver_name" class="input" /></div>
        <div class="form-group"><label>SĐT người nhận</label><input v-model="form.receiver_phone" class="input" /></div>
      </div>
      <div class="form-group"><label>Địa chỉ nhận</label><textarea v-model="form.receiver_address" class="textarea" rows="2" /></div>
      <div class="form-group"><label>Ghi chú</label><textarea v-model="form.note" class="textarea" rows="2" /></div>
    </BaseModal>

    <RecordDetailModal
      v-if="showDetailModal && selectedDetail"
      title="Chi tiết vận chuyển"
      :record="selectedDetail"
      :field-order="['id','order_id','order_code','carrier','tracking_code','shipping_status','shipped_date','delivered_date','shipping_fee','cod_amount','receiver_name','receiver_phone','receiver_address','note','created_by','created_at','updated_at','order_owner_email','order_created_by','order_sale_email','status','active','deleted']"
      :money-fields="['shipping_fee','cod_amount']"
      @close="showDetailModal = false"
    />
  </AppShell>
</template>
