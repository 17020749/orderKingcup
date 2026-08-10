<script setup lang="ts">
import { money } from '~/utils/format'

const { loadDashboardSnapshot } = useDashboardSnapshot()

const mounted = ref(false)
const loading = ref(true)
const dashboard = ref<any>(null)
const selectedPeriod = ref('month')

const periodOptions = [
  { key: 'today', label: 'Hôm nay' },
  { key: '7d', label: '7 ngày' },
  { key: 'month', label: 'Tháng này' },
  { key: 'quarter', label: 'Quý này' },
  { key: 'year', label: 'Năm nay' },
  { key: 'all', label: 'Tất cả' },
]

const currentPeriod = computed(() => (
  dashboard.value?.periods?.[selectedPeriod.value]
  || dashboard.value?.periods?.all
  || { salesKpis: [] }
))

const salesRows = computed(() => [...(currentPeriod.value.salesKpis || [])]
  .sort((a: any, b: any) => Number(b.revenue || 0) - Number(a.revenue || 0)
    || String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), 'vi')))

const maxRevenue = computed(() => Math.max(1, ...salesRows.value.map((row: any) => Number(row.revenue || 0))))
const hasUnclassified = computed(() => salesRows.value.some((row: any) => Number(row.classifications?.unclassified?.revenue || 0) > 0))

function totalBarWidth(value: any) {
  const amount = Number(value || 0)
  if (amount <= 0) return '0%'
  return `${Math.max(3, (amount / maxRevenue.value) * 100)}%`
}

function mixWidth(row: any, key: string) {
  const total = Number(row.revenue || 0)
  if (!total) return '0%'
  return `${Math.max(0, (Number(row.classifications?.[key]?.revenue || 0) / total) * 100)}%`
}

function percent(value: any) {
  return `${Number(value || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 })}%`
}

async function loadChart() {
  loading.value = true
  try {
    dashboard.value = await loadDashboardSnapshot(false)
  } catch (error) {
    console.warn('[KINGCUP_DASHBOARD] Không tải được biểu đồ Sale.', error)
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await nextTick()
  mounted.value = true
  await loadChart()
})
</script>

<template>
  <Teleport v-if="mounted" to=".sales-panel">
    <section class="all-sales-chart" aria-label="Biểu đồ doanh số tất cả Sale">
      <div class="all-sales-chart__heading">
        <div>
          <span class="all-sales-chart__kicker">Biểu đồ tất cả Sale</span>
          <h4>So sánh doanh số và cơ cấu nguồn đơn</h4>
          <p>
            Độ dài thanh thể hiện tổng doanh số giữa các Sale; phần màu bên trong thể hiện Số mới, Chăm sóc và Đại lý.
          </p>
        </div>
        <label class="all-sales-chart__period">
          <span>Thời gian</span>
          <select v-model="selectedPeriod" class="select">
            <option v-for="period in periodOptions" :key="period.key" :value="period.key">{{ period.label }}</option>
          </select>
        </label>
      </div>

      <div class="all-sales-chart__legend" aria-label="Chú thích biểu đồ">
        <span><i class="segment-new" />Số mới</span>
        <span><i class="segment-care" />Chăm sóc</span>
        <span><i class="segment-agency" />Đại lý</span>
        <span v-if="hasUnclassified"><i class="segment-unclassified" />Chưa phân loại</span>
      </div>

      <div v-if="loading" class="all-sales-chart__empty">Đang tải biểu đồ...</div>
      <div v-else-if="salesRows.length" class="all-sales-chart__rows">
        <article v-for="sale in salesRows" :key="sale.key" class="all-sales-chart__row">
          <div class="all-sales-chart__owner">
            <b>{{ sale.name || sale.email || 'Chưa phân công' }}</b>
            <span>{{ sale.orders || 0 }} đơn</span>
          </div>

          <div class="all-sales-chart__plot">
            <div class="all-sales-chart__track">
              <div
                v-if="Number(sale.revenue || 0) > 0"
                class="all-sales-chart__bar"
                :style="{ width: totalBarWidth(sale.revenue) }"
                :title="`Tổng doanh số: ${money(sale.revenue)}`"
              >
                <span class="segment-new" :style="{ width: mixWidth(sale, 'new') }" :title="`Số mới: ${money(sale.classifications?.new?.revenue)}`" />
                <span class="segment-care" :style="{ width: mixWidth(sale, 'care') }" :title="`Chăm sóc: ${money(sale.classifications?.care?.revenue)}`" />
                <span class="segment-agency" :style="{ width: mixWidth(sale, 'agency') }" :title="`Đại lý: ${money(sale.classifications?.agency?.revenue)}`" />
                <span
                  v-if="Number(sale.classifications?.unclassified?.revenue || 0) > 0"
                  class="segment-unclassified"
                  :style="{ width: mixWidth(sale, 'unclassified') }"
                  :title="`Chưa phân loại: ${money(sale.classifications?.unclassified?.revenue)}`"
                />
              </div>
              <span v-else class="all-sales-chart__zero">Chưa có doanh số</span>
            </div>
          </div>

          <div class="all-sales-chart__numbers">
            <b>{{ money(sale.revenue) }}</b>
            <span :class="{ 'has-debt': Number(sale.debt || 0) > 0 }">Nợ {{ money(sale.debt) }}</span>
            <small>Thu {{ percent(sale.collectionRate) }}</small>
          </div>
        </article>
      </div>
      <div v-else class="all-sales-chart__empty">Chưa có dữ liệu Sale trong khoảng thời gian này.</div>
    </section>
  </Teleport>
