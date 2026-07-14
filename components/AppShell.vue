<script setup lang="ts">
const { appUser, firebaseUser, logout, hasPermission, isAdmin } = useAuth();
const config = useRuntimeConfig().public;
const navItems = [
  { to: "/dashboard", label: "Dashboard", perm: "page.dashboard" },
  { to: "/orders", label: "Đơn hàng", perm: "page.orders" },
  {
    to: "/export-requests",
    label: "Yêu cầu xuất kho",
    perm: "page.export_requests",
  },
  { 
    to: '/warehouse-export-requests', 
    label: 'Kho xử lý YC xuất', 
    perm: 'page.warehouse_export_requests' 
  },
  { to: "/imports", label: "Nhập kho", perm: "page.imports" },
  { to: "/exports", label: "Xuất kho thật", perm: "page.exports" },
  { to: "/inventory", label: "Tồn kho", perm: "page.inventory" },
  {
    to: "/inventory-adjustments",
    label: "Điều chỉnh tồn",
    perm: "page.inventory_adjustments",
  },
  {
    to: "/warehouse-settings",
    label: "Danh mục kho",
    perm: "page.warehouse_settings",
  },
  { to: "/customers", label: "Khách hàng", perm: "page.customers" },
  { to: "/products", label: "Sản phẩm", perm: "page.products" },
  { to: "/payments", label: "Thanh toán", perm: "page.payments" },
  { to: "/shipments", label: "Vận chuyển", perm: "page.shipments" },
  { to: "/activity-logs", label: "Nhật ký", perm: "page.activity_logs" },
  { to: "/settings/users", label: "Người dùng & quyền", perm: "admin.only" },
  { to: "/settings/general", label: "Cài đặt chung", perm: "page.settings" },
];
const visibleNav = computed(() =>
  navItems.filter((item) =>
    item.perm === "admin.only"
      ? isAdmin.value
      : hasPermission(item.perm) || hasPermission("*"),
  ),
);

const navElement = ref<HTMLElement | null>(null);
const navScrollTop = useState<number>("app-shell.nav-scroll-top", () => 0);

function saveNavScroll() {
  if (navElement.value) {
    navScrollTop.value = navElement.value.scrollTop;
  }
}

function restoreNavScroll() {
  if (navElement.value) {
    navElement.value.scrollTop = navScrollTop.value;
  }
}

onMounted(async () => {
  await nextTick();
  restoreNavScroll();
});

watch(
  () => visibleNav.value.length,
  async () => {
    await nextTick();
    restoreNavScroll();
  },
);

onBeforeUnmount(saveNavScroll);
</script>

<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-badge">K</div>
        <div>
          <div>{{ config.appName }}</div>
          <div class="small subtle">Nuxt + Firestore</div>
        </div>
      </div>
      <nav ref="navElement" class="nav" @scroll.passive="saveNavScroll">
        <NuxtLink v-for="item in visibleNav" :key="item.to" :to="item.to"
          ><span>{{ item.label }}</span></NuxtLink
        >
      </nav>
      <div class="sidebar-footer">
        <div>
          <b>{{
            appUser?.display_name || firebaseUser?.displayName || appUser?.email
          }}</b>
        </div>
        <div>{{ appUser?.email }}</div>
        <button
          class="btn ghost"
          style="margin-top: 12px; color: #e2e8f0"
          @click="logout"
        >
          Đăng xuất
        </button>
      </div>
    </aside>
    <main class="main"><slot /></main>
  </div>
</template>
