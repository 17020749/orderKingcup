<script setup lang="ts">
import type { CustomerDoc, OrderDoc, OrderItemDoc, ShipmentDoc } from '~/types/models'
import { formatDateTime, isActive, makeId, money, normalizeText, todayKey, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared ESM helper is executed directly by Node client tests.
import { appendUniqueRows } from '~/utils/cursorPagination.mjs'
import { toDateKey } from '~/utils/listFilters'

const { mutateOrderRelation } = useAtomicOrderRelations()
const {
  loadScopedOrders,
  loadScopedOrderItems,
  loadScopedPaymentsForOrders,
  loadScopedCustomers,
  loadScopedShipmentsPage,
} = useScopedQueries()
const { computePaymentStatus, parseLogoLines } = useOrderLogic()
const { appUser, hasPermission } = useAuth()
const { showToast, withLoading } = useUi()
const { confirmState, askConfirm, resolveConfirm } = useConfirmDialog()

const rows = ref<ShipmentDoc[]>([])
const PAGE_SIZE = 50
const pageCursor = shallowRef<any>(null)
const hasMoreRows = ref(false)
const pageMode = ref<'cursor' | 'full'>('cursor')
const loadingMore = ref(false)
const orders = ref<OrderDoc[]>([])
const customers = ref<CustomerDoc[]>([])
const itemsByOrder = ref<Record<string, OrderItemDoc[]>>({})
const loading = ref(false)
const saving = ref(false)
const search = ref('')
const shippingStatusFilter = ref('')
const carrierFilter = ref('')
const dateFrom = ref('')
const dateTo = ref('')
const showModal = ref(false)
const showDetailModal = ref(false)
const selectedDetail = ref<ShipmentDoc | null>(null)
const editing = ref<ShipmentDoc | null>(null)
const form = reactive<any>({})

const filterValues = computed(() => ({ status: shippingStatusFilter.value, carrier: carrierFilter.value, from: dateFrom.value, to: dateTo.value }))
const toolbarFilters = computed(() => [
  { key: 'status', label: 'Trạng thái giao', allLabel: 'Tất cả trạng thái', options: ['Chờ giao', 'Đang giao', 'Đã giao', 'Giao thất bại', 'Hoàn hàng'].map(value => ({ label: value, value })) },
  { key: 'carrier', label: 'Nhà vận chuyển', allLabel: 'Tất cả nhà vận chuyển', options: carrierOptions.value.map(value => ({ label: value, value })) },
  { key: 'from', label: 'Từ ngày', type: 'date' as const },
  { key: 'to', label: 'Đến ngày', type: 'date' as const },
])

function updateFilter(key: string, value: string) {
  if (key === 'status') shippingStatusFilter.value = value
  if (key === 'carrier') carrierFilter.value = value
  if (key === 'from') dateFrom.value = value
  if (key === 'to') dateTo.value = value
}

const carrierOptions = computed(() => Array.from(new Set(rows.value.map(row => String(row.carrier || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'vi')))

const filtered = computed(() => {
  const keyword = normalizeText(search.value)
  return rows.value.filter(row => {
    const matchedText = !keyword || normalizeText(`${row.order_code} ${row.carrier} ${row.shipping_status} ${payerLabel(row)}`).includes(keyword)
    const rowDate = toDateKey(row.shipped_date || row.delivered_date || row.created_at)
    return matchedText
      && (!shippingStatusFilter.value || row.shipping_status === shippingStatusFilter.value)
      && (!carrierFilter.value || row.carrier === carrierFilter.value)
      && (!dateFrom.value || (!!rowDate && rowDate >= dateFrom.value))
      && (!dateTo.value || (!!rowDate && rowDate <= dateTo.value))
  })
})

function resetFilters() {
  search.value = ''
  shippingStatusFilter.value = ''
  carrierFilter.value = ''
  dateFrom.value = ''
  dateTo.value = ''
}

const selectedOrder = computed(() => orders.value.find(order => order.id === form.order_id))
const selectedCustomer = computed(() => customers.value.find(customer => customer.id === selectedOrder.value?.customer_id))
const selectedOrderItems = computed(() => selectedOrder.value ? (itemsByOrder.value[selectedOrder.value.id] || []) : [])
const detailOrder = computed(() => orders.value.find(order => order.id === selectedDetail.value?.order_id))
const detailOrderItems = computed(() => detailOrder.value ? (itemsByOrder.value[detailOrder.value.id] || []) : [])

function orderLines(items: OrderItemDoc[]) {
  return items.flatMap(item => {
    const logos = parseLogoLines(item.logo_json)
    if (logos.length) {
      return logos.map(line => ({
        product_code: item.product_code || '',
        product_name: item.product_name || '',
        logo: line.logo || '',
        unit: item.unit || '',
        quantity: toNumber(line.quantity),
      }))
    }
    return [{
      product_code: item.product_code || '',
      product_name: item.product_name || '',
      logo: '',
      unit: item.unit || '',
      quantity: toNumber(item.quantity),
    }]
  })
}

const selectedOrderLines = computed(() => orderLines(selectedOrderItems.value))
const detailOrderLines = computed(() => orderLines(detailOrderItems.value))
const orderOptions = computed(() => orders.value.map(order => ({
  value: order.id,
  label: `${order.order_code} - ${order.customer_name || 'Khách chưa tên'}`,
  subLabel: `${order.order_status || 'Mới tạo'} · ${order.payment_status || 'Chưa thanh toán'} · Công nợ: ${money(order.debt_amount)}`,
  search: `${order.order_code} ${order.customer_name || ''} ${order.phone || ''} ${order.order_status || ''} ${order.payment_status || ''}`,
})))

const shipmentDetailLabels: Record<string, string> = {
  order_id: 'ID đơn hàng',
  order_code: 'Mã đơn',
  carrier: 'Nhà vận chuyển',
  tracking_code: 'Mã đơn (tương thích dữ liệu cũ)',
  shipping_fee: 'Phí giao hàng',
  cod_amount: 'Tiền COD',
  shipping_status: 'Trạng thái giao',
  shipped_date: 'Ngày giao',
  delivered_date: 'Ngày hoàn thành',
  customer_pays_shipping: 'Khách trả phí',
  company_pays_shipping: 'Công ty trả phí',
  company_shipping_revenue_mode: 'Cách tính doanh thu phí công ty trả',
  shipping_revenue_amount: 'Doanh thu vận chuyển',
  receiver_name: 'Người nhận',
  receiver_phone: 'SĐT người nhận',
  receiver_address: 'Địa chỉ nhận',
  note: 'Ghi chú',
}

async function loadRows(force = false, append = false) {
  if (append && (!hasMoreRows.value || loadingMore.value)) return
  if (append) loadingMore.value = true
  else loading.value = true
  try {
    if (!append) {
      const [loadedOrders, loadedCustomers] = await Promise.all([
        loadScopedOrders(force),
        loadScopedCustomers(force),
      ])
      const activeOrders = loadedOrders.filter(isActive)
      const [loadedItems, loadedPayments] = await Promise.all([
        loadScopedOrderItems(activeOrders, force),
        loadScopedPaymentsForOrders(activeOrders, force),
      ])
      const itemMap: Record<string, OrderItemDoc[]> = {}
      loadedItems.filter(isActive).forEach(item => {
        if (!itemMap[item.order_id]) itemMap[item.order_id] = []
        itemMap[item.order_id].push(item)
      })
      const paymentMap: Record<string, any[]> = {}
      loadedPayments.filter(isActive).forEach(payment => {
        if (!paymentMap[payment.order_id]) paymentMap[payment.order_id] = []
        paymentMap[payment.order_id].push(payment)
      })
      itemsByOrder.value = itemMap
      customers.value = loadedCustomers.filter(isActive)
      orders.value = activeOrders.map(order => ({
        ...order,
        ...computePaymentStatus(order, paymentMap[order.id] || []),
      }))
    }
    const page = await loadScopedShipmentsPage(append ? pageCursor.value : null, PAGE_SIZE, force)
    const loadedRows = page.rows.filter(isActive)
    rows.value = append ? appendUniqueRows(rows.value, loadedRows) : loadedRows
    pageCursor.value = page.cursor
    hasMoreRows.value = page.hasMore
    pageMode.value = page.mode
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được dữ liệu vận chuyển.'), 'error')
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadMoreRows() {
  await loadRows(false, true)
}

function chooseOrder() {
  const order = selectedOrder.value
  if (!order) return
  const customer = selectedCustomer.value
  form.order_code = order.order_code
  // Keep the legacy field synchronized so old reports/integrations do not break.
  form.tracking_code = order.order_code
  form.receiver_name = customer?.customer_name || order.customer_name || ''
  form.receiver_phone = customer?.phone || order.phone || ''
  form.receiver_address = customer?.shipping_address || customer?.billing_address || ''
}

function onCompanyPayerChange() {
  if (!form.company_pays_shipping) form.company_shipping_revenue_mode = ''
}

function payerLabel(row: Partial<ShipmentDoc>) {
  const labels: string[] = []
  const legacyCustomerPays = row.customer_pays_shipping == null && row.company_pays_shipping == null
  if (row.customer_pays_shipping === true || legacyCustomerPays) labels.push('Khách trả')
  if (row.company_pays_shipping === true) labels.push('Công ty trả')
  return labels.join(' + ') || '-'
}

function openDetail(row: ShipmentDoc) {
  selectedDetail.value = row
  showDetailModal.value = true
}

function openModal(row?: ShipmentDoc) {
  if (row && !hasPermission('shipments.edit') && !hasPermission('*')) return showToast('Bạn không có quyền sửa vận chuyển.', 'error')
  editing.value = row || null
  Object.keys(form).forEach(key => delete form[key])
  Object.assign(form, row ? {
    ...row,
    customer_pays_shipping: row.customer_pays_shipping == null && row.company_pays_shipping == null
      ? true
      : row.customer_pays_shipping === true,
    company_pays_shipping: row.company_pays_shipping === true,
    company_shipping_revenue_mode: row.company_shipping_revenue_mode || '',
  } : {
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
    customer_pays_shipping: true,
    company_pays_shipping: false,
    company_shipping_revenue_mode: '',
    shipping_revenue_amount: 0,
    receiver_name: '',
    receiver_phone: '',
    receiver_address: '',
    note: '',
    status: 'active'
  })
  showModal.value = true
}

async function save() {
  if (editing.value && !hasPermission('shipments.edit') && !hasPermission('*')) return showToast('Bạn không có quyền sửa vận chuyển.', 'error')
  if (!editing.value && !hasPermission('shipments.create') && !hasPermission('*')) return showToast('Bạn không có quyền tạo vận chuyển.', 'error')
  if (!form.order_id) return showToast('Vui lòng chọn đơn hàng.', 'error')
  if (!form.customer_pays_shipping && !form.company_pays_shipping) return showToast('Vui lòng chọn ít nhất một bên trả phí vận chuyển.', 'error')
  if (form.company_pays_shipping && !form.company_shipping_revenue_mode) return showToast('Vui lòng chọn tính hoặc không tính doanh thu cho phần công ty trả.', 'error')
  const order = selectedOrder.value
  if (!order) return showToast('Không tìm thấy đơn hàng.', 'error')

  saving.value = true
  await withLoading(async () => {
    chooseOrder()
    const shippingFee = toNumber(form.shipping_fee)
    const shippingRevenueAmount = form.company_pays_shipping && form.company_shipping_revenue_mode === 'Tính doanh thu'
      ? shippingFee
      : 0
    const result = await mutateOrderRelation({
      module: 'shipments',
      mode: editing.value ? 'update' : 'create',
      order,
      record: {
        ...form,
        tracking_code: order.order_code,
        shipping_fee: shippingFee,
        cod_amount: toNumber(form.cod_amount),
        customer_pays_shipping: form.customer_pays_shipping === true,
        company_pays_shipping: form.company_pays_shipping === true,
        company_shipping_revenue_mode: form.company_pays_shipping ? form.company_shipping_revenue_mode : '',
        shipping_revenue_amount: shippingRevenueAmount,
        created_by: editing.value?.created_by || appUser.value?.email || '',
      },
      existingRecords: rows.value.filter(row => row.order_id === order.id),
      actor: appUser.value?.email || '',
    })

    const record = result.record as ShipmentDoc
    const index = rows.value.findIndex(row => row.id === record.id)
    if (index >= 0) rows.value[index] = { ...rows.value[index], ...record }
    else rows.value.unshift(record)
    Object.assign(order, result.orderPatch)
    showModal.value = false
    showToast(editing.value ? 'Đã cập nhật vận chuyển và tổng hợp đơn hàng.' : 'Đã thêm vận chuyển và cập nhật đơn hàng.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không lưu được vận chuyển. Toàn bộ thay đổi đã hoàn tác.'), 'error'))
    .finally(() => { saving.value = false })
}

async function remove(row: ShipmentDoc) {
  if (!hasPermission('shipments.delete') && !hasPermission('*')) return showToast('Bạn không có quyền xóa vận chuyển.', 'error')
  const order = orders.value.find(item => item.id === row.order_id)
  if (!order) return showToast('Không tìm thấy đơn hàng cha của vận chuyển.', 'error')
  const confirmed = await askConfirm({
    title: 'Xóa vận chuyển',
    message: `Bạn chắc chắn muốn xóa vận chuyển của đơn ${row.order_code}?`,
    confirmLabel: 'Xóa vận chuyển'
  })
  if (!confirmed) return
  await withLoading(async () => {
    const result = await mutateOrderRelation({
      module: 'shipments',
      mode: 'delete',
      order,
      record: row,
      existingRecords: rows.value.filter(item => item.order_id === order.id),
      actor: appUser.value?.email || '',
    })
    rows.value = rows.value.filter(item => item.id !== row.id)
    Object.assign(order, result.orderPatch)
    showToast('Đã xóa vận chuyển và cập nhật lại tổng hợp đơn hàng.', 'success')
  }).catch(error => showToast(reportFirebaseError(error, 'Không xóa được vận chuyển. Toàn bộ thay đổi đã hoàn tác.'), 'error'))
}

onMounted(() => loadRows())
</script>

<template>
  <AppShell>
    <PageHeader title="Vận chuyển" subtitle="Theo dõi giao hàng, vận chuyển và COD">
      <button v-if="hasPermission('shipments.create') || hasPermission('*')" class="btn primary" @click="openModal()">+ Thêm vận chuyển</button>
    </PageHeader>

    <div class="card" style="margin: 24px;">
      <FilterToolbar
        v-model:search="search"
        search-placeholder="Tìm mã đơn, nhà vận chuyển, bên trả phí..."
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
        <table style="min-width:1180px">
          <thead>
            <tr><th>Đơn hàng</th><th>Nhà vận chuyển</th><th>Mã đơn</th><th>Bên trả phí</th><th>Ngày giao</th><th>Phí giao</th><th>Doanh thu VC</th><th>COD</th><th>Trạng thái</th><th>Thao tác</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td>{{ row.order_code }}</td>
              <td>{{ row.carrier }}</td>
              <td>{{ row.order_code }}</td>
              <td>{{ payerLabel(row) }}</td>
              <td>{{ formatDateTime(row.shipped_date) }}</td>
              <td>{{ money(row.shipping_fee) }}</td>
              <td>{{ money(row.shipping_revenue_amount) }}</td>
              <td>{{ money(row.cod_amount) }}</td>
              <td><span class="badge">{{ row.shipping_status }}</span></td>
              <td>
                <div class="action-buttons">
                  <button class="btn-sm btn-view" @click="openDetail(row)">Xem</button>
                  <button v-if="hasPermission('shipments.edit') || hasPermission('*')" class="btn-sm" @click="openModal(row)">Sửa</button>
                  <button v-if="hasPermission('shipments.delete') || hasPermission('*')" class="btn-sm btn-delete" @click="remove(row)">Xóa</button>
                </div>
              </td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="10" class="empty">Không có dữ liệu vận chuyển.</td></tr>
          </tbody>
        </table>
      </div>
      <CursorLoadMore :loaded-count="rows.length" :has-more="hasMoreRows" :loading="loadingMore" :mode="pageMode" @load-more="loadMoreRows" />
    </div>

    <BaseModal v-if="showModal" :title="editing ? 'Sửa vận chuyển' : 'Thêm vận chuyển'" size="xl" :loading="saving" @close="showModal=false" @save="save">
      <div class="form-grid">
        <div class="form-group">
          <label>Đơn hàng</label>
          <SearchableSelect
            v-model="form.order_id"
            :options="orderOptions"
            :disabled="!!editing"
            placeholder="Tìm theo mã đơn, khách hàng, SĐT..."
            @change="chooseOrder"
          />
        </div>
        <div class="form-group"><label>Mã đơn</label><input v-model="form.order_code" class="input readonly-field" readonly /></div>
        <div class="form-group"><label>Nhà vận chuyển</label><input v-model="form.carrier" class="input" /></div>
        <div class="form-group"><label>Ngày giao</label><input v-model="form.shipped_date" class="input" type="date" /></div>
        <div class="form-group"><label>Phí giao hàng</label><input v-model.number="form.shipping_fee" class="input" type="number" min="0" /></div>
        <div class="form-group"><label>Tiền COD</label><input v-model.number="form.cod_amount" class="input" type="number" min="0" /></div>
        <div class="form-group"><label>Trạng thái</label><select v-model="form.shipping_status" class="select"><option>Chờ giao</option><option>Đang giao</option><option>Đã giao</option><option>Giao thất bại</option><option>Hoàn hàng</option></select></div>
      </div>

      <template v-if="selectedOrder">
        <div class="detail-grid" style="margin-top:16px">
          <div class="detail-item"><label>Trạng thái đơn hàng</label><strong>{{ selectedOrder.order_status || 'Mới tạo' }}</strong></div>
          <div class="detail-item"><label>Thanh toán</label><strong>{{ selectedOrder.payment_status || 'Chưa thanh toán' }}</strong></div>
          <div class="detail-item"><label>Tổng tiền đơn</label><strong>{{ money(selectedOrder.actual_revenue || selectedOrder.total_vat) }}</strong></div>
          <div class="detail-item"><label>Giảm giá</label><strong>{{ money(selectedOrder.discount_amount) }}</strong></div>
          <div class="detail-item"><label>Đã thu</label><strong>{{ money(selectedOrder.paid_amount) }}</strong></div>
          <div class="detail-item"><label>Công nợ</label><strong>{{ money(selectedOrder.debt_amount) }}</strong></div>
        </div>

        <h3 style="margin-top:18px">Sản phẩm trong đơn</h3>
        <div class="table-wrap">
          <table style="min-width:760px">
            <thead><tr><th>Sản phẩm</th><th>Mã SP</th><th>Logo</th><th>Đơn vị</th><th>Số lượng</th></tr></thead>
            <tbody>
              <tr v-for="(line, index) in selectedOrderLines" :key="`${line.product_code}|${line.logo}|${index}`">
                <td><b>{{ line.product_name || '-' }}</b></td>
                <td>{{ line.product_code || '-' }}</td>
                <td>{{ line.logo || '-' }}</td>
                <td>{{ line.unit || '-' }}</td>
                <td>{{ line.quantity }}</td>
              </tr>
              <tr v-if="!selectedOrderLines.length"><td colspan="5" class="empty">Đơn hàng chưa có sản phẩm.</td></tr>
            </tbody>
          </table>
        </div>
      </template>

      <div class="form-group" style="margin-top:16px">
        <label>Bên trả phí vận chuyển</label>
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <label><input v-model="form.customer_pays_shipping" type="checkbox" /> Khách trả</label>
          <label><input v-model="form.company_pays_shipping" type="checkbox" @change="onCompanyPayerChange" /> Công ty trả</label>
        </div>
        <div class="small subtle">Có thể chọn đồng thời cả khách và công ty.</div>
      </div>

      <div v-if="form.company_pays_shipping" class="form-group">
        <label>Phần công ty trả có tính doanh thu?</label>
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <label><input v-model="form.company_shipping_revenue_mode" type="radio" value="Tính doanh thu" /> Tính doanh thu</label>
          <label><input v-model="form.company_shipping_revenue_mode" type="radio" value="Không tính doanh thu" /> Không tính doanh thu</label>
        </div>
      </div>

      <div class="form-grid">
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
      :labels="shipmentDetailLabels"
      :field-order="['id','order_id','order_code','carrier','tracking_code','shipping_status','shipped_date','delivered_date','shipping_fee','cod_amount','customer_pays_shipping','company_pays_shipping','company_shipping_revenue_mode','shipping_revenue_amount','receiver_name','receiver_phone','receiver_address','note','created_by','created_at','updated_at','order_owner_email','order_created_by','order_sale_email','relation_revision','last_operation_id','status','active','deleted']"
      :money-fields="['shipping_fee','cod_amount','shipping_revenue_amount']"
      @close="showDetailModal = false"
    >
      <template v-if="detailOrder">
        <h3 style="margin-top:20px">Đơn hàng liên kết</h3>
        <div class="detail-grid">
          <div class="detail-item"><label>Trạng thái đơn hàng</label><strong>{{ detailOrder.order_status || 'Mới tạo' }}</strong></div>
          <div class="detail-item"><label>Thanh toán</label><strong>{{ detailOrder.payment_status || 'Chưa thanh toán' }}</strong></div>
          <div class="detail-item"><label>Công nợ</label><strong>{{ money(detailOrder.debt_amount) }}</strong></div>
        </div>
        <h3 style="margin-top:20px">Sản phẩm trong đơn</h3>
        <div class="table-wrap">
          <table style="min-width:760px">
            <thead><tr><th>Sản phẩm</th><th>Mã SP</th><th>Logo</th><th>Đơn vị</th><th>Số lượng</th></tr></thead>
            <tbody>
              <tr v-for="(line, index) in detailOrderLines" :key="`${line.product_code}|${line.logo}|${index}`">
                <td><b>{{ line.product_name || '-' }}</b></td>
                <td>{{ line.product_code || '-' }}</td>
                <td>{{ line.logo || '-' }}</td>
                <td>{{ line.unit || '-' }}</td>
                <td>{{ line.quantity }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </RecordDetailModal>

    <ConfirmModal v-bind="confirmState" @cancel="resolveConfirm(false)" @confirm="resolveConfirm(true)" />
  </AppShell>
</template>