</template>

<style scoped>
.all-sales-chart {
  margin-top: 22px;
  padding-top: 20px;
  border-top: 1px solid #e2e8f0;
}
.all-sales-chart__heading {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;
}
.all-sales-chart__kicker {
  display: block;
  margin-bottom: 6px;
  color: #2563eb;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.all-sales-chart h4 {
  margin: 0;
  color: #0f172a;
  font-size: 18px;
  line-height: 1.35;
}
.all-sales-chart p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.55;
}
.all-sales-chart__period {
  display: grid;
  flex: 0 0 150px;
  gap: 6px;
}
.all-sales-chart__period > span {
  color: #64748b;
  font-size: 11px;
  font-weight: 850;
}
.all-sales-chart__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 16px 0 14px;
  color: #64748b;
  font-size: 11px;
}
.all-sales-chart__legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.all-sales-chart__legend i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.all-sales-chart__rows {
  display: grid;
  gap: 8px;
}
.all-sales-chart__row {
  display: grid;
  grid-template-columns: minmax(130px, 190px) minmax(220px, 1fr) minmax(130px, 165px);
  gap: 14px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #f1f5f9;
}
.all-sales-chart__row:last-child { border-bottom: 0; }
.all-sales-chart__owner,
.all-sales-chart__numbers {
  min-width: 0;
}
.all-sales-chart__owner b,
.all-sales-chart__owner span,
.all-sales-chart__numbers b,
.all-sales-chart__numbers span,
.all-sales-chart__numbers small {
  display: block;
}
.all-sales-chart__owner b {
  overflow: hidden;
  color: #0f172a;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.all-sales-chart__owner span {
  margin-top: 3px;
  color: #94a3b8;
  font-size: 10px;
}
.all-sales-chart__track {
  position: relative;
  overflow: hidden;
  height: 22px;
  border-radius: 7px;
  background: #f1f5f9;
}
.all-sales-chart__bar {
  display: flex;
  overflow: hidden;
  height: 100%;
  min-width: 3px;
  border-radius: inherit;
}
.all-sales-chart__bar > span { display: block; height: 100%; }
.segment-new { background: #0ea5e9; }
.segment-care { background: #7c3aed; }
.segment-agency { background: #d97706; }
.segment-unclassified { background: #94a3b8; }
.all-sales-chart__zero {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  padding-left: 8px;
  color: #94a3b8;
  font-size: 10px;
}
.all-sales-chart__numbers { text-align: right; }
.all-sales-chart__numbers b {
  color: #0f172a;
  font-size: 12px;
}
.all-sales-chart__numbers span {
  margin-top: 2px;
  color: #64748b;
  font-size: 10px;
}
.all-sales-chart__numbers span.has-debt { color: #b91c1c; font-weight: 800; }
.all-sales-chart__numbers small {
  margin-top: 2px;
  color: #64748b;
  font-size: 10px;
}
.all-sales-chart__empty {
  padding: 24px 12px;
  color: #64748b;
  text-align: center;
}
@media (max-width: 900px) {
  .all-sales-chart__heading { flex-direction: column; }
  .all-sales-chart__period { width: 100%; flex-basis: auto; }
  .all-sales-chart__row { grid-template-columns: 130px minmax(160px, 1fr) 120px; gap: 10px; }
}
@media (max-width: 620px) {
  .all-sales-chart__row {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .all-sales-chart__plot { grid-column: 1 / -1; grid-row: 2; }
  .all-sales-chart__numbers { grid-column: 2; grid-row: 1; }
}
</style>
