<script setup lang="ts">
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import type { CustomerDoc, OrderDoc } from '~/types/models'
import { formatDateTime, money, normalizeText } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

const route = useRoute()
const { db } = useFirebaseServices()
const { hasPermission } = useAuth()
const { showToast } = useUi()

const loading = ref(false)
const customer = ref<CustomerDoc | null>(null)
const orders = ref<OrderDoc[]>([])
const search = ref('')

const customerId = computed(() => String(route.params.id || ''))
const filtered = computed(() => orders.value.filter(order => normalizeText(
  `${order.order_code} ${order.order_classification || ''} ${order.order_status || ''} ${order.payment_status || ''}`,
).includes(normalizeText(search.value))))

async function loadData() {
  if (!hasPermission('customers.orders_view')) {
    await navigateTo('/forbidden', { replace: true })
    return
  }

  loading.value = true
  try {
    const [customerSnapshot, orderSnapshot] = await Promise.all([
      getDoc(doc(db, 'customers', customerId.value)),
      getDocs(query(collection(db, 'orders'), where('customer_id', '==', customerId.value))),
    ])
    if (!customerSnapshot.exists()) throw new Error('Không tìm thấy khách hàng hoặc bạn không có quyền xem.')

    customer.value = {
      ...customerSnapshot.data(),
      id: customerSnapshot.id,
    } as CustomerDoc
    orders.value = orderSnapshot.docs
      .map(item => ({ ...item.data(), id: item.id }) as OrderDoc)
      .filter(item => item.deleted !== true && item.status !== 'deleted')
      .sort((a, b) => String(b.order_date || b.created_at || '').localeCompare(String(a.order_date || a.created_at || '')))
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
            </tr>
            <tr v-if="!filtered.length"><td colspan="8" class="empty">Khách hàng chưa có đơn hàng phù hợp.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </AppShell>
</template>

<style scoped>
.customer-orders-card { margin: 24px; }
@media (max-width: 700px) {
  .customer-orders-card { margin: 12px 0; }
}
</style>
