<script setup lang="ts">
const { appUser, firebaseUser, logout, hasPermission, isAdmin } = useAuth()
const config = useRuntimeConfig().public
const navItems = [
  { to: '/dashboard', label: 'Dashboard', perm: 'page.dashboard' },
  { to: '/orders', label: 'Đơn hàng', perm: 'page.orders' },
  { to: '/export-requests', label: 'Phiếu xuất kho', perm: 'page.export_requests' },
  { to: '/customers', label: 'Khách hàng', perm: 'page.customers' },
  { to: '/products', label: 'Sản phẩm', perm: 'page.products' },
  { to: '/payments', label: 'Thanh toán', perm: 'page.payments' },
  { to: '/shipments', label: 'Vận chuyển', perm: 'page.shipments' },
  { to: '/invoices', label: 'Hóa đơn', perm: 'page.invoices' },
  { to: '/activity-logs', label: 'Nhật ký', perm: 'page.activity_logs' },
  { to: '/settings/users', label: 'Người dùng & quyền', perm: 'admin.only' },
  { to: '/settings/general', label: 'Cài đặt chung', perm: 'page.settings' }
]
const visibleNav = computed(() => navItems.filter(item => item.perm === 'admin.only' ? isAdmin.value : (hasPermission(item.perm) || hasPermission('*'))))
</script>

<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="brand"><div class="brand-badge">K</div><div><div>{{ config.appName }}</div><div class="small subtle">Nuxt + Firestore</div></div></div>
      <nav class="nav"><NuxtLink v-for="item in visibleNav" :key="item.to" :to="item.to"><span>{{ item.label }}</span></NuxtLink></nav>
      <div class="sidebar-footer"><div><b>{{ appUser?.display_name || firebaseUser?.displayName || appUser?.email }}</b></div><div>{{ appUser?.email }}</div><button class="btn ghost" style="margin-top:12px;color:#e2e8f0" @click="logout">Đăng xuất</button></div>
    </aside>
    <main class="main"><slot /></main>
  </div>
</template>
