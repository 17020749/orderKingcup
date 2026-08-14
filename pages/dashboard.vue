<script setup lang="ts">
import { formatDateTime, money } from '~/utils/format'
import { reportFirebaseError } from '~/utils/firebaseErrors'
// @ts-ignore Shared ESM constants are also exercised by Node tests.
import {
  DASHBOARD_ORDER_CLASSIFICATIONS,
  DASHBOARD_PERIODS,
} from '~/utils/dashboardSnapshot.mjs'

const { loadDashboardSnapshot } = useDashboardSnapshot()
const { showToast } = useUi()

const loading = ref(true)
const dashboard = ref<any>(null)
const selectedPeriod = ref('month')
const selectedSaleKey = ref('all')
const selectedClassification = ref('all')
const saleSearch = ref('')
const salesSort = ref('revenue_desc')
const dateTimeFrom = ref('')
const dateTimeTo = ref('')

const dashboardTimeRange = computed(() => ({
  from: dateTimeFrom.value,
  to: dateTimeTo.value,
}))

const emptyMetrics = {
  orders: 0,
  customers: 0,
  products: 0,
  newCustomers: 0,
  revenue: 0,
  newRevenue: 0,
  careRevenue: 0,
  agencyRevenue: 0,
  unclassifiedRevenue: 0,
  orderPaid: 0,
  paid: 0,
  cashReceived: 0,
  debt: 0,
  profit: 0,
  collectionRate: 0,
  conversionRate: 0,
  marginRate: 0,
  classifications: {},
}

const emptyPeriod = {
  stats: emptyMetrics,
  salesKpis: [],
  productProfit: [],
}

const currentPeriod = computed(() => (
  dashboard.value?.periods?.[selectedPeriod.value]
  || dashboard.value?.periods?.all
  || emptyPeriod
))

const saleOptions = computed(() => [...(currentPeriod.value.salesKpis || [])]
  .sort((a: any, b: any) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), 'vi')))

const selectedSale = computed(() => (
  selectedSaleKey.value === 'all'
    ? null
    : (currentPeriod.value.salesKpis || []).find((sale: any) => sale.key === selectedSaleKey.value) || null
))

const classificationOptions = computed(() => {
  const rows = [
    { key: 'all', label: 'Tất cả phân loại' },
    ...DASHBOARD_ORDER_CLASSIFICATIONS,
  ]
  if (Number(currentPeriod.value.stats?.unclassifiedRevenue || 0) > 0) {
    rows.push({ key: 'unclassified', label: 'Chưa phân loại' })
  }
  return rows
})

function classificationBucket(source: any, key = selectedClassification.value) {
  if (!source || key === 'all') return source || emptyMetrics
  return source.classifications?.[key] || emptyMetrics
}

const businessScope = computed(() => selectedSale.value || currentPeriod.value.stats || emptyMetrics)
const selectedBusinessMetrics = computed(() => classificationBucket(businessScope.value))

const selectedClassificationLabel = computed(() => (
  classificationOptions.value.find((row: any) => row.key === selectedClassification.value)?.label || 'Tất cả phân loại'
))

const revenueCardLabel = computed(() => (
  selectedClassification.value === 'all'
    ? 'Tổng doanh số'
    : `Doanh số ${selectedClassificationLabel.value}`
))

const scopeLabel = computed(() => {
  const sale = selectedSale.value?.name || selectedSale.value?.email || 'Toàn bộ nhân sự'
  return selectedSale.value ? sale : 'Toàn bộ nhân sự'
})

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

const compositionRows = computed(() => {
  const source = businessScope.value || emptyMetrics
  const rows = [
    { key: 'new', label: 'Số mới', value: Number(source.classifications?.new?.revenue ?? source.newRevenue ?? 0) },
    { key: 'care', label: 'Chăm sóc', value: Number(source.classifications?.care?.revenue ?? source.careRevenue ?? 0) },
    { key: 'agency', label: 'Đại lý', value: Number(source.classifications?.agency?.revenue ?? source.agencyRevenue ?? 0) },
  ]
  const unclassified = Number(source.classifications?.unclassified?.revenue ?? source.unclassifiedRevenue ?? 0)
  if (unclassified > 0) rows.push({ key: 'unclassified', label: 'Chưa phân loại', value: unclassified })
  return rows
})

const topDebtSales = computed(() => [...(currentPeriod.value.salesKpis || [])]
  .filter((row: any) => Number(classificationBucket(row).debt || 0) > 0)
  .sort((a: any, b: any) => Number(classificationBucket(b).debt || 0) - Number(classificationBucket(a).debt || 0))
  .slice(0, 6))

