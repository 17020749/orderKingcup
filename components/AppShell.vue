<script setup lang="ts">
const { appUser, firebaseUser, logout, hasPermission, isAdmin } = useAuth();
const route = useRoute();

type NavItem = { to: string; label: string; perm: string };
type NavGroup = { key: string; label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    key: "business",
    label: "Kinh doanh",
    items: [
      { to: "/dashboard", label: "Dashboard", perm: "page.dashboard" },
      { to: "/orders", label: "Đơn hàng", perm: "page.orders" },
      { to: "/export-requests", label: "Yêu cầu xuất kho", perm: "page.export_requests" },
      { to: "/customers", label: "Khách hàng", perm: "page.customers" },
      { to: "/payments", label: "Thanh toán", perm: "page.payments" },
    ],
  },
  {
    key: "warehouse",
    label: "Kho",
    items: [
      { to: "/imports", label: "Nhập kho", perm: "page.imports" },
      { to: "/warehouse-export-requests", label: "Xử lý yêu cầu xuất", perm: "page.warehouse_export_requests" },
      { to: "/exports", label: "Phiếu xuất kho", perm: "page.exports" },
      { to: "/inventory-adjustments", label: "Điều chỉnh tồn", perm: "page.inventory_adjustments" },
      { to: "/printing", label: "Tiến độ in ấn", perm: "page.printing" },
      { to: "/warehouse-settings", label: "Danh mục kho", perm: "page.warehouse_settings" },
      { to: "/shipments", label: "Vận chuyển", perm: "page.shipments" },
      { to: "/activity-logs", label: "Nhật ký hoạt động", perm: "page.activity_logs" },
      { to: "/settings/users", label: "Người dùng & quyền", perm: "admin.only" },
      { to: "/settings/general", label: "Cài đặt chung", perm: "page.settings" },
    ],
  },
  {
    key: "shared",
    label: "Dùng chung",
    items: [
      { to: "/products", label: "Sản phẩm", perm: "page.products" },
      { to: "/inventory", label: "Tồn kho", perm: "page.inventory" },
    ],
  },
];

function canSeeNavItem(item: NavItem) {
  return item.perm === "admin.only"
    ? isAdmin.value
    : hasPermission(item.perm) || hasPermission("*");
}

const visibleNavGroups = computed(() =>
  navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(canSeeNavItem),
    }))
    .filter((group) => group.items.length),
);

const collapsedGroups = useState<Record<string, boolean>>(
  "app-shell.collapsed-nav-groups",
  () => ({ business: true, warehouse: true, shared: true }),
);

function routeMatches(item: NavItem) {
  return route.path === item.to || route.path.startsWith(`${item.to}/`);
}

function groupIsActive(group: NavGroup) {
  return group.items.some(routeMatches);
}

function toggleNavGroup(key: string) {
  collapsedGroups.value = {
    ...collapsedGroups.value,
    [key]: !collapsedGroups.value[key],
  };
}

function openActiveNavGroup() {
  const activeGroup = visibleNavGroups.value.find(groupIsActive);
  if (!activeGroup || !collapsedGroups.value[activeGroup.key]) return;
  collapsedGroups.value = {
    ...collapsedGroups.value,
    [activeGroup.key]: false,
  };
}

const visibleNavCount = computed(() =>
  visibleNavGroups.value.reduce((count, group) => count + group.items.length, 0),
);

watch(
  () => route.path,
  () => openActiveNavGroup(),
  { immediate: true },
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
  () => visibleNavCount.value,
  async () => {
    openActiveNavGroup();
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
        <div class="brand-wordmark" aria-label="KINGCUP">
          <span class="brand-wordmark-king">KING</span><span class="brand-wordmark-cup">CUP</span>
        </div>
      </div>
      <nav ref="navElement" class="nav" @scroll.passive="saveNavScroll">
        <section
          v-for="group in visibleNavGroups"
          :key="group.key"
          class="nav-section"
          :class="{ active: groupIsActive(group) }"
        >
          <button
            type="button"
            class="nav-group-toggle"
            :aria-expanded="!collapsedGroups[group.key]"
            @click="toggleNavGroup(group.key)"
          >
            <span>{{ group.label }}</span>
            <span class="nav-group-meta">
              <small>{{ group.items.length }}</small>
              <span class="nav-chevron" :class="{ collapsed: collapsedGroups[group.key] }">⌄</span>
            </span>
          </button>
          <div v-show="!collapsedGroups[group.key]" class="nav-group-links">
            <NuxtLink v-for="item in group.items" :key="item.to" :to="item.to">
              <span>{{ item.label }}</span>
            </NuxtLink>
          </div>
        </section>
      </nav>
      <div class="sidebar-footer">
        <NotificationCenter />
        <div style="margin-top: 12px">
          <b>{{
            appUser?.display_name || firebaseUser?.displayName || appUser?.email
          }}</b>
        </div>
        <div>{{ appUser?.email }}</div>
        <button
          class="btn ghost"
          style="margin-top: 12px"
          @click="logout"
        >
          Đăng xuất
        </button>
      </div>
    </aside>
    <main class="main"><slot /></main>
  </div>
</template>
