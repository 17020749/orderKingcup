<script setup lang="ts">
import { formatDateTime, money } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared ESM constants are also exercised by Node tests.
import { DASHBOARD_PERIODS } from '~/utils/dashboardSnapshot.mjs'

const { loadDashboardSnapshot } = useDashboardSnapshot()
const { showToast } = useUi()

const loading = ref(true)
const dashboard = ref<any>(null)
const selectedPeriod = ref('month')

const emptyPeriod = {
  stats: {
    orders: 0,
    customers: 0,
    products: 0,
    newCustomers: 0,
    revenue: 0,
    paid: 0,
    debt: 0,
    profit: 0,
    conversionRate: 0,
    marginRate: 0,
  },
  salesKpis: [],
  productProfit: [],
}

const currentPeriod = computed(() => (
  dashboard.value?.periods?.[selectedPeriod.value]
  || dashboard.value?.periods?.all
  || emptyPeriod
))
const pipelineTotal = computed(() => (
  dashboard.value?.pipeline?.reduce((sum: number, row: any) => sum + Number(row.count || 0), 0) || 0
))
const productionTotal = computed(() => (
  dashboard.value?.productionStages?.reduce((sum: number, row: any) => sum + Number(row.count || 0), 0) || 0
))
const trendMax = computed(() => Math.max(
  1,
  ...(dashboard.value?.revenueTrend || []).flatMap((row: any) => [row.revenue, row.paid, row.profit].map(Number)),
))

async function loadDashboard(force = false) {
  loading.value = true
  try {
    dashboard.value = await loadDashboardSnapshot(force)
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được dữ liệu dashboard.'), 'error')
  } finally {
    loading.value = false
  }
}