const filteredSalesRows = computed(() => {
  const keyword = saleSearch.value.trim().toLowerCase()
  const rows = (currentPeriod.value.salesKpis || []).filter((row: any) => {
    if (selectedSaleKey.value !== 'all' && row.key !== selectedSaleKey.value) return false
    if (!keyword) return true
    return `${row.name || ''} ${row.email || ''}`.toLowerCase().includes(keyword)
  })

  return [...rows].sort((a: any, b: any) => {
    const aScope = classificationBucket(a)
    const bScope = classificationBucket(b)
    if (salesSort.value === 'revenue_asc') return Number(aScope.revenue || 0) - Number(bScope.revenue || 0)
    if (salesSort.value === 'new_desc') return Number(b.classifications?.new?.revenue || 0) - Number(a.classifications?.new?.revenue || 0)
    if (salesSort.value === 'care_desc') return Number(b.classifications?.care?.revenue || 0) - Number(a.classifications?.care?.revenue || 0)
    if (salesSort.value === 'agency_desc') return Number(b.classifications?.agency?.revenue || 0) - Number(a.classifications?.agency?.revenue || 0)
    if (salesSort.value === 'debt_desc') return Number(bScope.debt || 0) - Number(aScope.debt || 0)
    if (salesSort.value === 'paid_desc') return Number(bScope.orderPaid || bScope.paid || 0) - Number(aScope.orderPaid || aScope.paid || 0)
    if (salesSort.value === 'collection_asc') return Number(aScope.collectionRate || 0) - Number(bScope.collectionRate || 0)
    if (salesSort.value === 'orders_desc') return Number(bScope.orders || 0) - Number(aScope.orders || 0)
    if (salesSort.value === 'name_asc') return String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), 'vi')
    return Number(bScope.revenue || 0) - Number(aScope.revenue || 0)
      || Number(bScope.orders || 0) - Number(aScope.orders || 0)
  })
})

async function loadDashboard(force = false) {
  loading.value = true
  try {
    dashboard.value = await loadDashboardSnapshot(force, dashboardTimeRange.value)
  } catch (error) {
    showToast(reportFirebaseError(error, 'Không tải được dữ liệu dashboard.'), 'error')
  } finally {
    loading.value = false
  }
}

