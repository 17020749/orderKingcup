<script setup lang="ts">
// @ts-ignore Shared ESM manifest is also executed directly by Node client tests.
import {
  NAV_SECTION_DEFINITIONS,
  accessModulesForNavigation,
} from '~/constants/accessMatrix.mjs'

const { appUser, firebaseUser, logout, hasPermission, isAdmin } = useAuth()
const route = useRoute()

type AccessModule = {
  key: string
  path: string
  label: string
  permission?: string
  adminOnly?: boolean
  navSection: string
  navOrder: number
}
type NavItem = { key: string; to: string; label: string; permission?: string; adminOnly?: boolean }
type NavGroup = { key: string; label: string; items: NavItem[] }
type NavEntry =
  | { type: 'item'; key: string; item: NavItem }
  | { type: 'group'; key: string; group: NavGroup }

const accessModules = accessModulesForNavigation() as AccessModule[]
const navSections = NAV_SECTION_DEFINITIONS as Array<{
  key: string
  label: string
  order: number
  grouped: boolean
}>

function toNavItem(module: AccessModule): NavItem {
  return {
    key: module.key,
    to: module.path,
    label: module.label,
    permission: module.permission,
    adminOnly: module.adminOnly === true,
  }
}

function canSeeNavItem(item: NavItem) {
  return item.adminOnly
    ? isAdmin.value
    : Boolean(item.permission && hasPermission(item.permission))
}

const visibleNavEntries = computed<NavEntry[]>(() => {
  const entries: NavEntry[] = []
  for (const section of [...navSections].sort((left, right) => left.order - right.order)) {
    const items = accessModules
      .filter(module => module.navSection === section.key)
      .map(toNavItem)
      .filter(canSeeNavItem)
    if (!items.length) continue

    if (section.grouped) {
      entries.push({
        type: 'group',
        key: section.key,
        group: { key: section.key, label: section.label, items },
      })
    } else {
      items.forEach(item => entries.push({ type: 'item', key: item.key, item }))
    }
  }
  return entries
})

const collapsedGroups = useState<Record<string, boolean>>(
  'app-shell.collapsed-nav-groups',
  () => Object.fromEntries(navSections.filter(section => section.grouped).map(section => [section.key, true])),
)

function routeMatches(item: NavItem) {
  return route.path === item.to || route.path.startsWith(`${item.to}/`)
}

function groupIsActive(group: NavGroup) {
  return group.items.some(routeMatches)
}

function toggleNavGroup(key: string) {
  collapsedGroups.value = {
    ...collapsedGroups.value,
    [key]: !collapsedGroups.value[key],
  }
}

function openActiveNavGroup() {
  const activeGroup = visibleNavEntries.value
    .filter((entry): entry is Extract<NavEntry, { type: 'group' }> => entry.type === 'group')
    .map(entry => entry.group)
    .find(groupIsActive)
  if (!activeGroup || !collapsedGroups.value[activeGroup.key]) return
  collapsedGroups.value = {
    ...collapsedGroups.value,
    [activeGroup.key]: false,
  }
}

const visibleNavCount = computed(() =>
  visibleNavEntries.value.reduce(
    (count, entry) => count + (entry.type === 'group' ? entry.group.items.length : 1),
    0,
  ),
)

watch(
  () => route.path,
  () => openActiveNavGroup(),
  { immediate: true },
)

const navElement = ref<HTMLElement | null>(null)
const navScrollTop = useState<number>('app-shell.nav-scroll-top', () => 0)

function saveNavScroll() {
  if (navElement.value) navScrollTop.value = navElement.value.scrollTop
}

function restoreNavScroll() {
  if (navElement.value) navElement.value.scrollTop = navScrollTop.value
}

onMounted(async () => {
  await nextTick()
  restoreNavScroll()
})

watch(
  () => visibleNavCount.value,
  async () => {
    openActiveNavGroup()
    await nextTick()
    restoreNavScroll()
  },
)

onBeforeUnmount(saveNavScroll)
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
        <template v-for="entry in visibleNavEntries" :key="entry.key">
          <NuxtLink
            v-if="entry.type === 'item'"
            :to="entry.item.to"
            class="nav-standalone-link"
          >
            <span>{{ entry.item.label }}</span>
          </NuxtLink>

          <section
            v-else
            class="nav-section"
            :class="{ active: groupIsActive(entry.group) }"
          >
            <button
              type="button"
              class="nav-group-toggle"
              :aria-expanded="!collapsedGroups[entry.group.key]"
              @click="toggleNavGroup(entry.group.key)"
            >
              <span>{{ entry.group.label }}</span>
              <span class="nav-group-meta">
                <small>{{ entry.group.items.length }}</small>
                <span class="nav-chevron" :class="{ collapsed: collapsedGroups[entry.group.key] }">⌄</span>
              </span>
            </button>
            <div v-show="!collapsedGroups[entry.group.key]" class="nav-group-links">
              <NuxtLink v-for="item in entry.group.items" :key="item.to" :to="item.to">
                <span>{{ item.label }}</span>
              </NuxtLink>
            </div>
          </section>
        </template>
      </nav>
      <div class="sidebar-footer">
        <NotificationCenter />
        <div style="margin-top: 12px">
          <b>{{ appUser?.display_name || firebaseUser?.displayName || appUser?.email }}</b>
        </div>
        <div>{{ appUser?.email }}</div>
        <button class="btn ghost" style="margin-top: 12px" @click="logout">
          Đăng xuất
        </button>
      </div>
    </aside>
    <main class="main"><slot /></main>
  </div>
</template>