function percent(value: any) {
  return `${Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
}

function compactMoney(value: any) {
  const amount = Number(value || 0)
  return `${new Intl.NumberFormat('vi-VN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount)}đ`
}

function barHeight(value: any) {
  const ratio = Number(value || 0) / trendMax.value
  return `${Math.max(Number(value || 0) > 0 ? 6 : 0, Math.round(ratio * 100))}%`
}

function stageWidth(count: any) {
  return `${productionTotal.value ? Math.max(4, Math.round((Number(count || 0) / productionTotal.value) * 100)) : 0}%`
}

function pipelineWidth(count: any) {
  return `${pipelineTotal.value ? Math.max(4, Math.round((Number(count || 0) / pipelineTotal.value) * 100)) : 0}%`
}

function paymentBadge(status: any) {
  const value = String(status || '').toLowerCase()
  if (value.includes('đã thanh toán') || value.includes('thanh toán thừa')) return 'green'
  if (value.includes('một phần') || value.includes('đã cọc')) return 'yellow'
  return 'red'
}

function dueLabel(days: any) {
  if (days == null) return 'Chưa có hạn giao'
  const value = Number(days)
  if (value < 0) return `Quá hạn ${Math.abs(value)} ngày`
  if (value === 0) return 'Giao hôm nay'
  return `Còn ${value} ngày`
}

function productionLabel(stage: any) {
  return ({
    design: 'Thiết kế',
    film: 'Film',
    printing: 'In',
    qc: 'QC',
    packing: 'Đóng gói',
    delivery: 'Giao hàng',
    quotation: 'Báo giá',
  } as Record<string, string>)[String(stage || '')] || String(stage || '-')
}

onMounted(() => loadDashboard())
</script>

<template>
  <AppShell>
    <PageHeader
      title="Dashboard vận hành"
      subtitle="Theo dõi đơn hàng, sản xuất, giao hàng, thu tiền và hiệu quả kinh doanh"
    >
      <div class="dashboard-header-actions">
        <select v-model="selectedPeriod" class="select dashboard-period-select" aria-label="Khoảng thời gian dashboard">
          <option v-for="period in DASHBOARD_PERIODS" :key="period.key" :value="period.key">
            {{ period.label }}
          </option>
        </select>
        <button class="btn" :disabled="loading" @click="loadDashboard(true)">
          {{ loading ? 'Đang tải...' : 'Làm mới dữ liệu' }}
        </button>
      </div>
    </PageHeader>

    <LoadingState v-if="loading" />

    <main v-else-if="dashboard" class="dashboard-page">
      <section class="dashboard-hero">
        <div>
          <span class="eyebrow">Kingcup Control Center</span>
          <h2>Từ báo giá đến thu tiền trên một màn hình</h2>
          <p>
            Số liệu được giới hạn theo quyền của tài khoản. Tiến độ sản xuất được tổng hợp từ trạng thái đơn,
            lệnh in, yêu cầu xuất kho và vận chuyển.
          </p>
        </div>
        <div class="hero-health">
          <div>
            <span>Quá hạn giao</span>
            <strong>{{ dashboard.stats.overdueOrders || 0 }}</strong>
          </div>
          <div>
            <span>Sắp đến hạn</span>
            <strong>{{ dashboard.stats.dueSoonOrders || 0 }}</strong>
          </div>
          <div>
            <span>Chờ thu tiền</span>
            <strong>{{ dashboard.stats.waitingCollection || 0 }}</strong>
          </div>
        </div>
      </section>

      <section class="metric-grid" aria-label="Chỉ số kinh doanh">
        <article class="metric-card metric-card--revenue">
          <span class="metric-label">Doanh thu</span>
          <strong>{{ money(currentPeriod.stats.revenue) }}</strong>
          <small>{{ currentPeriod.stats.orders }} đơn trong kỳ</small>
        </article>
        <article class="metric-card metric-card--paid">
          <span class="metric-label">Thực thu</span>
          <strong>{{ money(currentPeriod.stats.paid) }}</strong>
          <small>Dòng tiền đã xác nhận</small>
        </article>
        <article class="metric-card metric-card--debt">
          <span class="metric-label">Công nợ</span>
          <strong>{{ money(currentPeriod.stats.debt) }}</strong>
          <small>Còn phải thu của đơn trong kỳ</small>
        </article>
        <article class="metric-card metric-card--profit">
          <span class="metric-label">Lợi nhuận</span>
          <strong>{{ money(currentPeriod.stats.profit) }}</strong>
          <small>Biên lợi nhuận {{ percent(currentPeriod.stats.marginRate) }}</small>
        </article>
        <article class="metric-card metric-card--conversion">
          <span class="metric-label">Tỷ lệ chốt</span>
          <strong>{{ percent(currentPeriod.stats.conversionRate) }}</strong>
          <small>{{ currentPeriod.stats.newCustomers }} khách hàng mới</small>
        </article>
        <article class="metric-card metric-card--orders">
          <span class="metric-label">Đơn hàng</span>
          <strong>{{ currentPeriod.stats.orders }}</strong>
          <small>{{ currentPeriod.stats.customers }} khách · {{ currentPeriod.stats.products }} sản phẩm</small>
        </article>
      </section>

      <section class="dashboard-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Luồng đơn hàng</span>
            <h3>Báo giá → Sản xuất → Giao hàng → Thu tiền</h3>
          </div>
          <NuxtLink class="panel-link" to="/orders">Mở quản lý đơn hàng →</NuxtLink>
        </div>
        <div class="pipeline-grid">
          <article v-for="(stage, index) in dashboard.pipeline" :key="stage.key" class="pipeline-card">
            <div class="pipeline-topline">
              <span class="pipeline-index">0{{ index + 1 }}</span>
              <span>{{ stage.label }}</span>
            </div>
            <strong>{{ stage.count }}</strong>
            <small>{{ compactMoney(stage.amount) }}</small>
            <div class="pipeline-track"><span :style="{ width: pipelineWidth(stage.count) }" /></div>
          </article>
        </div>
      </section>

      <div class="operations-grid">
        <section class="dashboard-panel">
          <div class="panel-heading">
            <div>
              <span class="panel-kicker">Tiến độ sản xuất</span>
              <h3>Đang nằm ở công đoạn nào?</h3>
            </div>
            <NuxtLink class="panel-link" to="/printing">Chi tiết in ấn →</NuxtLink>
          </div>
          <div class="production-list">
            <div v-for="(stage, index) in dashboard.productionStages" :key="stage.key" class="production-row">
              <span class="production-number">{{ String(index + 1).padStart(2, '0') }}</span>
              <div class="production-content">
                <div class="production-meta">
                  <b>{{ stage.label }}</b>
                  <strong>{{ stage.count }} đơn</strong>
                </div>
                <div class="production-track"><span :style="{ width: stageWidth(stage.count) }" /></div>
              </div>
            </div>
          </div>
          <p class="panel-note">
            Công đoạn Film/QC/Đóng gói ưu tiên trường “Trạng thái vận hành”; khi chưa có, hệ thống suy luận từ lệnh in,
            yêu cầu kho và vận chuyển.
          </p>
        </section>

        <section class="dashboard-panel alert-panel">
          <div class="panel-heading">
            <div>
              <span class="panel-kicker">Cảnh báo tự động</span>
              <h3>Việc cần xử lý ngay</h3>
            </div>
            <span class="alert-count">{{ dashboard.alerts.length }}</span>
          </div>
          <div v-if="dashboard.alerts.length" class="alert-list">
            <NuxtLink
              v-for="alert in dashboard.alerts"
              :key="alert.id"
              :to="alert.href || '/orders'"
              class="alert-row"
              :class="`alert-row--${alert.level}`"
            >
              <span class="alert-dot" />
              <span class="alert-copy">
                <b>{{ alert.title }}</b>
                <small>{{ alert.description }}</small>
              </span>
              <span class="alert-arrow">→</span>
            </NuxtLink>
          </div>
          <div v-else class="panel-empty">Không có cảnh báo cần xử lý.</div>
        </section>
      </div>

      <div class="analytics-grid">
        <section class="dashboard-panel trend-panel">
          <div class="panel-heading">
            <div>
              <span class="panel-kicker">Xu hướng 6 tháng</span>
              <h3>Doanh thu, thực thu và lợi nhuận</h3>
            </div>
            <div class="chart-legend">
              <span><i class="legend-revenue" />Doanh thu</span>
              <span><i class="legend-paid" />Thực thu</span>
              <span><i class="legend-profit" />Lợi nhuận</span>
            </div>
          </div>
          <div class="trend-chart">
            <div v-for="month in dashboard.revenueTrend" :key="month.key" class="trend-column">
              <div class="trend-bars">
                <span class="trend-bar trend-bar--revenue" :style="{ height: barHeight(month.revenue) }" :title="money(month.revenue)" />
                <span class="trend-bar trend-bar--paid" :style="{ height: barHeight(month.paid) }" :title="money(month.paid)" />
                <span class="trend-bar trend-bar--profit" :style="{ height: barHeight(month.profit) }" :title="money(month.profit)" />
              </div>
              <b>{{ month.label }}</b>
            </div>
          </div>
        </section>

        <section class="dashboard-panel">
          <div class="panel-heading">
            <div>
              <span class="panel-kicker">Hiệu quả sản phẩm</span>
              <h3>Lợi nhuận theo nhóm</h3>
            </div>
          </div>
          <div v-if="currentPeriod.productProfit.length" class="profit-list">
            <div v-for="row in currentPeriod.productProfit" :key="row.name" class="profit-row">
              <div>
                <b>{{ row.name }}</b>
                <small>{{ row.quantity.toLocaleString('vi-VN') }} sản phẩm · Doanh thu {{ compactMoney(row.revenue) }}</small>
              </div>
              <div class="profit-value">
                <strong>{{ compactMoney(row.profit) }}</strong>
                <span>{{ percent(row.marginRate) }}</span>
              </div>
            </div>
          </div>
          <div v-else class="panel-empty">Chưa có dữ liệu giá vốn/lợi nhuận trong kỳ.</div>
        </section>
      </div>

      <section class="dashboard-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">KPI Sale</span>
            <h3>Doanh số, khách mới, tỷ lệ chốt và công nợ</h3>
          </div>
        </div>
        <div v-if="currentPeriod.salesKpis.length" class="table-wrap dashboard-table-wrap">
          <table class="dashboard-table">
            <thead>
              <tr>
                <th>Nhân viên</th>
                <th>Đơn hàng</th>
                <th>Khách mới</th>
                <th>Tỷ lệ chốt</th>
                <th>Doanh thu</th>
                <th>Thực thu theo đơn</th>
                <th>Công nợ</th>
                <th>Lợi nhuận</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="sale in currentPeriod.salesKpis" :key="sale.key">
                <td><b>{{ sale.name }}</b><div class="small subtle">{{ sale.email || 'Chưa có email' }}</div></td>
                <td>{{ sale.orders }}</td>
                <td>{{ sale.newCustomers }}</td>
                <td><span class="rate-pill">{{ percent(sale.conversionRate) }}</span></td>
                <td><b>{{ money(sale.revenue) }}</b></td>
                <td>{{ money(sale.paid) }}</td>
                <td class="debt-cell">{{ money(sale.debt) }}</td>
                <td>{{ money(sale.profit) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="panel-empty">Chưa có dữ liệu KPI Sale trong kỳ đã chọn.</div>
      </section>

      <div class="bottom-grid">
        <section class="dashboard-panel">
          <div class="panel-heading">
            <div>
              <span class="panel-kicker">Theo dõi giao hàng</span>
              <h3>Đơn cần bám sát</h3>
            </div>
            <NuxtLink class="panel-link" to="/shipments">Mở vận chuyển →</NuxtLink>
          </div>
          <div v-if="dashboard.orderWatchlist.length" class="watch-list">
            <NuxtLink v-for="order in dashboard.orderWatchlist" :key="order.id" to="/orders" class="watch-row">
              <span class="watch-status" :class="`watch-status--${order.alert_level}`" />
              <span class="watch-main">
                <b>{{ order.order_code }}</b>
                <small>{{ order.customer_name || '-' }} · {{ productionLabel(order.production_stage) }}</small>
              </span>
              <span class="watch-due" :class="`watch-due--${order.alert_level}`">{{ dueLabel(order.days_to_due) }}</span>
            </NuxtLink>
          </div>
          <div v-else class="panel-empty">Không có đơn đang theo dõi.</div>
        </section>

        <section class="dashboard-panel">
          <div class="panel-heading">
            <div>
              <span class="panel-kicker">Hồ sơ thiết kế</span>
              <h3>AI / PDF / Demo / Mockup theo đơn</h3>
            </div>
            <span class="design-score">
              {{ dashboard.designSummary.completeOrders }}/{{ dashboard.designSummary.requiredOrders }} đủ file
            </span>
          </div>
          <div class="design-summary">
            <div><span>Cần thiết kế</span><strong>{{ dashboard.designSummary.requiredOrders }}</strong></div>
            <div><span>Đủ hồ sơ</span><strong>{{ dashboard.designSummary.completeOrders }}</strong></div>
            <div><span>Còn thiếu</span><strong>{{ dashboard.designSummary.missingOrders }}</strong></div>
          </div>
          <div v-if="dashboard.designSummary.rows.length" class="design-list">
            <NuxtLink v-for="row in dashboard.designSummary.rows" :key="row.id" to="/orders" class="design-row">
              <div>
                <b>{{ row.orderCode }}</b>
                <small>{{ row.customerName }}</small>
              </div>
              <div class="design-chips">
                <span v-for="type in row.fileTypes" :key="type" class="file-chip file-chip--ok">{{ type }}</span>
                <span v-for="type in row.missingTypes" :key="`missing-${type}`" class="file-chip file-chip--missing">{{ type }}</span>
              </div>
            </NuxtLink>
          </div>
          <div v-else class="panel-empty">Chưa có đơn yêu cầu hồ sơ thiết kế.</div>
        </section>
      </div>

      <div class="bottom-grid">
        <section class="dashboard-panel">
          <div class="panel-heading">
            <div><span class="panel-kicker">Mới cập nhật</span><h3>Đơn hàng gần đây</h3></div>
          </div>
          <div class="table-wrap dashboard-table-wrap">
            <table class="dashboard-table dashboard-table--compact">
              <thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Thanh toán</th><th>Tổng tiền</th></tr></thead>
              <tbody>
                <tr v-for="order in dashboard.recentOrders" :key="order.id">
                  <td><b>{{ order.order_code }}</b><div class="small subtle">{{ formatDateTime(order.order_date) }}</div></td>
                  <td>{{ order.customer_name || '-' }}</td>
                  <td><span class="badge" :class="paymentBadge(order.payment_status)">{{ order.payment_status || 'Chưa thanh toán' }}</span></td>
                  <td><b>{{ money(order.actual_revenue || order.payable_amount || order.total_vat) }}</b></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="dashboard-panel">
          <div class="panel-heading">
            <div><span class="panel-kicker">Dòng tiền</span><h3>Thanh toán gần đây</h3></div>
            <NuxtLink class="panel-link" to="/payments">Mở thanh toán →</NuxtLink>
          </div>
          <div class="table-wrap dashboard-table-wrap">
            <table class="dashboard-table dashboard-table--compact">
              <thead><tr><th>Mã đơn</th><th>Ngày</th><th>Số tiền</th><th>Phương thức</th></tr></thead>
              <tbody>
                <tr v-for="payment in dashboard.recentPayments" :key="payment.id">
                  <td><b>{{ payment.order_code || '-' }}</b></td>
                  <td>{{ formatDateTime(payment.payment_date || payment.created_at) }}</td>
                  <td><b>{{ money(payment.amount) }}</b></td>
                  <td>{{ payment.method || '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>

    <div v-else class="dashboard-page">
      <div class="dashboard-panel panel-empty">Không có dữ liệu dashboard để hiển thị.</div>
    </div>
  </AppShell>
</template>

<style scoped>
.dashboard-page {
  display: grid;
  gap: 18px;
  padding: 0 24px 28px;
}
.dashboard-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dashboard-period-select {
  width: 150px;
  min-width: 150px;
}
.dashboard-hero {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(330px, 0.75fr);
  gap: 24px;
  align-items: center;
  padding: 28px;
  border-radius: 22px;
  color: #fff;
  background:
    radial-gradient(circle at 80% 20%, rgba(96, 165, 250, 0.36), transparent 30%),
    linear-gradient(135deg, #0f2d5c 0%, #173f82 54%, #0f766e 130%);
  box-shadow: 0 18px 42px rgba(15, 45, 92, 0.2);
}
.dashboard-hero::after {
  content: '';
  position: absolute;
  width: 260px;
  height: 260px;
  right: -110px;
  bottom: -150px;
  border: 42px solid rgba(255, 255, 255, 0.08);
  border-radius: 50%;
}
.eyebrow,
.panel-kicker {
  display: block;
  margin-bottom: 7px;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.eyebrow { color: #bfdbfe; }
.dashboard-hero h2 {
  max-width: 720px;
  margin: 0;
  font-size: clamp(26px, 3vw, 40px);
  line-height: 1.12;
  letter-spacing: -0.035em;
}
.dashboard-hero p {
  max-width: 760px;
  margin: 13px 0 0;
  color: #dbeafe;
  line-height: 1.65;
}
.hero-health {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.hero-health > div {
  padding: 15px 12px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 16px;
  text-align: center;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(8px);
}
.hero-health span {
  display: block;
  min-height: 34px;
  color: #dbeafe;
  font-size: 12px;
  line-height: 1.35;
}
.hero-health strong {
  display: block;
  margin-top: 5px;
  font-size: 29px;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
}
.metric-card {
  position: relative;
  overflow: hidden;
  min-width: 0;
  padding: 18px;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.055);
}
.metric-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: #2563eb;
}
.metric-card--paid::before { background: #059669; }
.metric-card--debt::before { background: #dc2626; }
.metric-card--profit::before { background: #7c3aed; }
.metric-card--conversion::before { background: #d97706; }
.metric-card--orders::before { background: #0891b2; }
.metric-label {
  display: block;
  color: #64748b;
  font-size: 12px;
  font-weight: 850;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.metric-card strong {
  display: block;
  overflow: hidden;
  margin-top: 9px;
  color: #0f172a;
  font-size: clamp(19px, 2vw, 27px);
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.metric-card small {
  display: block;
  margin-top: 8px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.4;
}
.dashboard-panel {
  min-width: 0;
  padding: 20px;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.045);
}
.panel-heading {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 18px;
}
.panel-kicker { color: #2563eb; }
.panel-heading h3 {
  margin: 0;
  color: #0f172a;
  font-size: 19px;
  line-height: 1.3;
}
.panel-link {
  flex: 0 0 auto;
  color: #2563eb;
  font-size: 13px;
  font-weight: 800;
}
.panel-link:hover { text-decoration: underline; }
.panel-note {
  margin: 16px 0 0;
  padding: 11px 12px;
  border-radius: 12px;
  color: #64748b;
  background: #f8fafc;
  font-size: 12px;
  line-height: 1.55;
}
.panel-empty {
  padding: 28px 12px;
  color: #64748b;
  text-align: center;
}
.pipeline-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}
.pipeline-card {
  padding: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  background: linear-gradient(180deg, #fff, #f8fafc);
}
.pipeline-topline {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #475569;
  font-size: 12px;
  font-weight: 850;
}
.pipeline-index {
  display: grid;
  width: 27px;
  height: 27px;
  place-items: center;
  border-radius: 9px;
  color: #1d4ed8;
  background: #dbeafe;
  font-size: 11px;
}
.pipeline-card strong {
  display: block;
  margin-top: 14px;
  color: #0f172a;
  font-size: 29px;
}
.pipeline-card small {
  display: block;
  margin-top: 2px;
  color: #64748b;
}
.pipeline-track,
.production-track {
  overflow: hidden;
  height: 6px;
  margin-top: 13px;
  border-radius: 999px;
  background: #e2e8f0;
}
.pipeline-track span,
.production-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #2563eb, #0ea5e9);
}
.operations-grid,
.analytics-grid,
.bottom-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.production-list {
  display: grid;
  gap: 12px;
}
.production-row {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}
.production-number {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 12px;
  color: #334155;
  background: #f1f5f9;
  font-size: 12px;
  font-weight: 900;
}
.production-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: #334155;
  font-size: 13px;
}
.production-meta strong { color: #0f172a; }
.production-track { margin-top: 7px; }
.alert-count,
.design-score {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 6px 10px;
  border-radius: 999px;
  color: #b91c1c;
  background: #fee2e2;
  font-size: 12px;
  font-weight: 850;
}
.design-score {
  color: #166534;
  background: #dcfce7;
}
.alert-list {
  display: grid;
  gap: 9px;
}
.alert-row {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  gap: 11px;
  align-items: center;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #fff;
  transition: transform 150ms ease, box-shadow 150ms ease;
}
.alert-row:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
}
.alert-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #f59e0b;
  box-shadow: 0 0 0 4px #fef3c7;
}
.alert-row--critical .alert-dot {
  background: #dc2626;
  box-shadow: 0 0 0 4px #fee2e2;
}
.alert-copy { min-width: 0; }
.alert-copy b,
.alert-copy small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.alert-copy b { color: #1e293b; font-size: 13px; }
.alert-copy small { margin-top: 3px; color: #64748b; font-size: 12px; }
.alert-arrow { color: #94a3b8; font-weight: 900; }
.chart-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
  color: #64748b;
  font-size: 11px;
}
.chart-legend span { display: inline-flex; align-items: center; gap: 5px; }
.chart-legend i { width: 8px; height: 8px; border-radius: 50%; }
.legend-revenue { background: #2563eb; }
.legend-paid { background: #10b981; }
.legend-profit { background: #8b5cf6; }
.trend-chart {
  display: grid;
  grid-template-columns: repeat(6, minmax(56px, 1fr));
  gap: 12px;
  min-height: 250px;
  padding-top: 12px;
  border-bottom: 1px solid #e2e8f0;
}
.trend-column {
  display: grid;
  grid-template-rows: minmax(190px, 1fr) auto;
  gap: 10px;
  text-align: center;
}
.trend-bars {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 5px;
  min-height: 190px;
}
.trend-bar {
  width: 18%;
  min-width: 8px;
  max-width: 18px;
  border-radius: 7px 7px 2px 2px;
  transition: height 220ms ease;
}
.trend-bar--revenue { background: #2563eb; }
.trend-bar--paid { background: #10b981; }
.trend-bar--profit { background: #8b5cf6; }
.trend-column b { padding-bottom: 11px; color: #64748b; font-size: 11px; }
.profit-list,
.watch-list,
.design-list {
  display: grid;
  gap: 9px;
}
.profit-row,
.watch-row,
.design-row {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: center;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
}
.profit-row b,
.profit-row small,
.watch-main b,
.watch-main small,
.design-row b,
.design-row small { display: block; }
.profit-row small,
.watch-main small,
.design-row small { margin-top: 3px; color: #64748b; font-size: 12px; }
.profit-value { flex: 0 0 auto; text-align: right; }
.profit-value strong { display: block; color: #166534; }
.profit-value span { display: inline-block; margin-top: 3px; color: #7c3aed; font-size: 11px; font-weight: 850; }
.dashboard-table-wrap { box-shadow: none; }
.dashboard-table { min-width: 920px; }
.dashboard-table--compact { min-width: 700px; }
.rate-pill {
  display: inline-flex;
  padding: 5px 8px;
  border-radius: 999px;
  color: #1d4ed8;
  background: #dbeafe;
  font-size: 12px;
  font-weight: 850;
}
.debt-cell { color: #b91c1c; font-weight: 800; }
.watch-row {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
}
.watch-status {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #10b981;
}
.watch-status--warning { background: #f59e0b; }
.watch-status--critical { background: #dc2626; }
.watch-due {
  color: #166534;
  font-size: 12px;
  font-weight: 850;
}
.watch-due--warning { color: #b45309; }
.watch-due--critical { color: #b91c1c; }
.design-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
  margin-bottom: 12px;
}
.design-summary > div {
  padding: 12px;
  border-radius: 14px;
  background: #f8fafc;
  text-align: center;
}
.design-summary span { display: block; color: #64748b; font-size: 11px; }
.design-summary strong { display: block; margin-top: 4px; color: #0f172a; font-size: 22px; }
.design-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
}
.file-chip {
  display: inline-flex;
  padding: 4px 6px;
  border-radius: 7px;
  font-size: 10px;
  font-weight: 900;
}
.file-chip--ok { color: #166534; background: #dcfce7; }
.file-chip--missing { color: #991b1b; background: #fee2e2; text-decoration: line-through; }

@media (max-width: 1450px) {
  .metric-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 1180px) {
  .dashboard-hero { grid-template-columns: 1fr; }
  .pipeline-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .operations-grid,
  .analytics-grid,
  .bottom-grid { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  .dashboard-page { padding: 0 12px 20px; }
  .dashboard-header-actions { width: 100%; flex-wrap: wrap; }
  .dashboard-period-select { flex: 1 1 150px; }
  .dashboard-hero { padding: 21px; border-radius: 18px; }
  .hero-health { grid-template-columns: 1fr; }
  .hero-health span { min-height: 0; }
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pipeline-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .panel-heading { flex-direction: column; }
  .chart-legend { justify-content: flex-start; }
  .trend-chart { overflow-x: auto; }
  .design-summary { grid-template-columns: 1fr; }
  .design-row { align-items: flex-start; flex-direction: column; }
  .design-chips { justify-content: flex-start; }
}
@media (max-width: 460px) {
  .metric-grid,
  .pipeline-grid { grid-template-columns: 1fr; }
  .watch-row { grid-template-columns: 10px minmax(0, 1fr); }
  .watch-due { grid-column: 2; }
}
</style>
