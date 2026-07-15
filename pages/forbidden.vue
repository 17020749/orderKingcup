<script setup lang="ts">
const { permissions, logout } = useAuth()
const routes = [
  ['page.dashboard', '/dashboard'], ['page.orders', '/orders'], ['page.export_requests', '/export-requests'],
  ['page.customers', '/customers'], ['page.products', '/products'], ['page.payments', '/payments'],
  ['page.shipments', '/shipments'], ['page.invoices', '/invoices'], ['page.activity_logs', '/activity-logs'],
  ['page.settings', '/settings/users']
]
const firstAllowed = computed(() => routes.find(([permission]) => permissions.value.includes('*') || permissions.value.includes(permission))?.[1] || '')
</script>
<template>
  <div class="login-page"><div class="login-card"><div class="brand brand-wordmark-wrap" style="margin-bottom:22px"><div class="brand-wordmark" aria-label="KINGCUP"><span class="brand-wordmark-king">KING</span><span class="brand-wordmark-cup">CUP</span></div></div><h1>Bạn không có quyền truy cập</h1><p class="subtle">Tài khoản không được cấp quyền mở trang này.</p><NuxtLink v-if="firstAllowed" class="btn primary" :to="firstAllowed">Về trang được phép</NuxtLink><button v-else class="btn" @click="logout">Đăng xuất</button></div></div>
</template>
