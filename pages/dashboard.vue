<script setup lang="ts">
import { formatDateTime, isActive, money, toNumber } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'

const { loadScopedOrders, loadScopedOrderItems, loadScopedPayments, loadScopedExportRequests, loadScopedCustomers, loadProducts } = useScopedQueries()
const { hasPermission } = useAuth()
const { showToast } = useUi()
const { computePaymentStatus } = useOrderLogic()
const loading = ref(true)
const stats = ref({ orders: 0, customers: 0, products: 0, revenue: 0, paid: 0, debt: 0, profit: 0, exportRequests: 0 })
const recentOrders = ref<any[]>([])
const recentPayments = ref<any[]>([])

async function loadDashboard(force = false) {
  loading.value = true
  try {
    const ordersSnap = await loadScopedOrders(force)
    const orders = ordersSnap.filter(isActive)
    const [customersSnap, productsSnap, requestsSnap, paymentsSnap, itemsSnap] = await Promise.all([
      hasPermission('customers.view') ? loadScopedCustomers(force) : [],
      hasPermission('products.view') ? loadProducts(force) : [],
      loadScopedExportRequests(orders, force),
      loadScopedPayments(orders, force),
      loadScopedOrderItems(orders, force)
    ])
    const payments = paymentsSnap.filter(isActive)
    const receivedPayments = payments.filter((p: any) => String(p.payment_status || '').trim() === 'Đã nhận')
    const paymentMap = payments.reduce((map: Record<string, any[]>, payment: any) => {
      if (!map[payment.order_id]) map[payment.order_id] = []
      map[payment.order_id].push(payment)
      return map
    }, {})
    const ordersWithPayment = orders.map((order: any) => ({
      ...order,
      ...computePaymentStatus(order, paymentMap[order.id] || [])
    }))
    stats.value = {
      orders: ordersWithPayment.length,
      customers: customersSnap.filter(isActive).length,
      products: productsSnap.filter(isActive).length,
      revenue: ordersWithPayment.reduce((s: number, o: any) => s + toNumber(o.actual_revenue || o.total_vat), 0),
      paid: receivedPayments.reduce((s: number, p: any) => s + toNumber(p.amount), 0),
      debt: ordersWithPayment.reduce((s: number, o: any) => s + toNumber(o.debt_amount), 0),
      profit: itemsSnap.filter(isActive).reduce((s: number, item: any) => s + toNumber(item.line_profit), 0),
      exportRequests: requestsSnap.filter(isActive).length
    }
    recentOrders.value = ordersWithPayment.sort((a: any, b: any) => String(b.created_at || b.order_date || '').localeCompare(String(a.created_at || a.order_date || ''))).slice(0, 8)
    recentPayments.value = payments.sort((a: any, b: any) => String(b.payment_date || b.created_at || '').localeCompare(String(a.payment_date || a.created_at || ''))).slice(0, 8)
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được dữ liệu dashboard.'), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(() => loadDashboard())
</script>

<template>
  <AppShell>
    <PageHeader title="Dashboard" subtitle="Tổng quan dữ liệu đơn hàng, thanh toán và công nợ">
      <button class="btn" @click="loadDashboard(true)">Làm mới</button>
    </PageHeader>
    <LoadingState v-if="loading" />
    <template v-else>
      <div class="grid grid-4" style="margin-bottom: 16px">
        <div class="kpi"><div class="subtle">Doanh thu</div><div class="kpi-value">{{ money(stats.revenue) }}</div></div>
        <div class="kpi"><div class="subtle">Đã thu</div><div class="kpi-value">{{ money(stats.paid) }}</div></div>
        <div class="kpi"><div class="subtle">Công nợ</div><div class="kpi-value">{{ money(stats.debt) }}</div></div>
        <div class="kpi"><div class="subtle">Lợi nhuận</div><div class="kpi-value">{{ money(stats.profit) }}</div></div>
      </div>
      <div class="grid grid-4" style="margin-bottom: 16px">
        <div class="summary-card"><label>Đơn hàng</label><strong>{{ stats.orders }}</strong></div>
        <div class="summary-card"><label>Khách hàng</label><strong>{{ stats.customers }}</strong></div>
        <div class="summary-card"><label>Sản phẩm</label><strong>{{ stats.products }}</strong></div>
        <div class="summary-card"><label>Phiếu xuất kho</label><strong>{{ stats.exportRequests }}</strong></div>
      </div>
      <div class="grid grid-2">
        <div class="card">
          <h3 style="margin-top: 0">Đơn hàng gần đây</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Thanh toán</th><th>Tổng tiền</th></tr></thead>
              <tbody>
                <tr v-for="order in recentOrders" :key="order.id">
                  <td><b>{{ order.order_code }}</b><div class="small subtle">{{ formatDateTime(order.order_date) }}</div></td>
                  <td>{{ order.customer_name }}</td>
                  <td><span class="badge green">{{ order.payment_status || 'Chưa thanh toán' }}</span></td>
                  <td>{{ money(order.actual_revenue || order.total_vat) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <h3 style="margin-top: 0">Thanh toán gần đây</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Mã đơn</th><th>Ngày</th><th>Số tiền</th><th>Phương thức</th></tr></thead>
              <tbody>
                <tr v-for="payment in recentPayments" :key="payment.id">
                  <td><b>{{ payment.order_code }}</b></td>
                  <td>{{ payment.payment_date }}</td>
                  <td>{{ money(payment.amount) }}</td>
                  <td>{{ payment.method }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </AppShell>
</template>
