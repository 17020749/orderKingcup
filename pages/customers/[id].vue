<script setup lang="ts">
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import type { CustomerDoc, OrderDoc, OrderItemDoc, PaymentDoc } from '~/types/models'
import { formatDateTime, money, normalizeText, safeJsonParse, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

const route = useRoute()
const { db } = useFirebaseServices()
const { hasPermission } = useAuth()
const { showToast } = useUi()
const { computePaymentStatus } = useOrderLogic()
const { loadScopedOrders, loadScopedPayments } = useScopedQueries()

const loading = ref(false)
const customer = ref<CustomerDoc | null>(null)
const orders = ref<OrderDoc[]>([])
const search = ref('')
const selectedOrder = ref<OrderDoc | null>(null)
const selectedOrderItems = ref<OrderItemDoc[]>([])
const detailLoading = ref(false)
const showDetailModal = ref(false)

const customerId = computed(() => String(route.params.id || ''))
const filtered = computed(() => orders.value.filter(order => normalizeText(
  `${order.order_code} ${order.order_classification || ''} ${order.order_status || ''} ${order.payment_status || ''}`,
).includes(normalizeText(search.value))))

const selectedOrderLines = computed(() => selectedOrderItems.value.flatMap(item => {
  const logos = safeJsonParse(item.logo_json, [])
  if (Array.isArray(logos) && logos.length) {
    return logos.map((line: any) => ({
      product_code: item.product_code || '',
      product_name: item.product_name || '',
      unit: item.unit || '',
      logo: String(line.logo || ''),
      quantity: toNumber(line.quantity ?? line.qty),
      unit_price: toNumber(line.unit_price ?? item.unit_price),
      line_total: toNumber(line.line_total) || toNumber(line.quantity ?? line.qty) * toNumber(line.unit_price ?? item.unit_price),
    }))
  }
  return [{
    product_code: item.product_code || '',
    product_name: item.product_name || '',
    unit: item.unit || '',
    logo: '',
    quantity: toNumber(item.quantity),
    unit_price: toNumber(item.unit_price),
    line_total: toNumber(item.line_total) || toNumber(item.quantity) * toNumber(item.unit_price),
  }]
}))

async function openOrderDetail(order: OrderDoc) {
  selectedOrder.value = order
  selectedOrderItems.value = []
  showDetailModal.value = true
  detailLoading.value = true
  try {
    const snapshot = await getDocs(query(collection(db, 'order_items'), where('order_id', '==', order.id)))
    selectedOrderItems.value = snapshot.docs
      .map(item => ({ ...item.data(), id: item.id }) as OrderItemDoc)
      .filter(item => item.deleted !== true && item.status !== 'deleted')
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được chi tiết sản phẩm của đơn hàng.'), 'error')
  } finally {
    detailLoading.value = false
  }
}

async function loadData(force = false) {
  if (!hasPermission('customers.orders_view')) {
    await navigateTo('/forbidden', { replace: true })
    return
  }

  loading.value = true
  try {
    const [customerSnapshot, scopedOrders] = await Promise.all([
      getDoc(doc(db, 'customers', customerId.value)),
      loadScopedOrders(force),
    ])
    if (!customerSnapshot.exists()) throw new Error('Không tìm thấy khách hàng hoặc bạn không có quyền xem.')

    customer.value = {
      ...customerSnapshot.data(),
      id: customerSnapshot.id,
    } as CustomerDoc
    const customerOrders = scopedOrders
      .filter(order => order.customer_id === customerId.value)

    if (hasPermission('payments.view')) {
      const loadedPayments = await loadScopedPayments(customerOrders, force)
      const paymentsByOrder: Record<string, PaymentDoc[]> = {}
      loadedPayments.forEach(payment => {
        if (!paymentsByOrder[payment.order_id]) paymentsByOrder[payment.order_id] = []
        paymentsByOrder[payment.order_id].push(payment)
      })

      orders.value = customerOrders.map(order => ({
        ...order,
        ...computePaymentStatus(order, paymentsByOrder[order.id] || []),
      }))
    } else {
      orders.value = customerOrders
    }
  } catch (error: any) {
    showToast(error?.code
      ? reportFirebaseError(error, 'Không tải được đơn hàng của khách.')
      : (error?.message || 'Không tải được đơn hàng của khách.'), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <AppShell>
    <PageHeader
      :title="customer ? `Đơn hàng của ${customer.customer_name}` : 'Đơn hàng theo khách hàng'"
      :subtitle="customer ? `${customer.customer_code || customer.id} · ${customer.phone || 'Chưa có SĐT'}` : 'Danh sách đơn hàng của khách đã chọn'"
    >
      <NuxtLink class="btn" to="/customers">← Quay lại khách hàng</NuxtLink>
      <button class="btn" @click="loadData">Làm mới</button>
    </PageHeader>

    <div class="card customer-orders-card">
      <div class="toolbar">
        <input v-model="search" class="input" style="max-width:520px" placeholder="Tìm mã đơn, phân loại, trạng thái..." />
        <span class="badge blue">{{ filtered.length }} đơn hàng</span>
      </div>

      <LoadingState v-if="loading" />
      <div v-else class="table-wrap">
        <table style="min-width:1100px">
          <thead>
            <tr>
              <th>Mã đơn hàng</th>
              <th>Ngày tạo</th>
              <th>Phân loại</th>
              <th>Trạng thái</th>
              <th>Thanh toán</th>
              <th>Tổng tiền</th>
              <th>Đã thu</th>
              <th>Công nợ</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="order in filtered" :key="order.id">
              <td><b style="color:#384bdc">{{ order.order_code }}</b></td>
              <td>{{ formatDateTime(order.order_date || order.created_at) || '-' }}</td>
              <td><span class="badge">{{ order.order_classification || '-' }}</span></td>
              <td><span class="badge blue">{{ order.order_status || 'Mới tạo' }}</span></td>
              <td><span class="badge green">{{ order.payment_status || 'Chưa thanh toán' }}</span></td>
              <td>{{ money(order.actual_revenue || order.total_vat) }}</td>
              <td>{{ money(order.paid_amount) }}</td>
              <td>{{ money(order.debt_amount) }}</td>
              <td><button class="btn-sm btn-view" @click="openOrderDetail(order)">Chi tiết</button></td>
            </tr>
            <tr v-if="!filtered.length"><td colspan="9" class="empty">Khách hàng chưa có đơn hàng phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <BaseModal
      v-if="showDetailModal && selectedOrder"
      :title="`Chi tiết đơn hàng ${selectedOrder.order_code}`"
      size="full"
      :show-footer="false"
      @close="showDetailModal = false"
    >
      <div class="detail-grid">
        <div class="detail-item"><label>Mã đơn hàng</label><strong>{{ selectedOrder.order_code }}</strong></div>
        <div class="detail-item"><label>Ngày tạo</label><strong>{{ formatDateTime(selectedOrder.order_date || selectedOrder.created_at) || '-' }}</strong></div>
        <div class="detail-item"><label>Phân loại</label><strong>{{ selectedOrder.order_classification || '-' }}</strong></div>
        <div class="detail-item"><label>Trạng thái</label><strong>{{ selectedOrder.order_status || 'Mới tạo' }}</strong></div>
        <div class="detail-item"><label>Thanh toán</label><strong>{{ selectedOrder.payment_status || 'Chưa thanh toán' }}</strong></div>
        <div class="detail-item"><label>Tổng tiền</label><strong>{{ money(selectedOrder.actual_revenue || selectedOrder.total_vat) }}</strong></div>
        <div class="detail-item"><label>Đã thu</label><strong>{{ money(selectedOrder.paid_amount) }}</strong></div>
        <div class="detail-item"><label>Công nợ</label><strong>{{ money(selectedOrder.debt_amount) }}</strong></div>
        <div class="detail-item"><label>Ghi chú</label><strong>{{ selectedOrder.note || '-' }}</strong></div>
      </div>

      <h3 class="detail-products-title">Sản phẩm trong đơn</h3>
      <LoadingState v-if="detailLoading" />
      <div v-else class="table-wrap">
        <table class="customer-order-detail-table">
          <thead><tr><th>Sản phẩm</th><th>Mã SP</th><th>Logo</th><th>Đơn vị</th><th>Số lượng</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
          <tbody>
            <tr v-for="(line, index) in selectedOrderLines" :key="`${line.product_code}|${line.logo}|${index}`">
              <td><b>{{ line.product_name || '-' }}</b></td>
              <td>{{ line.product_code || '-' }}</td>
              <td>{{ line.logo || '-' }}</td>
              <td>{{ line.unit || '-' }}</td>
              <td>{{ line.quantity.toLocaleString('vi-VN') }}</td>
              <td>{{ money(line.unit_price) }}</td>
              <td>{{ money(line.line_total) }}</td>
            </tr>
            <tr v-if="!selectedOrderLines.length"><td colspan="7" class="empty">Đơn hàng chưa có sản phẩm.</td></tr>
          </tbody>
        </table>
      </div>
    </BaseModal>
  </AppShell>
</template>

<style scoped>
.customer-orders-card { margin: 24px; }
.detail-products-title { margin-top: 20px; }
.customer-order-detail-table { min-width: 980px; }
@media (max-width: 700px) {
  .customer-orders-card { margin: 12px 0; }
}
</style>