function percent(value: any) {
  return `${Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
}

function ratioPercent(part: any, total: any) {
  const denominator = Number(total || 0)
  return denominator ? (Number(part || 0) / denominator) * 100 : 0
}

function compactMoney(value: any) {
  const amount = Number(value || 0)
  return `${new Intl.NumberFormat('vi-VN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount)}đ`
}

function classificationRevenue(key: string) {
  const source = businessScope.value || emptyMetrics
  return Number(source.classifications?.[key]?.revenue || 0)
}

function compositionWidth(value: any) {
  const revenue = Number(businessScope.value?.revenue || 0)
  return `${Math.max(Number(value || 0) > 0 ? 3 : 0, Math.round(ratioPercent(value, revenue)))}%`
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

function selectSale(key: string) {
  selectedSaleKey.value = selectedSaleKey.value === key ? 'all' : key
}

function clearBusinessFilters() {
  selectedSaleKey.value = 'all'
  selectedClassification.value = 'all'
  saleSearch.value = ''
  salesSort.value = 'revenue_desc'
  dateTimeFrom.value = ''
  dateTimeTo.value = ''
  selectedPeriod.value = 'month'
}

function onPeriodChanged() {
  if (selectedPeriod.value === 'custom') return
  dateTimeFrom.value = ''
  dateTimeTo.value = ''
}

function applyDateTimeRange() {
  if (!dateTimeFrom.value && !dateTimeTo.value) {
    selectedPeriod.value = 'month'
    return
  }
  selectedPeriod.value = 'custom'
  loadDashboard()
}

onMounted(() => loadDashboard())
</script>

<template>
  <AppShell>
    <PageHeader
      title="Dashboard kinh doanh & vận hành"
      subtitle="Doanh số, dòng tiền, công nợ và hiệu quả từng nhân sự trên một màn hình"
    >
      <div class="dashboard-header-actions">
        <button class="btn" :disabled="loading" @click="loadDashboard(true)">
          {{ loading ? 'Đang tải...' : 'Làm mới dữ liệu' }}
        </button>
      </div>
    </PageHeader>

    <LoadingState v-if="loading" />

    <main v-else-if="dashboard" class="dashboard-page">
      <section class="business-filter-panel">
        <div class="business-filter-heading">
          <div>
            <span class="panel-kicker">Tổng quan kinh doanh</span>
            <h2>{{ scopeLabel }}</h2>
            <p>Đơn đã hủy không được tính vào doanh số, lợi nhuận và công nợ.</p>
          </div>
          <button class="filter-reset" type="button" @click="clearBusinessFilters">Xóa bộ lọc</button>
        </div>

        <div class="business-filters">
          <label>
            <span>Thời gian</span>
            <select v-model="selectedPeriod" class="select" @change="onPeriodChanged">
              <option v-for="period in DASHBOARD_PERIODS" :key="period.key" :value="period.key">{{ period.label }}</option>
            </select>
          </label>
          <label>
            <span>Từ ngày giờ</span>
            <input v-model="dateTimeFrom" class="input" type="datetime-local" @change="applyDateTimeRange" />
          </label>
          <label>
            <span>Đến ngày giờ</span>
            <input v-model="dateTimeTo" class="input" type="datetime-local" @change="applyDateTimeRange" />
          </label>
          <label>
            <span>Nhân sự / Sale</span>
            <select v-model="selectedSaleKey" class="select">
              <option value="all">Tất cả nhân sự</option>
              <option v-for="sale in saleOptions" :key="sale.key" :value="sale.key">
                {{ sale.name || sale.email || 'Chưa phân công' }}
              </option>
            </select>
          </label>
          <label>
            <span>Phân loại đơn</span>
            <select v-model="selectedClassification" class="select">
              <option v-for="row in classificationOptions" :key="row.key" :value="row.key">{{ row.label }}</option>
            </select>
          </label>
          <label>
            <span>Sắp xếp bảng</span>
            <select v-model="salesSort" class="select">
              <option value="revenue_desc">Doanh số cao → thấp</option>
              <option value="revenue_asc">Doanh số thấp → cao</option>
              <option value="new_desc">Số mới cao nhất</option>
              <option value="care_desc">Chăm sóc cao nhất</option>
              <option value="agency_desc">Đại lý cao nhất</option>
              <option value="debt_desc">Công nợ cao nhất</option>
              <option value="paid_desc">Đã thu cao nhất</option>
              <option value="collection_asc">Tỷ lệ thu thấp nhất</option>
              <option value="orders_desc">Số đơn nhiều nhất</option>
              <option value="name_asc">Tên A → Z</option>
            </select>
          </label>
        </div>
      </section>

      <section class="metric-grid" aria-label="Chỉ số kinh doanh">
        <article class="metric-card metric-card--revenue">
          <span class="metric-label">{{ revenueCardLabel }}</span>
          <strong>{{ money(selectedBusinessMetrics.revenue) }}</strong>
          <small>{{ selectedBusinessMetrics.orders || 0 }} đơn · {{ scopeLabel }}</small>
          <em v-if="selectedClassification === 'all' && Number(businessScope.unclassifiedRevenue || 0) > 0">
            Chưa phân loại {{ money(businessScope.unclassifiedRevenue) }}
          </em>
        </article>
        <article class="metric-card metric-card--new" :class="{ 'metric-card--selected': selectedClassification === 'new' }">
          <span class="metric-label">Số mới</span>
          <strong>{{ money(classificationRevenue('new')) }}</strong>
          <small>{{ percent(ratioPercent(classificationRevenue('new'), businessScope.revenue)) }} cơ cấu doanh số</small>
        </article>
        <article class="metric-card metric-card--care" :class="{ 'metric-card--selected': selectedClassification === 'care' }">
          <span class="metric-label">Chăm sóc</span>
          <strong>{{ money(classificationRevenue('care')) }}</strong>
          <small>{{ percent(ratioPercent(classificationRevenue('care'), businessScope.revenue)) }} cơ cấu doanh số</small>
        </article>
        <article class="metric-card metric-card--agency" :class="{ 'metric-card--selected': selectedClassification === 'agency' }">
          <span class="metric-label">Đại lý</span>
          <strong>{{ money(classificationRevenue('agency')) }}</strong>
          <small>{{ percent(ratioPercent(classificationRevenue('agency'), businessScope.revenue)) }} cơ cấu doanh số</small>
        </article>
        <article class="metric-card metric-card--paid">
          <span class="metric-label">Đã thu theo đơn</span>
          <strong>{{ money(selectedBusinessMetrics.orderPaid || selectedBusinessMetrics.paid) }}</strong>
          <small>Thu được {{ percent(selectedBusinessMetrics.collectionRate) }} doanh số</small>
          <em>Dòng tiền thực thu kỳ: {{ money(selectedBusinessMetrics.cashReceived) }}</em>
        </article>
        <article class="metric-card metric-card--debt">
          <span class="metric-label">Công nợ</span>
          <strong>{{ money(selectedBusinessMetrics.debt) }}</strong>
          <small>{{ percent(ratioPercent(selectedBusinessMetrics.debt, selectedBusinessMetrics.revenue)) }} doanh số đang phải thu</small>
        </article>
      </section>

      <section class="health-strip" aria-label="Cảnh báo vận hành nhanh">
        <div><span>Quá hạn giao</span><strong>{{ dashboard.stats.overdueOrders || 0 }}</strong></div>
        <div><span>Sắp đến hạn</span><strong>{{ dashboard.stats.dueSoonOrders || 0 }}</strong></div>
        <div><span>Chờ thu tiền</span><strong>{{ dashboard.stats.waitingCollection || 0 }}</strong></div>
        <div><span>Đang sản xuất</span><strong>{{ dashboard.stats.inProduction || 0 }}</strong></div>
      </section>

      <section class="dashboard-panel sales-panel">
        <div class="panel-heading sales-heading">
          <div>
            <span class="panel-kicker">Hiệu quả theo nhân sự</span>
            <h3>Doanh số và công nợ của tất cả người từng có đơn hàng</h3>
            <p class="panel-description">Nhân sự không có đơn trong kỳ vẫn được giữ lại với giá trị 0 để không mất lịch sử.</p>
          </div>
          <span class="sales-count">{{ currentPeriod.salesKpis.length }} nhân sự lịch sử</span>
          <label class="sales-search">
            <span>Tìm nhân sự</span>
            <input v-model="saleSearch" class="input" placeholder="Tên hoặc email..." />
          </label>
        </div>

        <div v-if="filteredSalesRows.length" class="table-wrap dashboard-table-wrap">
          <table class="dashboard-table sales-table">
            <thead>
              <tr>
                <th>Nhân sự</th>
                <th>{{ selectedClassification === 'all' ? 'Tổng DS' : selectedClassificationLabel }}</th>
                <th :class="{ 'column-selected': selectedClassification === 'new' }">Số mới</th>
                <th :class="{ 'column-selected': selectedClassification === 'care' }">Chăm sóc</th>
                <th :class="{ 'column-selected': selectedClassification === 'agency' }">Đại lý</th>
                <th>Đã thu theo đơn</th>
                <th>Công nợ</th>
                <th>% Thu</th>
                <th>Dòng tiền kỳ</th>
                <th>Số đơn</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="sale in filteredSalesRows"
                :key="sale.key"
                :class="{ 'sale-row--selected': selectedSaleKey === sale.key }"
              >
                <td>
                  <button class="sale-link" type="button" @click="selectSale(sale.key)">
                    <b>{{ sale.name || sale.email || 'Chưa phân công' }}</b>
                    <span>{{ sale.email || 'Chưa có email' }}</span>
                  </button>
                </td>
                <td><b>{{ money(classificationBucket(sale).revenue) }}</b></td>
                <td :class="{ 'column-selected': selectedClassification === 'new' }">{{ money(sale.classifications?.new?.revenue) }}</td>
                <td :class="{ 'column-selected': selectedClassification === 'care' }">{{ money(sale.classifications?.care?.revenue) }}</td>
                <td :class="{ 'column-selected': selectedClassification === 'agency' }">{{ money(sale.classifications?.agency?.revenue) }}</td>
                <td>{{ money(classificationBucket(sale).orderPaid || classificationBucket(sale).paid) }}</td>
                <td class="debt-cell">{{ money(classificationBucket(sale).debt) }}</td>
                <td><span class="rate-pill">{{ percent(classificationBucket(sale).collectionRate) }}</span></td>
                <td>{{ money(classificationBucket(sale).cashReceived) }}</td>
                <td>{{ classificationBucket(sale).orders || 0 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="panel-empty">Không có nhân sự phù hợp với bộ lọc.</div>
      </section>

      <div class="analytics-grid">
        <section class="dashboard-panel">
          <div class="panel-heading">
            <div>
              <span class="panel-kicker">Cơ cấu doanh số</span>
              <h3>{{ scopeLabel }}</h3>
            </div>
          </div>
          <div class="composition-list">
            <button
              v-for="row in compositionRows"
              :key="row.key"
              class="composition-row"
              :class="{ 'composition-row--selected': selectedClassification === row.key }"
              type="button"
              @click="selectedClassification = selectedClassification === row.key ? 'all' : row.key"
            >
              <span class="composition-name">{{ row.label }}</span>
              <span class="composition-track"><i :style="{ width: compositionWidth(row.value) }" /></span>
              <strong>{{ money(row.value) }}</strong>
              <small>{{ percent(ratioPercent(row.value, businessScope.revenue)) }}</small>
            </button>
          </div>
        </section>

        <section class="dashboard-panel debt-panel">
          <div class="panel-heading">
            <div>
              <span class="panel-kicker">Công nợ theo nhân sự</span>
              <h3>Ưu tiên khoản cần bám</h3>
            </div>
            <NuxtLink class="panel-link" to="/payments">Mở thanh toán →</NuxtLink>
          </div>
          <div v-if="topDebtSales.length" class="debt-ranking">
            <button v-for="(sale, index) in topDebtSales" :key="sale.key" type="button" @click="selectedSaleKey = sale.key">
              <span class="debt-rank">{{ String(index + 1).padStart(2, '0') }}</span>
              <span class="debt-owner"><b>{{ sale.name || sale.email }}</b><small>{{ classificationBucket(sale).orders || 0 }} đơn trong phạm vi lọc</small></span>
              <strong>{{ money(classificationBucket(sale).debt) }}</strong>
            </button>
          </div>
          <div v-else class="panel-empty">Không có công nợ trong phạm vi đang chọn.</div>
        </section>
      </div>

      <section class="dashboard-panel trend-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Xu hướng 6 tháng</span>
            <h3>Doanh số, dòng tiền thực thu và lợi nhuận</h3>
            <p class="panel-description">Biểu đồ phản ánh toàn bộ dữ liệu theo quyền tài khoản; bộ lọc nhân sự phía trên không làm thay đổi biểu đồ này.</p>
          </div>
          <div class="chart-legend">
            <span><i class="legend-revenue" />Doanh số</span>
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

      <div class="section-divider">
        <div><span>Vận hành</span><h2>Đơn hàng, sản xuất và việc cần xử lý</h2></div>
      </div>

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
            <div class="pipeline-topline"><span class="pipeline-index">0{{ index + 1 }}</span><span>{{ stage.label }}</span></div>
            <strong>{{ stage.count }}</strong>
            <small>{{ compactMoney(stage.amount) }}</small>
            <div class="pipeline-track"><span :style="{ width: pipelineWidth(stage.count) }" /></div>
          </article>
        </div>
      </section>

      <div class="operations-grid">
        <section class="dashboard-panel">
          <div class="panel-heading">
            <div><span class="panel-kicker">Tiến độ sản xuất</span><h3>Đang nằm ở công đoạn nào?</h3></div>
            <NuxtLink class="panel-link" to="/printing">Chi tiết in ấn →</NuxtLink>
          </div>
          <div class="production-list">
            <div v-for="(stage, index) in dashboard.productionStages" :key="stage.key" class="production-row">
              <span class="production-number">{{ String(index + 1).padStart(2, '0') }}</span>
              <div class="production-content">
                <div class="production-meta"><b>{{ stage.label }}</b><strong>{{ stage.count }} đơn</strong></div>
                <div class="production-track"><span :style="{ width: stageWidth(stage.count) }" /></div>
              </div>
            </div>
          </div>
        </section>

        <section class="dashboard-panel alert-panel">
          <div class="panel-heading">
            <div><span class="panel-kicker">Cảnh báo tự động</span><h3>Việc cần xử lý ngay</h3></div>
            <span class="alert-count">{{ dashboard.alerts.length }}</span>
          </div>
          <div v-if="dashboard.alerts.length" class="alert-list">
            <NuxtLink v-for="alert in dashboard.alerts" :key="alert.id" :to="alert.href || '/orders'" class="alert-row" :class="`alert-row--${alert.level}`">
              <span class="alert-dot" />
              <span class="alert-copy"><b>{{ alert.title }}</b><small>{{ alert.description }}</small></span>
              <span class="alert-arrow">→</span>
            </NuxtLink>
          </div>
          <div v-else class="panel-empty">Không có cảnh báo cần xử lý.</div>
        </section>
      </div>

      <div class="analytics-grid">
        <section class="dashboard-panel">
          <div class="panel-heading">
            <div><span class="panel-kicker">Hiệu quả sản phẩm</span><h3>Lợi nhuận theo nhóm</h3></div>
          </div>
          <div v-if="currentPeriod.productProfit.length" class="profit-list">
            <div v-for="row in currentPeriod.productProfit" :key="row.name" class="profit-row">
              <div><b>{{ row.name }}</b><small>{{ row.quantity.toLocaleString('vi-VN') }} sản phẩm · Doanh số {{ compactMoney(row.revenue) }}</small></div>
              <div class="profit-value"><strong>{{ compactMoney(row.profit) }}</strong><span>{{ percent(row.marginRate) }}</span></div>
            </div>
          </div>
          <div v-else class="panel-empty">Chưa có dữ liệu giá vốn/lợi nhuận trong kỳ.</div>
        </section>

        <section class="dashboard-panel">
          <div class="panel-heading">
            <div><span class="panel-kicker">Hồ sơ thiết kế</span><h3>AI / PDF / Demo / Mockup theo đơn</h3></div>
            <span class="design-score">{{ dashboard.designSummary.completeOrders }}/{{ dashboard.designSummary.requiredOrders }} đủ file</span>
          </div>
          <div class="design-summary">
            <div><span>Cần thiết kế</span><strong>{{ dashboard.designSummary.requiredOrders }}</strong></div>
            <div><span>Đủ hồ sơ</span><strong>{{ dashboard.designSummary.completeOrders }}</strong></div>
            <div><span>Còn thiếu</span><strong>{{ dashboard.designSummary.missingOrders }}</strong></div>
          </div>
          <div v-if="dashboard.designSummary.rows.length" class="design-list">
            <NuxtLink v-for="row in dashboard.designSummary.rows" :key="row.id" to="/orders" class="design-row">
              <div><b>{{ row.orderCode }}</b><small>{{ row.customerName }}</small></div>
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
            <div><span class="panel-kicker">Theo dõi giao hàng</span><h3>Đơn cần bám sát</h3></div>
            <NuxtLink class="panel-link" to="/shipments">Mở vận chuyển →</NuxtLink>
          </div>
          <div v-if="dashboard.orderWatchlist.length" class="watch-list">
            <NuxtLink v-for="order in dashboard.orderWatchlist" :key="order.id" to="/orders" class="watch-row">
              <span class="watch-status" :class="`watch-status--${order.alert_level}`" />
              <span class="watch-main"><b>{{ order.order_code }}</b><small>{{ order.customer_name || '-' }} · {{ productionLabel(order.production_stage) }}</small></span>
              <span class="watch-due" :class="`watch-due--${order.alert_level}`">{{ dueLabel(order.days_to_due) }}</span>
            </NuxtLink>
          </div>
          <div v-else class="panel-empty">Không có đơn đang theo dõi.</div>
        </section>

        <section class="dashboard-panel">
          <div class="panel-heading"><div><span class="panel-kicker">Mới cập nhật</span><h3>Đơn hàng gần đây</h3></div></div>
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
      </div>

      <section class="dashboard-panel">
        <div class="panel-heading">
          <div><span class="panel-kicker">Dòng tiền</span><h3>Thanh toán gần đây</h3></div>
          <NuxtLink class="panel-link" to="/payments">Mở thanh toán →</NuxtLink>
        </div>
        <div class="table-wrap dashboard-table-wrap">
          <table class="dashboard-table dashboard-table--compact payments-table">
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
.dashboard-header-actions { display: flex; align-items: center; gap: 10px; }
.panel-kicker {
  display: block;
  margin-bottom: 7px;
  color: #2563eb;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.business-filter-panel {
  padding: 20px;
  border: 1px solid #dbe3ef;
  border-radius: 20px;
  background: linear-gradient(135deg, #f8fbff 0%, #fff 55%, #f8fafc 100%);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.045);
}
.business-filter-heading {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
  margin-bottom: 18px;
}
.business-filter-heading h2 { margin: 0; color: #0f172a; font-size: 24px; letter-spacing: -0.025em; }
.business-filter-heading p,
.panel-description { margin: 6px 0 0; color: #64748b; font-size: 12px; line-height: 1.5; }
.filter-reset {
  flex: 0 0 auto;
  padding: 8px 11px;
  border: 1px solid #dbe3ef;
  border-radius: 10px;
  color: #475569;
  background: #fff;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}
.business-filters {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.business-filters label,
.sales-search { display: grid; gap: 6px; }
.business-filters label > span,
.sales-search > span { color: #64748b; font-size: 11px; font-weight: 850; }
.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.metric-card {
  position: relative;
  overflow: hidden;
  min-width: 0;
  padding: 18px 18px 17px;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.055);
}
.metric-card::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: #2563eb; }
.metric-card--new::before { background: #0ea5e9; }
.metric-card--care::before { background: #7c3aed; }
.metric-card--agency::before { background: #d97706; }
.metric-card--paid::before { background: #059669; }
.metric-card--debt::before { background: #dc2626; }
.metric-card--selected { border-color: #93c5fd; box-shadow: 0 0 0 2px #dbeafe, 0 8px 24px rgba(15, 23, 42, 0.055); }
.metric-label { display: block; color: #64748b; font-size: 12px; font-weight: 850; letter-spacing: 0.04em; text-transform: uppercase; }
.metric-card strong { display: block; overflow: hidden; margin-top: 9px; color: #0f172a; font-size: clamp(22px, 2.2vw, 30px); line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
.metric-card small { display: block; margin-top: 8px; color: #64748b; font-size: 12px; line-height: 1.4; }
.metric-card em { display: block; margin-top: 5px; color: #475569; font-size: 11px; font-style: normal; font-weight: 700; }
.health-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.health-strip > div { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 14px; background: #fff; }
.health-strip span { color: #64748b; font-size: 12px; font-weight: 750; }
.health-strip strong { color: #0f172a; font-size: 20px; }
.dashboard-panel {
  min-width: 0;
  padding: 20px;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.045);
}
.panel-heading { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 18px; }
.panel-heading h3 { margin: 0; color: #0f172a; font-size: 19px; line-height: 1.3; }
.sales-count { display: inline-flex; align-items: center; min-height: 32px; padding: 6px 10px; border-radius: 999px; color: #334155; background: #f1f5f9; font-size: 12px; font-weight: 850; white-space: nowrap; }
.panel-link { flex: 0 0 auto; color: #2563eb; font-size: 13px; font-weight: 800; }
.panel-link:hover { text-decoration: underline; }
.panel-empty { padding: 28px 12px; color: #64748b; text-align: center; }
.sales-heading { align-items: end; }
.sales-search { width: min(280px, 100%); }
.dashboard-table-wrap { box-shadow: none; }
.dashboard-table { min-width: 920px; }
.sales-table { min-width: 1320px; }
.dashboard-table--compact { min-width: 700px; }
.sale-link { display: grid; gap: 3px; padding: 0; border: 0; text-align: left; background: transparent; cursor: pointer; }
.sale-link b { color: #0f172a; }
.sale-link span { color: #64748b; font-size: 11px; }
.sale-row--selected td { background: #eff6ff; }
.column-selected { background: #f0f9ff !important; }
.debt-cell { color: #b91c1c; font-weight: 800; }
.rate-pill { display: inline-flex; padding: 5px 8px; border-radius: 999px; color: #1d4ed8; background: #dbeafe; font-size: 12px; font-weight: 850; }
.analytics-grid,
.operations-grid,
.bottom-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.composition-list { display: grid; gap: 10px; }
.composition-row { display: grid; grid-template-columns: 92px minmax(0, 1fr) 120px 54px; gap: 12px; align-items: center; padding: 11px 12px; border: 1px solid #e2e8f0; border-radius: 13px; background: #fff; cursor: pointer; text-align: left; }
.composition-row--selected { border-color: #93c5fd; background: #eff6ff; }
.composition-name { color: #334155; font-size: 12px; font-weight: 850; }
.composition-track { overflow: hidden; height: 8px; border-radius: 999px; background: #e2e8f0; }
.composition-track i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #2563eb, #0ea5e9); }
.composition-row strong { color: #0f172a; font-size: 13px; text-align: right; }
.composition-row small { color: #64748b; font-size: 11px; text-align: right; }
.debt-ranking { display: grid; gap: 9px; }
.debt-ranking button { display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; gap: 11px; align-items: center; width: 100%; padding: 11px; border: 1px solid #e2e8f0; border-radius: 13px; background: #fff; cursor: pointer; text-align: left; }
.debt-rank { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px; color: #b91c1c; background: #fee2e2; font-size: 11px; font-weight: 900; }
.debt-owner b,
.debt-owner small { display: block; }
.debt-owner b { color: #1e293b; font-size: 13px; }
.debt-owner small { margin-top: 3px; color: #64748b; font-size: 11px; }
.debt-ranking strong { color: #b91c1c; }
.chart-legend { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; color: #64748b; font-size: 11px; }
.chart-legend span { display: inline-flex; align-items: center; gap: 5px; }
.chart-legend i { width: 8px; height: 8px; border-radius: 50%; }
.legend-revenue { background: #2563eb; }
.legend-paid { background: #10b981; }
.legend-profit { background: #8b5cf6; }
.trend-chart { display: grid; grid-template-columns: repeat(6, minmax(56px, 1fr)); gap: 12px; min-height: 250px; padding-top: 12px; border-bottom: 1px solid #e2e8f0; }
.trend-column { display: grid; grid-template-rows: minmax(190px, 1fr) auto; gap: 10px; text-align: center; }
.trend-bars { display: flex; justify-content: center; align-items: flex-end; gap: 5px; min-height: 190px; }
.trend-bar { width: 18%; min-width: 8px; max-width: 18px; border-radius: 7px 7px 2px 2px; transition: height 220ms ease; }
.trend-bar--revenue { background: #2563eb; }
.trend-bar--paid { background: #10b981; }
.trend-bar--profit { background: #8b5cf6; }
.trend-column b { padding-bottom: 11px; color: #64748b; font-size: 11px; }
.section-divider { padding: 10px 4px 0; }
.section-divider span { color: #2563eb; font-size: 11px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
.section-divider h2 { margin: 5px 0 0; color: #0f172a; font-size: 22px; }
.pipeline-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; }
.pipeline-card { padding: 16px; border: 1px solid #e2e8f0; border-radius: 16px; background: linear-gradient(180deg, #fff, #f8fafc); }
.pipeline-topline { display: flex; align-items: center; gap: 8px; color: #475569; font-size: 12px; font-weight: 850; }
.pipeline-index { display: grid; width: 27px; height: 27px; place-items: center; border-radius: 9px; color: #1d4ed8; background: #dbeafe; font-size: 11px; }
.pipeline-card strong { display: block; margin-top: 14px; color: #0f172a; font-size: 29px; }
.pipeline-card small { display: block; margin-top: 2px; color: #64748b; }
.pipeline-track,
.production-track { overflow: hidden; height: 6px; margin-top: 13px; border-radius: 999px; background: #e2e8f0; }
.pipeline-track span,
.production-track span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #2563eb, #0ea5e9); }
.production-list { display: grid; gap: 12px; }
.production-row { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 12px; align-items: center; }
.production-number { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 12px; color: #334155; background: #f1f5f9; font-size: 12px; font-weight: 900; }
.production-meta { display: flex; justify-content: space-between; gap: 12px; color: #334155; font-size: 13px; }
.production-meta strong { color: #0f172a; }
.production-track { margin-top: 7px; }
.alert-count,
.design-score { display: inline-flex; align-items: center; min-height: 32px; padding: 6px 10px; border-radius: 999px; color: #b91c1c; background: #fee2e2; font-size: 12px; font-weight: 850; }
.design-score { color: #166534; background: #dcfce7; }
.alert-list,
.profit-list,
.watch-list,
.design-list { display: grid; gap: 9px; }
.alert-row { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; gap: 11px; align-items: center; padding: 12px; border: 1px solid #e2e8f0; border-radius: 14px; background: #fff; }
.alert-dot { width: 9px; height: 9px; border-radius: 50%; background: #f59e0b; box-shadow: 0 0 0 4px #fef3c7; }
.alert-row--critical .alert-dot { background: #dc2626; box-shadow: 0 0 0 4px #fee2e2; }
.alert-copy { min-width: 0; }
.alert-copy b,
.alert-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.alert-copy b { color: #1e293b; font-size: 13px; }
.alert-copy small { margin-top: 3px; color: #64748b; font-size: 12px; }
.alert-arrow { color: #94a3b8; font-weight: 900; }
.profit-row,
.watch-row,
.design-row { display: flex; justify-content: space-between; gap: 14px; align-items: center; padding: 12px; border: 1px solid #e2e8f0; border-radius: 14px; }
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
.watch-row { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; }
.watch-status { width: 9px; height: 9px; border-radius: 50%; background: #10b981; }
.watch-status--warning { background: #f59e0b; }
.watch-status--critical { background: #dc2626; }
.watch-due { color: #166534; font-size: 12px; font-weight: 850; }
.watch-due--warning { color: #b45309; }
.watch-due--critical { color: #b91c1c; }
.design-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; margin-bottom: 12px; }
.design-summary > div { padding: 12px; border-radius: 14px; background: #f8fafc; text-align: center; }
.design-summary span { display: block; color: #64748b; font-size: 11px; }
.design-summary strong { display: block; margin-top: 4px; color: #0f172a; font-size: 22px; }
.design-chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
.file-chip { display: inline-flex; padding: 4px 6px; border-radius: 7px; font-size: 10px; font-weight: 900; }
.file-chip--ok { color: #166534; background: #dcfce7; }
.file-chip--missing { color: #991b1b; background: #fee2e2; text-decoration: line-through; }

@media (max-width: 1280px) {
  .business-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pipeline-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 980px) {
  .analytics-grid,
  .operations-grid,
  .bottom-grid { grid-template-columns: 1fr; }
  .health-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .panel-heading,
  .business-filter-heading { flex-direction: column; }
  .sales-heading { align-items: flex-start; }
  .sales-search { width: 100%; }
}
@media (max-width: 680px) {
  .dashboard-page { padding: 0 12px 20px; }
  .business-filters,
  .metric-grid,
  .health-strip,
  .pipeline-grid { grid-template-columns: 1fr; }
  .composition-row { grid-template-columns: 78px minmax(0, 1fr) 100px; }
  .composition-row small { display: none; }
  .trend-chart { overflow-x: auto; }
  .chart-legend { justify-content: flex-start; }
  .design-summary { grid-template-columns: 1fr; }
  .design-row { align-items: flex-start; flex-direction: column; }
  .design-chips { justify-content: flex-start; }
}
</style>
