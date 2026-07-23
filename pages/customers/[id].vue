<script setup lang="ts">
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import type { CustomerDoc, OrderDoc, OrderItemDoc, PaymentDoc } from '~/types/models'
import { formatDateTime, money, normalizeText, safeJsonParse, toNumber } from '~/utils/format'
import { reportFirebaseError, reportPermissionError } from '~/utils/firebaseErrors'

const route = useRoute()
const { db } = useFirebaseServices()
const { appUser, hasPermission } = useAuth()
const { showToast } = useUi()
const { computePaymentStatus } = useOrderLogic()
const { loadScopedPayments } = useScopedQueries()

const loading = ref(false)
const customer = ref<CustomerDoc | null>(null)
const orders = ref<OrderDoc[]>([])
const paymentsByOrder = ref<Record<string, PaymentDoc[]>>({})
const search = ref('')
const selectedOrder = ref<OrderDoc | null>(null)
const selectedOrderItems = ref<OrderItemDoc[]>([])
const detailLoading = ref(false)
const showDetailModal = ref(false)
const ordersDenied = ref(false)

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

const selectedOrderPayments = computed(() => {
  if (!selectedOrder.value) return []
  return [...(paymentsByOrder.value[selectedOrder.value.id] || [])].sort((a, b) =>
    String(b.payment_date || b.created_at || '').localeCompare(String(a.payment_date || a.created_at || '')),
  )
})

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
    showToast(reportFirebaseError(error, 'Không tải được chi tiết sản phẩm của đơn hàng.', {
      module: 'order_items',
      operation: 'query_by_order_id',
      record: order.id,
      actionPermission: 'customers.orders_view',
      scopePermission: 'orders.view_all',
    }), 'error')
  } finally {
    detailLoading.value = false
  }
}

async function loadData(force = false) {
  if (!hasPermission('customers.orders_view')) {
    reportPermissionError({
      module: 'customers',
      operation: 'view_customer_orders',
      record: customerId.value,
      missingPermissions: ['customers.orders_view'],
    })
    await navigateTo('/forbidden', { replace: true })
    return
  }

  loading.value = true
  ordersDenied.value = false
  try {
    const customerSnapshot = await getDoc(doc(db, 'customers', customerId.value))
    if (!customerSnapshot.exists()) throw new Error('Không tìm thấy khách hàng.')

    customer.value = {
      ...customerSnapshot.data(),
      id: customerSnapshot.id,
    } as CustomerDoc

    const actor = String(appUser.value?.email || '').trim().toLowerCase()
    const customerOwner = String(customer.value.created_by || '').trim().toLowerCase()
    const ownsCustomer = Boolean(actor && actor === customerOwner)
    if (!ownsCustomer && !hasPermission('orders.view_all')) {
      orders.value = []
      paymentsByOrder.value = {}
      ordersDenied.value = true
      showToast(reportPermissionError({
        module: 'orders',
        operation: 'list_by_customer',
        record: customerId.value,
        missingPermissions: ['orders.view_all'],
        context: { customer_owner: customerOwner },
      }), 'error')
      return
    }

    const orderSnapshot = await getDocs(query(
      collection(db, 'orders'),
      where('customer_id', '==', customerId.value),
    ))
    const customerOrders = orderSnapshot.docs
      .map(order => ({ ...order.data(), id: order.id }) as OrderDoc)
      .filter(order => order.deleted !== true && order.status !== 'deleted')

    if (hasPermission('payments.view')) {
      const loadedPayments = await loadScopedPayments(customerOrders, force)
      const nextPaymentsByOrder: Record<string, PaymentDoc[]> = {}
      loadedPayments.forEach(payment => {
        if (!nextPaymentsByOrder[payment.order_id]) nextPaymentsByOrder[payment.order_id] = []
        nextPaymentsByOrder[payment.order_id].push(payment)
      })
      paymentsByOrder.value = nextPaymentsByOrder

      orders.value = customerOrders.map(order => ({
        ...order,
        ...computePaymentStatus(order, nextPaymentsByOrder[order.id] || []),
      }))
    } else {
      paymentsByOrder.value = {}
      orders.value = customerOrders
    }
  } catch (error: any) {
    showToast(error?.code
      ? reportFirebaseError(error, 'Không tải được đơn hàng của khách.', {
          module: customer.value ? 'orders' : 'customers',
          operation: customer.value ? 'list_by_customer' : 'get',
          record: customerId.value,
          actionPermission: customer.value ? 'customers.orders_view' : 'customers.view',
          scopePermission: customer.value ? 'orders.view_all' : 'customers.view_all',
        })
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
      <div v-else-if="ordersDenied" class="alert warning">Bạn không có quyền thực hiện thao tác này.</div>
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

      <h3 v-if="hasPermission('payments.view')" class="detail-section-title">Lịch sử thanh toán</h3>
      <div v-if="hasPermission('payments.view') && selectedOrderPayments.length" class="payment-timeline">
        <div v-for="payment in selectedOrderPayments" :key="payment.id" class="payment-timeline-item">
          <span class="payment-timeline-dot" aria-hidden="true"></span>
          <div class="payment-timeline-content">
            <div class="payment-timeline-head">
              <strong>{{ payment.payment_type || 'Thanh toán' }}</strong>
              <strong class="payment-timeline-amount">{{ money(payment.amount) }}</strong>
            </div>
            <div class="payment-timeline-meta">
              {{ payment.payment_date || formatDateTime(payment.created_at) || '-' }}
              · {{ payment.method || 'Chưa rõ phương thức' }}
              · {{ payment.created_by || 'Không rõ người tạo' }}
            </div>
            <span class="badge" :class="payment.payment_status === 'Đã nhận' ? 'green' : 'blue'">
              {{ payment.payment_status || 'Chưa rõ trạng thái' }}
            </span>
            <div v-if="payment.note" class="payment-timeline-note">{{ payment.note }}</div>
          </div>
        </div>
      </div>
      <div v-else-if="hasPermission('payments.view')" class="empty payment-timeline-empty">Đơn hàng chưa có lần thanh toán nào.</div>

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
.detail-section-title { margin: 24px 0 12px; }
.detail-products-title { margin-top: 20px; }
.customer-order-detail-table { min-width: 980px; }
.payment-timeline { position: relative; display: grid; gap: 14px; margin-bottom: 20px; padding-left: 24px; }
.payment-timeline::before { content: ''; position: absolute; top: 8px; bottom: 8px; left: 7px; width: 2px; background: #dbe3f0; }
.payment-timeline-item { position: relative; }
.payment-timeline-dot { position: absolute; top: 8px; left: -24px; width: 16px; height: 16px; border: 3px solid #fff; border-radius: 50%; background: #384bdc; box-shadow: 0 0 0 2px #b9c5ef; }
.payment-timeline-content { padding: 12px 14px; border: 1px solid #e1e7f0; border-radius: 10px; background: #f8faff; }
.payment-timeline-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.payment-timeline-amount { color: #1f35c7; white-space: nowrap; }
.payment-timeline-meta { margin: 5px 0 8px; color: #64748b; font-size: 13px; }
.payment-timeline-note { margin-top: 8px; color: #334155; font-size: 13px; }
.payment-timeline-empty { margin-bottom: 20px; }
@media (max-width: 700px) {
  .customer-orders-card { margin: 12px 0; }
  .payment-timeline-head { align-items: flex-start; flex-direction: column; gap: 4px; }
  .payment-timeline-meta { line-height: 1.5; }
}
</style>
